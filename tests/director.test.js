/**
 * Test del Director: riproducibilità, ritmo, curva di tensione, testimoni, adattamento.
 * Uso: node tests/director.test.js
 */
'use strict';
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const LL = loadEngine();
const S = LL.CallState;
const templates = loadTemplates();
const { check, done } = makeChecker();

function newEngine(seed, base = 2) {
    return new LL.Engine({ seed, gameStartSec: 79200, durationSec: 21600,
        scheduler: new LL.Director({ templates, city, baseDifficulty: base }) });
}

/** style: 'good' usa la verità, 'bad' sbaglia sempre gli enti, 'idle' non risponde mai. */
function play(seed, style, base = 2) {
    const e = newEngine(seed, base);
    while (!e.ended && e.tick < 1e6) {
        if (style !== 'idle') {
            const a = e.activeCall();
            if (a && !a.dialog.pending) {
                const t = a.content.truth;
                const crit = new Set(t.critical_facts);
                const next = LL.Dialog.options(a).find((o) => o.asked === 0 && a.content.nodesById[o.id].reveals.some((r) => crit.has(r)));
                if (next && style === 'good' && !a.content.nodesById[next.id].endsCall) e.dispatch('ask', { callId: a.id, nodeId: next.id });
                else {
                    const l = a.content.location;
                    const form = { location: { x: l.x, y: l.y, street: l.street, number: l.number, zone: l.zone }, eventType: t.event_type };
                    const twinOf = [...e.calls.values()].find((k) => k.state === S.TRANSFERRED && k.incidentKey === a.incidentKey);
                    if (style === 'good' && twinOf) e.dispatch('merge', { callId: a.id, targetId: twinOf.id, form });
                    else if (t.event_type.startsWith('impropria')) e.dispatch('close', { callId: a.id, reason: t.event_type.split('.')[1] });
                    else e.dispatch('transfer', { callId: a.id, agencies: style === 'good' ? t.agencies_required : ['115'], form });
                }
            } else if (!a && e.tick % 10 === 0) {
                const c = [...e.calls.values()].find((k) => k.state === S.RINGING) || [...e.calls.values()].find((k) => k.state === S.ON_HOLD);
                if (c) e.dispatch(c.state === S.RINGING ? 'answer' : 'resume', { callId: c.id });
            }
        }
        e.step();
    }
    return e;
}

function replay(seed, log, base = 2) {
    const e = newEngine(seed, base);
    const byTick = new Map();
    for (const a of log) { if (a.meta) continue; if (!byTick.has(a.tick)) byTick.set(a.tick, []); byTick.get(a.tick).push(a); }
    while (!e.ended && e.tick < 1e6) { (byTick.get(e.tick) || []).forEach((a) => e.dispatch(a.type, a.payload)); e.step(); }
    return e;
}

// 1. Riproducibilità
const g1 = play(4242, 'good');
const rp = replay(4242, JSON.parse(JSON.stringify(g1.log)));
check(g1.fingerprint() === rp.fingerprint(), 'il Director è riproducibile dal registro azioni (anche con l\'adattamento)');
check(JSON.stringify(g1.scheduler.history) === JSON.stringify(rp.scheduler.history), 'stessa curva di tensione nel replay');

// 2. Ritmo del turno
const counts = [];
const lateArrivals = [];
for (let s = 1; s <= 12; s++) {
    const e = play(9000 + s, 'good');
    const primaries = [...e.calls.values()].filter((c) => c.parentId === null && !c.content.isWitness);
    counts.push(primaries.length);
    const firstOfVariant = new Map();
    for (const c of primaries.sort((a, b) => a.arrivalMs - b.arrivalMs)) if (!firstOfVariant.has(c.variantIndex)) firstOfVariant.set(c.variantIndex, c);
    lateArrivals.push(...[...firstOfVariant.values()].filter((c) => c.arrivalMs >= e.durationMs - 10 * 60000));
}
console.log('     chiamate principali per turno:', counts.join(' '));
const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
check(avg >= 12 && avg <= 21, `in media ${avg.toFixed(1)} chiamate principali per turno`);
check(lateArrivals.length === 0, 'nessun nuovo evento negli ultimi 10 minuti');

