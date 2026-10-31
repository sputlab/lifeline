/**
 * LifeLine - Voce dei chiamanti
 *
 * Tre motori, scelti dalla preferenza voiceMode ('auto' | 'tts' | 'hd' | 'babble' | 'off'):
 *   tts     sintesi vocale del browser (Web Speech): voci italiane, neurali su Edge e Chrome,
 *           Alice/Federica/Luca su Safari. Non passa dal mixer Web Audio: niente filtro telefonico,
 *           ma un clic di linea prima di ogni frase e il fruscio sotto.
 *   hd      «Voce HD»: voce neurale Piper scaricata su richiesta (voice_neural.js), filtrata come
 *           una vera linea telefonica. Se una frase tarda (> 1,2 s) si passa a tts per quella frase.
 *   babble  «parlato telefonico» sintetico ricavato dal testo (LL.Sound.speak).
 * 'auto' usa tts se esiste almeno una voce italiana, altrimenti babble. Qualunque errore scende
 * di un gradino: hd -> tts -> babble.
 *
 * Una sola frase alla volta: una nuova frase cancella la precedente, mai in coda.
 * La voce di un chiamante è stabile (hash di nome + numero): chi richiama ha la stessa voce,
 * testimoni diversi hanno voci diverse dove possibile. Con una sola voce italiana cambia il tono.
 */
