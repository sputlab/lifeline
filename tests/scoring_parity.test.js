/**
 * Parità tra le formule di punteggio JavaScript (client) e PHP (server).
 * Richiede php nel PATH. Uso: node tests/scoring_parity.test.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const LL = loadEngine();
const S = LL.CallState;
const templates = loadTemplates();
const { check, done } = makeChecker();

function play(seed, sloppiness) {
    const e = new LL.Engine({ seed, gameStartSec: 79200, durationSec: 21600,
        scheduler: new LL.TemplateScheduler({ templates, city, baseDifficulty: 2 }) });
    const r = new LL.RNG(seed).fork('bot');
    while (!e.ended) {
        const a = e.activeCall();
        if (a && !a.dialog.pending) {
            const opts = LL.Dialog.options(a).filter((o) => o.asked === 0);
            if (opts.length && a.activeMs < 30000 && r.chance(0.8)) e.dispatch('ask', { callId: a.id, nodeId: r.pick(opts).id });
            else {
                const t = a.content.truth;
                const l = a.content.location;
                const off = r.chance(sloppiness) ? r.int(20, 200) : 0;
                const ag = r.chance(sloppiness) ? [r.pick(['118', '115', 'PS', 'CC'])] : (t.agencies_required.length ? t.agencies_required : ['118']);
                if (r.chance(0.15)) e.dispatch('close', { callId: a.id, reason: 'informazioni' });
                else e.dispatch('transfer', { callId: a.id, agencies: ag,
                    form: { location: { x: l.x + off, y: l.y, street: l.street, number: l.number, zone: l.zone },
                            eventType: r.chance(sloppiness) ? 'sanitaria.malore' : t.event_type } });
            }
        } else if (!a && e.tick % 25 === 0) {
            const c = [...e.calls.values()].find((k) => k.state === S.RINGING || k.state === S.ON_HOLD);
            if (c && r.chance(0.7)) e.dispatch(c.state === S.RINGING ? 'answer' : 'resume', { callId: c.id });
        }
        e.step();
    }
    return LL.Scoring.evaluateShift(e, city);
}

const difficulties = Object.fromEntries(templates.map((t) => [t.id, t.content.difficulty]));
const shifts = [];
for (let i = 0; i < 60; i++) shifts.push(play(5000 + i, [0, 0.2, 0.5, 0.8][i % 4]));

let php;
try {
    php = JSON.parse(execFileSync('php', [path.join(__dirname, 'scoring_parity.php')], {
        input: JSON.stringify(shifts.map((s) => ({ calls: s.calls, difficulties }))),
    }).toString());
} catch (err) {
    console.log('SKIP php non disponibile: ' + err.message.split('\n')[0]);
    process.exit(0);
}

const mism = [];
shifts.forEach((s, i) => {
    const p = php[i];
    if (s.percent !== p.percent || s.grade !== p.grade || s.xp !== p.xp || s.points !== p.points) {
        mism.push(`#${i}: js ${s.grade} ${s.percent} ${s.xp} / php ${p.grade} ${p.percent} ${p.xp}`);
    }
});
console.log('     voti simulati:', shifts.map((s) => s.grade).join(' '));
check(mism.length === 0, `stesso voto, percentuale, punti e XP su ${shifts.length} turni` + (mism.length ? ` (${mism.slice(0, 3).join('; ')})` : ''));
check(new Set(shifts.map((s) => s.grade)).size >= 3, 'i turni simulati coprono voti diversi');
done();
