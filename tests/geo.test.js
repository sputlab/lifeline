/**
 * Test della geometria: vie nelle zone, civici, AML, scheda contatto.
 * Uso: node tests/geo.test.js
 */
'use strict';
const { loadEngine, loadTemplates, city, makeChecker } = require('./_load');

const LL = loadEngine();
const G = LL.Geo;
const templates = loadTemplates();
const { check, done } = makeChecker();

// 1. Ogni via sta dentro la propria zona (tutti i civici)
const outside = [];
for (const s of G.streets(city)) {
    for (let n = 1; n <= s.max; n++) {
        const p = G.addressPoint(s, n);
        const z = G.zoneAt(city, p);
        if (z !== s.zone) outside.push(`${s.name} ${n} -> ${z}`);
    }
}
check(outside.length === 0, 'tutti i civici cadono nella zona della loro via' + (outside.length ? ` (${outside.slice(0, 4).join('; ')})` : ''));

// 2. Nomi delle vie univoci
const names = G.streets(city).map((s) => s.name.toLowerCase());
check(new Set(names).size === names.length, 'nomi delle vie univoci');

// 3. Via e civico -> punto -> via e civico più vicini (andata e ritorno)
let roundTripOk = 0, total = 0;
for (const s of G.streets(city)) {
    for (const n of [1, Math.ceil(s.max / 2), s.max]) {
        total++;
        const back = G.nearestAddress(city, G.addressPoint(s, n));
        if (back.street.name === s.name && Math.abs(back.number - n) <= 1) roundTripOk++;
    }
}
check(roundTripOk / total > 0.9, `andata e ritorno indirizzo -> punto -> indirizzo (${roundTripOk}/${total})`);

// 4. AML: il punto reale è sempre dentro il cerchio; i fissi hanno l'intestazione
let amlIn = 0, amlTot = 0, landlines = 0, landOk = 0;
for (const t of templates) {
    for (let seed = 1; seed <= 200; seed++) {
        const c = LL.CallBuilder.build(t, new LL.RNG(seed), city);
        if (c.aml) {
            amlTot++;
            if (G.dist([c.aml.x, c.aml.y], [c.location.x, c.location.y]) <= c.aml.r + 0.01) amlIn++;
        }
        if (c.caller.phoneType === 'landline') {
            landlines++;
            if (c.directory && c.directory.street === c.location.street && !c.aml) landOk++;
        }
    }
}
check(amlTot > 0 && amlIn === amlTot, `il cerchio AML contiene sempre la posizione reale (${amlIn}/${amlTot})`);
check(landlines > 0 && landOk === landlines, 'le linee fisse mostrano l\'indirizzo di intestazione, senza AML');

// 5. Il riferimento citato ("vicino a...") è il più vicino alla posizione reale
{
    const c = LL.CallBuilder.build(templates.find((t) => t.code === 'INC_002'), new LL.RNG(11), city);
    const lm = G.nearestLandmark(city.zones[c.location.zone], [c.location.x, c.location.y]);
    check(lm.name === c.location.landmark, 'il punto di riferimento citato è il più vicino');
}

// 6. Scheda contatto: campi ripuliti dal motore
const f = LL.Engine.sanitizeForm({
    location: { x: 100.123, y: 50, street: 'Via Roma', number: 12, zone: 'centro' },
    eventType: 'sanitaria.malore', persons: 2, hazards: ['gas', 'razzi'], notes: '  nota  ', extra: 'x',
});
check(f.location.x === 100.1 && f.eventType === 'sanitaria.malore' && f.hazards.join() === 'gas' && f.notes === 'nota' && !('extra' in f),
    'la scheda viene validata (valori non ammessi scartati)');
check(Object.keys(LL.Engine.sanitizeForm({ eventType: 'DROP TABLE', persons: -1, location: { x: 'a' } })).length === 0,
    'valori non validi ignorati');

// 7. Trasferimento con scheda: salvata nel risultato e riproducibile
{
    const e = new LL.Engine({ seed: 5, gameStartSec: 0, durationSec: 3600, scheduler: new LL.TemplateScheduler({ templates, city }) });
    e.scheduler.queue = [];
    e.scheduler.addCallback({ atMs: 0, content: LL.CallBuilder.build(templates[0], new LL.RNG(1), city), parentId: null });
    e.step();
    const c = e.lineCall(0);
    e.dispatch('answer', { callId: c.id }); e.step();
    e.dispatch('transfer', { callId: c.id, agencies: ['118'], form: { eventType: 'sanitaria.malore', location: { x: 10, y: 20 } } }); e.step();
    check(c.result.form.eventType === 'sanitaria.malore' && c.result.form.location.y === 20, 'la scheda trasferita è registrata nell\'esito');
    const logged = e.log.find((a) => a.type === 'transfer');
    check(!!logged.payload.form, 'la scheda è nel registro azioni (replay)');
}

done();
