/**
 * Test di modelli, costruttore e dialogo.
 * Uso: node tests/dialog.test.js
 */
'use strict';
const { loadEngine, loadTemplates, loadFixtures, city, makeChecker, ROOT } = require('./_load');

const LL = loadEngine();
const S = LL.CallState;
const templates = loadTemplates();
const { check, done } = makeChecker();

// 1. Ogni modello, con molti seed, non lascia segnaposto irrisolti e ha una verità valida
let e0 = null;
let unresolved = [];
let badTruth = [];
const agencySets = {};
for (const t of templates) {
    agencySets[t.code] = new Set();
    for (let seed = 1; seed <= 300; seed++) {
        const c = LL.CallBuilder.build(t, new LL.RNG(seed), city);
        const u = LL.CallBuilder.unresolved(c);
        if (t.content.can_duplicate && seed <= 50) u.push(...LL.CallBuilder.unresolved(LL.CallBuilder.buildWitness(t, c, new LL.RNG(seed + 7), city)));
        // anche i segnaposto che il costruttore non riconosce (cifre, maiuscole): resterebbero nel testo
        if (seed <= 20) u.push(...(JSON.stringify([c.opening, c.facts, c.nodes, c.truth, c.callbackOpening, c.timeline, c.idleLines, c.deterioration])
            .match(/\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\}/g) || []));
        if (u.length) unresolved.push(`${t.code}#${seed}: ${u.join(' ')}`);
        if (typeof c.truth.event_type !== 'string' || c.truth.event_type.includes('{')) badTruth.push(`${t.code}#${seed}`);
        agencySets[t.code].add(c.truth.agencies_required.join('+') || 'nessuno');
    }
}
check(unresolved.length === 0, 'nessun segnaposto irrisolto in 300 varianti per modello' + (unresolved.length ? ` (${unresolved.slice(0, 3).join('; ')})` : ''));
check(badTruth.length === 0, 'verità nascosta sempre risolta');
console.log('     enti richiesti per modello:', JSON.stringify(Object.fromEntries(Object.entries(agencySets).map(([k, v]) => [k, [...v]]))));
check(agencySets.SAN_001.has('118+115') && agencySets.SAN_001.has('118'), 'SAN_001: le varianti cambiano gli enti richiesti');
check(agencySets.STR_005.has('PS') && agencySets.STR_005.has('CC'), 'STR_005: competenza PS o CC secondo la zona');

// 2. Stesso seed -> stessa chiamata
const t7 = templates.find((t) => t.code === 'SAN_007');
const a = LL.CallBuilder.build(t7, new LL.RNG(42), city);
const b = LL.CallBuilder.build(t7, new LL.RNG(42), city);
check(JSON.stringify(a) === JSON.stringify(b), 'costruzione deterministica');

// Motore con una sola chiamata controllata
function single(tplCode, seed, panic) {
    const e = new LL.Engine({ seed, gameStartSec: 0, durationSec: 3600,
        scheduler: new LL.TemplateScheduler({ templates, city }) });
    e.scheduler.queue = [];
    const content = LL.CallBuilder.build(templates.find((t) => t.code === tplCode), new LL.RNG(seed), city);
    if (panic !== undefined) content.caller.panicStart = panic;
    e.scheduler.addCallback({ atMs: 0, content, parentId: null });
    e.step();
    const c = e.lineCall(0);
    e.dispatch('answer', { callId: c.id }); e.step();
    return { e, c };
}
const run = (e, sec) => { for (let i = 0; i < sec * 10; i++) e.step(); };

// 3. Domanda: costa tempo, poi arriva la risposta
{
    const { e, c } = single('SAN_007', 7, 20);
    check(c.dialog.transcript.length === 1 && c.dialog.transcript[0].who === 'caller', 'rispondendo, il chiamante pronuncia l\'apertura');
    e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); e.step();
    check(!!c.dialog.pending, 'domanda in corso');
    e.dispatch('ask', { callId: c.id, nodeId: 'q_eta' }); e.step();
    check(c.dialog.transcript.filter((t) => t.who === 'op').length === 1, 'non si può fare una seconda domanda mentre la prima è in corso');
    run(e, 3);
    check(!c.facts.indirizzo, 'a metà tempo la risposta non è ancora arrivata');
    run(e, 4);
    check(!!c.facts.indirizzo && !c.dialog.pending, 'dopo il costo in secondi arriva la risposta con l\'indirizzo');
    e.dispatch('ask', { callId: c.id, nodeId: 'q_respiro' }); e.step();
    check(!c.dialog.pending, 'domanda bloccata finché mancano i prerequisiti');
}

