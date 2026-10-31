/**
 * Test delle meccaniche 1.2.0 (Node): regole del motore, peggioramento degli eventi,
 * storico del numero, apertura di chi richiama.
 * Uso: node tests/mechanics.test.js
 */
'use strict';
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const LL = loadEngine();
const S = LL.CallState;
const templates = loadTemplates();
const { check, done } = makeChecker();

// Modello di prova: arresto cardiaco con due fasi di peggioramento e apertura per chi richiama
const FIXTURE = {
    id: 9001, code: 'TST_901', version: 1, weight: 100,
    content: {
        code: 'TST_901', title: 'Arresto (prova)', category: 'sanitaria', difficulty: 3, weight: 100,
        caller: { gender: 'f', phone_type: 'mobile', panic_start: 30, ring_patience_s: 60, hold_patience_s: 400, reliability: 1, callback_chance: 1 },
        opening: { calm: 'Mio marito è caduto, respira male!', panic: 'Aiuto! Mio marito respira male!' },
        callback_opening: { calm: 'Ho già chiamato! Mio marito adesso non risponde più!', panic: 'Ho già chiamato! Non risponde più!' },
        facts: {
            indirizzo: { display: '{location.street} {location.number}' },
            respiro: { display: 'Respira a fatica' },
        },
        nodes: [
            { id: 'q_dove', label: 'Mi dica l\'indirizzo.', cost_s: 5, reveals: ['indirizzo'], reply: { calm: '{location.street} {location.number}.' } },
            { id: 'q_respiro', label: 'Respira?', cost_s: 5, reveals: ['respiro'],
                reply: { calm: 'Sì, ma male.', panic: 'Sì… male!' },
                reply_flag: { flag: 'arresto', calm: 'No! Non respira più!', panic: 'Non respira più!' } },
            { id: 'i_rcp', label: 'Iniziamo il massaggio cardiaco.', cost_s: 10, requires_flag: 'arresto', reply: { calm: 'Va bene, mi dica.' } },
        ],
        deterioration: [
            { after_s: 180, panic: 10, line: 'È diventato tutto blu…' },
            { after_s: 60, sets_flag: 'arresto', panic: 20, line: { calm: 'Aspetti… non respira più!', panic: 'Non respira più! Non respira più!' } },
        ],
        truth: { event_type: 'sanitaria.arresto_cardiaco', agencies_required: ['118'],
            severity: { optimal_s: 120, acceptable_s: 300, limit_s: 900 }, critical_facts: ['indirizzo', 'respiro'] },
    },
};

// Fino a quando il costruttore (WP3) non riporta deterioration e callbackOpening, li aggiunge il test
const build0 = LL.CallBuilder.build;
LL.CallBuilder.build = function (tpl, rng, cityData, opts) {
    const c = build0.call(this, tpl, rng, cityData, opts);
    const t = tpl.content;
    if (c.deterioration === undefined && t.deterioration) c.deterioration = t.deterioration;
    if (c.callbackOpening === undefined && t.callback_opening) c.callbackOpening = LL.CallBuilder.resolveString ? {
        calm: LL.CallBuilder.resolveString(t.callback_opening.calm, c.vars),
        panic: LL.CallBuilder.resolveString(t.callback_opening.panic, c.vars),
    } : t.callback_opening;
    return c;
};

const V2 = { version: 2, deterioration: true };
const V2_OFF = { version: 2, deterioration: false };
const run = (e, sec) => { for (let i = 0; i < sec * 10; i++) e.step(); };

/** Motore con solo le chiamate indicate: [{ atMs, tag }]. */
function scripted(rules, items, seed = 11) {
    const e = new LL.Engine({ seed, gameStartSec: 0, durationSec: 3600, rules,
        scheduler: new LL.TemplateScheduler({ templates, city }) });
    e.scheduler.queue = [];
    items.forEach((it, i) => e.scheduler.addCallback({ atMs: it.atMs, parentId: null, incidentTag: it.tag,
        content: LL.CallBuilder.build(FIXTURE, new LL.RNG(seed * 100 + i), city) }));
    const events = [];
    e.events.on('call:deteriorated', (p) => events.push({ id: p.call.id, stage: p.stage, line: p.line, queued: p.queued, ms: e.gameMs }));
    return { e, events };
}

// 1. Regole: valori di default e lettura
{
    const { e } = scripted(undefined, []);
    check(JSON.stringify(e.rules) === '{"version":1,"deterioration":false,"redial":false}', 'regole di default: versione 1, meccaniche spente');
    const { e: e2 } = scripted(Object.assign({ lines: 3 }, V2), []);
    check(e2.rules.version === 2 && e2.rules.deterioration === true && e2.board.lines.length === 3, 'regole dal server: versione, meccaniche e linee');
    check(Object.isFrozen(e2.rules), 'le regole non si cambiano a turno in corso');
}

