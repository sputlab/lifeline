/**
 * LifeLine - Geometria della città
 *
 * Coordinate della mappa in unità (1 unità = city.map.meters_per_unit metri).
 * I civici sono distribuiti in modo uniforme lungo il tracciato della via.
 */
(function (LL) {
    'use strict';

    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

    function pathLength(path) {
        let len = 0;
        for (let i = 1; i < path.length; i++) len += dist(path[i - 1], path[i]);
        return len;
    }

    /** Punto lungo la polilinea alla frazione t (0..1). */
    function pointAt(path, t) {
        const total = pathLength(path);
        let target = Math.max(0, Math.min(1, t)) * total;
        for (let i = 1; i < path.length; i++) {
            const seg = dist(path[i - 1], path[i]);
            if (target <= seg || i === path.length - 1) {
                const k = seg > 0 ? Math.min(1, target / seg) : 0;
                return [
                    path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k,
                    path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k,
                ];
            }
            target -= seg;
        }
        return path[path.length - 1].slice();
    }

    /** Punto più vicino su un segmento, con la distanza e la frazione. */
    function nearestOnSegment(p, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const k = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
        const q = [a[0] + dx * k, a[1] + dy * k];
        return { point: q, d: dist(p, q), k };
    }

    function pointInPolygon(p, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [xi, yi] = poly[i];
            const [xj, yj] = poly[j];
            if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    const Geo = {
        dist,

        /** Elenco piatto delle vie: { name, zone, path, max }. */
        streets(city) {
            if (!city._streets) {
                city._streets = [];
                for (const [zone, z] of Object.entries(city.zones)) {
                    for (const s of z.streets) city._streets.push({ name: s.name, zone, path: s.path, max: s.max });
                }
            }
            return city._streets;
        },

        findStreet(city, name) {
            const n = String(name || '').trim().toLowerCase();
            return this.streets(city).find((s) => s.name.toLowerCase() === n) || null;
        },

        /** Coordinate di un civico. */
        addressPoint(street, number) {
            const max = Math.max(1, street.max);
            const n = Math.max(1, Math.min(max, Math.round(number)));
            return pointAt(street.path, max === 1 ? 0.5 : (n - 1) / (max - 1));
        },

        /** Via e civico più vicini a un punto. */
        nearestAddress(city, p) {
            let best = null;
            for (const s of this.streets(city)) {
                const total = pathLength(s.path);
                let run = 0;
                for (let i = 1; i < s.path.length; i++) {
                    const seg = dist(s.path[i - 1], s.path[i]);
                    const r = nearestOnSegment(p, s.path[i - 1], s.path[i]);
                    if (!best || r.d < best.d) {
                        const t = total ? (run + seg * r.k) / total : 0;
                        best = { street: s, d: r.d, point: r.point, number: Math.max(1, Math.round(1 + t * (s.max - 1))) };
                    }
                    run += seg;
                }
            }
            return best;
        },

        zoneAt(city, p) {
            for (const [key, z] of Object.entries(city.zones)) {
                if (pointInPolygon(p, z.polygon)) return key;
            }
            return null;
        },

        nearestLandmark(zone, p) {
            let best = null;
            for (const l of zone.landmarks) {
                const d = dist(l.at, p);
                if (!best || d < best.d) best = { name: l.name, at: l.at, d };
            }
            return best;
        },

        /** Distanza in metri tra due punti della mappa. */
        meters(city, a, b) {
            return dist(a, b) * (city.map?.meters_per_unit || 1);
        },

        /** Quadrante della griglia da 500 m: colonne A, B, C... righe 1, 2, 3... */
        gridRef(city, p) {
            const size = 500 / (city.map?.meters_per_unit || 1);
            const col = Math.max(0, Math.floor(p[0] / size));
            const row = Math.max(0, Math.floor(p[1] / size));
            return String.fromCharCode(65 + col) + (row + 1);
        },

        gridSize(city) { return 500 / (city.map?.meters_per_unit || 1); },

        pointAt,
        pointInPolygon,
        nearestOnSegment,
    };

    LL.Geo = Geo;
})(globalThis.LL = globalThis.LL || {});
