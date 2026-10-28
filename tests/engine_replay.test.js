/**
 * Test del motore (Node): determinismo, replay dal registro azioni, coda e richiamate.
 * Uso: node tests/engine_replay.test.js
 */
'use strict';
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const LL = loadEngine();
const S = LL.CallState;
const templates = loadTemplates();
const { check, done } = makeChecker();

function newEngine(seed) {
    return new LL.Engine({
        seed, gameStartSec: 79200, durationSec: 21600,
        scheduler: new LL.TemplateScheduler({ templates, city, baseDifficulty: 2 }),
    });
}

/** Operatore simulato: risponde, fa le domande disponibili, poi trasferisce o chiude. */
function playWithBot(seed) {
    const e = newEngine(seed);
    while (!e.ended && e.tick < 1e6) {
        const a = e.activeCall();
        if (a) {
            if (!a.dialog.pending) {
                const next = LL.Dialog.options(a).find((o) => o.asked === 0);
                if (next) e.dispatch('ask', { callId: a.id, nodeId: next.id });
                else if (a.content.truth.agencies_required.length) e.dispatch('transfer', { callId: a.id, agencies: a.content.truth.agencies_required });
                else e.dispatch('close', { callId: a.id, reason: 'impropria' });
            }
        } else {
            const held = [...e.calls.values()].find((c) => c.state === S.ON_HOLD);
            const ringing = [...e.calls.values()].find((c) => c.state === S.RINGING);
            if (ringing && e.tick % 30 === 0) e.dispatch('answer', { callId: ringing.id });
            else if (held) e.dispatch('resume', { callId: held.id });
        }
        e.step();
    }
    return e;
}

function replay(seed, log) {
    const e = newEngine(seed);
    const byTick = new Map();
    for (const a of log) {
        if (a.meta) continue;
        if (!byTick.has(a.tick)) byTick.set(a.tick, []);
        byTick.get(a.tick).push(a);
    }
    while (!e.ended && e.tick < 1e6) {
        (byTick.get(e.tick) || []).forEach((a) => e.dispatch(a.type, a.payload));
        e.step();
    }
    return e;
}

const seed = 123456789;
const r1 = playWithBot(seed);
const r2 = playWithBot(seed);
const rp = replay(seed, JSON.parse(JSON.stringify(r1.log)));
const other = playWithBot(987654321);

check(r1.ended, 'il turno termina');
check(r1.fingerprint() === r2.fingerprint(), 'stesso seed e stesse azioni -> stesso risultato');
check(rp.fingerprint() === r1.fingerprint(), 'replay dal registro azioni -> risultato identico (anche dialogo e fatti)');
check(other.fingerprint() !== r1.fingerprint(), 'seed diverso -> turno diverso');

const s = r1.summary();
console.log('\nRiepilogo turno di prova:', JSON.stringify(s));
check(s.total >= 10, 'almeno 10 chiamate nel turno');
check(s.questions > s.total, 'l\'operatore simulato ha fatto domande');
check([...r1.calls.values()].every((c) => c.isFinal()), 'nessuna chiamata rimasta aperta');
check(r1.board.occupied() === 0 && r1.board.overflow.length === 0, 'linee e coda vuote a fine turno');
check(new Set([...r1.calls.values()].map((c) => c.content.code)).size >= 4, 'nel turno compaiono modelli diversi');

// Senza operatore: tutti riattaccano, e arrivano richiamate
const idle = newEngine(seed);
while (!idle.ended) idle.step();
const si = idle.summary();
check(si.byState.abandoned === si.total, 'senza risposta tutte le chiamate sono abbandonate');
check([...idle.calls.values()].some((c) => c.parentId !== null), 'chi riattacca a volte richiama');

// Coda del centralino
const q = newEngine(1);
q.scheduler.queue = [];
const tpl = templates.find((t) => t.code === 'SAN_001');
for (let i = 0; i < 6; i++) q.scheduler.addCallback({ atMs: 1000, content: LL.CallBuilder.build(tpl, new LL.RNG(i), city), parentId: null });
for (let i = 0; i < 15; i++) q.step();
check(q.board.occupied() === 4 && q.board.overflow.length === 2, '4 linee occupate + 2 in coda');
const first = q.lineCall(0);
q.dispatch('answer', { callId: first.id }); q.step();
q.dispatch('transfer', { callId: first.id, agencies: ['118'] }); q.step();
check(q.board.overflow.length === 1 && q.lineCall(0).state === S.RINGING, 'linea liberata -> la prima in coda squilla');

const before = q.log.length;
q.dispatch('transfer', { callId: q.lineCall(1).id, agencies: ['118'] });
q.dispatch('answer', { callId: 9999 });
q.step();
check(q.log.length === before, 'azioni non valide ignorate');

done();