// 2. Chiamata in attesa oltre after_s: condizione, panico, frase alla ripresa, risposta diversa
{
    const mk = (rules) => {
        const s = scripted(rules, [{ atMs: 0, tag: 'a' }]);
        s.e.step();
        const c = s.e.lineCall(0);
        s.e.dispatch('answer', { callId: c.id }); s.e.step();
        s.e.dispatch('hold', { callId: c.id }); s.e.step();
        run(s.e, 65);
        return Object.assign(s, { c });
    };
    const on = mk(V2);
    const off = mk(V2_OFF);
    const v1 = mk(undefined);
    check(!off.c.dialog.flags.arresto && off.c.deterStage === 0 && !v1.c.dialog.flags.arresto, 'meccanica spenta: nessun peggioramento');
    check(on.c.dialog.flags.arresto === true && on.c.deterStage === 1, 'in attesa oltre after_s: condizione attivata');
    check(Math.abs((on.c.panic - off.c.panic) - 20) < 1e-9, `il panico sale della quantità della fase (+${(on.c.panic - off.c.panic).toFixed(1)})`);
    check(on.events.length === 1 && on.events[0].queued === true && on.events[0].stage === 0 && on.events[0].ms === 60000,
        'evento call:deteriorated a 60 s, frase in sospeso perché in attesa');
    const before = on.c.dialog.transcript.length;
    check(on.c.deterQueue.length === 1 && before === off.c.dialog.transcript.length, 'in attesa la frase non entra nella trascrizione');
    on.e.dispatch('resume', { callId: on.c.id }); on.e.step();
    const last = on.c.dialog.transcript[on.c.dialog.transcript.length - 1];
    check(last.who === 'caller' && /non respira più/i.test(last.text) && last.nodeId === 'det:0' && on.c.deterQueue.length === 0,
        'alla ripresa il chiamante dice la frase del peggioramento');
    check(LL.Dialog.options(on.c).some((o) => o.id === 'i_rcp') && !LL.Dialog.options(off.c).some((o) => o.id === 'i_rcp'),
        'la condizione sblocca le istruzioni (requires_flag)');
    on.e.dispatch('ask', { callId: on.c.id, nodeId: 'q_respiro' }); run(on.e, 6);
    const reply = on.c.dialog.transcript.filter((t) => t.nodeId === 'q_respiro').pop();
    check(reply && /non respira più/i.test(reply.text), `la risposta cambia: «${reply && reply.text}»`);
}

// 3. In linea la frase arriva subito; le fasi sono in ordine di tempo anche se scritte in disordine
{
    const s = scripted(V2, [{ atMs: 0, tag: 'a' }]);
    s.e.step();
    const c = s.e.lineCall(0);
    s.e.dispatch('answer', { callId: c.id }); s.e.step();
    run(s.e, 61);
    const t = c.dialog.transcript;
    check(s.events.length === 1 && s.events[0].queued === false && t[t.length - 1].nodeId === 'det:0', 'chiamata in linea: frase subito nella trascrizione');
    run(s.e, 125);
    check(c.deterStage === 2 && s.events.length === 2 && s.events[1].line === 'È diventato tutto blu…', 'seconda fase a 180 s, con frase semplice');
}

// 4. Il peggioramento si ferma quando l'evento è stato trasferito (anche per le altre chiamate dell'evento)
{
    const s = scripted(V2, [{ atMs: 0, tag: 'a' }, { atMs: 1000, tag: 'a' }]);
    run(s.e, 2);
    const [c1, c2] = [s.e.getCall(1), s.e.getCall(2)];
    s.e.dispatch('answer', { callId: c1.id }); s.e.step();
    s.e.dispatch('transfer', { callId: c1.id, agencies: ['118'] }); s.e.step();
    s.e.dispatch('answer', { callId: c2.id }); s.e.step();
    s.e.dispatch('hold', { callId: c2.id }); s.e.step();
    run(s.e, 200);
    check(c2.incidentKey === c1.incidentKey && c2.deterStage === 0 && !c2.dialog.flags.arresto && s.events.length === 0,
        'evento trasferito: nessuna fase per il testimone in attesa');
}

