/**
 * Test dell'audio della chiamata (LL.CallAudio) con il motore vero e una voce finta.
 * Verifica: apertura detta alla risposta, risposte dette, taglio su attesa/pausa/fine,
 * didascalie mai lette, voce stabile per chiamante, nessun effetto sul motore.
 * Uso: node tests/callaudio.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const { check, done } = makeChecker();
const templates = loadTemplates();

let clock = 1000;
const micro = [];
const flush = () => { while (micro.length) micro.shift()(); };
function setup() {
    const LL = loadEngine();
    // il motore gira nel suo contesto: i moduli UI vanno caricati nello stesso oggetto LL
    const sandbox = { console, LL, performance: { now: () => clock }, setTimeout: () => 0, clearTimeout: () => {}, queueMicrotask: (fn) => micro.push(fn) };
    vm.createContext(sandbox);
    for (const f of ['ui/speechtext.js', 'ui/callaudio.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js', f), 'utf8'), sandbox, { filename: f });
    }
    const log = [];
    LL.Sound = { on: true, stopVoice: () => log.push(['stopVoice']), cue: (k) => { log.push(['cue', k]); return clock; }, speak: () => null, duck: () => {} };
    LL.Voice = {
        stop: () => log.push(['stop']),
        mode: () => 'tts',
        say: (r) => { log.push(['say', r]); if (r.onstart) r.onstart(clock); },
    };
    return { LL, log };
}

function single(LL, code, seed, panic) {
    const e = new LL.Engine({ seed, gameStartSec: 0, durationSec: 3600, scheduler: new LL.TemplateScheduler({ templates, city }) });
    e.scheduler.queue = [];
    const content = LL.CallBuilder.build(templates.find((t) => t.code === code), new LL.RNG(seed), city);
    if (panic !== undefined) content.caller.panicStart = panic;
    e.scheduler.addCallback({ atMs: 0, content, parentId: null });
    e.step();
    return { e, c: e.lineCall(0) };
}
const step = (e) => { e.step(); flush(); };
const run = (e, sec) => { for (let i = 0; i < sec * 10; i++) step(e); };
const says = (log) => log.filter((x) => x[0] === 'say').map((x) => x[1]);

// 1. Risposta: l'apertura viene detta; una risposta a una domanda viene detta
{
    const { LL, log } = setup();
    const { e, c } = single(LL, 'SAN_007', 7, 20);
    const ui = {};
    const audio = LL.CallAudio.attach(e, ui);
    e.dispatch('answer', { callId: c.id }); step(e);
    let s = says(log);
    check(s.length === 1 && s[0].text === LL.SpeechText.toSpeech(c.dialog.transcript[0].text).say.slice(0, s[0].text.length), 'apertura detta alla risposta');
    check(ui.voiceState && ui.voiceState.callId === c.id && ui.voiceState.entryIdx === 0 && ui.voiceState.endMs === null, 'voiceState pubblicato (endMs null finché parla)');
    check(s[0].kind === (c.content.caller.voice === 'child' ? 'child' : c.content.caller.voice), 'tipo di voce dal chiamante');
    audio.frame(ui);
    check(says(log).length === 1, 'frame() non ripete la stessa battuta');

    e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); step(e);
    check(log.some((x) => x[0] === 'stop'), 'una nuova domanda interrompe il chiamante');
    run(e, 7);
    s = says(log);
    const last = c.dialog.transcript[c.dialog.transcript.length - 1];
    check(s.length === 2 && last.who === 'caller' && ui.voiceState.entryIdx === c.dialog.transcript.length - 1, 'risposta detta, voiceState sulla battuta giusta');
    check(s[0].seed === s[1].seed, 'stessa voce per tutta la chiamata');

    // 2. Attesa: voce tagliata subito, endMs valorizzato
    log.length = 0;
    e.dispatch('hold', { callId: c.id }); step(e);
    check(log.some((x) => x[0] === 'stop'), 'attesa: voce tagliata');
    check(ui.voiceState.endMs !== null, 'attesa: voiceState chiuso');
    // ripresa dopo più di 5 s: la frase di ripresa (se c'è) viene detta, nient'altro di vecchio
    run(e, 6);
    log.length = 0;
    e.dispatch('resume', { callId: c.id }); step(e);
    const resumed = says(log);
    check(resumed.length <= 1 && (resumed.length === 0 || ui.voiceState.entryIdx === c.dialog.transcript.length - 1), 'ripresa: al massimo la frase di ripresa');

    // 3. Pausa: niente voce finché in pausa, nessun recupero alla ripresa
    audio.pause();
    log.length = 0;
    e.dispatch('ask', { callId: c.id, nodeId: 'q_respiro' }); run(e, 8);
    audio.frame(ui);
    check(says(log).length === 0, 'in pausa non parla nessuno');
    audio.resume();
    audio.frame(ui);
    check(says(log).length === 0, 'alla ripresa non recupera le battute perse');

    // 4. skip e detach
    e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); run(e, 7);
    check(audio.skip() === true && log.some((x) => x[0] === 'stop'), 'skip() taglia la frase');
    audio.detach();
    log.length = 0;
    e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); run(e, 7);
    check(says(log).length === 0, 'detach(): nessun ascolto');
}

// 5. Didascalie: sussurro, interprete, lingua
{
    const { LL, log } = setup();
    const { e, c } = single(LL, 'SIC_006', 3, 30);
    LL.CallAudio.attach(e, {});
    e.dispatch('answer', { callId: c.id }); step(e);
    const s = says(log)[0];
    check(s && s.whisper === true && !/sussurra/.test(s.text), 'SIC_006: sussurra -> sussurro, didascalia non letta');
}
{
    const { LL, log } = setup();
    const { e, c } = single(LL, 'SAN_010', 5, 30);
    LL.CallAudio.attach(e, {});
    e.dispatch('answer', { callId: c.id }); step(e);
    const s0 = says(log)[0];
    check(s0 && s0.lang === 'en', 'SAN_010: apertura in inglese -> voce inglese se c\'è');
    e.dispatch('ask', { callId: c.id, nodeId: 'a_interprete' }); run(e, 22);
    const s1 = says(log)[1];
    check(s1 && s1.other === true && s1.lang === 'it' && s1.seed !== s0.seed && !/interprete/.test(s1.text), 'interprete: altra voce, in italiano, didascalia non letta');
}

// 6. Voce stabile: stesso nome e numero -> stessa voce; chiamanti diversi -> voci diverse
{
    const { LL } = setup();
    const t = templates.find((x) => x.code === 'SAN_007');
    const seeds = new Set();
    let same = true;
    for (let s = 1; s <= 30; s++) {
        const c1 = { content: LL.CallBuilder.build(t, new LL.RNG(s), city) };
        const c2 = { content: LL.CallBuilder.build(t, new LL.RNG(s), city) };
        const v1 = LL.CallAudio.voiceOf(c1, null, { cues: [] }), v2 = LL.CallAudio.voiceOf(c2, null, { cues: [] });
        if (v1.seed !== v2.seed) same = false;
        seeds.add(v1.seed);
    }
    check(same, 'stesso chiamante -> stessa voce');
    check(seeds.size >= 25, 'chiamanti diversi -> voci diverse (' + seeds.size + '/30)');
    const c = { content: { caller: { name: 'A B', phone: '1', voice: 'male', voiceProfile: { kind: 'female', age: 'elderly' } } } };
    const v = LL.CallAudio.voiceOf(c, null, { cues: [] });
    check(v.kind === 'female' && v.age === 'elderly', 'voiceProfile del chiamante ha la precedenza');
    const w = LL.CallAudio.voiceOf(c, { speaker: { name: 'Vicino', gender: 'm' } }, { cues: [] });
    check(w.kind === 'male' && w.seed !== v.seed, 'cambio di interlocutore: altra voce');
}

// 7. Il motore non cambia: stessa impronta con e senza audio
{
    const play = (withAudio) => {
        const { LL } = setup();
        const { e, c } = single(LL, 'SAN_007', 11, 50);
        if (withAudio) LL.CallAudio.attach(e, {});
        e.dispatch('answer', { callId: c.id }); step(e);
        e.dispatch('ask', { callId: c.id, nodeId: 'q_dove' }); run(e, 7);
        e.dispatch('hold', { callId: c.id }); run(e, 3);
        e.dispatch('resume', { callId: c.id }); run(e, 5);
        return e.fingerprint();
    };
    check(play(false) === play(true), 'impronta del motore identica con l\'audio collegato');
}

done();
