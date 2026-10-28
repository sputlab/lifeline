/**
 * LifeLine - Pianificatore degli arrivi
 *
 * Interfaccia usata dal motore:
 *   init(engine)        pianificazione iniziale
 *   due(gameMs)         arrivi da far entrare fino a quell'istante
 *   addCallback(item)   inserisce una richiamata
 *
 * Versione semplice: orari con grappoli e scelta pesata dei modelli per fascia oraria
 * e difficoltà. Nello step 6 il Director userà la stessa interfaccia, con la curva di tensione.
 */
(function (LL) {
    'use strict';

    function timeBand(clockSec) {
        const h = Math.floor((((clockSec % 86400) + 86400) % 86400) / 3600);
        if (h >= 6 && h < 12) return 'mattina';
        if (h >= 12 && h < 18) return 'pomeriggio';
        if (h >= 18 && h < 22) return 'sera';
        return 'notte';
    }

    class TemplateScheduler {
        /**
         * @param {object} o
         * @param {Array}  o.templates        modelli dal server
         * @param {object} o.city             dati della città
         * @param {number} o.baseDifficulty   difficoltà di riferimento (dal grado)
         */
        constructor({ templates, city, baseDifficulty = 1 }) {
            if (!templates || templates.length === 0) throw new Error('Nessun modello di chiamata disponibile');
            this.templates = templates;
            this.city = city;
            this.base = baseDifficulty;
        }

        weightFor(tpl, band) {
            const bands = tpl.content.time_bands || tpl.time_bands || [];
            let w = Number(tpl.weight ?? tpl.content.weight ?? 100);
            if (bands.length && !bands.includes(band)) w *= 0.05;
            const d = Number(tpl.content.difficulty || 1);
            if (d > this.base + 2) w *= 0.08;
            else if (d > this.base + 1) w *= 0.35;
            return w;
        }

        init(engine) {
            this.engine = engine;
            const dur = engine.durationMs;
            const r = engine.rng.fork('arrivals');
            const times = [r.int(20000, 60000)];

            const n = r.int(9, 13);
            for (let i = 0; i < n; i++) times.push(r.int(90000, dur - 600000));

            const clusters = r.int(2, 4);
            for (let k = 0; k < clusters; k++) {
                const base = r.pick(times);
                const extra = r.int(1, 2);
                for (let j = 0; j < extra; j++) times.push(base + r.int(8000, 70000));
            }
            times.sort((a, b) => a - b);

            this.queue = times.map((atMs, i) => {
                const cr = engine.rng.fork('call:' + i);
                const band = timeBand(engine.gameStartSec + atMs / 1000);
                const tpl = cr.weighted(this.templates, (t) => this.weightFor(t, band));
                return { atMs, content: LL.CallBuilder.build(tpl, cr, this.city), parentId: null, variantIndex: i };
            });
        }

        due(gameMs) {
            const out = [];
            while (this.queue.length && this.queue[0].atMs <= gameMs) out.push(this.queue.shift());
            return out;
        }

        addCallback(item) {
            let i = this.queue.findIndex((q) => q.atMs > item.atMs);
            if (i < 0) i = this.queue.length;
            this.queue.splice(i, 0, item);
        }

        remaining() { return this.queue.length; }
    }

    LL.TemplateScheduler = TemplateScheduler;
    LL.timeBand = timeBand;
})(globalThis.LL = globalThis.LL || {});