// 5. Richiamata: storico del numero, apertura da richiamata, condizioni già raggiunte senza frasi
{
    const s = scripted(V2, [{ atMs: 0, tag: 'a' }]);
    s.e.step();
    const c1 = s.e.lineCall(0);
    let guard = 0;
    while (s.e.calls.size < 2 && guard++ < 5000) s.e.step();
    const c2 = s.e.getCall(2);
    check(c1.state === S.ABANDONED && c2 && c2.parentId === c1.id && c2.content.isCallback, 'chi non riceve risposta richiama');
    const hist = s.e.callsByPhone(c1.content.caller.phone);
    check(hist.length === 2 && hist[0].id === c1.id && hist[0].state === S.ABANDONED && hist[0].closedMs === c1.closedMs
        && hist[1].id === c2.id && hist[1].isCallback && Array.isArray(hist[0].agencies), 'callsByPhone: chiamata abbandonata e richiamata dallo stesso numero');
    check(s.e.callsByPhone('+39 000').length === 0 && s.e.callsByPhone(null).length === 0, 'callsByPhone: numero sconosciuto -> elenco vuoto');
    check(c2.dialog.flags.arresto === true && c2.deterStage === 1 && c2.dialog.transcript.length === 0,
        'la richiamata arriva con la situazione già peggiorata (solo condizioni)');
    s.e.dispatch('answer', { callId: c2.id }); s.e.step();
    check(/Ho già chiamato/.test(c2.dialog.transcript[0].text) && c2.content.opening !== c1.content.opening,
        'chi richiama ha un\'apertura diversa (callbackOpening)');
    const ages = s.e.incidentAgeMs(c2);
    check(ages === s.e.gameMs - c1.arrivalMs, 'età dell\'evento dal primo arrivo');
}

// 6. Apertura generica di chi richiama dalle frasi della città (T6), senza estrazioni casuali
{
    const tpl = JSON.parse(JSON.stringify(FIXTURE));
    delete tpl.content.callback_opening;
    const mk = (withLines) => {
        const e = new LL.Engine({ seed: 5, gameStartSec: 0, durationSec: 3600, scheduler: new LL.TemplateScheduler({ templates, city }) });
        e.scheduler.queue = [];
        const content = LL.CallBuilder.build(tpl, new LL.RNG(5), city);
        content.lines = Object.assign({}, content.lines);
        delete content.lines.callback_calm; delete content.lines.callback_panic;   // la città 1.2.0 le ha: qui le togliamo
        if (withLines) Object.assign(content.lines, { callback_calm: 'Ho già chiamato prima, {caller_first}!', callback_panic: 'Ho già chiamato!' });
        e.scheduler.addCallback({ atMs: 0, content, parentId: null });
        let g = 0;
        while (e.calls.size < 2 && g++ < 5000) e.step();
        return e;
    };
    const plain = mk(false);
    const generic = mk(true);
    const cb = generic.getCall(2);
    check(plain.getCall(2).content.opening === plain.getCall(1).content.opening, 'senza frasi generiche la richiamata ripete l\'apertura');
    check(cb.content.opening.calm === `Ho già chiamato prima, ${cb.content.vars.caller_first}!` && cb.content.opening.panic === 'Ho già chiamato!',
        'frase generica della città, con segnaposto risolti');
    check(cb.arrivalMs === plain.getCall(2).arrivalMs, 'stesso istante della richiamata: nessuna estrazione in più');
}

// 7. Turno completo: determinismo, replay con le regole salvate, impronte diverse con meccanica accesa o spenta
const pool = templates.concat([FIXTURE].map((t) => Object.assign({}, t, { weight: 2500 })));

function play(seed, rules, style = 'good') {
    const e = new LL.Engine({ seed, gameStartSec: 79200, durationSec: 21600, rules,
        scheduler: new LL.Director({ templates: pool, city, baseDifficulty: 2 }) });
    while (!e.ended && e.tick < 1e6) {
        if (style !== 'idle') {
            const a = e.activeCall();
            if (a && !a.dialog.pending) {
                const t = a.content.truth;
                const next = LL.Dialog.options(a).find((o) => o.asked === 0 && !a.content.nodesById[o.id].endsCall);
                if (next && a.activeMs < 40000) e.dispatch('ask', { callId: a.id, nodeId: next.id });
                else if (a.holdCount === 0) e.dispatch('hold', { callId: a.id });   // ogni chiamata passa un po' in attesa
                else {
                    const l = a.content.location;
                    const form = { location: { x: l.x, y: l.y, street: l.street, number: l.number, zone: l.zone }, eventType: t.event_type };
                    const twinOf = [...e.calls.values()].find((k) => k.state === S.TRANSFERRED && k.incidentKey === a.incidentKey);
                    if (twinOf) e.dispatch('merge', { callId: a.id, targetId: twinOf.id, form });
                    else if (t.event_type.startsWith('impropria')) e.dispatch('close', { callId: a.id, reason: t.event_type.split('.')[1] });
                    else e.dispatch('transfer', { callId: a.id, agencies: t.agencies_required, form });
                }
            } else if (!a && e.tick % 40 === 0) {
                // il modello di prova resta in attesa oltre la prima fase di peggioramento
                const c = [...e.calls.values()].find((k) => k.state === S.ON_HOLD && k.holdMs >= (k.content.code === 'TST_901' ? 70000 : 5000))
                    || [...e.calls.values()].find((k) => k.state === S.RINGING);
                if (c) e.dispatch(c.state === S.RINGING ? 'answer' : 'resume', { callId: c.id });
            }
        }
        e.step();
    }
    return e;
}

