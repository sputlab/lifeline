/**
 * Test delle preferenze (migrazione da 'lifeline.sound', validazione, chiavi sconosciute).
 * Uso: node tests/prefs.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeChecker } = require('./_load');

const { check, done } = makeChecker();
const SRC = fs.readFileSync(path.join(__dirname, '../assets/js/ui/prefs.js'), 'utf8');

/** localStorage finto; broken = ogni accesso lancia un'eccezione (modalità privata, cookie bloccati). */
function fakeStorage(init = {}, broken = false) {
    const data = Object.assign({}, init);
    return {
        data,
        getItem(k) { if (broken) throw new Error('bloccato'); return k in data ? data[k] : null; },
        setItem(k, v) { if (broken) throw new Error('bloccato'); data[k] = String(v); },
        removeItem(k) { delete data[k]; },
    };
}

/** Carica prefs.js come nel browser, con il localStorage dato. */
function load(storage) {
    const ctx = vm.createContext({ console, localStorage: storage });
    vm.runInContext(SRC, ctx, { filename: 'prefs.js' });
    return ctx.LL.Prefs;
}

// 1. Primo avvio senza nulla: valori predefiniti
{
    const st = fakeStorage();
    const P = load(st);
    check(P.get('on') === true && P.get('master') === 0.6 && P.get('voiceMode') === 'auto' && P.get('speechLen') === 'adaptive', 'valori predefiniti');
    check(!('lifeline.prefs' in st.data), 'senza vecchie impostazioni non scrive nulla al caricamento');
}

// 2. Migrazione: chi aveva i suoni spenti in 1.1 resta muto
{
    const st = fakeStorage({ 'lifeline.sound': JSON.stringify({ on: false, vol: 0.35 }) });
    const P = load(st);
    check(P.get('on') === false, 'migrazione: suoni spenti restano spenti');
    check(P.get('master') === 0.35, 'migrazione: volume conservato');
    const saved = JSON.parse(st.data['lifeline.prefs']);
    check(saved.on === false && saved.master === 0.35, 'migrazione salvata in lifeline.prefs');
    check('lifeline.sound' in st.data, 'la vecchia chiave resta (ritorno a 1.1 possibile)');
    // secondo avvio: vale lifeline.prefs, non di nuovo la migrazione
    st.data['lifeline.sound'] = JSON.stringify({ on: true, vol: 1 });
    const P2 = load(st);
    check(P2.get('on') === false && P2.get('master') === 0.35, 'la migrazione avviene una sola volta');
}
{
    const P = load(fakeStorage({ 'lifeline.sound': JSON.stringify({ on: true, vol: 7 }) }));
    check(P.get('on') === true && P.get('master') === 1, 'migrazione: volume fuori scala limitato a 1');
    const Pbad = load(fakeStorage({ 'lifeline.sound': '{rotto' }));
    check(Pbad.get('on') === true, 'vecchie impostazioni illeggibili: predefiniti');
}

// 3. Validazione e chiavi sconosciute conservate
{
    const st = fakeStorage({ 'lifeline.prefs': JSON.stringify({ on: 'si', master: 2, voiceMode: 'robot', textScale: 3, futureKey: { a: 1 } }) });
    const P = load(st);
    check(P.get('on') === true && P.get('master') === 1 && P.get('voiceMode') === 'auto' && P.get('textScale') === 1.15, 'valori non validi corretti o limitati');
    P.set('voiceVol', 0.5);
    const saved = JSON.parse(st.data['lifeline.prefs']);
    check(saved.futureKey && saved.futureKey.a === 1, 'chiavi sconosciute conservate al salvataggio');
    check(saved.voiceVol === 0.5, 'set salva subito');
}

// 4. set / onChange
{
    const P = load(fakeStorage());
    const seen = [];
    const off = P.onChange((p, keys) => seen.push(keys.join(',') + '=' + p.voiceMode));
    P.set('voiceMode', 'off');
    P.set('voiceMode', 'off');                       // nessun cambiamento: nessuna notifica
    P.set('voiceMode', 'nonvalido');                 // ignorato
    P.set({ speechLen: 'short', motion: 'reduced' });
    check(seen.length === 2 && seen[0] === 'voiceMode=off' && seen[1] === 'speechLen,motion=off', 'onChange solo sui veri cambiamenti: ' + seen.join(' | '));
    off();
    P.set('voiceMode', 'tts');
    check(seen.length === 2, 'onChange: ci si può staccare');
    const snap = P.get();
    snap.voiceMode = 'babble';
    check(P.get('voiceMode') === 'tts', 'get() restituisce una copia');
}

// 5. Storage bloccato: nessuna eccezione, valori in memoria
{
    let P;
    let threw = false;
    try { P = load(fakeStorage({}, true)); P.set('on', false); } catch (_) { threw = true; }
    check(!threw && P.get('on') === false, 'storage bloccato: il gioco continua');
    let threw2 = false;
    try {
        const ctx = vm.createContext({ console });
        Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('SecurityError'); } });
        vm.runInContext(SRC, ctx);
        ctx.LL.Prefs.set('master', 0.2);
    } catch (_) { threw2 = true; }
    check(!threw2, 'localStorage inaccessibile: nessuna eccezione');
}

// 6. apply(): variabile CSS e data-motion
{
    const P = load(fakeStorage());
    const props = {};
    const doc = { documentElement: { style: { setProperty: (k, v) => { props[k] = v; } } }, body: { dataset: {} } };
    P.set({ textScale: 1.1, motion: 'reduced' });
    P.apply(doc);
    check(props['--call-scale'] === '1.1' && doc.body.dataset.motion === 'reduced', 'apply(): --call-scale e body[data-motion]');
}

done();
