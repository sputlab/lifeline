/**
 * LifeLine - Caricamento dei dati del gioco (testi, città, tipi di evento)
 *
 * Prova prima api/data.php (funziona anche dove i file .json sono bloccati),
 * poi il file diretto. Se falliscono entrambi, l'errore riporta file e codice HTTP.
 */
(function (LL) {
    'use strict';

    const version = document.querySelector('meta[name="app-version"]')?.content || '0';
    const FILES = {
        'lang-it': 'lang/it.json',
        'lang-en': 'lang/en.json',
        city: 'data/city_valdemara.json',
        events: 'data/event_types.json',
    };
    const cache = new Map();

    class DataError extends Error {
        constructor(file, detail) {
            super(`${file}: ${detail}`);
            this.code = 'data_unavailable';
            this.vars = { file, detail };
        }
    }

    async function viaApi(key) {
        const res = await fetch(`api/data.php?file=${encodeURIComponent(key)}&v=${encodeURIComponent(version)}`, { credentials: 'same-origin' });
        let json = null;
        try { json = await res.json(); } catch (_) { /* risposta non JSON */ }
        if (json && json.ok) return json.data;
        const msg = json?.error?.message || `HTTP ${res.status}`;
        throw new Error(msg);
    }

    async function direct(key) {
        const res = await fetch(`${FILES[key]}?v=${encodeURIComponent(version)}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function load(key) {
        if (cache.has(key)) return cache.get(key);
        let first;
        try {
            const d = await viaApi(key);
            cache.set(key, d);
            return d;
        } catch (e) { first = e; }
        try {
            const d = await direct(key);
            cache.set(key, d);
            return d;
        } catch (e) {
            throw new DataError(FILES[key], `${first.message}; ${e.message}`);
        }
    }

    LL.Data = { load, DataError };
})(globalThis.LL = globalThis.LL || {});
