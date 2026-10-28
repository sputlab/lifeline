/**
 * Test dell'addestramento: chiamate guidate, fine anticipata, riproducibilità.
 * Uso: node tests/training.test.js
 */
'use strict';
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const LL = loadEngine();
const S = LL.CallState;
const templates = loadTemplates().filter((t) => ['SAN_001', 'IMP_004', 'INC_002'].includes(t.code));
const { check, done } = makeChecker();
const run = (e, sec) => { for (let i = 0; i < sec * 10; i++) e.step(); };

function newEngine() {
    return new LL.Engine({ seed: 777, gameStartSec: 54000, durationSec: 14400,
        scheduler: new LL.TrainingScheduler({ templates, city }) });
}
const byTag = (e, tag) => [...e.calls.values()].filter((c) => c.incidentKey === e._incidentTags.get(tag)).pop();
const form = (c) => ({ location: { x: c.content.location.x, y: c.content.location.y, street: c.content.location.street, number: c.content.location.number, zone: c.content.location.zone }, eventType: c.content.truth.event_type });

/** Percorso dell'addestramento come lo farebbe un giocatore attento. */
function playTraining() {
    const e = newEngine();
    run(e, 60);
    check(e.calls.size === 0, 'nessuna chiamata casuale in addestramento');
    e.dispatch('spawn', { code: 'SAN_001', tag: 't1', require: '118+115' }); run(e, 1);
    const c1 = byTag(e, 't1');
    check(c1 && c1.content.truth.agencies_required.join('+') === '118+115', 'la prima chiamata è la variante con la porta chiusa (118 + 115)');
    check(c1.content.caller.callbackChance === 0 && c1.content.caller.panicStart <= 25, 'chiamante ammorbidito: calmo e senza richiamate');
    e.dispatch('answer', { callId: c1.id }); run(e, 1);
    for (const n of ['q_dove', 'q_accesso']) { e.dispatch('ask', { callId: c1.id, nodeId: n }); run(e, 8); }
    e.dispatch('transfer', { callId: c1.id, agencies: ['118', '115'], form: form(c1) }); run(e, 1);

    e.dispatch('spawn', { code: 'IMP_004', tag: 't2', delaySec: 3 }); run(e, 4);
    const c2 = byTag(e, 't2');
    e.dispatch('answer', { callId: c2.id }); run(e, 1);
    e.dispatch('ask', { callId: c2.id, nodeId: 'q_ambiente' }); run(e, 6);
    e.dispatch('close', { callId: c2.id, reason: 'scherzo' }); run(e, 1);

    e.dispatch('spawn', { code: 'INC_002', tag: 't3', delaySec: 3 }); run(e, 4);
    const c3 = byTag(e, 't3');
    e.dispatch('answer', { callId: c3.id }); run(e, 1);
    for (const n of ['q_dove', 'q_persone']) { e.dispatch('ask', { callId: c3.id, nodeId: n }); run(e, 7); }
    e.dispatch('transfer', { callId: c3.id, agencies: c3.content.truth.agencies_required, form: form(c3) }); run(e, 1);

    e.dispatch('spawn', { code: 'INC_002', tag: 't4', witnessOf: 't3', delaySec: 3 }); run(e, 4);
    const w = [...e.calls.values()].find((c) => c.content.isWitness);
    check(w && w.incidentKey === c3.incidentKey, 'il testimone guidato appartiene all\'evento del cassonetto');
    e.dispatch('answer', { callId: w.id }); run(e, 1);
    e.dispatch('merge', { callId: w.id, targetId: c3.id, form: form(w) }); run(e, 1);

    e.dispatch('end_shift', {}); run(e, 1);
    return e;
}

const e1 = playTraining();
check(e1.ended && e1.gameMs < e1.durationMs, 'l\'addestramento termina subito dopo «end_shift», prima della durata massima');

// Replay dal registro
const e2 = newEngine();
const byTick = new Map();
for (const a of e1.log) { if (a.meta) continue; if (!byTick.has(a.tick)) byTick.set(a.tick, []); byTick.get(a.tick).push(a); }
while (!e2.ended && e2.tick < 1e6) { (byTick.get(e2.tick) || []).forEach((a) => e2.dispatch(a.type, a.payload)); e2.step(); }
check(e1.fingerprint() === e2.fingerprint(), 'l\'addestramento si riproduce identico dal registro (chiamate guidate comprese)');

const ev = LL.Scoring.evaluateShift(e1, city);
console.log('     voto addestramento:', ev.grade, ev.percent, JSON.stringify(ev.calls.map((c) => [c.code, c.state, c.final])));
check(['S', 'A'].includes(ev.grade), 'un addestramento fatto bene ottiene un buon voto');

// Chiamate guidate rifiutate quando non valide
{
    const e = newEngine();
    e.dispatch('spawn', { code: 'NON_ESISTE', tag: 'x' });
    e.dispatch('spawn', { code: 'INC_002', tag: 'y', witnessOf: 'mai_creato' });
    e.step();
    check(e.log.length === 0, 'chiamate guidate non valide ignorate');
    const d = new LL.Engine({ seed: 1, gameStartSec: 0, durationSec: 3600, scheduler: new LL.Director({ templates, city }) });
    d.dispatch('spawn', { code: 'SAN_001', tag: 'z' }); d.step();
    check(d.log.length === 0, 'nei turni normali non si possono creare chiamate a comando');
}

done();
