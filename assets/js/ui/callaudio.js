/**
 * LifeLine - Audio della chiamata (collega il motore alla voce)
 *
 * Ascolta gli eventi del motore e fa parlare il chiamante in linea. Non modifica mai il motore.
 *
 *   const audio = LL.CallAudio.attach(engine, ui);
 *   audio.frame(ui)    a ogni render: taglia la voce se la chiamata attiva è cambiata e pronuncia
 *                      le battute nuove (anche quelle senza evento: ripresa dall'attesa, peggioramenti)
 *   audio.pause() / audio.resume() / audio.stop() / audio.skip() / audio.detach()
 *
 * Pubblica ui.voiceState = { callId, entryIdx, startMs, endMs, est } (tempi performance.now() in ms):
 *   entryIdx  indice nel transcript della battuta pronunciata
 *   endMs     null finché la voce non finisce davvero; uguale a startMs se non si sente nulla
 *   est       durata prevista in ms (per far scorrere il testo prima che arrivi endMs)
 *
 * Regole: una battuta alla volta, la più recente vince; attesa, pausa, cambio linea, riattacco
 * e una nuova domanda dell'operatore tagliano la voce in corso (entro 60-120 ms).
 * Le didascalie («(sussurra)», «(piange)») non vengono mai lette: diventano effetti o prosodia.
 */