function replay(seed, rules, log) {
    const e = new LL.Engine({ seed, gameStartSec: 79200, durationSec: 21600, rules: JSON.parse(JSON.stringify(rules || {})),
        scheduler: new LL.Director({ templates: pool, city, baseDifficulty: 2 }) });
    const byTick = new Map();
    for (const a of log) { if (a.meta) continue; if (!byTick.has(a.tick)) byTick.set(a.tick, []); byTick.get(a.tick).push(a); }
    while (!e.ended && e.tick < 1e6) { (byTick.get(e.tick) || []).forEach((a) => e.dispatch(a.type, a.payload)); e.step(); }
    return e;
}

{
    const seed = 31337;
    const on = play(seed, V2);
    const on2 = play(seed, V2);
    const off = play(seed, V2_OFF);
    const v1 = play(seed, undefined);
    const fired = [...on.calls.values()].filter((c) => c.deterStage > 0).length;
    console.log(`     chiamate con peggioramento: ${fired} su ${on.calls.size}`);
    check(fired > 0, 'nel turno alcune chiamate peggiorano');
    check(on.fingerprint() === on2.fingerprint(), 'stesse regole, stesso seed, stesse azioni -> stessa impronta');
    const rp = replay(seed, V2, JSON.parse(JSON.stringify(on.log)));
    check(rp.fingerprint() === on.fingerprint(), 'replay con le regole salvate -> risultato identico');
    check(on.fingerprint() !== off.fingerprint(), 'meccanica accesa o spenta -> impronte diverse');
    check(off.fingerprint() !== v1.fingerprint(), 'regole di versione 2: impronta con lo stato del dialogo');
    const rpOff = replay(seed, V2_OFF, JSON.parse(JSON.stringify(on.log)));
    check(rpOff.fingerprint() !== on.fingerprint(), 'replay con regole diverse da quelle salvate -> risultato diverso');

    // Nessuna estrazione casuale: senza operatore gli arrivi sono identici con o senza peggioramento
    const sig = (e) => [...e.calls.values()].map((c) => `${c.arrivalMs}:${c.content.code}:${c.parentId}`).join('|');
    const idleOn = play(seed, V2, 'idle');
    const idleOff = play(seed, V2_OFF, 'idle');
    check(sig(idleOn) === sig(idleOff), 'stessi arrivi, modelli e richiamate con o senza peggioramento');

    // Valutazione: stato finale sempre tra i 5 valori del database, voto ancora buono
    const ev = LL.Scoring.evaluateShift(on, city);
    const finals = new Set(['transferred', 'closed', 'merged', 'abandoned', 'dropped']);
    check(ev.calls.every((c) => finals.has(c.state)), 'stati finali compatibili con il database');
    check(['S', 'A', 'B'].includes(ev.grade), `operatore simulato con peggioramento: voto ${ev.grade} (${ev.percent}/100)`);
}

// 8. Nota "tempo ottimale" solo con regole dalla versione 2 (nessun effetto sul punteggio)
{
    const mk = (rules) => {
        const s = scripted(rules, [{ atMs: 0, tag: 'a' }]);
        s.e.step();
        const c = s.e.lineCall(0);
        s.e.dispatch('answer', { callId: c.id }); s.e.step();
        run(s.e, 20);
        const l = c.content.location;
        s.e.dispatch('transfer', { callId: c.id, agencies: ['118'],
            form: { location: { x: l.x, y: l.y, street: l.street, number: l.number, zone: l.zone }, eventType: 'sanitaria.arresto_cardiaco' } });
        s.e.step();
        return LL.Scoring.evaluateShift(s.e, city).calls[0];
    };
    const a = mk(V2);
    const b = mk(undefined);
    check(a.notes.some((n) => n.key === 'db.note_optimal'), 'v2: nota sui soccorsi entro il tempo ottimale');
    check(!b.notes.some((n) => n.key === 'db.note_optimal'), 'v1: nessuna nota nuova');
    check(a.final === b.final && a.points === b.points, 'la nota non cambia il punteggio');
}

done();
