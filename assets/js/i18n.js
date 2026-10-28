/**
 * LifeLine - Traduzioni
 * Stringhe in lang/<codice>.json, applicate agli elementi con data-i18n.
 */
'use strict';

const I18n = (() => {
    const supported = ['it', 'en'];
    let dict = {};
    let current = 'it';

    function resolve(key) {
        return key.split('.').reduce((obj, k) => (obj && k in obj ? obj[k] : undefined), dict);
    }

    function t(key, vars = {}) {
        const s = resolve(key);
        if (typeof s !== 'string') return key;
        return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    }

    function list(key) {
        const v = resolve(key);
        return Array.isArray(v) ? v : [];
    }

    function apply(root = document) {
        root.querySelectorAll('[data-i18n]').forEach((el) => {
            el.textContent = t(el.dataset.i18n);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
        });
        root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
            el.setAttribute('aria-label', t(el.dataset.i18nAria));
        });
    }

    async function load(lang) {
        const code = supported.includes(lang) ? lang : 'it';
        dict = await LL.Data.load(`lang-${code}`);
        current = code;
        document.documentElement.lang = code;
        try { localStorage.setItem('lifeline.lang', code); } catch (_) { /* storage non disponibile */ }
        apply();
    }

    function preferred() {
        try {
            const saved = localStorage.getItem('lifeline.lang');
            if (supported.includes(saved)) return saved;
        } catch (_) { /* storage non disponibile */ }
        return (navigator.language || 'it').toLowerCase().startsWith('it') ? 'it' : 'en';
    }

    return { load, t, list, apply, preferred, get lang() { return current; } };
})();
