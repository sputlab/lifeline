/**
 * LifeLine - Mappa di Valdemara (SVG)
 *
 * Zoom con rotellina o pulsanti, trascinamento per spostarsi, clic per posizionare
 * il luogo dell'evento. Mostra il cerchio AML (cellulari) o l'indirizzo di intestazione
 * (linee fisse) della chiamata in linea, il punto scelto dall'operatore e gli eventi trasferiti.
 * Nomi delle vie e dei punti di riferimento compaiono solo con lo zoom.
 */
(function (LL) {
    'use strict';

    const NS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs = {}, parent = null) => {
        const n = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (parent) parent.append(n);
        return n;
    };
    const pts = (path) => path.map((p) => p.join(',')).join(' ');

    let uid = 0;

    class MapView {
        constructor(container, city, { onPick } = {}) {
            this.city = city;
            this.onPick = onPick;
            this.W = city.map.width;
            this.H = city.map.height;
            this.view = { x: 0, y: 0, w: 1e6, h: 0 };
            this.id = `map${++uid}`;

            this.svg = svgEl('svg', { class: 'map__svg', viewBox: `0 0 ${this.W} ${this.H}`, role: 'img' });
            this.svg.setAttribute('aria-label', I18n.t('map.aria'));
            container.replaceChildren(this.svg);
            this.container = container;

            this._draw();
            this._bind();
            this._applyView();
        }

        /* ---------- Disegno statico ---------- */

        _draw() {
            const s = this.svg;
            const city = this.city;
            const art = LL.CityArt.build(city);
            const cfg = city.art || {};
            const P = (pts) => pts.map((q) => q.join(',')).join(' ');

            // Ritagli per zona (curve di livello, colline)
            const defs = svgEl('defs', {}, s);
            for (const [key, z] of Object.entries(city.zones)) {
                const cp = svgEl('clipPath', { id: `${this.id}-clip-${key}` }, defs);
                svgEl('polygon', { points: pts(z.polygon) }, cp);
            }

            const vg = svgEl('radialGradient', { id: `${this.id}-vignette`, cx: '50%', cy: '50%', r: '75%' }, defs);
            svgEl('stop', { offset: '60%', 'stop-color': '#000', 'stop-opacity': '0' }, vg);
            svgEl('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': '0.35' }, vg);

            // 1. Terreno, tinto per competenza territoriale
            const gZones = svgEl('g', { class: 'map__zones' }, s);
            for (const [key, z] of Object.entries(city.zones)) {
                svgEl('polygon', { points: pts(z.polygon), 'data-zone': key, 'data-police': z.police, class: 'map__zone' }, gZones);
            }

            // 2. Rilievo: ombreggiatura morbida delle alture e curve di livello ritagliate sulla zona
            const gShade = svgEl('g', { class: 'map__shade' }, s);
            (cfg.peaks || []).forEach((pk, i) => {
                const gid = `${this.id}-hill${i}`;
                const rg = svgEl('radialGradient', { id: gid, cx: '42%', cy: '38%', r: '60%' }, defs);
                svgEl('stop', { offset: '0%', 'stop-color': '#9fb3c8', 'stop-opacity': '0.16' }, rg);
                svgEl('stop', { offset: '55%', 'stop-color': '#6f8499', 'stop-opacity': '0.06' }, rg);
                svgEl('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': '0' }, rg);
                const rx = pk.rings * pk.step * 1.8, ry = rx * pk.squash;
                svgEl('ellipse', { cx: pk.at[0], cy: pk.at[1], rx, ry, fill: `url(#${gid})`, 'clip-path': `url(#${this.id}-clip-${pk.zone || 'montagna'})` }, gShade);
            });
            const gRelief = svgEl('g', { class: 'map__relief' }, s);
            for (const c of art.contours) {
                svgEl('path', { d: c.d, class: `map__contour${c.major ? ' map__contour--major' : ''}`, 'clip-path': `url(#${this.id}-clip-${c.zone})` }, gRelief);
            }

            // 3. Verde: boschi, parchi, campo sportivo, vigneti
            const gGreen = svgEl('g', { class: 'map__green' }, s);
            const gTrees = svgEl('g', { class: 'map__trees' }, gGreen);
            for (const p of cfg.parks || []) svgEl('polygon', { points: P(p.polygon), class: 'map__park' }, gGreen);
            for (const pp of art.parkPaths || []) svgEl('polyline', { points: P(pp), class: 'map__park-path' }, gGreen);
            const gParkTrees = svgEl('g', { class: 'map__trees map__trees--park' }, gGreen);
            const inPark = (x, y) => (cfg.parks || []).some((pk) => LL.Geo.pointInPolygon([x, y], pk.polygon));
            for (const [x, y, r] of art.trees) svgEl('circle', { cx: x, cy: y, r }, inPark(x, y) ? gParkTrees : gTrees);
            for (const f of cfg.fields || []) {
                const [x, y] = f.at;
                svgEl('rect', { x: x - f.w / 2, y: y - f.h / 2, width: f.w, height: f.h, class: 'map__field' }, gGreen);
                svgEl('line', { x1: x, y1: y - f.h / 2, x2: x, y2: y + f.h / 2, class: 'map__field-line' }, gGreen);
                svgEl('circle', { cx: x, cy: y, r: Math.min(f.w, f.h) * 0.18, class: 'map__field-line' }, gGreen);
            }
            const vd = art.vines.map(([a, b]) => `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`).join('');
            if (vd) svgEl('path', { d: vd, class: 'map__vines' }, gGreen);

            // 4. Acqua
            if (city.map.river) {
                const rd = 'M' + city.map.river.map((q) => q.join(',')).join(' L');
                svgEl('path', { d: rd, class: 'map__river-bank', 'stroke-width': art.riverHalf * 2 + 2.4 }, s);
                svgEl('path', { d: rd, class: 'map__river', 'stroke-width': art.riverHalf * 2 }, s);
            }

            // 5. Piazze e edifici
            const gBuild = svgEl('g', { class: 'map__buildings' }, s);
            for (const pl of art.plazas) svgEl('polygon', { points: P(pl), class: 'map__plaza' }, gBuild);
            const byZone = {};
            for (const b of art.buildings) (byZone[b.zone] = byZone[b.zone] || []).push(`M${P(b.pts).replace(/ /g, 'L')}Z`);
            for (const [zone, parts] of Object.entries(byZone)) {
                svgEl('path', { d: parts.join(''), class: 'map__building', 'data-zone': zone }, gBuild);
            }

            // 6. Strade: prima i bordi, poi le carreggiate (i viali sopra alle vie)
            const gCasing = svgEl('g', { class: 'map__casings' }, s);
            const gRoads = svgEl('g', { class: 'map__streets' }, s);
            const gLabels = svgEl('g', { class: 'map__street-labels' }, s);
            const order = LL.Geo.streets(city).map((st, i) => ({ st, i, cls: LL.CityArt.roadClass(cfg, st.name) }))
                .sort((a, b) => ({ trail: 0, normal: 1, main: 2 }[a.cls] - { trail: 0, normal: 1, main: 2 }[b.cls]));
            const labelJobs = [];
            for (const { st, i, cls } of order) {
                const pid = `${this.id}-st${i}`;
                const d = 'M' + st.path.map((q) => q.join(',')).join(' L');
                const half = LL.CityArt.ROAD[cls];
                if (cls !== 'trail') svgEl('path', { d, class: 'map__casing', 'stroke-width': half * 2 + 1.1 }, gCasing);
                svgEl('path', { id: pid, d, class: `map__street map__street--${cls}`, 'stroke-width': half * 2 }, gRoads);

                const first = st.path[0];
                const last = st.path[st.path.length - 1];
                if (st.path.length > 3 && LL.Geo.dist(first, last) < 3) {
                    const cx = st.path.reduce((a, q) => a + q[0], 0) / st.path.length;
                    const top = Math.min(...st.path.map((q) => q[1]));
                    const t = svgEl('text', { x: cx, y: top - 4, class: 'map__street-label map__street-label--plaza', 'text-anchor': 'middle' }, gLabels);
                    t.textContent = st.name;
                    const halfLen = st.name.length * 11 * 0.56 * ((this.W / 2.2) / 600) / 2;
                    (this._reservedLabels = this._reservedLabels || []).push({ name: st.name, c: [cx, top - 6], half: halfLen });
                    continue;
                }
                labelJobs.push({ st, cls, pid });
            }
            for (const lab of this._placeLabels(labelJobs)) {
                const t = svgEl('text', { class: `map__street-label${lab.cls === 'main' ? ' map__street-label--main' : ''}${lab.small ? ' map__street-label--small' : ''}`, dy: '0.35em' }, gLabels);
                const tp = svgEl('textPath', { href: `#${lab.pid}`, startOffset: `${lab.pct.toFixed(1)}%`, 'text-anchor': 'middle' }, t);
                tp.textContent = lab.name;
            }
            const gBridges = svgEl('g', { class: 'map__bridges' }, s);
            for (const br of art.bridges) svgEl('polygon', { points: P(br), class: 'map__bridge' }, gBridges);

            // 7. Griglia di riferimento da 500 m
            const gs = LL.Geo.gridSize(city);
            const gGrid = svgEl('g', { class: 'map__grid' }, s);
            let gd = '';
            for (let x = gs; x < this.W; x += gs) gd += `M${x.toFixed(1)},0V${this.H}`;
            for (let y = gs; y < this.H; y += gs) gd += `M0,${y.toFixed(1)}H${this.W}`;
            svgEl('path', { d: gd, class: 'map__grid-line' }, gGrid);
            this.gGridLabels = svgEl('g', { class: 'map__grid-labels' }, s);

            // 8. Confini di zona e nomi
            const gBorders = svgEl('g', { class: 'map__borders' }, s);
            for (const z of Object.values(city.zones)) svgEl('polygon', { points: pts(z.polygon), class: 'map__border' }, gBorders);
            const gZoneLabels = svgEl('g', { class: 'map__zone-labels' }, s);
            for (const z of Object.values(city.zones)) {
                const t = svgEl('text', { x: z.label_at[0], y: z.label_at[1], class: 'map__zone-label', 'text-anchor': 'middle' }, gZoneLabels);
                t.textContent = z.name;
            }
            if (city.map.river_name && city.map.river) {
                const rp = svgEl('path', { id: `${this.id}-river`, d: 'M' + city.map.river.map((q) => q.join(',')).join(' L'), fill: 'none', stroke: 'none' }, s);
                const t = svgEl('text', { class: 'map__water-label', dy: '-0.9em' }, s);
                const tp = svgEl('textPath', { href: `#${rp.id}`, startOffset: '21%', 'text-anchor': 'middle' }, t);
                tp.textContent = city.map.river_name;
            }

            // 9. Punti di riferimento
            this._pins = new Set();
            const gLm = svgEl('g', { class: 'map__landmarks' }, s);
            for (const z of Object.values(city.zones)) {
                for (const l of z.landmarks) {
                    const g = this._pin(gLm, l.at[0], l.at[1], 1, 'map__landmark');
                    if (/chies|duomo|croce/i.test(l.name)) {
                        svgEl('path', { d: 'M-1,-4H1V-1H4V1H1V4H-1V1H-4V-1H-1Z', class: 'map__landmark-dot' }, g);
                    } else {
                        svgEl('rect', { x: -2.8, y: -2.8, width: 5.6, height: 5.6, class: 'map__landmark-dot' }, g);
                    }
                    const t = svgEl('text', { x: 7, y: 4, class: 'map__landmark-label' }, g);
                    t.textContent = l.name;
                }
            }

            svgEl('rect', { x: 0, y: 0, width: this.W, height: this.H, fill: `url(#${this.id}-vignette)`, class: 'map__vignette' }, s);
            this.gIncidents = svgEl('g', { class: 'map__incidents' }, s);
            this.gCall = svgEl('g', { class: 'map__call' }, s);
            this.gMarker = svgEl('g', { class: 'map__marker' }, s);

            // Scala metrica e nord (sovrapposti in HTML, a dimensione fissa)
            const scale = document.createElement('div');
            scale.className = 'map__scale';
            scale.innerHTML = '<span class="map__scale-bar"></span><span class="map__scale-label"></span>';
            const north = document.createElement('div');
            north.className = 'map__north';
            north.setAttribute('aria-hidden', 'true');
            north.textContent = 'N';
            this.container.append(scale, north);
            this.scaleBar = scale.querySelector('.map__scale-bar');
            this.scaleLabel = scale.querySelector('.map__scale-label');
        }

        /**
         * Posizionamento delle etichette delle vie.
         * Ogni via propone posizioni lungo il tracciato (preferendo i tratti lontani dagli incroci);
         * poi le etichette vengono accettate in ordine di importanza, scartando quelle che
         * si sovrapporrebbero a un'altra già piazzata. Le scartate compaiono solo allo zoom massimo.
         */
        _placeLabels(jobs) {
            const G = LL.Geo;
            const kAtZoom2 = (this.W / 2.2) / 600;
            const segsOf = (name) => {
                const out = [];
                for (const o of G.streets(this.city)) {
                    if (o.name === name) continue;
                    for (let i = 1; i < o.path.length; i++) out.push([o.path[i - 1], o.path[i]]);
                }
                return out;
            };
            const cands = [];
            for (const job of jobs) {
                const { st } = job;
                let len = 0;
                for (let j = 1; j < st.path.length; j++) len += G.dist(st.path[j - 1], st.path[j]);
                const textLen = st.name.length * 11 * 0.56 * kAtZoom2;
                const half = textLen / 2 + 1.5;
                const tooShort = textLen > len * 0.92;
                const others = segsOf(st.name);
                const spots = [];
                for (let pct = 8; pct <= 92; pct += 3) {
                    const t = pct / 100;
                    if (!tooShort && (t * len < half || (1 - t) * len < half)) continue;
                    const c = G.pointAt(st.path, t);
                    let clear = Infinity;
                    for (const [a, b] of others) clear = Math.min(clear, G.nearestOnSegment(c, a, b).d);
                    spots.push({ pct, t, c, clear });
                }
                spots.sort((a, b) => b.clear - a.clear);
                cands.push({ name: st.name, pid: job.pid, cls: job.cls, half, len, small: tooShort, spots,
                    want: Math.max(1, Math.floor(len / 240)) });
            }
            // Vie in ordine di priorità: viali prima; per ciascuna si prova ogni posizione finché non è libera
            const rank = { main: 0, normal: 1, trail: 2 };
            cands.sort((a, b) => (rank[a.cls] - rank[b.cls]) || (b.len - a.len));
            const placed = this._reservedLabels ? this._reservedLabels.slice() : [];
            const out = [];
            for (const c of cands) {
                const mine = [];
                for (const sp of c.spots) {
                    if (mine.length >= c.want) break;
                    if (mine.some((x) => Math.abs(x.t - sp.t) * c.len < c.half * 2 + 30)) continue;
                    const hit = !c.small && placed.some((p) => p.name !== c.name && G.dist(p.c, sp.c) < Math.max(p.half, c.half) + 5);
                    if (hit) continue;
                    mine.push(sp);
                    if (!c.small) placed.push({ name: c.name, c: sp.c, half: c.half });
                    out.push({ name: c.name, pid: c.pid, cls: c.cls, pct: sp.pct, small: c.small });
                }
                if (!mine.length && c.spots.length) {
                    // nessuna posizione libera allo zoom medio: compare allo zoom massimo
                    out.push({ name: c.name, pid: c.pid, cls: c.cls, pct: c.spots[0].pct, small: true });
                }
            }
            return out;
        }


        /** Etichette della griglia sul bordo visibile, scala metrica. */
        _updateOverlays(k) {
            const gs = LL.Geo.gridSize(this.city);
            const v = this.view;
            const g = this.gGridLabels;
            if (g) {
                g.replaceChildren();
                const pad = 6 * k;
                for (let c = 0; c * gs < this.W; c++) {
                    const x = c * gs + gs / 2;
                    if (x < v.x || x > v.x + v.w) continue;
                    const t = svgEl('text', { x, y: v.y + pad + 8 * k, class: 'map__grid-label', 'text-anchor': 'middle' }, g);
                    t.textContent = String.fromCharCode(65 + c);
                }
                for (let r = 0; r * gs < this.H; r++) {
                    const y = r * gs + gs / 2;
                    if (y < v.y || y > v.y + v.h) continue;
                    const t = svgEl('text', { x: v.x + pad, y: y + 4 * k, class: 'map__grid-label' }, g);
                    t.textContent = String(r + 1);
                }
            }
            if (this.scaleBar) {
                const mPerPx = k * (this.city.map.meters_per_unit || 1);
                const nice = [20, 50, 100, 200, 250, 500, 1000, 2000];
                const m = nice.find((x) => x / mPerPx >= 60) || 2000;
                this.scaleBar.style.width = `${Math.round(m / mPerPx)}px`;
                this.scaleLabel.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
            }
        }

        /* ---------- Interazione ---------- */

        _bind() {
            const s = this.svg;
            let drag = null;

            s.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                drag = { x: e.clientX, y: e.clientY, view: { ...this.view }, moved: false };
                s.setPointerCapture(e.pointerId);
            });
            s.addEventListener('pointermove', (e) => {
                if (!drag) return;
                const dx = e.clientX - drag.x;
                const dy = e.clientY - drag.y;
                if (!drag.moved && Math.hypot(dx, dy) < 5) return;
                drag.moved = true;
                const k = this.view.w / s.clientWidth;
                this.view.x = drag.view.x - dx * k;
                this.view.y = drag.view.y - dy * k;
                this._applyView();
            });
            s.addEventListener('pointerup', (e) => {
                if (!drag) return;
                const wasDrag = drag.moved;
                drag = null;
                if (!wasDrag && this.onPick) this.onPick(this._toMap(e.clientX, e.clientY));
            });
            s.addEventListener('pointercancel', () => { drag = null; });
            s.addEventListener('wheel', (e) => {
                e.preventDefault();
                this.zoomAt(this._toMap(e.clientX, e.clientY), e.deltaY < 0 ? 1 / 1.25 : 1.25);
            }, { passive: false });

            this._onResize = () => this._applyView();
            window.addEventListener('resize', this._onResize);
            if (window.ResizeObserver) {
                this._ro = new ResizeObserver(() => this._applyView());
                this._ro.observe(this.container);
            }
        }

        destroy() {
            window.removeEventListener('resize', this._onResize);
            if (this._ro) this._ro.disconnect();
        }

        _toMap(cx, cy) {
            const p = this.svg.createSVGPoint();
            p.x = cx;
            p.y = cy;
            const q = p.matrixTransform(this.svg.getScreenCTM().inverse());
            return [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10];
        }

        _applyView() {
            const v = this.view;
            const cw = this.svg.clientWidth || 600;
            const ch = this.svg.clientHeight || 420;
            const aspect = ch / cw;
            // la città intera deve starci tutta: larghezza massima limitata anche dall'altezza
            const maxW = Math.max(this.W, this.H / aspect);
            v.w = Math.max(60, Math.min(maxW, v.w));
            v.h = v.w * aspect;
            const padX = Math.max(0, (v.w - this.W) / 2), padY = Math.max(0, (v.h - this.H) / 2);
            v.x = v.w >= this.W ? -padX : Math.max(0, Math.min(this.W - v.w, v.x));
            v.y = v.h >= this.H ? -padY : Math.max(0, Math.min(this.H - v.h, v.y));
            this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);

            // Testo a dimensione costante sullo schermo
            const px = cw;
            const k = v.w / px;
            this.svg.style.setProperty('--fs', `${(k * 11).toFixed(3)}px`);
            this.svg.style.setProperty('--fs-zone', `${(k * 13).toFixed(3)}px`);
            this.svg.style.setProperty('--k', k.toFixed(4));
            const zoom = this.W / v.w;
            this.svg.dataset.zoom = zoom >= 3.5 ? '3' : zoom >= 1.8 ? '2' : '1';
            this._k = k;
            this._updateOverlays(k);
            for (const pin of this._pins) {
                if (!pin.el.isConnected) { this._pins.delete(pin); continue; }
                pin.el.setAttribute('transform', `translate(${pin.x},${pin.y}) scale(${(k * pin.size).toFixed(4)})`);
            }
        }

        /** Simbolo a dimensione costante sullo schermo, ancorato a un punto della mappa. */
        _pin(parent, x, y, size, cls) {
            const el = svgEl('g', { class: cls }, parent);
            const pin = { el, x, y, size };
            this._pins.add(pin);
            el.setAttribute('transform', `translate(${x},${y}) scale(${((this._k || 1) * size).toFixed(4)})`);
            return el;
        }

        zoomAt(p, factor) {
            const v = this.view;
            const nw = Math.max(60, Math.min(this.W, v.w * factor));
            const k = nw / v.w;
            v.x = p[0] - (p[0] - v.x) * k;
            v.y = p[1] - (p[1] - v.y) * k;
            v.w = nw;
            this._applyView();
        }

        zoomBy(factor) {
            const v = this.view;
            this.zoomAt([v.x + v.w / 2, v.y + v.h / 2], factor);
        }

        reset() {
            this.view = { x: 0, y: 0, w: 1e6, h: 0 };
            this._applyView();
        }

        /** Inquadra un cerchio (centro e raggio in unità mappa). */
        focus(x, y, r = 40) {
            const aspect = (this.svg.clientHeight || 420) / (this.svg.clientWidth || 600);
            const w = Math.max(120, Math.min(this.W, (r * 2 * 2.4) / Math.min(1, aspect / 0.7)));
            this.view = { x: x - w / 2, y: y - (w * aspect) / 2, w, h: 0 };
            this._applyView();
        }

        /* ---------- Contenuti dinamici ---------- */

        /** Chiamata in linea: cerchio AML o indirizzo di intestazione. */
        setCall(c) {
            this.gCall.replaceChildren();
            if (!c) return;
            const aml = c.content.aml;
            const dir = c.content.directory;
            if (aml) {
                svgEl('circle', { cx: aml.x, cy: aml.y, r: aml.r, class: 'map__aml-glow' }, this.gCall);
                svgEl('circle', { cx: aml.x, cy: aml.y, r: aml.r, class: 'map__aml' }, this.gCall);
                const dot = this._pin(this.gCall, aml.x, aml.y, 1, 'map__aml-center');
                svgEl('circle', { r: 3 }, dot);
            } else if (dir) {
                const g = this._pin(this.gCall, dir.x, dir.y, 1.6, 'map__dir');
                svgEl('rect', { x: -4, y: -4, width: 8, height: 8 }, g);
            }
        }

        /** Punto scelto dall'operatore per la chiamata in linea. */
        setMarker(p) {
            this.gMarker.replaceChildren();
            if (!p) return;
            const g = this._pin(this.gMarker, p[0], p[1], 1.4, 'map__marker-pin');
            svgEl('circle', { r: 11, class: 'map__marker-pulse' }, g);
            svgEl('circle', { r: 7, class: 'map__marker-ring' }, g);
            svgEl('circle', { r: 2.2, class: 'map__marker-dot' }, g);
        }

        /** Eventi trasferiti nel turno: [{ id, x, y, title }] */
        setIncidents(list) {
            this.gIncidents.replaceChildren();
            for (const it of list) {
                const main = (it.agencies || [])[0] || '';
                const g = this._pin(this.gIncidents, it.x, it.y, 1.3, `map__incident map__incident--${main.toLowerCase()}`);
                svgEl('circle', { r: 9, class: 'map__incident-ring' }, g);
                svgEl('path', { d: 'M0,-6 L6,0 L0,6 L-6,0 Z' }, g);
                const tt = svgEl('title', {}, g);
                tt.textContent = it.title;
            }
        }
    }

    LL.MapView = MapView;
})(globalThis.LL = globalThis.LL || {});
