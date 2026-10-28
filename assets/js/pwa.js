/**
 * LifeLine - Registrazione del service worker
 */
'use strict';

(() => {
    if (!('serviceWorker' in navigator)) return;
    const meta = document.querySelector('meta[name="app-version"]');
    const version = meta ? meta.content : '0';

    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(version)}`).then((reg) => {
            // Aggiornamento trovato: attivalo subito, la pagina si ricarica da sola
            // solo se non c'è un turno in corso (body.in-console).
            reg.addEventListener('updatefound', () => {
                const worker = reg.installing;
                if (!worker) return;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                        worker.postMessage('skipWaiting');
                    }
                });
            });
        }).catch(() => { /* PWA opzionale: il gioco funziona comunque */ });

        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloaded || document.body.classList.contains('in-console')) return;
            reloaded = true;
            location.reload();
        });
    });
})();
