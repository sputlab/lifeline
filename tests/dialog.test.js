/**
 * Test di modelli, costruttore e dialogo.
 * Uso: node tests/dialog.test.js
 */
'use strict';
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

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

done();
