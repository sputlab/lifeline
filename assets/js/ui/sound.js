/**
 * LifeLine - Suoni della centrale (Web Audio, tutto sintetizzato, nessun file)
 *
 *   squillo       trillo a due toni; più fitto con più linee, urgente se qualcuno sta per riattaccare
 *   voce          «parlato» telefonico sintetico ricavato dal testo: sillabe dai gruppi vocalici,
 *                 pause sulla punteggiatura, tono che sale sulle domande. Timbro stabile per chiamante.
 *                 È la voce di riserva quando il browser non ha voci italiane (e il suono degli effetti
 *                 «risata», «pianto»). Anche la Voce HD passa da qui (playBuffer) per il filtro telefonico.
 *   linea         fruscio leggero finché c'è una chiamata in linea (con ronzio a 50 Hz sul fisso)
 *   sirene        a trasferimento avvenuto: bitonale ambulanza (118), bitonale grave Vigili del fuoco (115),
 *                 sirena ululante per Polizia e Carabinieri. Filtrate e sfumate come in lontananza.
 *   eventi        risposta, attesa, trasferimento, riattacco, coda, nuova informazione, fine turno
 *
 * Mixer: voce, effetti, squilli e linea hanno ciascuno il proprio bus verso il master (poi un compressore).
 * Mentre il chiamante parla, effetti e squilli si abbassano (duck); uno squillo urgente resta udibile.
 * Volumi e modalità vengono da LL.Prefs. Il contesto audio nasce al primo gesto dell'utente (regola dei browser).
 */