// 4. Nel panico gli errori sono molto più frequenti; da calmo quasi assenti
function errorRate(panic) {
    let errors = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const { e, c } = single('SAN_007', seed, panic);
        e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' });
        run(e, 7);
        if (c.facts.indirizzo && !c.facts.indirizzo.reports[0].correct) errors++;
    }
    return errors / 200;
}
const calmRate = errorRate(10);
const panicRate = errorRate(95);
console.log(`     errori sull'indirizzo: calmo ${(calmRate * 100).toFixed(0)}%, nel panico ${(panicRate * 100).toFixed(0)}%`);
check(calmRate < 0.12 && panicRate > 0.3, 'il panico aumenta gli errori del chiamante');

// 5. Rassicurare abbassa il panico, sempre meno se ripetuto
{
    const { e, c } = single('SAN_007', 3, 90);
    const p0 = c.panic;
    e.dispatch('ask', { callId: c.id, nodeId: 'a_rassicura' }); run(e, 9);
    const p1 = c.panic;
    e.dispatch('ask', { callId: c.id, nodeId: 'a_rassicura' }); run(e, 9);
    const p2 = c.panic;
    check(p0 - p1 > 20, 'la prima rassicurazione abbassa molto il panico');
    check(p1 - p2 > 0 && p1 - p2 < p0 - p1, 'la seconda funziona meno');
}

// 6. Verifica ripetendo la domanda: risposte diverse -> discordanza segnalata
{
    let found = false;
    for (let seed = 1; seed <= 200 && !found; seed++) {
        const { e, c } = single('SAN_007', seed, 95);
        e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); run(e, 7);
        e.dispatch('ask', { callId: c.id, nodeId: 'a_rassicura' }); run(e, 9);
        e.dispatch('ask', { callId: c.id, nodeId: 'a_rassicura' }); run(e, 9);
        e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); run(e, 7);
        const f = LL.Dialog.collected(c).find((x) => x.key === 'indirizzo');
        if (f && f.conflict) found = true;
    }
    check(found, 'richiedendo l\'indirizzo si possono scoprire risposte discordanti');
}

// 7. Silenzio dell'operatore: il panico sale
{
    const { e, c } = single('SAN_001', 5, 30);
    const p0 = c.panic;
    run(e, 20);
    check(c.panic > p0 + 5, 'restare in silenzio fa salire il panico');
}

// 8. Attesa durante una domanda: la domanda va persa
{
    const { e, c } = single('SAN_001', 5, 30);
    e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); run(e, 2);
    e.dispatch('hold', { callId: c.id }); e.step();
    const lastOp = c.dialog.transcript.filter((t) => t.who === 'op').pop();
    check(c.state === S.ON_HOLD && !c.dialog.pending && lastOp.interrupted, 'mettere in attesa interrompe la domanda in corso');
}

// 9. Una domanda può far riattaccare il chiamante (scherzo)
{
    const { e, c } = single('IMP_004', 2, 5);
    e.dispatch('ask', { callId: c.id, nodeId: 'q_adulto' }); run(e, 6);
    check(c.state === S.DROPPED && e.board.occupied() === 0, 'lo scherzatore riattacca e la linea si libera');
}

// 10. Interprete: senza, l'indirizzo resta vago; con, arriva l'indirizzo esatto e la domanda sparisce
{
    const { e, c } = single('SAN_010', 3, 40);
    e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); run(e, 7);
    const vague = c.facts.indirizzo.reports[0];
    e.dispatch('ask', { callId: c.id, nodeId: 'a_interprete' }); run(e, 21);
    const hidden = !LL.Dialog.options(c).some((o) => o.id === 'a_interprete');
    e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); run(e, 7);
    const precise = c.facts.indirizzo.reports[1];
    check(!vague.correct && precise.correct && precise.display.includes(c.content.location.street) && hidden,
        'senza interprete indirizzo vago, con interprete indirizzo esatto (e l\'opzione sparisce)');
}

