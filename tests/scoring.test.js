/**
 * Test della valutazione: assi, esiti per evento, voto e XP.
 * Uso: node tests/scoring.test.js
 */
'use strict';
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const LL = loadEngine();
const S = LL.CallState;
const templates = loadTemplates();
const { check, done } = makeChecker();
const run = (e, sec) => { for (let i = 0; i < sec * 10; i++) e.step(); };

/** Motore con chiamate controllate. seedFilter permette di scegliere una variante. */
function setup(code, { seed = 1, panic, filter } = {}) {
    const tpl = templates.find((t) => t.code === code);
    let s = seed;
    let content;
    for (; s < seed + 500; s++) {
        content = LL.CallBuilder.build(tpl, new LL.RNG(s), city);
        if (!filter || filter(content)) break;
    }
    if (panic !== undefined) content.caller.panicStart = panic;
    const e = new LL.Engine({ seed: 99, gameStartSec: 0, durationSec: 3600, scheduler: new LL.TemplateScheduler({ templates, city }) });
    e.scheduler.queue = [];
    e.scheduler.addCallback({ atMs: 0, content, parentId: null, variantIndex: 0 });
    e.step();
    return { e, c: e.lineCall(0), content };
}
function answer(e, c) { e.dispatch('answer', { callId: c.id }); e.step(); }
function ask(e, c, ids) {
    for (const id of ids) {
        e.dispatch('ask', { callId: c.id, nodeId: id });
        run(e, (c.content.nodesById[id].costSec) + 0.3);
    }
}
function formFor(c, over = {}) {
    const l = c.content.location;
    return Object.assign({ location: { x: l.x, y: l.y, street: l.street, number: l.number, zone: l.zone }, eventType: c.content.truth.event_type }, over);
}
function finish(e) { while (!e.ended) e.step(); return LL.Scoring.evaluateShift(e, city); }

// 1. Gestione corretta di un arresto cardiaco
{
    const { e, c } = setup('SAN_007', { panic: 20 });
    answer(e, c);
    ask(e, c, ['q_dove', 'q_coscienza', 'q_respiro']);
    e.dispatch('transfer', { callId: c.id, agencies: ['118'], form: formFor(c) }); e.step();
    const r = finish(e).calls[0];
    console.log('     perfetta:', JSON.stringify(r.axes), 'finale', r.final, r.outcome, 'ritardo', r.delaySec, 's');
    check(r.final >= 85 && r.outcome === 'positivo', 'gestione corretta: punteggio alto ed esito positivo');
    check(r.axes.location === 100 && r.axes.agencies === 100 && r.axes.classification === 100, 'luogo, enti e tipologia pieni');
}

// 2. Ente sbagliato: 115 invece di 118
{
    const { e, c } = setup('SAN_007', { panic: 20 });
    answer(e, c); ask(e, c, ['q_dove']);
    e.dispatch('transfer', { callId: c.id, agencies: ['115'], form: formFor(c) }); e.step();
    const r = finish(e).calls[0];
    check(r.axes.agencies === 0 && r.outcome === 'negativo', 'ente richiesto mancante: enti a 0 ed esito peggiorato');
    check(r.notes.some((n) => n.key === 'db.note_missing_agency'), 'il debriefing segnala l\'ente mancante');
}

// 3. Competenza territoriale scambiata (PS al posto di CC)
{
    const { e, c } = setup('STR_005', { panic: 20, filter: (x) => x.truth.agencies_required.join() === 'CC' });
    answer(e, c); ask(e, c, ['q_dove', 'q_feriti']);
    e.dispatch('transfer', { callId: c.id, agencies: ['PS'], form: formFor(c) }); e.step();
    const r = finish(e).calls[0];
    check(r.axes.agencies === 50 && r.notes.some((n) => n.key === 'db.note_competence'), 'PS invece di CC: metà punteggio enti e nota di competenza');
    const { e: e2, c: c2 } = setup('STR_005', { panic: 20, filter: (x) => x.truth.agencies_required.join() === 'CC' });
    answer(e2, c2); ask(e2, c2, ['q_dove', 'q_feriti']);
    e2.dispatch('transfer', { callId: c2.id, agencies: ['CC'], form: formFor(c2) }); e2.step();
    const r2 = finish(e2).calls[0];
    check(r.delaySec - r2.delaySec === 180, 'lo scambio di competenza aggiunge 3 minuti di ritardo');
}

// 4. Emergenza chiusa come non pertinente
{
    const { e, c } = setup('IMP_003', { filter: (x) => x.truth.event_type === 'sanitaria.dolore_toracico' });
    answer(e, c); run(e, 5);
    e.dispatch('close', { callId: c.id, reason: 'informazioni' }); e.step();
    const r = finish(e).calls[0];
    check(r.axes.agencies === 0 && r.outcome === 'negativo' && r.final < 40, 'la farmacia che nasconde un dolore toracico, chiusa: esito negativo');
}

// 5. Scherzo chiuso correttamente e in fretta
{
    const { e, c } = setup('IMP_004');
    answer(e, c); ask(e, c, ['q_dove', 'q_ambiente']);
    e.dispatch('close', { callId: c.id, reason: 'scherzo' }); e.step();
    const r = finish(e).calls[0];
    check(r.final >= 85 && r.axes.classification === 100 && r.outcome === 'nessuno', 'scherzo riconosciuto e chiuso: punteggio alto');
}

