/**
 * LifeLine - Suoni della centrale (Web Audio, tutto sintetizzato, nessun file)
 *
 *   squillo       trillo a due toni; più fitto con più linee, urgente se qualcuno sta per riattaccare
 *   voce          «parlato» telefonico sintetico: sillabe con formanti vocaliche filtrate come una linea
 *                 telefonica. Tono, ritmo e tremolio cambiano con l'agitazione del chiamante.
 *   linea         fruscio leggero finché c'è una chiamata in linea
 *   sirene        a trasferimento avvenuto: bitonale ambulanza (118), bitonale grave Vigili del fuoco (115),
 *                 sirena ululante per Polizia e Carabinieri. Filtrate e sfumate come in lontananza.
 *   eventi        risposta, attesa, trasferimento, riattacco, coda, nuova informazione, fine turno
 *
 * Il contesto audio nasce al primo gesto dell'utente (regola dei browser).
 */
(function (LL) {
    'use strict';

    const KEY = 'lifeline.sound';
    const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [440, 1020], [660, 1720]];

    const Sound = {
        ctx: null,
        master: null,
        on: true,
        vol: 0.6,
        _ringTimer: null,
        _ringKey: '',
        _noise: null,
        _hiss: null,
        _voiceUntil: 0,

        load() {
            try {
                const s = JSON.parse(localStorage.getItem(KEY) || '{}');
                if (typeof s.on === 'boolean') this.on = s.on;
                if (typeof s.vol === 'number') this.vol = Math.max(0, Math.min(1, s.vol));
            } catch (_) { /* preferenze non disponibili */ }
        },
        save() { try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, vol: this.vol })); } catch (_) { /* ignora */ } },

        unlock() {
            if (!this.ctx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                this.ctx = new AC();
                this.master = this.ctx.createGain();
                const comp = this.ctx.createDynamicsCompressor();
                this.master.connect(comp);
                comp.connect(this.ctx.destination);
                this._applyVolume();
                // rumore bianco riutilizzabile (consonanti, fruscio di linea)
                const len = this.ctx.sampleRate * 2;
                this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
                const d = this._noise.getChannelData(0);
                for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            }
            if (this.ctx.state === 'suspended') this.ctx.resume();
        },

        setOn(on) { this.on = !!on; this._applyVolume(); this.save(); if (!this.on) this.stopAll(); },
        setVolume(v) { this.vol = Math.max(0, Math.min(1, v)); this._applyVolume(); this.save(); },
        _applyVolume() { if (this.master) this.master.gain.value = this.on ? this.vol * 0.55 : 0; },
        _ok() { return this.ctx && this.on; },

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
                g.connect(dest || this.master);
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
            this._notes(seq);
        },

        /** count = linee che squillano, urgent = qualcuno sta per riattaccare. */
        ring(count, urgent = false) {
            const key = `${count}:${urgent}`;
            if (key === this._ringKey) return;
            this._ringKey = key;
            clearInterval(this._ringTimer);
            this._ringTimer = null;
            if (count > 0 && this._ok()) {
                this._ringBurst(urgent);
                const every = urgent ? 1200 : count > 1 ? 1700 : 2600;
                this._ringTimer = setInterval(() => this._ringBurst(urgent), every);
            }
        },

        /* ---------------- Linea telefonica ---------------- */

        _telephone(dest) {
            // filtro passa-banda della linea telefonica (300-3400 Hz)
            const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320;
            const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
            hp.connect(lp); lp.connect(dest || this.master);
            return hp;
        },

        lineOn(on) {
            if (!this._ok()) return;
            if (on && !this._hiss) {
                const src = this.ctx.createBufferSource();
                src.buffer = this._noise; src.loop = true;
                const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.6;
                const g = this.ctx.createGain(); g.gain.value = 0.0001;
                g.gain.linearRampToValueAtTime(0.012, this.ctx.currentTime + 0.3);
                src.connect(bp); bp.connect(g); g.connect(this.master);
                src.start();
                this._hiss = { src, g };
            } else if (!on && this._hiss) {
                const { src, g } = this._hiss;
                g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.2);
                src.stop(this.ctx.currentTime + 0.25);
                this._hiss = null;
            }
        },

        /**
         * Parlato sintetico.
         * @param {object} o  { seconds, panic (0-100), voice: 'male'|'female'|'child'|'operator' }
         */
        speak({ seconds = 1.5, panic = 0, voice = 'male' }) {
            if (!this._ok()) return;
            const ctx = this.ctx;
            const now = Math.max(ctx.currentTime + 0.02, this._voiceUntil);
            const p = Math.max(0, Math.min(100, panic)) / 100;
            const base = { male: 118, female: 205, child: 290, operator: 150 }[voice] || 130;
            const f0 = base * (1 + p * 0.45);
            const rate = voice === 'operator' ? 4.2 : 3.8 + p * 4.2;          // sillabe al secondo
            const jitter = 0.08 + p * 0.25;
            const loud = voice === 'operator' ? 0.16 : 0.2 + p * 0.1;
            const n = Math.max(3, Math.round(seconds * rate));

            const out = this._telephone();
            const bus = ctx.createGain(); bus.gain.value = 1;
            bus.connect(out);
            // tremolio nella voce agitata
            if (p > 0.45 && voice !== 'operator') {
                const lfo = ctx.createOscillator(); const lg = ctx.createGain();
                lfo.frequency.value = 5 + p * 4; lg.gain.value = 0.25 * p;
                lfo.connect(lg); lg.connect(bus.gain);
                lfo.start(now); lfo.stop(now + seconds + 0.5);
            }

            let t = now;
            for (let i = 0; i < n; i++) {
                const dur = (1 / rate) * (0.7 + Math.random() * 0.6);
                const pause = Math.random() < 0.12 ? dur * 0.9 : dur * 0.12;   // piccole pause tra le parole
                const [F1, F2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
                const src = ctx.createOscillator();
                src.type = 'sawtooth';
                const pitch = f0 * (1 + (Math.random() * 2 - 1) * jitter);
                const endPitch = i === n - 1 ? pitch * (p > 0.6 ? 1.15 : 0.85) : pitch * (1 + (Math.random() - 0.5) * 0.1);
                src.frequency.setValueAtTime(pitch, t);
                src.frequency.linearRampToValueAtTime(endPitch, t + dur);
                const g = ctx.createGain();
                this._env(g, t, 0.025, dur * 0.55, dur * 0.35, loud * (0.6 + Math.random() * 0.4));
                const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = F1; f1.Q.value = 6;
                const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = F2; f2.Q.value = 8;
                const mix = ctx.createGain(); mix.gain.value = 2.2;
                src.connect(f1); src.connect(f2); f1.connect(mix); f2.connect(mix);
                mix.connect(g); g.connect(bus);
                src.start(t); src.stop(t + dur + 0.05);
                // consonante: breve soffio di rumore
                if (Math.random() < 0.55) {
                    const nz = ctx.createBufferSource(); nz.buffer = this._noise;
                    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 2500 + Math.random() * 1500; nb.Q.value = 1.5;
                    const ng = ctx.createGain();
                    this._env(ng, t, 0.005, 0.02, 0.03, loud * 0.35);
                    nz.connect(nb); nb.connect(ng); ng.connect(bus);
                    nz.start(t, Math.random()); nz.stop(t + 0.08);
                }
                t += dur + pause;
            }
            this._voiceUntil = t;
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
            o.connect(lp); lp.connect(g); g.connect(this.master);
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

        stopAll() { this.ring(0); this.lineOn(false); this._voiceUntil = 0; },
    };

    Sound.load();
    LL.Sound = Sound;
})(globalThis.LL = globalThis.LL || {});