(function (LL) {
    'use strict';

    const FIRST_CHUNK_MS = 1200;     // Voce HD: oltre questo tempo la frase passa alla voce del browser
    const SAFETY_MS = 20000;         // fine forzata se il browser non segnala la fine
    const KEEPALIVE_MS = 10000;      // Chrome interrompe le voci online dopo ~15 s: pause()/resume()
    const START_TIMEOUT_MS = 2500;   // se la voce del browser non parte, si passa al parlato sintetico

    const FEMALE = /\b(alice|federica|paola|elsa|isabella|carla|chiara|emma|giulia|silvia|francesca|valentina|bianca|lucia|sara|serena|gianna|alessandra|elisa|fiamma|palmira|pina|imelda|irma|laura|martina|google italiano|samantha|karen|anna|helena|katja|hedda|petra|marlene|vicki|zira|aria|jenny|sonia|libby|susan|hazel|moira|tessa|fiona|victoria|amelie)\b/i;
    const MALE = /\b(luca|cosimo|diego|giorgio|riccardo|giuseppe|marco|roberto|benigno|calogero|gianni|lisandro|rinaldo|pietro|matteo|andrea|daniel|alex|fred|tom|david|mark|guy|ryan|george|james|oliver|stefan|markus|yannick|conrad|killian|hans|thomas)\b/i;
    const GOOD = /natural|neural|online|premium|enhanced|plus|wavenet|studio/i;
    const POOR = /compact|espeak|eloquence|robot|novelty/i;

    const ST = () => LL.SpeechText;
    const pref = (k) => (LL.Prefs ? LL.Prefs.get(k) : ({ voiceMode: 'auto', voiceName: '', speechLen: 'adaptive' })[k]);
    const now = () => performance.now();
    const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null;

    // percorso di voice_neural.js accanto a questo file (con lo stesso ?v= di cache)
    const NEURAL_URL = (() => {
        try {
            const src = document.currentScript && document.currentScript.src;
            if (src) { const u = new URL(src); u.pathname = u.pathname.replace(/voice\.js$/, 'voice_neural.js'); return u.href; }
        } catch (_) { /* */ }
        return 'assets/js/ui/voice_neural.js';
    })();

    function classify(v) {
        const n = v.name || '';
        let score = 0;
        if (GOOD.test(n)) score += 10;
        if (/google/i.test(n)) score += 6;
        if (v.localService === false) score += 2;
        if (POOR.test(n)) score -= 8;
        if (v.default) score += 1;
        const gender = FEMALE.test(n) ? 'f' : (MALE.test(n) ? 'm' : 'u');
        return { name: n, lang: String(v.lang || '').replace('_', '-'), gender, score, local: v.localService !== false, voice: v };
    }

    const Voice = {
        _voices: [],
        _tok: 0,
        _cur: null,             // { tok, cancel() } frase in corso
        _neural: null,          // promessa di caricamento di voice_neural.js
        _primed: false,

        supported() {
            return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function';
        },

        refresh() {
            const s = synth();
            if (!s) return;
            try {
                this._voices = (s.getVoices() || []).map(classify).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
            } catch (_) { this._voices = []; }
        },

        /** Voci per lingua ('it', 'en', 'de'), migliori prima. */
        list(lang = 'it') {
            if (!this._voices.length) this.refresh();
            return this._voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
        },

        hasItalian() { return this.supported() && this.list('it').length > 0; },

        /** Motore effettivo per la prossima frase. */
        mode() {
            const m = pref('voiceMode');
            if (m === 'off') return 'off';
            if (m === 'babble') return 'babble';
            if (m === 'hd' && LL.VoiceNeural && LL.VoiceNeural.isReady()) return 'hd';
            if (m === 'tts' || m === 'hd') return this.supported() ? 'tts' : 'babble';
            return this.hasItalian() ? 'tts' : 'babble';
        },

        /**
         * Voce stabile per un parlante.
         * @param {object} o  { seed, kind: 'male'|'female'|'child', lang, other: true per l'interprete }
         */
        pick({ seed = 0, kind = 'female', lang = 'it', other = false } = {}) {
            let list = this.list(lang);
            if (!list.length && lang !== 'it') list = this.list('it');
            if (!list.length) return null;
            const wanted = pref('voiceName');
            if (wanted && !other && lang === 'it') {
                const v = list.find((x) => x.name === wanted);
                if (v) return v;
            }
            let g = kind === 'male' ? 'm' : 'f';
            if (other) g = g === 'm' ? 'f' : 'm';
            const best = list[0].score;
            const pool = list.filter((v) => v.score >= best - 4);
            // prima il sesso giusto tra le voci migliori, poi tra quelle discrete, poi le voci neutre
            let cands = pool.filter((v) => v.gender === g);
            if (!cands.length) cands = list.filter((v) => v.gender === g && v.score >= best - 12 && v.score > -5);
            if (!cands.length) cands = pool.filter((v) => v.gender === 'u');
            if (!cands.length) cands = pool;
            return cands[(seed >>> 0) % cands.length];
        },

        /** Da chiamare dentro un gesto dell'utente: sblocca la sintesi su Safari/iOS. */
        prime() {
            if (this._primed || !this.supported()) return;
            this._primed = true;
            try {
                const u = new SpeechSynthesisUtterance(' ');
                u.volume = 0;
                synth().speak(u);
            } catch (_) { /* */ }
        },

        /** Ferma subito qualunque voce (browser, HD, sintetica) e gli effetti vocali sulla linea. */
        stop(fadeMs = 60) {
            this._cancel();
            if (LL.Sound) { LL.Sound.stopVoice(fadeMs); LL.Sound.duck(false); }
        },

        /** Annulla la frase in corso senza toccare l'audio Web Audio già programmato. */
        _cancel() {
            this._tok++;
            const cur = this._cur;
            this._cur = null;
            if (cur) { try { cur.cancel(); } catch (_) { /* */ } }
            try { const s = synth(); if (s && (s.speaking || s.pending)) s.cancel(); } catch (_) { /* */ }
            if (LL.VoiceNeural && LL.VoiceNeural.cancelAll) { try { LL.VoiceNeural.cancelAll(); } catch (_) { /* */ } }
        },

        /**
         * Pronuncia una frase già ripulita (SpeechText.toSpeech + plan).
         * @param {object} r
         * @param {string} r.text      testo da dire
         * @param {number} r.seed      voce stabile del parlante
         * @param {string} r.kind      'male' | 'female' | 'child'
         * @param {string} [r.age]     'child' | 'adult' | 'elderly'
         * @param {number} [r.panic]
         * @param {string} [r.lvl]     'calm' | 'panic' | 'hyst'
         * @param {string} [r.lang]    'it' | 'en' | 'de'
         * @param {boolean} [r.other]  voce diversa (interprete)
         * @param {boolean} [r.whisper]
         * @param {string} [r.profile] 'landline' | 'mobile'
         * @param {number} [r.rate]    velocità minima da plan()
         * @param {number} [r.at]      non prima di (performance.now(), ms)
         * @param {function} [r.onstart]  (startMs)
         * @param {function} [r.onend]    (endMs) anche se la voce non suona; mai dopo stop()
         * @param {boolean} [r.keep]   non tagliare l'audio già programmato (effetti appena messi prima della frase)
         * @returns {{engine: string}}
         */
        say(r) {
            if (r.keep) this._cancel(); else this.stop(30);
            const tok = ++this._tok;
            const live = () => tok === this._tok;
            let started = false, ended = false;
            const api = {
                start: (ms) => { if (!started && live()) { started = true; if (LL.Sound) LL.Sound.duck(true); r.onstart && r.onstart(ms ?? now()); } },
                end: (ms) => {
                    if (ended || !live()) return;
                    ended = true;
                    if (!started) api.start(ms);
                    if (LL.Sound) LL.Sound.duck(false);
                    this._cur = null;
                    r.onend && r.onend(ms ?? now());
                },
            };
            const engine = (LL.Sound && !LL.Sound.on) || !r.text ? 'off' : this.mode();
            if (engine === 'off') {
                const t = now();
                api.start(t); api.end(t);
                return { engine };
            }
            if (engine === 'hd') this._sayHD(r, tok, api);
            else if (engine === 'tts') this._sayTTS(r, tok, api);
            else this._sayBabble(r, tok, api);
            return { engine };
        },

        _sayBabble(r, tok, api) {
            if (!LL.Sound || !LL.Sound.ctx) { api.end(); return; }
            const h = LL.Sound.speak({ text: r.text, seed: r.seed, panic: r.panic, rate: r.rate || 1, voice: r.kind === 'child' ? 'child' : (r.other ? (r.kind === 'male' ? 'female' : 'male') : r.kind), profile: r.profile, whisper: r.whisper, at: r.at, queue: true });
            if (!h) { api.end(); return; }
            const t1 = setTimeout(() => api.start(h.startMs), Math.max(0, h.startMs - now()));
            const t2 = setTimeout(() => api.end(h.endMs), Math.max(0, h.endMs - now()));
            this._cur = { tok, cancel: () => { clearTimeout(t1); clearTimeout(t2); } };
        },

        _sayTTS(r, tok, api) {
            const s = synth();
            const sp = ST();
            const v = this.pick({ seed: r.seed, kind: r.kind, lang: r.lang || 'it', other: r.other });
            const pr = sp.prosody({ kind: r.other ? (r.kind === 'male' ? 'female' : 'male') : r.kind, age: r.age, panic: r.other ? 0 : r.panic, lvl: r.other ? 'calm' : r.lvl, seed: r.seed, whisper: r.whisper });
            let pitch = pr.pitch;
            // voce del sesso «sbagliato» (una sola voce disponibile): compensa col tono
            if (v && v.gender === 'f' && r.kind === 'male' && !r.other) pitch *= 0.88;
            if (v && v.gender === 'm' && r.kind !== 'male' && !r.other) pitch *= 1.15;
            let u;
            try {
                u = new SpeechSynthesisUtterance(r.text);
                if (v) { u.voice = v.voice; u.lang = v.voice.lang; } else u.lang = { it: 'it-IT', en: 'en-GB', de: 'de-DE' }[r.lang] || 'it-IT';
                u.pitch = Math.max(0, Math.min(2, pitch));
                u.rate = Math.max(0.5, Math.min(1.6, Math.max(pr.rate, r.rate || 0)));
                u.volume = Math.max(0, Math.min(1, (LL.Sound ? LL.Sound.voiceLevel() : 1) * pr.volume));
            } catch (_) { this._sayBabble(r, tok, api); return; }

            const timers = [];
            let keep = null;
            const clear = () => { timers.forEach(clearTimeout); clearInterval(keep); };
            const finish = () => { clear(); api.end(); };
            u.onstart = () => {
                if (tok !== this._tok) return;
                api.start();
                if (v && !v.local) {
                    keep = setInterval(() => { try { if (s.speaking && !s.paused) { s.pause(); s.resume(); } } catch (_) { /* */ } }, KEEPALIVE_MS);
                }
            };
            u.onend = () => { if (tok === this._tok) finish(); };
            u.onerror = (e) => {
                if (tok !== this._tok) return;
                clear();
                // 'interrupted'/'canceled' arrivano anche da stop(): qui il token è ancora valido, quindi è un vero errore
                if (!e || (e.error !== 'interrupted' && e.error !== 'canceled')) { this._sayBabble(r, tok, api); return; }
                api.end();
            };
            this._cur = { tok, cancel: clear };
            const go = () => {
                if (tok !== this._tok) return;
                if (LL.Sound) LL.Sound.cue('click', { profile: r.profile });
                try { s.speak(u); } catch (_) { this._sayBabble(r, tok, api); return; }
                timers.push(setTimeout(() => {
                    if (tok === this._tok && !s.speaking) { try { s.cancel(); } catch (_) { /* */ } clear(); this._sayBabble(r, tok, api); }
                }, START_TIMEOUT_MS));
                timers.push(setTimeout(() => { if (tok === this._tok) { try { s.cancel(); } catch (_) { /* */ } finish(); } }, Math.max(SAFETY_MS, (r.est || 0) * 1500 + 4000)));
            };
            const wait = Math.max(0, (r.at || 0) - now());
            if (wait > 0) timers.push(setTimeout(go, wait)); else go();
        },

        _sayHD(r, tok, api) {
            const N = LL.VoiceNeural;
            const sp = ST();
            const kind = r.other ? (r.kind === 'male' ? 'female' : 'male') : r.kind;
            const model = kind === 'male' ? 'riccardo' : 'paola';
            const rate = Math.max(0.6, Math.min(1.6, r.rate || 1));
            const opts = { model, lengthScale: N.lengthScaleFor(rate) };
            const parts = sp.sentences(r.text).slice(0, 8);
            if (!parts.length) { api.end(); return; }
            const jobs = parts.map((p) => N.synth(p, opts));
            jobs.forEach((j) => j.catch(() => { /* gestito sotto */ }));
            let fallen = false;
            const fallback = () => {
                if (fallen || tok !== this._tok) return;
                fallen = true;
                N.cancelAll();
                (this.supported() && this.hasItalian() ? this._sayTTS : this._sayBabble).call(this, r, tok, api);
            };
            const timer = setTimeout(fallback, FIRST_CHUNK_MS);
            let endTimer = null;
            this._cur = { tok, cancel: () => { clearTimeout(timer); clearTimeout(endTimer); } };
            const pitchRate = r.kind === 'child' ? 1.2 : 1;
            (async () => {
                let at = Math.max(now() + 20, r.at || 0);
                if (LL.Sound) at = Math.max(at, LL.Sound.cue('click', { profile: r.profile, at }) );
                for (let i = 0; i < jobs.length; i++) {
                    let buf;
                    try { buf = await jobs[i]; } catch (_) { if (i === 0) { clearTimeout(timer); fallback(); } break; }
                    if (fallen || tok !== this._tok) return;
                    if (i === 0) clearTimeout(timer);
                    const h = LL.Sound.playBuffer(buf, { profile: r.profile, rate: pitchRate, at: Math.max(at, now() + 10), panic: r.panic, gain: r.whisper ? 0.5 : 1 });
                    if (!h) { if (i === 0) fallback(); return; }
                    if (i === 0) { const s0 = h.startMs; setTimeout(() => api.start(s0), Math.max(0, s0 - now())); }
                    at = h.endMs + 90;
                }
                if (fallen || tok !== this._tok) return;
                endTimer = setTimeout(() => api.end(), Math.max(0, at - 90 - now()));
            })();
        },

        /** Carica voice_neural.js (solo dopo il consenso del giocatore). */
        loadNeural() {
            if (LL.VoiceNeural) return Promise.resolve(LL.VoiceNeural);
            if (!this._neural) {
                this._neural = import(NEURAL_URL).then(() => LL.VoiceNeural || null).catch((e) => {
                    console.warn('Voce HD non disponibile', e);
                    this._neural = null;
                    return null;
                });
            }
            return this._neural;
        },

        /** Prepara la Voce HD se il giocatore l'ha scelta e i file sono già scaricati (mai scarica nulla). */
        async warmNeural() {
            if (pref('voiceMode') !== 'hd') return false;
            const N = await this.loadNeural();
            if (!N || !N.supported()) return false;
            try { await N.init(); return true; } catch (e) { console.warn('Voce HD non pronta', e); return false; }
        },

        /** Frase di prova per le impostazioni. */
        sample(lvl = 'calm', kind = 'female') {
            if (LL.Sound) LL.Sound.unlock();
            this.prime();
            const text = lvl === 'calm' ? (I18nT('voice.sample_calm') || 'Pronto, 112? C\'è un incendio nel palazzo di fronte.')
                : (I18nT('voice.sample_panic') || 'Pronto?! 112? C\'è un incendio! Fate presto, vi prego!');
            const panic = lvl === 'calm' ? 15 : 85;
            const seed = ST().hash('prova|' + kind);
            const pl = ST().plan({ text, panic, mode: 'full' });
            return this.say({ text, seed, kind, age: 'adult', panic, lvl: lvl === 'calm' ? 'calm' : 'hyst', lang: 'it', profile: 'mobile', rate: pl.rate, est: pl.est });
        },
    };

    function I18nT(key) {
        try {
            if (typeof I18n === 'undefined') return '';
            const s = I18n.t(key);
            return s === key ? '' : s;
        } catch (_) { return ''; }
    }

    if (Voice.supported()) {
        Voice.refresh();
        try { window.speechSynthesis.addEventListener('voiceschanged', () => Voice.refresh()); } catch (_) {
            window.speechSynthesis.onvoiceschanged = () => Voice.refresh();
        }
    }
    if (typeof document !== 'undefined') {
        // la sintesi va sbloccata dentro un gesto dell'utente (Safari, iOS)
        const unlock = () => { Voice.prime(); Voice.warmNeural(); };
        document.addEventListener('pointerdown', unlock, { once: true, capture: true });
        document.addEventListener('keydown', unlock, { once: true, capture: true });
    }
    if (LL.Prefs) LL.Prefs.onChange((p, keys) => {
        if (keys.includes('voiceMode')) {
            if (p.voiceMode === 'off') Voice.stop();
            else if (p.voiceMode === 'hd') Voice.warmNeural();
        }
    });

    LL.Voice = Voice;
})(globalThis.LL = globalThis.LL || {});