(function (LL) {
    'use strict';

    const ANSWER_DELAY_MS = 260;     // dopo il «clic» di risposta
    const RESUME_DELAY_MS = 150;
    const CUE_KINDS = new Set(['laugh', 'sob']);
    const STYLE_RATE = { breathless: 1.1, slurred: 0.85 };   // moltiplicatore della velocità per stile

    const now = () => performance.now();
    const ST = () => LL.SpeechText;
    const pref = (k, d) => (LL.Prefs ? LL.Prefs.get(k) : d);

    function kindOf(x) {
        if (!x) return null;
        if (typeof x === 'string') return x === 'child' ? 'child' : x === 'female' || x === 'f' ? 'female' : x === 'male' || x === 'm' ? 'male' : null;
        if (typeof x === 'object') return kindOf(x.kind) || kindOf(x.voice) || kindOf(x.gender);
        return null;
    }

    /**
     * Voce del parlante di una battuta (chiamante, testimone che subentra, interprete, bambino).
     * Dipende solo da nome, numero e profilo voce: mai dalla verità nascosta o dalla categoria.
     */
    function voiceOf(call, entry, sp) {
        const cl = (call.content && call.content.caller) || {};
        const spk = (entry && entry.speaker) || null;
        const vp = (spk && typeof spk.voice === 'object' && spk.voice) || (spk && spk.voiceProfile) || (!spk && cl.voiceProfile) || null;
        let kind = kindOf(vp) || kindOf(spk && spk.voice) || kindOf(spk && spk.gender) || kindOf(cl.voice) || kindOf(cl.gender) || 'male';
        let age = (vp && vp.age) || (kind === 'child' ? 'child' : 'adult');
        const key = `${(spk && spk.name) || cl.name || ''}|${cl.phone || ''}`;
        let seed = ST().hash(key);
        let other = false;
        if (ST().hasCue(sp, 'child')) { kind = 'child'; age = 'child'; seed = ST().hash(key + '|bambino'); }
        if (ST().hasCue(sp, 'interpreter')) { other = true; age = 'adult'; seed = ST().hash(key + '|interprete'); if (kind === 'child') kind = 'female'; }
        // stile (sussurro, pianto, affanno, voce impastata) e accento: l'interprete non li eredita
        const style = other ? null : (vp && vp.style) || null;
        const accent = other ? null : (vp && vp.accent) || null;
        return { kind, age, seed, other, style, accent };
    }

    function attach(engine, ui) {
        const S = LL.CallState;
        const ev = engine.events;
        const unsubs = [];
        const handled = new Map();   // callId -> battute del transcript già gestite (pronunciate o saltate)
        const lvlHint = new Map();   // callId -> lvl dall'ultimo dialog:reply
        const startDelay = new Map(); // callId -> ritardo della prossima battuta (risposta/ripresa)
        let target = ui || {};
        let cur = null;              // { callId, entryIdx }
        let paused = false;
        let detached = false;
        let opUntil = 0;             // fine prevista della voce dell'operatore (performance.now): il chiamante risponde dopo
        const timers = new Set();

        const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, Math.max(0, ms)); timers.add(t); return t; };
        const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
        const publish = (st) => { target.voiceState = st; };
        const isCur = (callId, idx) => cur && cur.callId === callId && cur.entryIdx === idx;
        const markAll = (call) => { if (call && call.dialog) handled.set(call.id, call.dialog.transcript.length); };

        /** Taglia la voce in corso. */
        function cut(fadeMs = 60, keepOperator = false) {
            clearTimers();
            if (!keepOperator) opUntil = 0;
            const vs = target.voiceState;
            if (cur && vs && vs.callId === cur.callId && vs.endMs === null) publish(Object.assign({}, vs, { endMs: now() }));
            cur = null;
            if (keepOperator) return;
            if (LL.Voice) LL.Voice.stop(fadeMs);
            else if (LL.Sound) LL.Sound.stopVoice(fadeMs);
        }

        function lvlOf(call, entry) {
            if (entry && entry.lvl) return entry.lvl;
            if (lvlHint.has(call.id)) return lvlHint.get(call.id);
            return call.panic >= 85 ? 'hyst' : call.panic >= 60 ? 'panic' : 'calm';
        }

        /** Pronuncia una battuta del chiamante (idx = posizione nel transcript, -1 se fuori transcript). */
        function speak(call, entry, idx, delayMs = 0) {
            if (paused || detached || !LL.Sound || !ST()) return;
            const sp = ST().toSpeech(entry.text || '');
            const who = voiceOf(call, entry, sp);
            let lvl = lvlOf(call, entry);
            const crying = who.style === 'crying';
            if (crying && lvl === 'calm') lvl = 'panic';
            const panic = who.other ? 0 : call.panic;
            const pl = ST().plan({ text: sp.say, panic, mode: pref('speechLen', 'adaptive') });
            const text = sp.say.slice(0, pl.truncateAt).trim();
            const profile = call.content && call.content.caller ? call.content.caller.phoneType : undefined;

            // se l'operatore sta ancora parlando, il chiamante aspetta la fine (altrimenti la domanda verrebbe tagliata)
            const opWait = Math.max(0, opUntil - now());
            cut(30, opWait > 0);
            const callId = call.id;
            cur = { callId, entryIdx: idx };
            let at = now() + Math.max(delayMs, opWait);
            const silent = !LL.Sound.on || pref('voiceMode', 'auto') === 'off';
            // effetti prima della frase (o al posto della frase, se è solo una didascalia)
            if (!silent) {
                for (const c of sp.cues) {
                    if (CUE_KINDS.has(c.kind) && (c.pos === 'start' || !text)) at = LL.Sound.cue(c.kind, { seed: who.seed, voice: who.kind, profile, at }) + 80;
                }
                // profilo «piange» senza didascalia: un singhiozzo prima della prima battuta
                if (crying && idx <= 0 && !sp.cues.some((c) => c.kind === 'sob')) at = LL.Sound.cue('sob', { seed: who.seed, voice: who.kind, profile, at }) + 80;
            }
            const startMs = at;
            publish({ callId, entryIdx: idx, startMs, endMs: null, est: Math.round(pl.est * 1000) });

            const after = (endMs) => {
                if (!isCur(callId, idx)) return;
                let end = endMs;
                if (!silent && text) {
                    for (const c of sp.cues) {
                        if (CUE_KINDS.has(c.kind) && c.pos !== 'start') end = LL.Sound.cue(c.kind, { seed: who.seed, voice: who.kind, profile, at: end + 60 });
                    }
                }
                publish({ callId, entryIdx: idx, startMs: target.voiceState ? target.voiceState.startMs : startMs, endMs: end, est: Math.round(pl.est * 1000) });
                if (end > now() + 5) later(() => { if (isCur(callId, idx)) cur = null; }, end - now());
                else cur = null;
            };

            if (!text) {
                if (silent || at <= now()) after(now());
                else later(() => after(now()), at - now());
                return;
            }
            const fire = () => {
                if (!isCur(callId, idx) || paused || detached) return;
                opUntil = 0;
                LL.Voice.say({
                    text, seed: who.seed, kind: who.kind, age: who.age, other: who.other, panic, lvl,
                    lang: ST().langOf(text), whisper: ST().hasCue(sp, 'whisper') || who.style === 'whisper', profile,
                    rate: pl.rate * (STYLE_RATE[who.style] || 1), est: pl.est, at: Math.max(at, now()), keep: true,
                    onstart: (ms) => {
                        if (!isCur(callId, idx)) return;
                        publish({ callId, entryIdx: idx, startMs: ms, endMs: null, est: Math.round(pl.est * 1000) });
                    },
                    onend: (ms) => after(ms),
                });
            };
            if (opWait > 0) later(fire, opWait); else fire();
        }

        /** Pronuncia l'ultima battuta nuova del chiamante in linea (le altre nuove si saltano). */
        function pump(call, delayMs = 0) {
            if (paused || detached || !call || !call.dialog) return;
            if (call.id !== engine.activeId || call.state !== S.ACTIVE) return;
            const tr = call.dialog.transcript;
            const from = handled.get(call.id) || 0;
            if (tr.length <= from) return;
            handled.set(call.id, tr.length);
            if (startDelay.has(call.id)) { delayMs = Math.max(delayMs, startDelay.get(call.id)); startDelay.delete(call.id); }
            for (let i = tr.length - 1; i >= from; i--) {
                if (tr[i].who === 'caller') { speak(call, tr[i], i, delayMs); return; }
            }
        }

        /* ---------------- Voce HD: pre-riscaldamento dell'apertura mentre squilla ---------------- */

        function prewarm(call) {
            const N = LL.VoiceNeural;
            if (!N || !N.isReady() || !LL.Voice || LL.Voice.mode() !== 'hd' || !call || !call.content) return;
            const op = call.content.opening || {};
            for (const lvl of ['calm', 'panic']) {
                if (!op[lvl]) continue;
                const sp = ST().toSpeech(op[lvl]);
                const first = ST().chunks(sp.say)[0];
                if (!first) continue;
                const who = voiceOf(call, null, sp);
                const kind = who.other ? (who.kind === 'male' ? 'female' : 'male') : who.kind;
                const panic = lvl === 'panic' ? Math.max(60, call.panic) : Math.min(59, call.panic);
                const rate = ST().plan({ text: sp.say, panic, mode: pref('speechLen', 'adaptive') }).rate;
                N.prewarm(first, { model: kind === 'male' ? 'riccardo' : 'paola', lengthScale: N.lengthScaleFor(rate) });
            }
        }

        /* ---------------- Eventi del motore ---------------- */

        unsubs.push(ev.on('call:new', ({ call, line }) => { if (line !== null && line !== undefined) prewarm(call); }));
        unsubs.push(ev.on('call:ringing', ({ call }) => prewarm(call)));

        unsubs.push(ev.on('call:state', ({ call, from, to }) => {
            if (from === S.ACTIVE && to !== S.ACTIVE) {
                if (cur && cur.callId === call.id) cut(40);
                markAll(call);
                startDelay.delete(call.id);
            }
            if (to === S.ACTIVE) {
                // il motore aggiunge l'apertura e cambia activeId subito dopo l'evento: il ritardo
                // vale per il primo pump() che trova la battuta nuova (frame, peggioramento o risposta)
                startDelay.set(call.id, from === S.RINGING ? ANSWER_DELAY_MS : RESUME_DELAY_MS);
                queueMicrotask(() => pump(call));
            }
        }));

        unsubs.push(ev.on('dialog:ask', ({ call, nodeId }) => {
            if (call.id !== engine.activeId) return;
            if (cur && cur.callId === call.id) cut(120);       // l'operatore interrompe
            markAll(call);
            if (paused || !LL.Sound || !LL.Sound.on || pref('voiceMode', 'auto') === 'off') return;
            const node = call.content && call.content.nodesById ? call.content.nodesById[nodeId] : null;
            const label = node ? node.label : '';
            if (pref('operatorVoice', false) && label && LL.Voice && LL.Voice.mode() !== 'babble') {
                // la domanda si dice per intero (anche con più frasi: «Che piano? Che nome c'è sul citofono?»)
                const text = ST().toSpeech(label).say;
                const pl = ST().plan({ text, panic: 0, mode: 'full', baseRate: 1.1 });
                opUntil = now() + pl.est * 1000 + 500;
                LL.Voice.say({ text, seed: ST().hash('operatore'), kind: 'male', age: 'adult', panic: 0, lvl: 'calm', lang: 'it', rate: pl.rate, est: pl.est, onend: () => { opUntil = 0; } });
            } else if (LL.Voice && LL.Voice.mode() === 'babble') {
                // nel parlato sintetico resta il breve «parlato» dell'operatore, come in 1.1
                const secs = Math.min(1.8, 0.8 + ((node && node.costSec) || 5) * 0.12);
                LL.Sound.speak({ seconds: secs, voice: 'operator', seed: 11 });
            }
        }));

        unsubs.push(ev.on('dialog:reply', ({ call, lvl }) => {
            if (lvl) lvlHint.set(call.id, lvl);
            pump(call);
        }));

        unsubs.push(ev.on('call:final', ({ call }) => {
            if (cur && cur.callId === call.id) cut(40);
            handled.delete(call.id);
            lvlHint.delete(call.id);
            startDelay.delete(call.id);
        }));

        unsubs.push(ev.on('call:deteriorated', ({ call, line, queued }) => {
            // in sospeso (attesa, squillo): la frase entra nel transcript alla ripresa e la dice pump()
            if (!call || queued || call.id !== engine.activeId) return;
            const before = handled.get(call.id) || 0;
            pump(call);
            // se la frase del peggioramento non è finita nel transcript, la si pronuncia comunque
            if (typeof line === 'string' && line && (handled.get(call.id) || 0) === before) {
                speak(call, { who: 'caller', text: line }, -1);
            }
        }));

        const offPrefs = LL.Prefs ? LL.Prefs.onChange((p, keys) => {
            if ((keys.includes('voiceMode') && p.voiceMode === 'off') || (keys.includes('on') && !p.on)) cut(40);
        }) : null;

        /* ---------------- Comandi ---------------- */

        const handle = {
            /** Da chiamare a ogni render della console. */
            frame(u) {
                if (detached) return;
                if (u) target = u;
                if (cur && cur.callId !== engine.activeId) cut(40);
                const a = engine.activeCall ? engine.activeCall() : null;
                if (a) pump(a);
            },
            pause() {
                paused = true;
                cut(40);
            },
            resume() {
                paused = false;
                // niente recuperi: le battute dette durante la pausa restano solo scritte
                const a = engine.activeCall ? engine.activeCall() : null;
                markAll(a);
            },
            stop() {
                paused = true;
                cut(30);
                if (LL.Sound) LL.Sound.stopVoice(30);
            },
            /** Salta la frase in corso (tasto S). Il testo resta completo nella conversazione. */
            skip() {
                if (!cur) return false;
                cut(40);
                return true;
            },
            detach() {
                if (detached) return;
                handle.stop();
                detached = true;
                unsubs.forEach((u) => u());
                unsubs.length = 0;
                if (offPrefs) offPrefs();
            },
            get speaking() { return !!cur; },
        };
        publish(null);
        return handle;
    }

    LL.CallAudio = { attach, voiceOf };
})(globalThis.LL = globalThis.LL || {});
