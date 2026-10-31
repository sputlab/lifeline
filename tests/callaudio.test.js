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
    return { LL, log, sandbox };
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
    // dalla 1.2.0 l'interprete prende la linea con switch_caller (voce propria del parlante)
    const s1 = says(log)[says(log).length - 1];
    const last = c.dialog.transcript[c.dialog.transcript.length - 1];
    check(s1 && last.speaker && s1.lang === 'it' && s1.seed !== s0.seed && s1.kind !== s0.kind && !/\(/.test(s1.text), 'interprete: altra voce, in italiano, didascalia non letta');
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

// 8. Peggioramento (regole v2): in attesa la frase resta in sospeso e si dice una volta sola alla ripresa
{
    const { LL, log } = setup();
    const e = new LL.Engine({ seed: 3, gameStartSec: 0, durationSec: 3600, rules: { version: 2, deterioration: true },
        scheduler: new LL.TemplateScheduler({ templates, city }) });
    e.scheduler.queue = [];
    const content = LL.CallBuilder.build(templates.find((t) => t.code === 'SAN_007'), new LL.RNG(3), city);
    content.caller.panicStart = 20;
    content.timeline = null;   // solo il peggioramento
    content.caller.holdPatienceSec = 600;
    e.scheduler.addCallback({ atMs: 0, content, parentId: null });
    e.step();
    const c = e.lineCall(0);
    let queued = 0;
    e.events.on('call:deteriorated', (p) => { if (p.queued) queued++; });
    LL.CallAudio.attach(e, {});
    e.dispatch('answer', { callId: c.id }); step(e);
    e.dispatch('hold', { callId: c.id }); run(e, 160);
    const line = c.deterQueue.length ? c.deterQueue[0].line : '';
    const said = () => says(log).filter((s) => line && s.text.startsWith(LL.SpeechText.toSpeech(line).say.slice(0, 12))).length;
    check(queued === 1 && line && said() === 0, 'in attesa: peggioramento in sospeso, non detto');
    e.dispatch('resume', { callId: c.id }); run(e, 2);
    check(said() === 1, 'alla ripresa la frase del peggioramento è detta una volta');
}

{
    // profilo voce: lo stile del modello vale anche senza didascalia
    const { LL, log } = setup();
    const { e, c } = single(LL, 'SIC_015', 7);
    check(c.content.caller.voiceProfile && c.content.caller.voiceProfile.style === 'whisper', 'SIC_015: profilo sussurro');
    LL.CallAudio.attach(e, {});
    e.dispatch('answer', { callId: c.id }); step(e);
    const s = says(log)[0];
    check(s && s.whisper === true, 'SIC_015: stile whisper -> sussurro senza «(sussurra)»');
    const vo = LL.CallAudio.voiceOf({ content: { caller: { name: 'x', voiceProfile: { age: 'adult', style: 'whisper' } } } }, { who: 'caller', text: 'Pronto' }, LL.SpeechText.toSpeech('Pronto'));
    check(vo.style === 'whisper', 'voiceOf: stile dal profilo');
}

// 9. Voce dell'operatore: la domanda si dice per intero e il chiamante aspetta che finisca
{
    const { LL, log, sandbox } = setup();
    const timers = [];
    sandbox.setTimeout = (fn, ms) => { timers.push({ fn, at: clock + (ms || 0) }); return timers.length; };
    sandbox.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1] = null; };
    LL.Prefs = { get: (k) => ({ operatorVoice: true, voiceMode: 'auto', speechLen: 'adaptive' })[k], onChange: () => () => {} };
    const { e, c } = single(LL, 'SAN_007', 7, 20);
    LL.CallAudio.attach(e, {});
    e.dispatch('answer', { callId: c.id }); step(e);
    const node = c.content.nodes.find((n) => /[?.!]\s+\S/.test(ST_label(n)));
    function ST_label(n) { return n && n.label ? n.label : ''; }
    check(!!node, 'esiste una domanda a più frasi in SAN_007: ' + (node && node.label));
    const before = says(log).length;
    for (const n of c.content.nodes) if (n.requires && n.requires.length) { /* i prerequisiti si soddisfano chiedendo prima */ }
    const want = node ? ST_label(node) : '';
    // chiede i prerequisiti in ordine per sbloccare la domanda scelta
    const ask = (id) => { e.dispatch('ask', { callId: c.id, nodeId: id }); step(e); };
    const chain = [];
    (function need(n) { for (const r of (n.requires || [])) { const m = c.content.nodes.find((x) => x.id === r); if (m && !chain.includes(m.id)) { need(m); chain.push(m.id); } } })(node);
    chain.forEach((id) => { ask(id); run(e, 15); });
    const opBefore = says(log).filter((x) => !x.kind || x.seed === LL.SpeechText.hash('operatore')).length;
    ask(node.id);
    const ops = says(log).filter((x) => x.seed === LL.SpeechText.hash('operatore'));
    const op = ops[ops.length - 1];
    check(op && op.text === LL.SpeechText.toSpeech(want).say && op.text.length > want.split(/[?.!]/)[0].length + 3, 'operatore: domanda detta per intero, non solo la prima frase: ' + (op && op.text));
    // la risposta del chiamante arriva mentre l'operatore parla: viene rimandata alla fine, non taglia la domanda
    const nCaller = () => says(log).filter((x) => x.seed !== LL.SpeechText.hash('operatore')).length;
    const c0 = nCaller();
    for (let i = 0; i < 200 && c.dialog.transcript[c.dialog.transcript.length - 1].who !== 'caller'; i++) step(e);
    flush();
    check(nCaller() === c0, 'chiamante rimandato finché l\'operatore parla (nessun taglio della domanda)');
    clock += 60000;                       // l'operatore ha finito
    if (op && op.onend) op.onend(clock);
    timers.filter(Boolean).forEach((t) => { t.fn(); });
    check(nCaller() === c0 + 1, 'a fine domanda il chiamante risponde');
}

done();
