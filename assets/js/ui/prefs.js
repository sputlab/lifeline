/**
 * LifeLine - Preferenze del giocatore (audio, voce, testo, animazioni)
 *
 * Salvate in localStorage 'lifeline.prefs'. Al primo avvio importa le vecchie
 * impostazioni 'lifeline.sound' {on, vol}: chi aveva i suoni spenti li ritrova spenti.
 * Le chiavi sconosciute (scritte da versioni più nuove) vengono conservate.
 *
 *   LL.Prefs.get()            copia di tutte le preferenze
 *   LL.Prefs.get('voiceVol')  un valore
 *   LL.Prefs.set('voiceVol', 0.8) / LL.Prefs.set({ ... })
 *   LL.Prefs.onChange(fn)     fn(prefs, changedKeys); restituisce la funzione per staccarsi
 *
 * Nessun accesso allo storage può far fallire il gioco: tutto è in try/catch.
 */
(function (LL) {
    'use strict';

    const KEY = 'lifeline.prefs';
    const LEGACY_KEY = 'lifeline.sound';

    const clamp = (lo, hi) => (v, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    const oneOf = (...list) => (v, d) => (list.includes(v) ? v : d);
    const bool = (v, d) => (typeof v === 'boolean' ? v : d);
    const str = (max) => (v, d) => (typeof v === 'string' ? v.slice(0, max) : d);

    /** Valore predefinito e validatore di ogni preferenza. */
    const SCHEMA = {
        on:            [true, bool],                       // suoni attivi
        master:        [0.6, clamp(0, 1)],                 // volume generale
        voiceVol:      [1, clamp(0, 1)],                   // voce del chiamante
        sfxVol:        [0.8, clamp(0, 1)],                 // effetti, squilli, sirene
        voiceMode:     ['auto', oneOf('auto', 'tts', 'hd', 'babble', 'off')],
        voiceName:     ['', str(200)],                     // voce preferita ('' = varia per chiamante)
        speechLen:     ['adaptive', oneOf('full', 'adaptive', 'short')],
        operatorVoice: [false, bool],                      // leggere ad alta voce le domande dell'operatore
        textScale:     [1, clamp(0.9, 1.15)],
        motion:        ['system', oneOf('system', 'reduced')],
        subtitles:     ['typewriter', oneOf('typewriter', 'instant')],
    };

    function defaults() {
        const o = {};
        for (const [k, [d]] of Object.entries(SCHEMA)) o[k] = d;
        return o;
    }

    function sanitize(raw) {
        const out = Object.assign({}, raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
        for (const [k, [d, check]] of Object.entries(SCHEMA)) out[k] = check(out[k], d);
        return out;
    }

    /**
     * Crea un archivio di preferenze. Il gioco usa l'istanza globale; i test passano uno storage finto.
     * @param {Storage|null} storage
     */
    function create(storage) {
        const store = storage || null;
        const listeners = new Set();
        let data = defaults();

        function read(key) {
            try { return store ? store.getItem(key) : null; } catch (_) { return null; }
        }
        function write() {
            try { if (store) store.setItem(KEY, JSON.stringify(data)); } catch (_) { /* storage pieno o bloccato */ }
        }

        function load() {
            let raw = null;
            try { raw = JSON.parse(read(KEY) || 'null'); } catch (_) { raw = null; }
            if (raw && typeof raw === 'object') {
                data = sanitize(raw);
                return;
            }
            // migrazione da 1.1: { on, vol }
            data = defaults();
            let legacy = null;
            try { legacy = JSON.parse(read(LEGACY_KEY) || 'null'); } catch (_) { legacy = null; }
            if (legacy && typeof legacy === 'object') {
                if (typeof legacy.on === 'boolean') data.on = legacy.on;
                if (typeof legacy.vol === 'number' && isFinite(legacy.vol)) data.master = Math.max(0, Math.min(1, legacy.vol));
                write();
            }
        }

        const api = {
            KEY,
            SCHEMA,
            defaults,

            get(key) {
                if (key === undefined) return Object.assign({}, data);
                return data[key];
            },

            /** set('chiave', valore) oppure set({ chiave: valore, ... }). Valori non validi vengono ignorati. */
            set(key, value) {
                const patch = typeof key === 'string' ? { [key]: value } : (key || {});
                const changed = [];
                for (const [k, v] of Object.entries(patch)) {
                    const next = SCHEMA[k] ? SCHEMA[k][1](v, data[k]) : v;
                    if (next !== data[k]) { data[k] = next; changed.push(k); }
                }
                if (!changed.length) return api;
                write();
                const snap = api.get();
                listeners.forEach((fn) => { try { fn(snap, changed); } catch (e) { console.error(e); } });
                return api;
            },

            onChange(fn) {
                listeners.add(fn);
                return () => listeners.delete(fn);
            },

            /** Applica dimensione del testo e animazioni al documento. */
            apply(doc) {
                const d = doc || (typeof document !== 'undefined' ? document : null);
                if (!d || !d.documentElement) return;
                try {
                    d.documentElement.style.setProperty('--call-scale', String(data.textScale));
                    if (d.body) d.body.dataset.motion = data.motion;
                } catch (_) { /* documento non pronto */ }
            },

            load,
        };
        load();
        return api;
    }

    let storage = null;
    try { storage = typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { storage = null; }
    const Prefs = create(storage);
    Prefs.create = create;
    LL.Prefs = Prefs;

    if (typeof document !== 'undefined') {
        const applyNow = () => Prefs.apply(document);
        if (document.body) applyNow();
        else document.addEventListener('DOMContentLoaded', applyNow, { once: true });
        Prefs.onChange((p, keys) => { if (keys.includes('textScale') || keys.includes('motion')) applyNow(); });
    }
})(globalThis.LL = globalThis.LL || {});
