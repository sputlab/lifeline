/**
 * LifeLine - Pianificatore dell'addestramento
 *
 * Nessuna chiamata casuale: arrivano solo quelle richieste dal tutor con l'azione
 * "spawn" (registrata, quindi riproducibile). Le chiamate sono ammorbidite:
 * chiamanti pazienti e calmi, nessuna richiamata, nessuna linea che cade.
 */
(function (LL) {
    'use strict';

    class TrainingScheduler {
        constructor({ templates, city }) {
            this.templates = templates;
            this.city = city;
        }

        init(engine) {
            this.engine = engine;
            this.queue = [];
            this.bases = new Map();
            this.history = [];
            this.count = 0;
        }

        due(gameMs) {
            const out = [];
            while (this.queue.length && this.queue[0].atMs <= gameMs) out.push(this.queue.shift());
            return out;
        }

        addCallback() { /* nessuna richiamata in addestramento */ }

        remaining() { return this.queue.length; }

        /**
         * payload: { code, tag, require?, witnessOf?, delaySec? }
         *   require:   enti richiesti desiderati ("118+115") per scegliere la variante
         *   witnessOf: tag di un evento già creato, per generarne un testimone
         */
        spawn(engine, p) {
            const tpl = this.templates.find((t) => t.code === p.code);
            if (!tpl || typeof p.tag !== 'string') return false;
            let content;
            if (p.witnessOf) {
                const base = this.bases.get(p.witnessOf);
                if (!base) return false;
                content = LL.CallBuilder.buildWitness(tpl, base, engine.rng.fork(`train:${p.tag}`), this.city);
            } else {
                for (let v = 0; v < 200; v++) {
                    content = LL.CallBuilder.build(tpl, engine.rng.fork(`train:${p.tag}:${v}`), this.city);
                    if (!p.require || content.truth.agencies_required.join('+') === p.require) break;
                }
                this.bases.set(p.tag, content);
            }
            content = this._soften(content);
            this.count++;
            const delay = Math.max(0, Math.min(120, Number(p.delaySec) || 0)) * 1000;
            this.queue.push({ atMs: engine.gameMs + delay, content, parentId: null, variantIndex: this.count,
                incidentTag: p.witnessOf || p.tag });
            this.queue.sort((a, b) => a.atMs - b.atMs);
            return true;
        }

        _soften(c) {
            return Object.assign({}, c, {
                dropAtActiveMs: null,
                caller: Object.assign({}, c.caller, {
                    ringPatienceSec: c.caller.ringPatienceSec * 4,
                    holdPatienceSec: c.caller.holdPatienceSec * 4,
                    panicStart: Math.min(c.caller.panicStart, 25),
                    reliability: 1,
                    callbackChance: 0,
                }),
            });
        }
    }

    LL.TrainingScheduler = TrainingScheduler;
})(globalThis.LL = globalThis.LL || {});