// 11. Batteria scarica: la linea cade dopo il tempo previsto
{
    const { e, c } = single('SAN_012', 4, 30);
    const limit = c.content.dropAtActiveMs;
    run(e, limit / 1000 - 2);
    const alive = c.state === S.ACTIVE;
    run(e, 3);
    check(limit >= 50000 && limit <= 80000 && alive && c.state === S.DROPPED, `la linea dell'escursionista cade dopo ${limit / 1000} s di conversazione`);
}

// 12. Bambino da linea fissa: indirizzo di intestazione disponibile, e in attesa riattacca in fretta
{
    const { e, c } = single('SAN_014', 6, 40);
    check(!!c.content.directory && !c.content.aml && c.content.directory.street === c.content.location.street, 'il bambino chiama da un fisso: c\'è l\'indirizzo di intestazione');
    e.dispatch('hold', { callId: c.id }); e.step();
    run(e, c.content.caller.holdPatienceSec + 1);
    check(c.state === S.ABANDONED, `messo in attesa, il bambino riattacca (pazienza ${c.content.caller.holdPatienceSec} s)`);
}

// 13. Chiamata in codice: dire "ha sbagliato numero" la fa riattaccare; le domande sì/no sbloccano il resto
{
    const a = single('SIC_015', 2, 75);
    e0 = a.e;
    const before = LL.Dialog.options(a.c).map((o) => o.id);
    a.e.dispatch('ask', { callId: a.c.id, nodeId: 'q_errore' }); run(a.e, 7);
    check(a.c.state === S.DROPPED, 'dirle che ha sbagliato numero la fa riattaccare');
    const b = single('SIC_015', 2, 75);
    b.e.dispatch('ask', { callId: b.c.id, nodeId: 'q_pericolo' }); run(b.e, 7);
    const after = LL.Dialog.options(b.c).map((o) => o.id);
    check(!before.includes('q_indirizzo') && after.includes('q_indirizzo') && after.includes('q_armi'), 'confermato il pericolo, si sbloccano indirizzo «per la consegna» e le altre domande chiuse');
}

// 14. Testimone: stesso evento, nuovo chiamante, apertura da testimone
{
    const tpl = templates.find((t) => t.code === 'STR_013');
    const base = LL.CallBuilder.build(tpl, new LL.RNG(5), city);
    const w = LL.CallBuilder.buildWitness(tpl, base, new LL.RNG(6), city);
    check(w.isWitness && w.location === base.location && w.caller.phone !== base.caller.phone && w.opening.calm.includes(base.location.street)
        && JSON.stringify(w.truth) === JSON.stringify(base.truth), 'il testimone condivide luogo e verità, con chiamante e apertura propri');
    check(LL.CallBuilder.unresolved(w).length === 0, 'nessun segnaposto irrisolto nel testimone');
}

/* ================= 1.2.0: campi nuovi dei modelli (fixture in tests/fixtures/t120) ================= */

const fixtures = loadFixtures('t120');
const fx = (code) => fixtures.find((t) => t.code === code);
const T901 = fx('TST_901');
const T902 = fx('TST_902');

/** Come single(), ma con un modello qualsiasi; raccoglie gli eventi dialog:reply. */
function singleT(tpl, seed, panic) {
    const e = new LL.Engine({ seed, gameStartSec: 0, durationSec: 3600,
        scheduler: new LL.TemplateScheduler({ templates, city }) });
    e.scheduler.queue = [];
    const content = LL.CallBuilder.build(tpl, new LL.RNG(seed), city);
    if (panic !== undefined) content.caller.panicStart = panic;
    e.scheduler.addCallback({ atMs: 0, content, parentId: null });
    const replies = [];
    e.events.on('dialog:reply', (p) => replies.push(p));
    e.step();
    const c = e.lineCall(0);
    e.dispatch('answer', { callId: c.id }); e.step();
    return { e, c, replies };
}
const askAndWait = (e, c, nodeId, sec) => { e.dispatch('ask', { callId: c.id, nodeId }); run(e, sec); };
const callerLines = (c, nodeId) => c.dialog.transcript.filter((t) => t.who === 'caller' && t.nodeId === nodeId);