(function (LL) {
    'use strict';

    const LEGACY_KEY = 'lifeline.sound';
    // formanti (F1, F2) delle vocali italiane
    const FORMANTS = { a: [730, 1090], e: [530, 1840], i: [270, 2290], o: [570, 840], u: [300, 870] };
    const VOWEL_KEYS = Object.keys(FORMANTS);
    const DUCK = 0.45;
    const DUCK_URGENT_RING = 0.6;

    // preferenze di riserva se prefs.js non è caricato
    const fallbackPrefs = (() => {
        const p = { on: true, master: 0.6, voiceVol: 1, sfxVol: 0.8, voiceMode: 'auto' };
        try {
            const s = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}');
            if (typeof s.on === 'boolean') p.on = s.on;
            if (typeof s.vol === 'number') p.master = Math.max(0, Math.min(1, s.vol));
        } catch (_) { /* preferenze non disponibili */ }
        return p;
    })();
    const pref = (k) => (LL.Prefs ? LL.Prefs.get(k) : fallbackPrefs[k]);
    const setPref = (k, v) => { if (LL.Prefs) LL.Prefs.set(k, v); else fallbackPrefs[k] = v; };
    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const Sound = {
        ctx: null,
        master: null,
        voiceBus: null,
        sfxBus: null,
        ringBus: null,
        lineBus: null,
        _ringTimer: null,
        _ringKey: '',
        _ringUrgent: false,
        _noise: null,
        _wave: null,
        _clipCurve: null,
        _hiss: null,
        _voiceUntil: 0,
        _utts: [],          // { gain, sources: [], end } utterance in corso sul bus voce
        _ducked: false,

        /* ---------------- Preferenze ---------------- */

        get on() { return !!pref('on'); },
        get vol() { return Number(pref('master')) || 0; },
        setOn(on) { setPref('on', !!on); this._applyVolume(); if (!on) this.stopAll(); },
        setVolume(v) { setPref('master', Math.max(0, Math.min(1, Number(v) || 0))); this._applyVolume(); },
        /** Volume da dare alla voce del browser (Web Speech non passa dal mixer). */
        voiceLevel() {
            if (!this.on || pref('voiceMode') === 'off') return 0;
            const v = Number(pref('voiceVol'));
            return Math.max(0, Math.min(1, this.vol * (isFinite(v) ? v : 1) * 1.4));
        },
        // compatibilità 1.1: le preferenze sono ora in LL.Prefs
        load() {},
        save() {},

        unlock() {
            try {
                if (!this.ctx) {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    if (!AC) return;
                    const ctx = new AC();
                    this.ctx = ctx;
                    this.master = ctx.createGain();
                    const comp = ctx.createDynamicsCompressor();
                    this.master.connect(comp);
                    comp.connect(ctx.destination);
                    for (const b of ['voiceBus', 'sfxBus', 'ringBus', 'lineBus']) {
                        this[b] = ctx.createGain();
                        this[b].connect(this.master);
                    }
                    // rumore bianco riutilizzabile (consonanti, fruscio di linea)
                    const len = ctx.sampleRate * 2;
                    this._noise = ctx.createBuffer(1, len, ctx.sampleRate);
                    const d = this._noise.getChannelData(0);
                    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
                    // timbro glottale: armoniche che calano come 1/n²
                    const N = 24;
                    const real = new Float32Array(N), imag = new Float32Array(N);
                    for (let n = 1; n < N; n++) imag[n] = 1 / (n * n) + (n < 4 ? 0.15 / n : 0);
                    this._wave = ctx.createPeriodicWave(real, imag);
                    // saturazione morbida del cellulare
                    const curve = new Float32Array(1024);
                    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
                    this._clipCurve = curve;
                    this._applyVolume(true);
                    if (LL.Prefs && !this._prefsBound) {
                        this._prefsBound = true;
                        LL.Prefs.onChange((p, keys) => {
                            this._applyVolume();
                            if (keys.includes('on') && !p.on) this.stopAll();
                            if (keys.includes('voiceMode') && p.voiceMode === 'off') this.stopVoice();
                        });
                    }
                }
                if (this.ctx.state === 'suspended') this.ctx.resume();
            } catch (e) {
                console.warn('Audio non disponibile', e);
            }
        },

        _ramp(param, value, secs = 0.08) {
            if (!param) return;
            const t = this.ctx.currentTime;
            try {
                param.cancelScheduledValues(t);
                param.setValueAtTime(param.value, t);
                param.linearRampToValueAtTime(value, t + secs);
            } catch (_) { param.value = value; }
        },

        _applyVolume(instant = false) {
            if (!this.master) return;
            const set = (param, v, secs) => (instant ? (param.value = v) : this._ramp(param, v, secs));
            set(this.master.gain, this.on ? this.vol * 0.55 : 0, 0.05);
            const sfx = Number(pref('sfxVol')); const sfxV = isFinite(sfx) ? sfx : 0.8;
            const voice = Number(pref('voiceVol')); const voiceV = isFinite(voice) ? voice : 1;
            const down = this._ducked;
            set(this.voiceBus.gain, pref('voiceMode') === 'off' ? 0 : voiceV, 0.05);
            set(this.sfxBus.gain, sfxV * (down ? DUCK : 1), down ? 0.08 : 0.3);
            set(this.ringBus.gain, sfxV * (down ? (this._ringUrgent ? DUCK_URGENT_RING : DUCK) : 1), down ? 0.08 : 0.3);
            set(this.lineBus.gain, sfxV, 0.05);
        },

        /** Abbassa effetti e squilli mentre parla il chiamante (80 ms giù, 300 ms su). */
        duck(on) {
            if (this._ducked === !!on) return;
            this._ducked = !!on;
            this._applyVolume();
        },

        _ok() { return !!(this.ctx && this.on); },

        _env(g, t0, attack, hold, release, peak) {
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.linearRampToValueAtTime(peak, t0 + attack);
            g.gain.setValueAtTime(peak, t0 + attack + hold);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
        },

        /** Note semplici: [freq, inizio, durata, tipo, volume] */
        _notes(list, dest) {
            if (!this._ok()) return;
            const now = this.ctx.currentTime;
            for (const [f, start, dur, type = 'sine', vol = 0.3] of list) {
                const o = this.ctx.createOscillator();
                const g = this.ctx.createGain();
                o.type = type;
                o.frequency.value = f;
                this._env(g, now + start, 0.01, Math.max(0, dur - 0.05), 0.04, vol);
                o.connect(g);
                g.connect(dest || this.sfxBus);
                o.start(now + start);
                o.stop(now + start + dur + 0.08);
            }
        },

        /* ---------------- Squillo ---------------- */

        _ringBurst(urgent) {
            const seq = [];
            const hi = urgent ? 1600 : 1400, lo = urgent ? 1050 : 950;
            for (let b = 0; b < 2; b++) {
                for (let i = 0; i < 8; i++) seq.push([i % 2 ? hi : lo, b * 0.5 + i * 0.05, 0.05, 'triangle', urgent ? 0.26 : 0.2]);
            }
            this._notes(seq, this.ringBus);
        },

        /** count = linee che squillano, urgent = qualcuno sta per riattaccare. */
        ring(count, urgent = false) {
            const key = `${count}:${urgent}`;
            if (key === this._ringKey) return;
            this._ringKey = key;
            if (this._ringUrgent !== (urgent && count > 0)) { this._ringUrgent = urgent && count > 0; if (this._ducked) this._applyVolume(); }
            clearInterval(this._ringTimer);
            this._ringTimer = null;
            if (count > 0 && this._ok()) {
                this._ringBurst(urgent);
                const every = urgent ? 1200 : count > 1 ? 1700 : 2600;
                this._ringTimer = setInterval(() => this._ringBurst(urgent), every);
            }
        },

        /* ---------------- Linea telefonica ---------------- */

        /**
         * Catena del telefono verso dest (predefinito: bus voce).
         *   fisso      passa-banda 300-3400 Hz
         *   cellulare  400-3000 Hz con leggera saturazione
         * @returns {AudioNode} ingresso della catena
         */
        _telephone(profile, dest) {
            const ctx = this.ctx;
            const mobile = profile === 'mobile';
            const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = mobile ? 400 : 300; hp.Q.value = 0.7;
            const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = mobile ? 3000 : 3400; lp.Q.value = 0.7;
            hp.connect(lp);
            let tail = lp;
            if (mobile && this._clipCurve) {
                const ws = ctx.createWaveShaper(); ws.curve = this._clipCurve; ws.oversample = 'none';
                lp.connect(ws); tail = ws;
            }
            tail.connect(dest || this.voiceBus);
            return hp;
        },

        /** Fruscio di linea; sul fisso anche un lieve ronzio a 50 Hz. */
        lineOn(on, profile) {
            if (!this._ok()) return;
            // cambio diretto tra un cellulare e un fisso: si ricostruisce il fruscio col profilo nuovo
            if (on && this._hiss && this._hiss.profile !== profile) this.lineOn(false);
            if (on && !this._hiss) {
                const ctx = this.ctx;
                const src = ctx.createBufferSource();
                src.buffer = this._noise; src.loop = true;
                const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.6;
                const g = ctx.createGain(); g.gain.value = 0.0001;
                g.gain.linearRampToValueAtTime(0.012, ctx.currentTime + 0.3);
                src.connect(bp); bp.connect(g); g.connect(this.lineBus);
                src.start();
                const sources = [src];
                if (profile === 'landline') {
                    const hum = ctx.createOscillator(); hum.frequency.value = 50;
                    const hg = ctx.createGain(); hg.gain.value = 0.006;
                    hum.connect(hg); hg.connect(g); hum.start();
                    sources.push(hum);
                }
                this._hiss = { sources, g, profile };
            } else if (!on && this._hiss) {
                const { sources, g } = this._hiss;
                g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.2);
                for (const s of sources) { try { s.stop(this.ctx.currentTime + 0.25); } catch (_) { /* già fermo */ } }
                this._hiss = null;
            }
        },

        /* ---------------- Voce ---------------- */

        /** Nuova utterance sul bus voce: guadagno proprio, sorgenti tracciate per poterla tagliare. */
        _utterance(profile) {
            const g = this.ctx.createGain(); g.gain.value = 1;
            g.connect(this._telephone(profile));
            const u = { gain: g, sources: [], end: 0 };
            this._utts = this._utts.filter((x) => x.end > this.ctx.currentTime);
            this._utts.push(u);
            return u;
        },

        _msToCtx(ms) { return this.ctx.currentTime + Math.max(0, (ms - nowMs()) / 1000); },
        _ctxToMs(t) { return nowMs() + (t - this.ctx.currentTime) * 1000; },

        /**
         * Parlato sintetico.
         * @param {object} o
         * @param {string} [o.text]     testo da «pronunciare» (dà sillabe e pause); senza testo usa o.seconds
         * @param {number} [o.seconds]  durata se manca il testo
         * @param {number} [o.seed]     timbro stabile del chiamante (SpeechText.hash)
         * @param {number} [o.panic]    0-100
         * @param {number} [o.rate]     moltiplicatore di velocità (da SpeechText.plan)
         * @param {string} [o.voice]    'male'|'female'|'child'|'operator'
         * @param {string} [o.profile]  'landline'|'mobile'
         * @param {boolean} [o.whisper]
         * @param {number} [o.at]       non prima di questo istante (performance.now(), ms)
         * @param {boolean} [o.queue]   in coda alla voce precedente invece di tagliarla (operatore -> chiamante)
         * @returns {{startMs: number, endMs: number}|null}
         */
        speak({ text = '', seconds = 1.5, seed = 0, panic = 0, rate = 1, voice = 'male', profile, whisper = false, at = 0, queue = false } = {}) {
            if (!this._ok()) return null;
            const ctx = this.ctx;
            if (!queue && voice !== 'operator') this.stopVoice(30);
            const rnd = LL.SpeechText ? LL.SpeechText.mulberry32(seed || 1) : Math.random;
            const p = Math.max(0, Math.min(100, panic)) / 100;
            const base = { male: 118, female: 205, child: 290, operator: 150 }[voice] || 130;
            const f0 = base * (1 + p * 0.45) * (voice === 'operator' ? 1 : 1 + (rnd() - 0.5) * 0.24);
            const personalRate = voice === 'operator' ? 1 : 0.92 + rnd() * 0.16;
            const breath = 0.35 + rnd() * 0.4;
            const sps = (voice === 'operator' ? 4.2 : 3.8 + p * 4.2) * personalRate * Math.max(0.5, rate); // sillabe al secondo
            const jitter = 0.06 + p * 0.2;
            const loud = (voice === 'operator' ? 0.16 : 0.2 + p * 0.1) * (whisper ? 0.5 : 1);

            let syl = text && LL.SpeechText ? LL.SpeechText.syllables(text) : [];
            if (!syl.length) {
                const n = Math.max(3, Math.round(seconds * sps));
                syl = Array.from({ length: n }, (_, i) => ({ v: VOWEL_KEYS[Math.floor(Math.random() * VOWEL_KEYS.length)], cons: Math.random() < 0.55, gap: Math.random() < 0.12 ? 120 : (i === n - 1 ? 0 : 20), rise: false, loud: false }));
            }
            syl = syl.slice(0, 160);

            let t = Math.max(ctx.currentTime + 0.02, at ? this._msToCtx(at) : 0, queue ? this._voiceUntil : 0);
            const t0 = t;
            const u = this._utterance(profile);
            // tremolio nella voce agitata
            let lfo = null;
            if (p > 0.45 && voice !== 'operator') {
                lfo = ctx.createOscillator(); const lg = ctx.createGain();
                lfo.frequency.value = 5 + p * 4; lg.gain.value = 0.25 * p;
                lfo.connect(lg); lg.connect(u.gain.gain);
                lfo.start(t0);
                u.sources.push(lfo);
            }

            const n = syl.length;
            for (let i = 0; i < n; i++) {
                const s = syl[i];
                const dur = (1 / sps) * (0.75 + rnd() * 0.5);
                const [F1, F2] = FORMANTS[s.v] || FORMANTS.e;
                const pitch = f0 * (1 + (rnd() * 2 - 1) * jitter) * (s.rise ? 1.12 : 1);
                const endPitch = s.rise ? pitch * 1.15 : (i === n - 1 || s.gap >= 260 ? pitch * (p > 0.6 ? 1.1 : 0.86) : pitch * (1 + (rnd() - 0.5) * 0.1));
                const peak = loud * (0.6 + rnd() * 0.4) * (s.loud ? 1.3 : 1);
                // voce: oscillatore -> due formanti -> inviluppo (4 nodi)
                const g = ctx.createGain();
                this._env(g, t, 0.025, dur * 0.55, dur * 0.35, peak * (whisper ? 0.15 : 2.2));
                g.connect(u.gain);
                const src = ctx.createOscillator();
                if (this._wave) src.setPeriodicWave(this._wave); else src.type = 'sawtooth';
                src.frequency.setValueAtTime(pitch, t);
                src.frequency.linearRampToValueAtTime(endPitch, t + dur);
                const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = F1; f1.Q.value = 6;
                const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = F2; f2.Q.value = 8;
                src.connect(f1); src.connect(f2); f1.connect(g); f2.connect(g);
                src.start(t); src.stop(t + dur + 0.05);
                u.sources.push(src);
                // consonante o sussurro: soffio di rumore filtrato (3 nodi)
                if (s.cons || whisper) {
                    const nz = ctx.createBufferSource(); nz.buffer = this._noise;
                    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass';
                    nb.frequency.value = whisper ? F2 : 2500 + rnd() * 1500; nb.Q.value = whisper ? 3 : 1.5;
                    const ng = ctx.createGain();
                    const nd = whisper ? dur * 0.8 : 0.05;
                    this._env(ng, t, 0.005, nd * 0.5, nd * 0.5, loud * (whisper ? 1.2 : 0.35 * breath * 1.6));
                    nz.connect(nb); nb.connect(ng); ng.connect(u.gain);
                    nz.start(t, rnd() * 1.5); nz.stop(t + nd + 0.03);
                    u.sources.push(nz);
                }
                t += dur + (s.gap || 0) / 1000 / Math.max(0.6, rate);
            }
            u.end = t + 0.1;
            if (lfo) lfo.stop(u.end);
            this._voiceUntil = Math.max(this._voiceUntil, t);
            return { startMs: this._ctxToMs(t0), endMs: this._ctxToMs(t) };
        },

        /**
         * Suona un AudioBuffer (Voce HD) attraverso la linea telefonica, sul bus voce.
         * @returns {{startMs: number, endMs: number, stop: function}|null}
         */
        playBuffer(buffer, { profile, rate = 1, at = 0, gain = 1, panic = 0 } = {}) {
            if (!this._ok() || !buffer) return null;
            const ctx = this.ctx;
            const u = this._utterance(profile);
            u.gain.gain.value = Math.max(0, Math.min(2, gain)) * 1.6;
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.playbackRate.value = Math.max(0.5, Math.min(2, rate));
            src.connect(u.gain);
            const t0 = Math.max(ctx.currentTime + 0.01, at ? this._msToCtx(at) : 0);
            const p = Math.max(0, Math.min(100, panic)) / 100;
            src.start(t0);
            u.sources.push(src);
            const dur = buffer.duration / src.playbackRate.value;
            u.end = t0 + dur + 0.05;
            if (p > 0.55) {
                const lfo = ctx.createOscillator(); const lg = ctx.createGain();
                lfo.frequency.value = 5 + p * 3; lg.gain.value = 0.18 * p;
                lfo.connect(lg); lg.connect(u.gain.gain);
                lfo.start(t0); lfo.stop(u.end);
                u.sources.push(lfo);
            }
            this._voiceUntil = Math.max(this._voiceUntil, t0 + dur);
            return { startMs: this._ctxToMs(t0), endMs: this._ctxToMs(t0 + dur), stop: () => { try { src.stop(); } catch (_) { /* */ } } };
        },

        /** Taglia subito la voce in corso (attesa, pausa, cambio linea, riattacco). */
        stopVoice(fadeMs = 60) {
            this._voiceUntil = 0;
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            const f = Math.max(0.005, fadeMs / 1000);
            for (const u of this._utts) {
                try {
                    u.gain.gain.cancelScheduledValues(t);
                    u.gain.gain.setValueAtTime(u.gain.gain.value, t);
                    u.gain.gain.linearRampToValueAtTime(0, t + f);
                } catch (_) { /* nodo già scollegato */ }
                for (const s of u.sources) { try { s.stop(t + f + 0.01); } catch (_) { /* già fermo */ } }
            }
            this._utts = [];
        },

        /**
         * Effetti vocali brevi sulla linea: 'laugh' | 'sob' | 'click' | 'line'.
         * @returns {number} istante di fine (performance.now(), ms)
         */
        cue(kind, { seed = 0, voice = 'male', profile, at = 0 } = {}) {
            if (!this._ok()) return nowMs();
            const ctx = this.ctx;
            const rnd = LL.SpeechText ? LL.SpeechText.mulberry32(seed || 7) : Math.random;
            const u = this._utterance(profile);
            const t0 = Math.max(ctx.currentTime + 0.01, at ? this._msToCtx(at) : 0);
            const f0 = ({ male: 125, female: 215, child: 300 }[voice] || 150) * (1 + (rnd() - 0.5) * 0.2);
            const noise = (t, dur, freq, q, peak) => {
                const nz = ctx.createBufferSource(); nz.buffer = this._noise;
                const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = freq; nb.Q.value = q;
                const ng = ctx.createGain();
                this._env(ng, t, 0.004, dur * 0.4, dur * 0.6, peak);
                nz.connect(nb); nb.connect(ng); ng.connect(u.gain);
                nz.start(t, rnd() * 1.5); nz.stop(t + dur + 0.02);
                u.sources.push(nz);
            };
            const tone = (t, dur, fa, fb, F1, peak) => {
                const o = ctx.createOscillator();
                if (this._wave) o.setPeriodicWave(this._wave); else o.type = 'sawtooth';
                o.frequency.setValueAtTime(fa, t); o.frequency.linearRampToValueAtTime(fb, t + dur);
                const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = F1; f.Q.value = 4;
                const g = ctx.createGain();
                this._env(g, t, 0.015, dur * 0.4, dur * 0.5, peak);
                o.connect(f); f.connect(g); g.connect(u.gain);
                o.start(t); o.stop(t + dur + 0.05);
                u.sources.push(o);
            };
            let t = t0;
            switch (kind) {
                case 'laugh': {
                    const n = 4 + Math.floor(rnd() * 3);
                    for (let i = 0; i < n; i++) {
                        const p = f0 * (1.25 - i * 0.05);
                        noise(t, 0.04, 1800, 1.2, 0.08);
                        tone(t + 0.02, 0.11, p, p * 0.9, 750, 0.5);
                        t += 0.16 + rnd() * 0.04;
                    }
                    break;
                }
                case 'sob': {
                    for (let i = 0; i < 3; i++) {
                        noise(t, 0.22, 1200, 0.8, 0.1);                                  // respiro spezzato
                        tone(t + 0.18, 0.28, f0 * 1.3, f0 * 0.95, 600, 0.35);
                        t += 0.5 + rnd() * 0.15;
                    }
                    break;
                }
                case 'click':
                    noise(t, 0.012, 3000, 0.7, 0.25);
                    noise(t + 0.015, 0.09, 1800, 0.5, 0.05);
                    t += 0.12;
                    break;
                case 'line':
                default:
                    noise(t, 0.18, 2000, 0.5, 0.06);
                    t += 0.2;
                    break;
            }
            u.end = t + 0.1;
            return this._ctxToMs(t);
        },

        /* ---------------- Sirene ---------------- */

        _siren(kind, delay) {
            const ctx = this.ctx;
            const t0 = ctx.currentTime + delay;
            const dur = 2.6;
            const o = ctx.createOscillator();
            o.type = kind === '115' ? 'square' : 'sawtooth';
            const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.6);
            g.gain.setValueAtTime(0.14, t0 + dur - 1);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            if (kind === 'police') {
                // ululato: salita e discesa
                o.frequency.setValueAtTime(650, t0);
                o.frequency.linearRampToValueAtTime(1250, t0 + 0.65);
                o.frequency.linearRampToValueAtTime(650, t0 + 1.3);
                o.frequency.linearRampToValueAtTime(1250, t0 + 1.95);
                o.frequency.linearRampToValueAtTime(600, t0 + dur);
            } else {
                // bitonale: ambulanza più acuta e rapida, Vigili del fuoco più grave e lenta
                const [a, b, step] = kind === '115' ? [392, 523, 0.7] : [587, 784, 0.45];
                for (let t = 0, i = 0; t < dur; t += step, i++) o.frequency.setValueAtTime(i % 2 ? b : a, t0 + t);
                o.frequency.linearRampToValueAtTime(a * 0.94, t0 + dur); // leggero effetto Doppler finale
            }
            o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
            o.start(t0); o.stop(t0 + dur + 0.1);
        },

        /** Sirene degli enti attivati, una dopo l'altra. */
        dispatch(agencies) {
            if (!this._ok() || !agencies || !agencies.length) return;
            const kinds = [];
            if (agencies.includes('118')) kinds.push('118');
            if (agencies.includes('115')) kinds.push('115');
            if (agencies.includes('PS') || agencies.includes('CC')) kinds.push('police');
            kinds.forEach((k, i) => this._siren(k, 0.35 + i * 0.9));
        },

        /* ---------------- Eventi ---------------- */

        play(name) {
            switch (name) {
                case 'answer':   this._notes([[1800, 0, 0.02, 'square', 0.12], [600, 0.02, 0.06, 'sine', 0.18]]); break;
                case 'hold':     this._notes([[660, 0, 0.12], [440, 0.15, 0.16]]); break;
                case 'transfer': this._notes([[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.22]]); break;
                case 'hangup':   this._notes([[425, 0, 0.18, 'sine', 0.22], [425, 0.36, 0.18, 'sine', 0.22], [425, 0.72, 0.18, 'sine', 0.22]]); break;
                case 'queue':    this._notes([[1760, 0, 0.08, 'sine', 0.18], [1760, 0.14, 0.08, 'sine', 0.18]]); break;
                case 'fact':     this._notes([[1318, 0, 0.06, 'sine', 0.08], [1760, 0.05, 0.1, 'sine', 0.07]]); break;
                case 'click':    this._notes([[2400, 0, 0.012, 'square', 0.05]]); break;
                case 'end':      this._notes([[392, 0, 0.2], [523, 0.22, 0.2], [659, 0.44, 0.35]]); break;
            }
        },

        stopAll() {
            this.ring(0);
            this.lineOn(false);
            this.stopVoice(40);
            this.duck(false);
            if (LL.Voice && LL.Voice.stop) { try { LL.Voice.stop(); } catch (_) { /* */ } }
        },
    };

    LL.Sound = Sound;
})(globalThis.LL = globalThis.LL || {});
