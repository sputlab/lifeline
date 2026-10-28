/**
 * LifeLine - Director
 *
 * Decide quando arriva la prossima chiamata e quale, seguendo una curva di tensione:
 *   tensione(t) = base crescente nel turno + picchi (onde gaussiane) + adattamento alla performance
 * Alta tensione = chiamate più ravvicinate, più difficili, a raffica; bassa tensione = respiro.
 * La media sale nel corso del turno, ma non in modo lineare.
 *
 * Adattamento: il Director osserva le chiamate chiuse (esito rispetto alla verità) e
 * alza o abbassa la pressione entro limiti stretti. Tutto è deterministico: dipende solo
 * dal seed e dallo stato del motore, quindi il turno resta riproducibile dal registro azioni.
 *
 * Genera anche i testimoni multipli di uno stesso evento (da accorpare) e, a volte,
 * un evento "gemello" vicino ma distinto (da non accorpare).
 */
(function (LL) {
    'use strict';

    const S = LL.CallState;
    const LAST_WINDOW_MS = 10 * 60 * 1000;   // niente nuove chiamate negli ultimi 10 minuti
    const SAMPLE_MS = 5 * 60 * 1000;
    const ADAPT_MIN = -0.25;
    const ADAPT_MAX = 0.2;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    class Director {
        /**
         * @param {object} o
         * @param {Array}  o.templates
         * @param {object} o.city
         * @param {number} o.baseDifficulty  dal grado del giocatore
         */
        constructor({ templates, city, baseDifficulty = 1 }) {
            if (!templates || templates.length === 0) throw new Error('Nessun modello di chiamata disponibile');
            this.templates = templates;
            this.city = city;
            this.base = baseDifficulty;
        }

        init(engine) {
            this.engine = engine;
            this.dur = engine.durationMs;
            const plan = engine.rng.fork('director:plan');
            this.rGap = engine.rng.fork('director:gaps');

            // 2-3 picchi di tensione, lontani dall'inizio
            const n = plan.int(2, 3);
            this.peaks = [];
            for (let i = 0; i < n; i++) {
                this.peaks.push({
                    at: plan.range(0.18 + i * (0.7 / n), 0.18 + (i + 1) * (0.7 / n)) * this.dur,
                    width: plan.range(12, 24) * 60000,
                    height: plan.range(0.22, 0.38),
                });
            }

            this.queue = [];         // richiamate, testimoni, gemelli programmati
            this.spawned = 0;
            this.nextAt = plan.int(20000, 60000);
            this.adapt = 0;
            this.seen = new Set();
            this.recent = [];
            this.used = new Map();       // modello -> volte uscito nel turno
            this.recentCats = [];
            this.history = [];
            this.lastSample = -Infinity;
        }

        /* ---------- Tensione ---------- */

        baseTension(ms) {
            const p = ms / this.dur;
            let t = 0.12 + 0.42 * p;
            for (const pk of this.peaks) t += pk.height * Math.exp(-((ms - pk.at) ** 2) / (2 * pk.width ** 2));
            return clamp(t, 0, 1);
        }

        tension(ms) { return clamp(this.baseTension(ms) + this.adapt, 0, 1); }

        /* ---------- Interfaccia verso il motore ---------- */

        due(gameMs) {
            this._observe();
            if (gameMs - this.lastSample >= SAMPLE_MS) {
                this.lastSample = gameMs;
                this.history.push({ ms: gameMs, base: +this.baseTension(gameMs).toFixed(3), tension: +this.tension(gameMs).toFixed(3), adapt: +this.adapt.toFixed(3) });
            }

            const out = [];
            while (this.queue.length && this.queue[0].atMs <= gameMs) out.push(this.queue.shift());

            if (gameMs >= this.nextAt && gameMs < this.dur - LAST_WINDOW_MS) {
                out.push(...this._spawn(gameMs));
            }
            return out;
        }

        addCallback(item) { this._enqueue(item); }

        remaining() { return this.queue.length + (this.nextAt < this.dur - LAST_WINDOW_MS ? 1 : 0); }

        _enqueue(item) {
            let i = this.queue.findIndex((q) => q.atMs > item.atMs);
            if (i < 0) i = this.queue.length;
            this.queue.splice(i, 0, item);
        }

        /* ---------- Generazione ---------- */

        _spawn(gameMs) {
            const i = this.spawned++;
            const cr = this.engine.rng.fork('call:' + i);
            const T = this.tension(gameMs);
            const band = LL.timeBand(this.engine.gameStartSec + gameMs / 1000);
            const target = this.base - 0.5 + T * 4 + this.adapt * 6;

            const tpl = cr.weighted(this.templates, (t) => this._weight(t, band, target));
            const content = LL.CallBuilder.build(tpl, cr, this.city);
            const tag = 'inc:' + i;
            const items = [{ atMs: gameMs, content, parentId: null, variantIndex: i, incidentTag: tag }];
            this.recent.push(tpl.code);
            if (this.recent.length > 4) this.recent.shift();
            this.used.set(tpl.code, (this.used.get(tpl.code) || 0) + 1);
            this.recentCats.push(tpl.content.category);
            if (this.recentCats.length > 2) this.recentCats.shift();

            // Testimoni dello stesso evento
            const dup = content.duplicates;
            if (dup) {
                if (cr.chance(Math.min(0.9, dup.chance * (0.5 + 0.5 * T)))) {
                    const extra = dup.max > 1 && cr.chance(T * 0.5) ? cr.int(1, dup.max - 1) : 0;
                    const count = 1 + extra;
                    const [lo, hi] = dup.delay_s || [20, 150];
                    for (let k = 0; k < count; k++) {
                        const wr = this.engine.rng.fork(`call:${i}:w${k}`);
                        this._enqueue({ atMs: gameMs + wr.int(lo, hi) * 1000, content: LL.CallBuilder.buildWitness(tpl, content, wr, this.city),
                            parentId: null, variantIndex: i, incidentTag: tag });
                    }
                }
                // Evento gemello: stesso tipo, stessa zona, luogo diverso
                if (dup.near_twin_chance && cr.chance(dup.near_twin_chance)) {
                    const tr = this.engine.rng.fork(`call:${i}:twin`);
                    this._enqueue({ atMs: gameMs + tr.int(60, 300) * 1000,
                        content: LL.CallBuilder.build(tpl, tr, this.city, { zone: content.location.zone }),
                        parentId: null, variantIndex: i, incidentTag: `${tag}:twin` });
                }
            }

            // Prossimo arrivo: l'adattamento incide sul ritmo solo a metà (pesa di più sulla difficoltà)
            const Tg = clamp(this.baseTension(gameMs) + this.adapt * 0.5, 0, 1);
            const busy = this.engine.board.occupied();
            let gapSec = (2400 * (1 - Tg) + 480 * Tg) * this.rGap.range(0.5, 1.5);
            if (busy >= 3) gapSec *= 1.4;                         // sala già piena: respiro
            if (Tg > 0.62 && this.rGap.chance((Tg - 0.62) * 1.3)) { // raffica nei picchi
                gapSec = this.rGap.int(8, 60);
            }
            this.nextAt = gameMs + Math.round(gapSec * 1000);
            return items;
        }

        /**
         * Peso di un modello: fascia oraria, vicinanza alla difficoltà desiderata (larga,
         * per non restringersi a pochi modelli), forte penalità per i modelli già usciti
         * nel turno e per due chiamate di fila della stessa categoria.
         */
        _weight(tpl, band, target) {
            const c = tpl.content;
            let w = Number(tpl.weight ?? c.weight ?? 100);
            const bands = c.time_bands || [];
            if (bands.length && !bands.includes(band)) w *= 0.12;
            const d = Number(c.difficulty || 1);
            w *= Math.exp(-((d - target) ** 2) / (2 * 2.3 ** 2));
            w *= Math.pow(0.25, this.used.get(tpl.code) || 0);
            if (this.recent.includes(tpl.code)) w *= 0.3;
            if (this.recentCats.length === 2 && this.recentCats.every((k) => k === c.category)) w *= 0.5;
            return w;
        }

        /* ---------- Adattamento alla performance ---------- */

        _observe() {
            for (const c of this.engine.calls.values()) {
                if (!c.isFinal() || this.seen.has(c.id)) continue;
                this.seen.add(c.id);
                this.adapt = clamp(this.adapt + this._signal(c), ADAPT_MIN, ADAPT_MAX);
            }
        }

        /** Segnale rapido sulla gestione di una chiamata (verità nota al Director). */
        _signal(c) {
            const t = c.content.truth;
            const emergency = !String(t.event_type).startsWith('impropria.') && t.agencies_required.length > 0;
            switch (c.state) {
                case S.ABANDONED: return emergency ? -0.05 : -0.02;
                case S.DROPPED: return emergency ? -0.04 : 0.01;
                case S.CLOSED: return emergency ? -0.06 : 0.015;
                case S.MERGED: {
                    const target = this.engine.getCall(c.result.targetId);
                    return target && target.incidentKey === c.incidentKey ? 0.02 : -0.04;
                }
                case S.TRANSFERRED: {
                    if (!emergency) return -0.02;
                    const ag = LL.Scoring.agencyCheck(t, c.result.agencies);
                    const f = c.result.form || {};
                    let near = false;
                    if (f.location) near = LL.Geo.meters(this.city, [f.location.x, f.location.y], [c.content.location.x, c.content.location.y]) < 150;
                    if (ag.missing.length) return -0.05;
                    return near && f.eventType ? 0.03 : 0.005;
                }
                default: return 0;
            }
        }
    }

    LL.Director = Director;
})(globalThis.LL = globalThis.LL || {});