// 15. Fixture: nessun segnaposto irrisolto, anche negli elenchi, nella cronologia e nella richiamata
{
    const bad = [];
    for (const t of fixtures) {
        for (let seed = 1; seed <= 300; seed++) {
            const c = LL.CallBuilder.build(t, new LL.RNG(seed), city);
            const u = LL.CallBuilder.unresolved(c);
            if (t.content.can_duplicate) u.push(...LL.CallBuilder.unresolved(LL.CallBuilder.buildWitness(t, c, new LL.RNG(seed + 7), city)));
            if (u.length) bad.push(`${t.code}#${seed}: ${u.join(' ')}`);
        }
    }
    check(bad.length === 0, 'fixture 1.2.0: nessun segnaposto irrisolto in 300 varianti' + (bad.length ? ` (${bad.slice(0, 3).join('; ')})` : ''));
}

// 16. Nessuna estrazione nuova sul flusso della chiamata: con o senza i campi 1.2.0 la chiamata è la stessa
{
    const base = templates.find((t) => t.code === 'SAN_007');
    const rich = JSON.parse(JSON.stringify(base));
    Object.assign(rich.content, {
        timeline: T901.content.timeline.slice(0, 1),
        idle_lines: T901.content.idle_lines,
        callback_opening: { calm: 'Sono di nuovo io.' },
        deterioration: T901.content.deterioration,
    });
    rich.content.caller.voice = { age: 'elderly', style: 'crying' };
    let same = true;
    for (let seed = 1; seed <= 50 && same; seed++) {
        const r1 = new LL.RNG(seed);
        const r2 = new LL.RNG(seed);
        const a1 = LL.CallBuilder.build(base, r1, city);
        const a2 = LL.CallBuilder.build(rich, r2, city);
        const legacy = (x) => JSON.stringify([x.opening, x.facts, x.nodes.map((n) => [n.id, n.reply, n.error]), x.truth, x.location, x.aml,
            x.dropAtActiveMs, x.caller.name, x.caller.phone, x.caller.panicStart, x.caller.ringPatienceSec, x.caller.voice]);
        same = legacy(a1) === legacy(a2) && r1.uint32() === r2.uint32();
    }
    check(same, 'i campi 1.2.0 non cambiano le estrazioni del flusso della chiamata (né la sua posizione dopo la costruzione)');
    // i campi assenti nel modello restano null nel contenuto costruito
    const noNew = templates.every((t) => {
        const k = t.content;
        const c = LL.CallBuilder.build(t, new LL.RNG(3), city);
        return (k.timeline ? c.timeline !== null : c.timeline === null) && (k.idle_lines ? true : c.idleLines === null)
            && (k.callback_opening ? true : c.callbackOpening === null) && (k.deterioration ? true : c.deterioration === null)
            && c.nodes.every((n, i) => (k.nodes[i].repeat ? true : n.repeat === null) && (k.nodes[i].switch_caller ? true : n.switchCaller === null));
    });
    check(noNew, 'i campi 1.2.0 assenti nel modello restano null (cronologia, attesa, richiamata, ripetizioni, cambi di interlocutore)');
}

// 17. Testi a elenco: la seconda richiesta usa il secondo elemento; apertura stabile dal telefono
{
    const { e, c, replies } = singleT(T901, 11, 10);
    const open = c.content.opening.calm;
    check(c.dialog.transcript[0].text === open[LL.hashString(c.content.caller.phone) % open.length], 'apertura a elenco: elemento scelto dal numero di telefono');
    askAndWait(e, c, 'q_dove', 7);
    askAndWait(e, c, 'q_dove', 7);
    const r = callerLines(c, 'q_dove');
    const calm = c.content.nodesById.q_dove.reply.calm;
    check(r.length === 2 && r[0].text === calm[0] && r[1].text === calm[1], 'stessa domanda due volte: la seconda risposta è arr[1]');
    const last = replies.filter((p) => p.nodeId === 'q_dove').pop();
    check(last && last.entry === r[1] && last.lvl === 'calm' && last.speaker === null && last.call === c,
        'dialog:reply porta { call, nodeId, entry, lvl, speaker }');
}

// 18. repeat: dalla seconda risposta; elenco di ripetizioni in ordine
{
    const { e, c } = singleT(T901, 12, 10);
    askAndWait(e, c, 'q_eta', 5); askAndWait(e, c, 'q_eta', 5); askAndWait(e, c, 'q_eta', 5);
    const r = callerLines(c, 'q_eta').map((x) => x.text);
    const n = c.content.nodesById.q_eta;
    check(r[0] === n.reply.calm && r[1] === n.repeat.calm[0] && r[2] === n.repeat.calm[1], 'repeat: prima la risposta, poi le ripetizioni in ordine');
}

