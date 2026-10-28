/** Carica il motore di gioco in un contesto Node isolato. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadEngine() {
    const ctx = vm.createContext({ console, performance: { now: () => 0 } });
    for (const f of ['core/rng.js', 'core/events.js', 'game/call.js', 'game/queue.js', 'game/geo.js', 'game/cityart.js', 'game/builder.js',
                     'game/dialog.js', 'game/scheduler.js', 'core/clock.js', 'game/scoring.js', 'game/director.js', 'game/training.js', 'core/engine.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx, { filename: f });
    }
    return ctx.LL;
}

/** Modelli nel formato inviato dal server all'avvio del turno. */
function loadTemplates() {
    const dir = path.join(ROOT, 'sql/templates');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f, i) => {
        const content = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { id: i + 1, code: content.code, version: 1, weight: content.weight ?? 100, content };
    });
}

const city = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/city_valdemara.json'), 'utf8'));

function makeChecker() {
    let failures = 0;
    const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) failures++; };
    const done = () => {
        console.log(failures ? `\n${failures} test falliti` : '\nTutti i test superati');
        process.exitCode = failures ? 1 : 0;
    };
    return { check, done };
}

module.exports = { loadEngine, loadTemplates, city, makeChecker };