// 6. Chiamata non pertinente trasferita: spreco di risorse
{
    const { e, c } = setup('IMP_003', { filter: (x) => x.truth.event_type === 'impropria.informazioni' });
    answer(e, c); ask(e, c, ['q_emergenza']);
    e.dispatch('transfer', { callId: c.id, agencies: ['118'], form: formFor(c, { eventType: 'sanitaria.malore' }) }); e.step();
    const r = finish(e).calls[0];
    check(r.axes.agencies === 20 && r.notes.some((n) => n.key === 'db.note_transferred_improper'), 'trasferire una richiesta di informazioni penalizza gli enti');
}

// 7. Luogo sbagliato: civico errato dato nel panico
{
    const { e, c } = setup('SAN_007', { panic: 20 });
    answer(e, c); ask(e, c, ['q_dove', 'q_coscienza', 'q_respiro']);
    const st = LL.Geo.findStreet(city, c.content.location.street);
    const wrongN = c.content.location.number > st.max / 2 ? 1 : st.max;
    const p = LL.Geo.addressPoint(st, wrongN);
    e.dispatch('transfer', { callId: c.id, agencies: ['118'], form: formFor(c, { location: { x: p[0], y: p[1], street: st.name, number: wrongN, zone: st.zone } }) }); e.step();
    const r = finish(e).calls[0];
    console.log('     civico sbagliato: errore', r.you.errorM, 'm, luogo', r.axes.location, 'ritardo', r.delaySec, 's');
    check(r.you.errorM > 50 && r.axes.location < 100, 'un civico sbagliato riduce il punteggio del luogo');
}

// 8. Scheda incompleta: +45 s per campo mancante
{
    const make = (form) => {
        const { e, c } = setup('SAN_001', { panic: 20, filter: (x) => x.truth.agencies_required.join() === '118' });
        answer(e, c); ask(e, c, ['q_dove', 'q_accesso']);
        e.dispatch('transfer', { callId: c.id, agencies: ['118'], form: form(c) }); e.step();
        return finish(e).calls[0];
    };
    const full = make((c) => formFor(c));
    const noType = make((c) => formFor(c, { eventType: undefined }));
    check(noType.delaySec - full.delaySec === 45 && noType.notes.some((n) => n.key === 'db.note_incomplete'), 'tipologia mancante: 45 s di ritardo in più e nota');
}

// 9. Chiamata persa e richiamata: l'esito conta dal primo squillo; accorpare la seconda richiamata è corretto
{
    const { e, c } = setup('SAN_001', { panic: 20, filter: (x) => x.caller.callbackChance > 0 });
    c.content.caller.callbackChance = 1;
    run(e, 80); // nessuno risponde
    check(c.state === S.ABANDONED, 'la chiamata non risposta viene abbandonata');
    let cb = null;
    while (!cb && e.tick < 50000) { e.step(); cb = [...e.calls.values()].find((k) => k.parentId === c.id && k.state === S.RINGING); }
    answer(e, cb); ask(e, cb, ['q_dove', 'q_accesso']);
    e.dispatch('transfer', { callId: cb.id, agencies: cb.content.truth.agencies_required, form: formFor(cb) }); e.step();
    const ev = finish(e);
    const r0 = ev.calls.find((r) => r.id === c.id);
    const r1 = ev.calls.find((r) => r.id === cb.id);
    check(r0.final === 0 && r1.decisive && r1.incidentKey === r0.incidentKey, 'la chiamata persa vale 0, la richiamata decide l\'esito dello stesso evento');
    check(r1.delaySec >= (cb.arrivalMs - c.arrivalMs) / 1000, 'il ritardo parte dal primo squillo, non dalla richiamata');
}
{
    const { e, c } = setup('INC_002', { panic: 20 });
    answer(e, c); ask(e, c, ['q_dove', 'q_persone']);
    e.dispatch('transfer', { callId: c.id, agencies: c.content.truth.agencies_required, form: formFor(c) }); e.step();
    // stessa situazione, un secondo testimone (duplicato dello stesso evento)
    e.scheduler.addCallback({ atMs: e.gameMs + 100, content: c.content, parentId: c.id });
    run(e, 1);
    const d = [...e.calls.values()].find((k) => k.parentId === c.id);
    answer(e, d); ask(e, d, ['q_dove']);
    e.dispatch('merge', { callId: d.id, targetId: c.id, form: formFor(d) }); e.step();
    const r = finish(e).calls.find((x) => x.id === d.id);
    check(r.axes.agencies === 100 && r.axes.classification === 100, 'accorpare il duplicato all\'evento giusto: pieno punteggio');
}

// 10. Determinismo della valutazione, voto e XP
{
    const { e, c } = setup('SAN_007', { panic: 20 });
    answer(e, c); ask(e, c, ['q_dove']);
    e.dispatch('transfer', { callId: c.id, agencies: ['118'], form: formFor(c) }); e.step();
    while (!e.ended) e.step();
    const a = LL.Scoring.evaluateShift(e, city);
    const b = LL.Scoring.evaluateShift(e, city);
    check(JSON.stringify(a) === JSON.stringify(b), 'la valutazione è deterministica');
    check(a.grade === LL.Scoring.capGrade(LL.Scoring.gradeFor(a.percent), a.outcomes) && a.xp === LL.Scoring.idiv(a.points * LL.Scoring.GRADE_MULT[a.grade], 100) + 50, 'voto e XP coerenti con le formule');
}
check(['S', 'A', 'B', 'C', 'D'].join() === [95, 85, 70, 55, 20].map(LL.Scoring.gradeFor).join(), 'soglie dei voti: S 90, A 80, B 65, C 50');
check(LL.Scoring.capGrade('S', { negativo: 1, parziale: 0 }) === 'B' && LL.Scoring.capGrade('S', { negativo: 0, parziale: 2 }) === 'A'
    && LL.Scoring.capGrade('C', { negativo: 1, parziale: 0 }) === 'C', 'tetti al voto per esiti negativi e parziali');

done();