// 19. Prefisso "Gliel'ho già detto!" nel panico: sì sulle domande senza errore, mai su errori o nodi che possono sbagliare
{
    const prefix = city.generic_lines.repeat_panic;
    const a = singleT(T902, 4, 75);
    askAndWait(a.e, a.c, 'q_sveglia', 6); askAndWait(a.e, a.c, 'q_sveglia', 6);
    const r = callerLines(a.c, 'q_sveglia');
    check(!r[0].text.startsWith(prefix) && r[1].text === `${prefix} ${a.c.content.nodesById.q_sveglia.reply.calm}`,
        'nel panico la domanda ripetuta riceve il prefisso «' + prefix + '»');
    const b = singleT(T901, 4, 90);
    askAndWait(b.e, b.c, 'q_colore', 6); askAndWait(b.e, b.c, 'q_colore', 6);
    const rb = callerLines(b.c, 'q_colore');
    check(rb.length === 2 && rb.every((x) => x.error && !x.text.startsWith(prefix)), 'nessun prefisso sulle risposte sbagliate');
    let leaked = false;
    for (let seed = 1; seed <= 40; seed++) {
        const s = singleT(T902, seed, 80);
        askAndWait(s.e, s.c, 'q_dove', 7); askAndWait(s.e, s.c, 'q_dove', 7);
        if (callerLines(s.c, 'q_dove').some((x) => x.text.startsWith(prefix))) leaked = true;
    }
    check(!leaked, 'nessun prefisso sui nodi che possono sbagliare (non tradisce la risposta sbagliata)');
    // rassicurare due volte non è una domanda ripetuta: niente «Gliel'ho già detto!»
    const r7 = singleT(templates.find((t) => t.code === 'SAN_007'), 2, 100);
    askAndWait(r7.e, r7.c, 'a_rassicura', 10); askAndWait(r7.e, r7.c, 'a_rassicura', 10);
    const rr = callerLines(r7.c, 'a_rassicura');
    check(rr.length === 2 && r7.c.panic >= 60 && !rr.some((x) => x.text.startsWith(prefix)), 'nessun prefisso sulle rassicurazioni ripetute');
}

// 20. Terzo livello: hyst da panico 85
{
    const { e, c, replies } = singleT(T901, 5, 90);
    check(c.dialog.transcript[0].text === c.content.opening.hyst, 'apertura hyst con panico 90');
    askAndWait(e, c, 'q_dove', 7);
    const r = replies.find((p) => p.nodeId === 'q_dove');
    check(r && r.lvl === 'hyst' && r.entry.text === c.content.nodesById.q_dove.reply.hyst, 'risposta hyst con panico 90 (lvl "hyst" nell\'evento)');
    const s = singleT(templates.find((t) => t.code === 'SAN_007'), 5, 95);
    check(s.c.dialog.transcript[0].text === s.c.content.opening.panic, 'senza testo hyst si usa quello di panico');
}

