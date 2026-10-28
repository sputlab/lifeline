/**
 * LifeLine - Orologio di gioco e Runner
 *
 * La simulazione avanza sempre a passi fissi (tick) di tempo di gioco: il risultato
 * non dipende dalla velocità del computer né dalla velocità di scorrimento.
 * Il Runner decide solo quanti tick eseguire per ogni frame:
 *   - tempo reale (x1) quando c'è una chiamata attiva, in attesa, che squilla o in coda;
 *   - accelerato (idleScale) quando la sala è vuota.
 */
(function (LL) {
    'use strict';

    const pad = (n) => String(n).padStart(2, '0');

    LL.Time = {
        /** Secondi dalla mezzanotte -> "HH:MM:SS" (con giro delle 24 ore). */
        clock(sec) {
            const s = ((Math.floor(sec) % 86400) + 86400) % 86400;
            return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
        },
        /** Durata in secondi -> "m:ss" oppure "h:mm:ss". */
        duration(sec) {
            const s = Math.max(0, Math.floor(sec));
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
        },
    };

    const MAX_TICKS_PER_FRAME = 5000;
    const MAX_FRAME_MS = 250;

    class Runner {
        constructor(engine, { idleScale = 90, onFrame = null } = {}) {
            this.engine = engine;
            this.idleScale = idleScale;
            this.debugMult = 1;
            this.onFrame = onFrame;
            this.running = false;
            this._raf = null;
            this._acc = 0;
            this._last = 0;
            this._frame = this._frame.bind(this);
        }

        /** Velocità di gioco (1 = tempo reale), senza il moltiplicatore di debug. */
        get gameScale() {
            return this.engine.isBusy() ? 1 : this.idleScale;
        }

        get scale() {
            return this.gameScale * this.debugMult;
        }

        start() {
            if (this.running || this.engine.ended) return;
            this.running = true;
            this._acc = 0;
            this._last = performance.now();
            this._raf = requestAnimationFrame(this._frame);
        }

        pause() {
            this.running = false;
            if (this._raf) cancelAnimationFrame(this._raf);
            this._raf = null;
        }

        _frame(now) {
            if (!this.running) return;
            const eng = this.engine;
            const dtReal = Math.min(now - this._last, MAX_FRAME_MS);
            this._last = now;

            const busyBefore = eng.isBusy();
            this._acc += dtReal * this.scale;

            const tickMs = eng.cfg.tickMs;
            let steps = 0;
            while (this._acc >= tickMs && steps < MAX_TICKS_PER_FRAME && !eng.ended) {
                eng.step();
                this._acc -= tickMs;
                steps++;
                // Appena arriva una chiamata si torna al tempo reale:
                // il tempo accelerato residuo del frame viene scartato.
                if (!busyBefore && eng.isBusy()) {
                    this._acc = 0;
                    break;
                }
            }

            if (this.onFrame) this.onFrame();
            if (eng.ended) {
                this.running = false;
                return;
            }
            this._raf = requestAnimationFrame(this._frame);
        }
    }

    LL.Runner = Runner;
})(globalThis.LL = globalThis.LL || {});
