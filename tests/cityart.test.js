/**
 * Test degli elementi grafici della città: allineati alla logica e deterministici.
 * Uso: node tests/cityart.test.js
 */
'use strict';
const { loadEngine, city, makeChecker } = require('./_load');

const LL = loadEngine();
const G = LL.Geo;
const { check, done } = makeChecker();

const fresh = () => JSON.parse(JSON.stringify(city));
const c1 = fresh();
const a = LL.CityArt.build(c1);
const b = LL.CityArt.build(fresh());
check(JSON.stringify(a) === JSON.stringify(b), 'generazione deterministica');
console.log(`     ${a.buildings.length} edifici, ${a.trees.length} alberi, ${a.vines.length} filari, ${a.contours.length} curve di livello, ${a.bridges.length} ponti`);
check(a.buildings.length > 800 && a.bridges.length >= 3, 'la città è popolata (edifici e ponti)');

// Nessun edificio sulle carreggiate, nel torrente, nei parchi o fuori dalla propria zona
const segs = [];
for (const s of G.streets(c1)) {
    const half = LL.CityArt.ROAD[LL.CityArt.roadClass(c1.art, s.name)];
    for (let i = 1; i < s.path.length; i++) segs.push({ a: s.path[i - 1], b: s.path[i], half });
}
const river = c1.map.river;
let onRoad = 0, inRiver = 0, inPark = 0, outZone = 0;
for (const bd of a.buildings) {
    const probes = [[bd.pts.reduce((s, p) => s + p[0], 0) / 4, bd.pts.reduce((s, p) => s + p[1], 0) / 4]];
    for (let i = 0; i < 4; i++) {
        const p0 = bd.pts[i], p1 = bd.pts[(i + 1) % 4];
        for (let k = 0; k <= 10; k++) probes.push([p0[0] + (p1[0] - p0[0]) * k / 10, p0[1] + (p1[1] - p0[1]) * k / 10]);
    }
    for (const p of probes) {
        if (segs.some((sg) => G.nearestOnSegment(p, sg.a, sg.b).d < sg.half)) { onRoad++; break; }
    }
    for (const p of probes) {
        let hit = false;
        for (let i = 1; i < river.length; i++) if (G.nearestOnSegment(p, river[i - 1], river[i]).d < a.riverHalf) hit = true;
        if (hit) { inRiver++; break; }
    }
    if (probes.some((p) => (c1.art.parks || []).some((pk) => G.pointInPolygon(p, pk.polygon)))) inPark++;
    if (!probes.every((p) => G.pointInPolygon(p, c1.zones[bd.zone].polygon))) outZone++;
}
check(onRoad === 0, 'nessun edificio sopra una carreggiata');
check(inRiver === 0, 'nessun edificio nel torrente');
check(inPark === 0, 'nessun edificio dentro un parco');
check(outZone === 0, 'ogni edificio sta nella zona della propria via');

// Ogni civico resta raggiungibile: il punto del civico non cade dentro un edificio
let blockedAddr = 0;
for (const s of G.streets(c1)) {
    for (let n = 1; n <= s.max; n++) {
        const p = G.addressPoint(s, n);
        if (a.buildings.some((bd) => G.pointInPolygon(p, bd.pts))) blockedAddr++;
    }
}
check(blockedAddr === 0, 'nessun civico coperto da un edificio');

// Quadranti della griglia
check(G.gridRef(c1, [10, 10]) === 'A1' && G.gridRef(c1, [510, 420]) === 'G6', 'quadranti della griglia da 500 m');

done();