// 21. Cronologia: scatta una volta al tempo estratto, interrompe la domanda, si ferma in attesa, è riproducibile
{
    const seed = 21;
    const tl = LL.CallBuilder.build(T901, new LL.RNG(seed), city).timeline.find((t) => t.id === 'smette');
    const expected = new LL.RNG(LL.hashString(seed + ':timeline')).int(60, 90) * 1000;
    check(tl.atMs === expected, `tempo della cronologia estratto dal flusso "timeline" (${tl.atMs / 1000} s)`);

    const { e, c, replies } = singleT(T901, seed, 10);
    while (c.activeMs < tl.atMs - 2000) e.step();
    e.dispatch('ask', { callId: c.id, nodeId: 'q_eta' });
    while (c.activeMs < tl.atMs - 100) e.step();
    const before = callerLines(c, 'tl:smette').length;
    e.step();
    const fired = callerLines(c, 'tl:smette').length;
    run(e, 30);
    const op = c.dialog.transcript.filter((t) => t.who === 'op' && t.nodeId === 'q_eta').pop();
    check(before === 0 && fired === 1 && callerLines(c, 'tl:smette').length === 1, 'la voce scatta esattamente al tempo estratto, una sola volta');
    check(op.interrupted && !c.dialog.asked.q_eta, 'una voce "interrupt" interrompe la domanda in corso');
    check(c.dialog.flags.arresto && replies.some((p) => p.nodeId === 'tl:smette'), 'la voce attiva la condizione ed emette dialog:reply con nodeId tl:<id>');

    const h = singleT(T901, seed, 10);
    while (h.c.activeMs < tl.atMs - 5000) h.e.step();
    h.e.dispatch('hold', { callId: h.c.id }); run(h.e, 40);
    const frozen = h.c.activeMs;
    const onHold = callerLines(h.c, 'tl:smette').length;
    h.e.dispatch('resume', { callId: h.c.id }); run(h.e, 6);
    check(onHold === 0 && frozen === tl.atMs - 5000 &&callerLines(h.c, 'tl:smette').length === 1,
        'in attesa il tempo della conversazione si ferma: la voce scatta solo dopo la ripresa');

    const script = () => {
        const s = singleT(T901, seed, 30);
        askAndWait(s.e, s.c, 'q_dove', 7); run(s.e, 50); askAndWait(s.e, s.c, 'q_respiro', 7); run(s.e, 40);
        return [s.e.fingerprint(), LL.Dialog.fingerprintState(s.c.dialog), JSON.stringify(s.c.dialog.transcript)];
    };
    check(JSON.stringify(script()) === JSON.stringify(script()), 'la cronologia è riproducibile (stessa impronta)');

    const v = singleT(T901, seed, 10);
    askAndWait(v.e, v.c, 'q_eta', 25);
    const w = singleT(T901, seed, 10);
    run(w.e, 25);
    check(callerLines(v.c, 'tl:vicino').length === 0 && callerLines(w.c, 'tl:vicino').length === 1
        && w.c.facts.eta.reports[0].nodeId === 'tl:vicino', 'unless_asked: la voce non scatta se la domanda è già stata fatta; reveals annota il fatto');
}

// 22. Frasi nel silenzio: dopo 12 s, a turno; il panico continua a salire
{
    const { e, c } = singleT(T901, 30, 10);
    const p0 = c.panic;
    run(e, 12.5);
    const idle = callerLines(c, 'idle');
    check(idle.length === 1 && idle[0].text === c.content.idleLines.calm[0] && c.panic > p0, 'dopo 12 s di silenzio una frase di attesa, e il panico sale');
    run(e, 25);
    const all = callerLines(c, 'idle');
    check(all.length >= 2 && all[1].text !== all[0].text, 'le frasi di attesa si alternano');
    check(LL.CallBuilder.build(templates[0], new LL.RNG(1), city).idleLines === null, 'nessuna frase di attesa nei modelli che non le prevedono');
}

// 23. Cambio di interlocutore: nuova voce, panico e affidabilità; le frasi sono etichettate
{
    let errBefore = 0;
    let errAfter = 0;
    let tagged = true;
    let opening = true;
    let unlocked = true;
    for (let seed = 1; seed <= 60; seed++) {
        const { e, c, replies } = singleT(T902, seed, 50);
        askAndWait(e, c, 'q_dove', 7);
        if (callerLines(c, 'q_dove')[0].error) errBefore++;
        askAndWait(e, c, 'q_vicina', 8.1);
        const panicAfter = c.panic;
        const sp = c.dialog.speaker;
        const noOpeningYet = callerLines(c, 'sw:q_vicina').length === 0;
        run(e, 2.5);
        const op = callerLines(c, 'sw:q_vicina')[0];
        opening = opening && noOpeningYet && !!op && op.text.includes(c.content.vars.caller_first) && panicAfter <= 21 && !!sp && sp.name === 'La vicina';
        unlocked = unlocked && LL.Dialog.options(c).some((o) => o.id === 'q_piano') && !LL.Dialog.options(c).some((o) => o.id === 'q_vicina');
        askAndWait(e, c, 'q_dove', 7);
        const after = callerLines(c, 'q_dove')[1];
        if (after.error) errAfter++;
        const ev = replies.filter((p) => p.nodeId === 'q_dove').pop();
        tagged = tagged && after.speaker && after.speaker.name === 'La vicina' && after.speaker.gender === 'f'
            && after.speaker.voice.age === 'elderly' && ev.speaker === after.speaker && !callerLines(c, 'q_vicina')[0].speaker;
    }
    console.log(`     errori sull'indirizzo: bambino ${errBefore}/60, vicina ${errAfter}/60`);
    check(errBefore > 30 && errAfter === 0, 'dopo il cambio gli errori usano l\'affidabilità della nuova persona');
    check(opening, 'la nuova persona si presenta circa 2 s dopo, con il proprio panico iniziale');
    check(tagged, 'le frasi dopo il cambio hanno speaker { name, gender, voice }, anche nell\'evento');
    check(unlocked, 'il cambio sblocca le domande riservate all\'adulto');
}

