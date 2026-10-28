/**
 * LifeLine - Generatore pseudo-casuale deterministico
 *
 * Stesso seed = stessa sequenza, su qualsiasi browser e sul server (replay).
 * fork(label) crea un flusso indipendente derivato dal seed e dall'etichetta,
 * così le azioni del giocatore non alterano, ad esempio, la sequenza degli arrivi.
 */
(function (LL) {
    'use strict';

    /** Hash di una stringa a 32 bit (derivato da cyrb53). */
    function hashString(str) {
        let h1 = 0xdeadbeef ^ str.length;
        let h2 = 0x41c6ce57 ^ str.length;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (h1 ^ h2) >>> 0;
    }

    function splitmix32(a) {
        return function () {
            a = (a + 0x9e3779b9) | 0;
            let t = a ^ (a >>> 16);
            t = Math.imul(t, 0x21f0aaad);
            t ^= t >>> 15;
            t = Math.imul(t, 0x735a2d97);
            return (t ^ (t >>> 15)) >>> 0;
        };
    }

    function sfc32(a, b, c, d) {
        return function () {
            a |= 0; b |= 0; c |= 0; d |= 0;
            const t = (((a + b) | 0) + d) | 0;
            d = (d + 1) | 0;
            a = b ^ (b >>> 9);
            b = (c + (c << 3)) | 0;
            c = (c << 21) | (c >>> 11);
            c = (c + t) | 0;
            return t >>> 0;
        };
    }

    class RNG {
        constructor(seed) {
            this.seed = seed >>> 0;
            const sm = splitmix32(this.seed);
            this._next = sfc32(sm(), sm(), sm(), sm());
            for (let i = 0; i < 12; i++) this._next();
        }

        /** Intero senza segno a 32 bit. */
        uint32() { return this._next(); }

        /** Decimale in [0, 1). */
        float() { return this._next() / 4294967296; }

        /** Intero in [min, max] inclusi. */
        int(min, max) { return min + Math.floor(this.float() * (max - min + 1)); }

        /** Decimale in [min, max). */
        range(min, max) { return min + this.float() * (max - min); }

        chance(p) { return this.float() < p; }

        pick(arr) { return arr[Math.floor(this.float() * arr.length)]; }

        /** Scelta pesata: items = [{ weight, ... }] oppure weightFn(item). */
        weighted(items, weightFn = (it) => it.weight) {
            let total = 0;
            for (const it of items) total += Math.max(0, weightFn(it));
            let r = this.float() * total;
            for (const it of items) {
                r -= Math.max(0, weightFn(it));
                if (r < 0) return it;
            }
            return items[items.length - 1];
        }

        shuffle(arr) {
            const a = arr.slice();
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(this.float() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
        }

        /** Flusso indipendente: dipende solo dal seed e dall'etichetta. */
        fork(label) { return new RNG(hashString(this.seed + ':' + label)); }
    }

    LL.RNG = RNG;
    LL.hashString = hashString;
})(globalThis.LL = globalThis.LL || {});