// 3. Curva: la seconda metà è più tesa della prima, e ci sono picchi sopra la linea di base
{
    const h = g1.scheduler.history;
    const half = h.length / 2;
    const m = (arr) => arr.reduce((a, b) => a + b.base, 0) / arr.length;
    check(m(h.slice(half)) > m(h.slice(0, half)), 'la tensione media cresce nel corso del turno');
    const linear = (x) => 0.12 + 0.42 * (x.ms / g1.durationMs);
    check(h.some((x) => x.base - linear(x) > 0.15), 'ci sono picchi ben sopra la linea di crescita');
    const gaps = [...g1.calls.values()].filter((c) => c.parentId === null).map((c) => c.arrivalMs).sort((a, b) => a - b)
        .map((t, i, a) => (i ? t - a[i - 1] : null)).filter((x) => x !== null);
    check(Math.min(...gaps) < 90000 && Math.max(...gaps) > 20 * 60000, 'ritmo irregolare: raffiche e lunghe pause');
}

// 4. Testimoni e gemelli
{
    let witnesses = 0, sameIncident = 0, twins = 0, twinsDistinct = 0;
    for (let s = 1; s <= 30; s++) {
        const e = play(7000 + s, 'good');
        const calls = [...e.calls.values()];
        for (const c of calls.filter((k) => k.content.isWitness)) {
            witnesses++;
            const primary = calls.find((k) => !k.content.isWitness && k.variantIndex === c.variantIndex && k.incidentKey === c.incidentKey);
            if (primary && c.content.location.x === primary.content.location.x && c.content.caller.phone !== primary.content.caller.phone) sameIncident++;
        }
        const byVariant = new Map();
        for (const c of calls.filter((k) => !k.content.isWitness && k.parentId === null)) {
            if (!byVariant.has(c.variantIndex)) byVariant.set(c.variantIndex, []);
            byVariant.get(c.variantIndex).push(c);
        }
        for (const list of byVariant.values()) {
            if (list.length === 2) { twins++; if (list[0].incidentKey !== list[1].incidentKey && list[0].content.location.zone === list[1].content.location.zone) twinsDistinct++; }
        }
    }
    console.log(`     su 30 turni: ${witnesses} testimoni, ${twins} eventi gemelli`);
    check(witnesses >= 30 && witnesses <= 200 && sameIncident === witnesses, 'i testimoni appartengono allo stesso evento (stesso luogo, chiamante diverso)');
    check(twins > 0 && twinsDistinct === twins, 'i gemelli sono eventi distinti nella stessa zona');
}

// 5. Adattamento: chi sbaglia trova meno pressione, chi va bene di più
{
    const diffAvg = (e) => {
        const l = [...e.calls.values()].filter((c) => c.parentId === null && !c.content.isWitness && c.arrivalMs > e.durationMs / 3);
        return l.reduce((a, c) => a + c.content.difficulty, 0) / l.length;
    };
    let good = 0, bad = 0, adaptG = 0, adaptB = 0;
    for (let s = 1; s <= 10; s++) {
        const eg = play(3000 + s, 'good'); const eb = play(3000 + s, 'bad');
        good += diffAvg(eg); bad += diffAvg(eb);
        adaptG += eg.scheduler.adapt; adaptB += eb.scheduler.adapt;
    }
    console.log(`     difficoltà media dopo il primo terzo: brava ${(good / 10).toFixed(2)}, sbaglia ${(bad / 10).toFixed(2)}`);
    check(adaptG / 10 > 0 && adaptB / 10 < 0, 'l\'adattamento va in direzioni opposte per chi gestisce bene e chi sbaglia');
    check(good > bad, 'chi gestisce bene riceve chiamate più difficili');
}

// 6. Il grado alza la difficoltà
{
    const d = (base) => {
        let sum = 0, n = 0;
        for (let s = 1; s <= 8; s++) {
            const e = play(6000 + s, 'good', base);
            for (const c of e.calls.values()) if (c.parentId === null && !c.content.isWitness) { sum += c.content.difficulty; n++; }
        }
        return sum / n;
    };
    const d1 = d(1), d5 = d(5);
    console.log(`     difficoltà media: grado 1 ${d1.toFixed(2)}, grado 5 ${d5.toFixed(2)}`);
    check(d5 > d1 + 1, 'a grado più alto le chiamate sono in media più difficili');
}

// 7. Valutazione: un buon operatore con il Director ottiene un buon voto e accorpa i testimoni
{
    const ev = LL.Scoring.evaluateShift(g1, city);
    const merged = ev.calls.filter((c) => c.state === S.MERGED);
    check(['S', 'A'].includes(ev.grade), `operatore attento: voto ${ev.grade} (${ev.percent}/100)`);
    check(merged.every((c) => c.axes.agencies === 100), 'testimoni accorpati correttamente');
}

done();