// 24. Costruttore: richiamata, profilo voce, accordo di genere
{
    const c = LL.CallBuilder.build(T901, new LL.RNG(8), city);
    check(typeof c.callbackOpening.calm === 'string' && c.callbackOpening.calm.includes(c.vars.caller_first) && Array.isArray(c.callbackOpening.panic),
        'callback_opening risolto in content.callbackOpening');
    const vp = c.caller.voiceProfile;
    check(vp.age === 'elderly' && vp.accent === 'de' && vp.style === 'breathless' && vp.kind === (c.caller.gender === 'f' ? 'female' : 'male')
        && c.caller.voice === (c.caller.gender === 'f' ? 'female' : 'male'), 'voce come oggetto: voiceProfile completo, stringa voice invariata');
    let gOk = true;
    for (let seed = 1; seed <= 30; seed++) {
        const k = LL.CallBuilder.build(T901, new LL.RNG(seed), city);
        gOk = gOk && k.nodesById.a_rassicura.label === `Stia tranquill${k.caller.gender === 'f' ? 'a' : 'o'}, l'ambulanza sta arrivando.`;
    }
    check(gOk, '{g.o} segue il genere estratto del chiamante');
    const b = LL.CallBuilder.build(T902, new LL.RNG(8), city);
    const w = LL.CallBuilder.buildWitness(T902, b, new LL.RNG(9), city);
    check(b.caller.voice === 'child' && b.caller.voiceProfile.kind === 'child' && w.caller.voiceProfile.style === 'whisper'
        && w.caller.voice !== 'child' && w.timeline === null && w.callbackOpening === null && w.vars.g.o === (w.caller.gender === 'f' ? 'a' : 'o'),
        'testimone: witness_voice, accordo del testimone, nessuna cronologia né richiamata');
    const l = LL.CallBuilder.build(templates.find((t) => !t.content.caller.voice), new LL.RNG(8), city);
    check(l.caller.voiceProfile.age === 'adult' && l.caller.voiceProfile.kind === l.caller.voice, 'modelli senza voce: profilo adulto dal genere');
    check(Array.isArray(c.deterioration) && c.deterioration[0].after_s === 240, 'deterioration passato al motore');
}

// 25. API per gli altri pacchetti: SILENCE_GRACE_MS, say, fingerprintState
{
    const { e, c } = singleT(T901, 40, 10);
    check(LL.Dialog.SILENCE_GRACE_MS === 8000, 'SILENCE_GRACE_MS esportato');
    const fp0 = LL.Dialog.fingerprintState(c.dialog);
    const n = c.dialog.transcript.length;
    const entry = LL.Dialog.say(c, { calm: 'Calmo.', panic: 'Agitato!' }, { ms: e.gameMs, nodeId: 'det:0' });
    check(c.dialog.transcript.length === n + 1 && entry.text === 'Calmo.' && entry.who === 'caller' && entry.ms === e.gameMs, 'say() aggiunge una frase del chiamante, scelta col panico');
    askAndWait(e, c, 'q_dove', 7);
    c.dialog.flags.zeta = true; c.dialog.flags.alfa = true;
    const fp1 = LL.Dialog.fingerprintState(c.dialog);
    check(fp0 === 'f:;t:;s:;a:' && fp1 === 'f:alfa,zeta;t:;s:;a:q_dove=1', `fingerprintState canonico (${fp1})`);
}

