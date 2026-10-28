/**
 * LifeLine - Elementi grafici della città generati dai dati
 *
 * Tutto deriva dalle coordinate di data/city_valdemara.json: edifici lungo le vie,
 * filari dei vigneti, alberi, curve di livello, ponti. Generazione deterministica
 * (stesso risultato a ogni caricamento) e sempre allineata alla logica del gioco:
 * nessun edificio invade una carreggiata, il torrente, un parco o una piazza.
 */
(function (LL) {
    'use strict';

    const G = () => LL.Geo;

    // Dimensioni in unità mappa (1 unità = 6 m)
    const ROAD = { main: 2.2, normal: 1.4, trail: 0.5 };   // semi-larghezza della carreggiata
    const ZONE_STYLE = {
        centro:       { w: [3.5, 6], d: [3.5, 6], gap: [0.2, 0.6], rows: 6, setback: 0.5, p: 1, pack: 0.66 },
        residenziale: { w: [4, 6.5], d: [4, 6.5], gap: [1.8, 4.5], rows: 3, setback: 1.6, p: 0.88 },
        industriale:  { w: [10, 22], d: [8, 15], gap: [4, 10], rows: 2, setback: 3, p: 0.85 },
        colline:      { w: [3, 5], d: [2.5, 4], gap: [18, 55], rows: 1, setback: 2, p: 0.55 },
        montagna:     { w: [2.5, 3.5], d: [2, 3], gap: [35, 90], rows: 1, setback: 2, p: 0.3 },
    };

    function segDist(p, a, b) { return G().nearestOnSegment(p, a, b).d; }

    function segIntersect(a, b, c, d) {
        const r = [b[0] - a[0], b[1] - a[1]];
        const s = [d[0] - c[0], d[1] - c[1]];
        const den = r[0] * s[1] - r[1] * s[0];
        if (Math.abs(den) < 1e-9) return null;
        const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
        const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return { p: [a[0] + t * r[0], a[1] + t * r[1]], t };
    }

    /** Curva chiusa morbida (Catmull-Rom -> Bézier) come attributo "d". */
    function smoothClosed(pts) {
        const n = pts.length;
        let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
        for (let i = 0; i < n; i++) {
            const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
            const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
            const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
            d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
        }
        return d + 'Z';
    }

    function roadClass(art, name) {
        if ((art.trails || []).includes(name)) return 'trail';
        if ((art.main_roads || []).includes(name)) return 'main';
        return 'normal';
    }

    const CityArt = {
        ROAD,
        roadClass,

        build(city) {
            if (city._art) return city._art;
            const art = city.art || {};
            const rng = new LL.RNG(LL.hashString(`lifeline-art:${city.name}:${art.seed || 1}`));
            const streets = G().streets(city);
            const river = city.map.river || [];
            const riverHalf = (art.river_width || 5) / 2;

            // Segmenti stradali con la loro semi-larghezza
            const segs = [];
            for (const s of streets) {
                const half = ROAD[roadClass(art, s.name)];
                for (let i = 1; i < s.path.length; i++) segs.push({ a: s.path[i - 1], b: s.path[i], half });
            }
            const riverSegs = [];
            for (let i = 1; i < river.length; i++) riverSegs.push({ a: river[i - 1], b: river[i] });

            // Aree vietate agli edifici: parchi, campi, piazze (tracciati chiusi)
            const blocked = [...(art.parks || []).map((p) => p.polygon)];
            for (const f of art.fields || []) {
                const [x, y] = f.at;
                blocked.push([[x - f.w / 2 - 2, y - f.h / 2 - 2], [x + f.w / 2 + 2, y - f.h / 2 - 2], [x + f.w / 2 + 2, y + f.h / 2 + 2], [x - f.w / 2 - 2, y + f.h / 2 + 2]]);
            }
            const plazas = streets.filter((s) => s.path.length > 3 && G().dist(s.path[0], s.path[s.path.length - 1]) < 3).map((s) => s.path);
            blocked.push(...plazas);

            // Indice spaziale dei segmenti (celle da 20 unità): ogni controllo guarda solo i vicini
            const SC = 20, REACH = 6;
            const segIndex = new Map();
            const indexSeg = (sg, list) => {
                const x0 = Math.floor((Math.min(sg.a[0], sg.b[0]) - REACH) / SC), x1 = Math.floor((Math.max(sg.a[0], sg.b[0]) + REACH) / SC);
                const y0 = Math.floor((Math.min(sg.a[1], sg.b[1]) - REACH) / SC), y1 = Math.floor((Math.max(sg.a[1], sg.b[1]) + REACH) / SC);
                for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
                    const k = `${list}:${x},${y}`;
                    if (!segIndex.has(k)) segIndex.set(k, []);
                    segIndex.get(k).push(sg);
                }
            };
            segs.forEach((sg) => indexSeg(sg, 'r'));
            riverSegs.forEach((sg) => indexSeg(sg, 'w'));
            const near = (list, p) => segIndex.get(`${list}:${Math.floor(p[0] / SC)},${Math.floor(p[1] / SC)}`) || [];
            const nearRoad = (p, margin) => near('r', p).some((sg) => segDist(p, sg.a, sg.b) < sg.half + margin);

            /** Il rettangolo è libero da strade? Bordi campionati + nessun segmento che lo attraversa. */
            const rectClear = (pts, margin) => {
                for (let i = 0; i < 4; i++) {
                    const a = pts[i], b = pts[(i + 1) % 4];
                    const L = G().dist(a, b);
                    const steps = Math.max(1, Math.ceil(L / 1.5));
                    for (let k = 0; k <= steps; k++) {
                        const q = [a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps];
                        if (nearRoad(q, margin)) return false;
                    }
                }
                const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
                const seen = new Set();
                for (const q of [...pts, [cx, cy]]) {
                    for (const sg of near('r', q)) {
                        if (seen.has(sg)) continue;
                        seen.add(sg);
                        if (G().pointInPolygon(sg.a, pts) || G().pointInPolygon(sg.b, pts)) return false;
                        for (let i = 0; i < 4; i++) if (segIntersect(sg.a, sg.b, pts[i], pts[(i + 1) % 4])) return false;
                    }
                }
                return true;
            };
            const nearRiver = (p, margin) => near('w', p).some((sg) => segDist(p, sg.a, sg.b) < riverHalf + margin);
            const inBlocked = (p) => blocked.some((poly) => G().pointInPolygon(p, poly));

            // Griglia spaziale per evitare sovrapposizioni tra edifici
            const cell = 12;
            const hash = new Map();
            const hkey = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
            const overlaps = (cx, cy, r, pack = 0.82) => {
                for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                    const list = hash.get(`${Math.floor(cx / cell) + dx},${Math.floor(cy / cell) + dy}`);
                    if (list && list.some((o) => Math.hypot(o.x - cx, o.y - cy) < (o.r + r) * pack)) return true;
                }
                return false;
            };
            const addHash = (cx, cy, r) => {
                const k = hkey(cx, cy);
                if (!hash.has(k)) hash.set(k, []);
                hash.get(k).push({ x: cx, y: cy, r });
            };

            // ---------- Edifici lungo le vie (seguono la curvatura: posizione per lunghezza d'arco) ----------
            const frameAt = (path, cum, total, d) => {
                const dd = Math.max(0, Math.min(total, d));
                let i = 1;
                while (i < path.length - 1 && cum[i] < dd) i++;
                const a = path[i - 1], b = path[i];
                const L = cum[i] - cum[i - 1] || 1;
                const k = (dd - cum[i - 1]) / L;
                const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
                return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], u, n: [-u[1], u[0]] };
            };
            const buildings = [];
            for (const s of streets) {
                const style = ZONE_STYLE[s.zone];
                const zonePoly = city.zones[s.zone].polygon;
                const half = ROAD[roadClass(art, s.name)];
                if (!style || roadClass(art, s.name) === 'trail') continue;
                const path = s.path;
                const cum = [0];
                for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + G().dist(path[i - 1], path[i]));
                const total = cum[cum.length - 1];
                for (const side of [1, -1]) {
                    let t = rng.range(0, style.gap[1]);
                    while (t < total - 2) {
                        const w = rng.range(style.w[0], style.w[1]);
                        if (t + w > total) break;
                        const f = frameAt(path, cum, total, t + w / 2);
                        const { u, n } = f;
                        let off = half + style.setback;
                        for (let row = 0; row < style.rows; row++) {
                            const d = rng.range(style.d[0], style.d[1]);
                            if (!rng.chance(style.p)) { off += d + rng.range(0.8, 2); continue; }
                            const c = [f.p[0] + n[0] * side * (off + d / 2), f.p[1] + n[1] * side * (off + d / 2)];
                            const hw = w / 2, hd = d / 2;
                            const pts = [
                                [c[0] - u[0] * hw - n[0] * hd, c[1] - u[1] * hw - n[1] * hd],
                                [c[0] + u[0] * hw - n[0] * hd, c[1] + u[1] * hw - n[1] * hd],
                                [c[0] + u[0] * hw + n[0] * hd, c[1] + u[1] * hw + n[1] * hd],
                                [c[0] - u[0] * hw + n[0] * hd, c[1] - u[1] * hw + n[1] * hd],
                            ];
                            const probes = [...pts, c];
                            const r = Math.hypot(hw, hd);
                            const ok = probes.every((q) => G().pointInPolygon(q, zonePoly) && !nearRiver(q, 1.5) && !inBlocked(q))
                                && rectClear(pts, 0.5) && !overlaps(c[0], c[1], r, style.pack || 0.82);
                            if (!ok) break;
                            buildings.push({ zone: s.zone, pts: pts.map((q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]) });
                            addHash(c[0], c[1], r);
                            off += d + rng.range(0.6, 2.2);
                        }
                        t += w + rng.range(style.gap[0], style.gap[1]);
                    }
                }
            }

            // ---------- Filari dei vigneti ----------
            const vines = [];
            for (const v of art.vineyards || []) {
                const ang = (v.angle || 0) * Math.PI / 180;
                const dir = [Math.cos(ang), Math.sin(ang)];
                const nrm = [-dir[1], dir[0]];
                const xs = v.polygon.map((p) => p[0]), ys = v.polygon.map((p) => p[1]);
                const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
                const R = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 2;
                for (let k = -R; k <= R; k += 2.4) {
                    let start = null;
                    for (let tt = -R; tt <= R + 1; tt += 1) {
                        const p = [cx + nrm[0] * k + dir[0] * tt, cy + nrm[1] * k + dir[1] * tt];
                        const inside = tt <= R && G().pointInPolygon(p, v.polygon) && !nearRoad(p, 2);
                        if (inside && !start) start = p;
                        if (!inside && start) {
                            if (G().dist(start, p) > 3) vines.push([start, p]);
                            start = null;
                        }
                    }
                }
            }

            // ---------- Boschi ----------
            const trees = [];
            for (const f of art.forests || []) {
                const xs = f.polygon.map((p) => p[0]), ys = f.polygon.map((p) => p[1]);
                for (let x = Math.min(...xs); x <= Math.max(...xs); x += 5) {
                    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 5) {
                        const p = [x + rng.range(-2, 2), y + rng.range(-2, 2)];
                        if (!G().pointInPolygon(p, f.polygon) || nearRoad(p, 3) || nearRiver(p, 3)) continue;
                        if (rng.chance(0.8)) trees.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(rng.range(1.2, 2.3) * 10) / 10]);
                    }
                }
            }

            // ---------- Alberi nei parchi (più radi, con un vialetto libero) ----------
            const parkPaths = [];
            for (const pk of art.parks || []) {
                const xs = pk.polygon.map((p) => p[0]), ys = pk.polygon.map((p) => p[1]);
                const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
                const path = [[x0 + (x1 - x0) * 0.08, y0 + (y1 - y0) * 0.85], [x0 + (x1 - x0) * 0.45, y0 + (y1 - y0) * 0.45], [x0 + (x1 - x0) * 0.92, y0 + (y1 - y0) * 0.2]];
                parkPaths.push(path);
                for (let x = x0; x <= x1; x += 6) {
                    for (let y = y0; y <= y1; y += 6) {
                        const p = [x + rng.range(-2.5, 2.5), y + rng.range(-2.5, 2.5)];
                        if (!G().pointInPolygon(p, pk.polygon) || nearRoad(p, 3)) continue;
                        if (segDist(p, path[0], path[1]) < 3 || segDist(p, path[1], path[2]) < 3) continue;
                        if (rng.chance(0.45)) trees.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(rng.range(1.6, 2.8) * 10) / 10]);
                    }
                }
            }

            // ---------- Curve di livello ----------
            const contours = [];
            for (const pk of art.peaks || []) {
                const ph1 = rng.range(0, Math.PI * 2), ph2 = rng.range(0, Math.PI * 2);
                for (let k = 1; k <= pk.rings; k++) {
                    const r = k * pk.step;
                    const pts = [];
                    for (let a = 0; a < 360; a += 15) {
                        const th = a * Math.PI / 180;
                        const wob = 1 + 0.13 * Math.sin(3 * th + ph1 + k * 0.3) + 0.07 * Math.sin(5 * th + ph2);
                        pts.push([pk.at[0] + Math.cos(th) * r * wob * 1.6, pk.at[1] + Math.sin(th) * r * wob * pk.squash * 1.6]);
                    }
                    contours.push({ d: smoothClosed(pts), zone: pk.zone || 'montagna', major: k % 3 === 0 });
                }
            }

            // ---------- Ponti ----------
            const bridges = [];
            for (const s of streets) {
                const half = ROAD[roadClass(art, s.name)];
                for (let i = 1; i < s.path.length; i++) {
                    for (const rs of riverSegs) {
                        const hit = segIntersect(s.path[i - 1], s.path[i], rs.a, rs.b);
                        if (!hit) continue;
                        const a = s.path[i - 1], b = s.path[i];
                        const L = G().dist(a, b);
                        const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
                        const n = [-u[1], u[0]];
                        const len = riverHalf + 3, wid = half + 1;
                        const c = hit.p;
                        bridges.push([
                            [c[0] - u[0] * len - n[0] * wid, c[1] - u[1] * len - n[1] * wid],
                            [c[0] + u[0] * len - n[0] * wid, c[1] + u[1] * len - n[1] * wid],
                            [c[0] + u[0] * len + n[0] * wid, c[1] + u[1] * len + n[1] * wid],
                            [c[0] - u[0] * len + n[0] * wid, c[1] - u[1] * len + n[1] * wid],
                        ]);
                    }
                }
            }

            city._art = { buildings, vines, trees, contours, bridges, plazas, riverHalf, parkPaths };
            return city._art;
        },
    };

    LL.CityArt = CityArt;
})(globalThis.LL = globalThis.LL || {});