// 26. Controlli dei modelli (come in tools/import_templates.php): fatti critici raggiungibili, condizioni attivabili
{
    const problems = [];
    for (const t of templates.concat(fixtures)) {
        const c = t.content;
        const revealed = new Set(c.nodes.flatMap((n) => n.reveals || []));
        for (const f of c.truth.critical_facts || []) {
            if (typeof f !== 'string' || f.startsWith('{')) continue;
            if (!(f in c.facts)) problems.push(`${t.code}: critico ${f} non tra i facts`);
            else if (!revealed.has(f)) problems.push(`${t.code}: critico ${f} non rivelato da domande`);
        }
        const setters = new Set([...c.nodes.map((n) => n.sets_flag), ...(c.timeline || []).map((x) => x.sets_flag),
            ...(c.deterioration || []).map((x) => x.sets_flag)].filter(Boolean));
        const used = [...c.nodes.flatMap((n) => [n.requires_flag, n.hidden_if_flag, n.reply_flag && n.reply_flag.flag, n.error && n.error.unless_flag]),
            ...(c.timeline || []).flatMap((x) => [x.if_flag, x.unless_flag])].filter(Boolean);
        for (const f of used) if (!setters.has(f)) problems.push(`${t.code}: condizione ${f} mai attivata`);
        for (const x of c.timeline || []) {
            for (const f of x.reveals || []) if ((c.truth.critical_facts || []).includes(f)) problems.push(`${t.code}: la cronologia rivela il critico ${f}`);
        }
    }
    check(problems.length === 0, 'fatti critici chiesti dall\'operatore e condizioni sempre attivabili' + (problems.length ? ` (${problems.slice(0, 3).join('; ')})` : ''));
}

// 27. Genere "any": nessun accordo al maschile in prima persona nelle frasi del chiamante, a meno di usare {g.o}
//     (stessa regola di --lint; i modelli in KNOWN sono da correggere nei contenuti)
{
    const KNOWN = new Set([]);
    const RE = /\b(?:sono|mi sento|resto|sto|rimango|ero)\s+(?:\S+\s+)?(bloccato|tranquillo|seduto|fermo|solo|caduto|ferito|sicuro|stanco|preoccupato|chiuso)\b/i;
    const found = new Map();
    for (const t of templates.concat(fixtures)) {
        if (t.content.caller.gender === 'm' || t.content.caller.gender === 'f') continue;
        if (JSON.stringify(t.content).includes('{g.')) continue;
        for (let seed = 1; seed <= 50; seed++) {
            const c = LL.CallBuilder.build(t, new LL.RNG(seed), city);
            const pairs = [c.opening, ...c.nodes.flatMap((n) => [n.reply, n.repeat, n.replyFlag, n.error && n.error.reply]),
                ...(c.timeline || []).map((x) => x.say), c.idleLines];
            for (const p of pairs) {
                for (const k of ['calm', 'panic', 'hyst']) {
                    for (const s of [].concat((p && p[k]) || [])) {
                        const m = typeof s === 'string' && s.match(RE);
                        if (m) found.set(t.code, m[1]);
                    }
                }
            }
        }
    }
    const unexpected = [...found.keys()].filter((k) => !KNOWN.has(k));
    if (found.size) console.log('     parole accordate con genere any:', JSON.stringify(Object.fromEntries(found)));
    check(unexpected.length === 0, 'genere any: nessuna parola accordata senza {g.o}' + (unexpected.length ? ` (${unexpected.join(', ')})` : ''));
}

// 28. Validatore PHP (se php è disponibile): fixture valide, modello sbagliato rifiutato con i messaggi attesi
{
    const { execFileSync } = require('child_process');
    const path = require('path');
    const tool = path.join(ROOT, 'tools/import_templates.php');
    let php = true;
    let okFixtures = false;
    let invalidOut = '';
    try {
        execFileSync('php', [tool, '--check', path.join(ROOT, 'tests/fixtures/t120')], { stdio: 'pipe' });
        okFixtures = true;
    } catch (err) {
        if (err.code === 'ENOENT') php = false;
    }
    if (php) {
        try {
            execFileSync('php', [tool, '--check', path.join(ROOT, 'tests/fixtures/t120/invalid')], { stdio: 'pipe' });
        } catch (err) {
            invalidOut = String(err.stderr || '');
        }
        check(okFixtures, 'php --check: le fixture 1.2.0 sono valide');
        const expect = ['non è rivelato da nessuna domanda', 'non è mai attivata', 'non può rivelare il fatto critico', 'non esiste nella città',
            'chiave "loud" non ammessa', 'switch_caller.gender', 'at_s deve essere', 'deve essere un oggetto { calm, panic, hyst }', 'caller.voice.age'];
        const missing = expect.filter((m) => !invalidOut.includes(m));
        check(missing.length === 0, 'php --check rifiuta il modello sbagliato con i messaggi attesi' + (missing.length ? ` (mancano: ${missing.join('; ')})` : ''));
    } else {
        console.log('     php non disponibile: controlli del validatore saltati');
    }
}

done();
