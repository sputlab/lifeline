/**
 * LifeLine - Scheda contatto
 *
 * Una bozza per ogni chiamata, conservata anche quando la chiamata va in attesa.
 * Il luogo si indica scrivendo via e civico oppure con un clic sulla mappa.
 * Dati minimi per il trasferimento: luogo, tipologia di evento, almeno un ente.
 * Si può trasferire anche con la scheda incompleta (secondo clic di conferma):
 * il secondo livello dovrà rifare le domande, e la valutazione ne terrà conto.
 * Le tre «pillole» Luogo / Evento / Ente nell'intestazione mostrano cosa manca;
 * Ctrl/Cmd+Invio trasferisce anche mentre si scrive in un campo.
 */
(function (LL) {
    'use strict';

    const S = LL.CallState;
    const t = (k, v) => I18n.t(k, v);
    const $ = (sel, root = document) => root.querySelector(sel);
    const SNAP_UNITS = 12; // entro ~70 m dalla via il punto si aggancia al civico
    /** Chiavi dei dati minimi, nell'ordine delle pillole, con l'etichetta del vecchio testo di stato. */
    const READY_KEYS = ['place', 'event', 'agency'];
    const MISS_LABEL = { place: 'form.miss_location', event: 'form.miss_event', agency: 'form.miss_agency' };
    /** Scorciatoie da tastiera degli enti (gestite da ConsoleUI). */
    const AGENCY_KEYS = { '118': 'Z', '115': 'X', PS: 'C', CC: 'V' };

    function option(value, text) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        return o;
    }

    const ICONS = {
        '118': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
        '115': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 5 5.5 5 10.5A5 5 0 0 1 12 18a5 5 0 0 1-5-5.5c0-2.2 1.3-3.6 2.3-4.6.1 1.6.8 2.8 2 3.3C11.8 8.5 11.4 5.2 12 2zM6 20h12v2H6z"/></svg>',
        PS: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z"/></svg>',
        CC: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z"/></svg>',
    };

    /** Casella a scelta multipla: pulsante-ente (tile) o etichetta (chip). */
    function checkbox(value, label, name, kind = 'chip') {
        const lab = document.createElement('label');
        lab.className = kind === 'tile' ? 'ftile' : 'fchip';
        lab.dataset.value = value;
        const i = document.createElement('input');
        i.type = 'checkbox';
        i.value = value;
        i.name = name;
        lab.append(i);
        if (kind === 'tile') {
            const ic = document.createElement('span');
            ic.className = 'ftile__icon';
            ic.innerHTML = ICONS[value] || '';
            const code = document.createElement('span');
            code.className = 'ftile__code';
            code.textContent = value;
            const nm = document.createElement('span');
            nm.className = 'ftile__name';
            nm.textContent = label;
            lab.append(ic, code, nm);
            if (AGENCY_KEYS[value]) lab.dataset.key = AGENCY_KEYS[value];
        } else {
            const sp = document.createElement('span');
            sp.textContent = label;
            lab.append(sp);
        }
        return lab;
    }

    class ContactForm {
        constructor(root, { engine, city, eventTypes, map, signal, announce }) {
            this.root = root;
            this.signal = signal;
            this.announce = typeof announce === 'function' ? announce : () => {};
            this.readyState = new Map(); // callId -> dati minimi completi (per annunciare i cambi)
            this.engine = engine;
            this.city = city;
            this.eventTypes = eventTypes;
            this.map = map;
            this.drafts = new Map();
            this.call = null;
            this.el = {};
            ['empty', 'body', 'street', 'number', 'loc', 'use-dir', 'cat', 'type', 'persons', 'hazards', 'notes',
             'agencies', 'status', 'transfer', 'merge-target', 'merge', 'close-reason', 'close', 'streets', 'ready']
                .forEach((id) => { this.el[id] = $(`#f-${id}`, root); });
            this._populate();
            this._bind();
            this.show(null);
        }

        /* ---------- Preparazione ---------- */

        _populate() {
            const e = this.el;
            e.streets.replaceChildren(...LL.Geo.streets(this.city).map((s) => option(s.name, this.city.zones[s.zone].name)));

            e.cat.replaceChildren(option('', t('form.choose')));
            for (const cat of Object.keys(this.eventTypes.categories)) e.cat.append(option(cat, t(`events.cat.${cat}`)));

            e.hazards.replaceChildren(...LL.Engine.HAZARDS.map((h) => checkbox(h, t(`hazards.${h}`), 'hazard')));
            e.agencies.replaceChildren(...LL.Engine.AGENCIES.map((a) => checkbox(a, t(`agencies_short.${a}`), 'agency', 'tile')));
            e['close-reason'].replaceChildren(...LL.Engine.CLOSE_REASONS.map((r) => option(r, t(`events.impropria.${r}`))));
            e.transfer.dataset.key = 'G';

            // Pillole di completezza: un clic porta al campo che manca
            this.pills = {};
            if (e.ready) {
                e.ready.replaceChildren();
                for (const k of READY_KEYS) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'fpill';
                    b.dataset.key = k;
                    b.dataset.ok = 'false';
                    b.textContent = t(`console.pill_${k}`);
                    e.ready.append(b);
                    this.pills[k] = b;
                }
            }
        }

        _fillTypes(cat, selected) {
            const sel = this.el.type;
            sel.replaceChildren(option('', t('form.choose')));
            sel.disabled = !cat;
            if (!cat) return;
            for (const ty of this.eventTypes.categories[cat]) sel.append(option(`${cat}.${ty}`, t(`events.${cat}.${ty}`)));
            sel.value = selected || '';
        }

        _bind() {
            const e = this.el;
            const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: this.signal });
            const d = () => this.call && this.draft(this.call);
            const changed = () => { const x = d(); if (x) { x.confirm = false; this._status(); } };

            on(e.street, 'input', () => { const x = d(); if (!x) return; x.street = e.street.value; this._locateFromAddress(); });
            on(e.number, 'input', () => { const x = d(); if (!x) return; x.number = e.number.value ? parseInt(e.number.value, 10) : null; this._locateFromAddress(); });
            on(e['use-dir'], 'click', () => {
                const dir = this.call?.content.directory;
                if (!dir) return;
                const x = d();
                x.street = dir.street;
                x.number = dir.number;
                e.street.value = dir.street;
                e.number.value = String(dir.number);
                this._locateFromAddress();
            });
            on(e.cat, 'change', () => {
                const x = d(); if (!x) return;
                x.category = e.cat.value;
                x.eventType = '';
                this._fillTypes(x.category, '');
                changed();
            });
            on(e.type, 'change', () => { const x = d(); if (x) { x.eventType = e.type.value; changed(); } });
            on(e.persons, 'input', () => { const x = d(); if (x) { x.persons = e.persons.value === '' ? null : parseInt(e.persons.value, 10); } });
            on(e.notes, 'input', () => { const x = d(); if (x) x.notes = e.notes.value; });
            on(e.hazards, 'change', () => { const x = d(); if (x) x.hazards = [...e.hazards.querySelectorAll('input:checked')].map((i) => i.value); });
            on(e.agencies, 'change', () => { const x = d(); if (x) { x.agencies = [...e.agencies.querySelectorAll('input:checked')].map((i) => i.value); changed(); } });

            on(e.transfer, 'click', () => this.transfer());
            if (e.ready) on(e.ready, 'click', (ev) => { const b = ev.target.closest('.fpill'); if (b) this.focusMissing(b.dataset.key); });
            // Ctrl/Cmd+Invio: trasferisce anche dall'interno di un campo
            on(this.root, 'keydown', (ev) => {
                if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && !ev.altKey) { ev.preventDefault(); this.transfer(); }
            });
            // Il riquadro "duplicato o non pertinente" si chiude con un clic fuori o con Esc
            this.more = this.root.querySelector('.fmore');
            on(document, 'pointerdown', (ev) => { if (this.more.open && !this.more.contains(ev.target)) this.more.open = false; });
            on(document, 'keydown', (ev) => { if (ev.key === 'Escape' && this.more.open) { this.more.open = false; ev.preventDefault(); ev.stopImmediatePropagation(); } });
            on(e.merge, 'click', () => this._merge());
            on(e.close, 'click', () => this._close());
        }

        /* ---------- Bozza ---------- */

        draft(c) {
            if (!this.drafts.has(c.id)) {
                this.drafts.set(c.id, {
                    street: '', number: null, point: null, zone: null, free: false,
                    category: '', eventType: '', persons: null, hazards: [], notes: '', agencies: [], confirm: false,
                });
            }
            return this.drafts.get(c.id);
        }

        discard(callId) { this.drafts.delete(callId); this.readyState.delete(callId); }

        show(c) {
            this.call = c;
            const e = this.el;
            if (this.more) this.more.open = false;
            e.empty.hidden = !!c;
            e.body.hidden = !c;
            if (e.ready) e.ready.hidden = !c;
            if (!c) { this.map.setMarker(null); return; }

            const x = this.draft(c);
            e.street.value = x.street;
            e.number.value = x.number ?? '';
            e.cat.value = x.category;
            this._fillTypes(x.category, x.eventType);
            e.persons.value = x.persons ?? '';
            e.notes.value = x.notes;
            e.hazards.querySelectorAll('input').forEach((i) => { i.checked = x.hazards.includes(i.value); });
            e.agencies.querySelectorAll('input').forEach((i) => { i.checked = x.agencies.includes(i.value); });
            e['use-dir'].hidden = !c.content.directory;
            this.refreshMergeTargets();
            this.map.setMarker(x.point);
            this._locText();
            this.readyState.set(c.id, this.missing(x).length === 0);
            this._status();
        }

        /* ---------- Luogo ---------- */

        _locateFromAddress() {
            const x = this.draft(this.call);
            const st = LL.Geo.findStreet(this.city, x.street);
            x.free = false;
            if (st) {
                const n = x.number && x.number > 0 ? Math.min(x.number, st.max) : Math.ceil(st.max / 2);
                x.point = LL.Geo.addressPoint(st, n).map((v) => Math.round(v * 10) / 10);
                x.zone = st.zone;
            } else {
                x.point = null;
                x.zone = null;
            }
            x.confirm = false;
            this.map.setMarker(x.point);
            this._locText();
            this._status();
        }

        /** Clic sulla mappa. */
        pick(p) {
            if (!this.call) return;
            const x = this.draft(this.call);
            const near = LL.Geo.nearestAddress(this.city, p);
            if (near && near.d <= SNAP_UNITS) {
                x.street = near.street.name;
                x.number = near.number;
                x.point = near.point.map((v) => Math.round(v * 10) / 10);
                x.free = false;
            } else {
                x.street = near ? near.street.name : '';
                x.number = null;
                x.point = p;
                x.free = true;
            }
            x.zone = LL.Geo.zoneAt(this.city, x.point);
            x.confirm = false;
            this.el.street.value = x.street;
            this.el.number.value = x.number ?? '';
            this.map.setMarker(x.point);
            this._locText();
            this._status();
        }

        _locText() {
            const x = this.draft(this.call);
            const box = this.el.loc;
            box.replaceChildren();
            const span = (cls, text) => { const n = document.createElement('span'); n.className = cls; n.textContent = text; return n; };
            if (!x.point) {
                box.append(span('floc__none', x.street && !LL.Geo.findStreet(this.city, x.street) ? t('form.loc_unknown_street') : t('form.loc_none')));
                box.dataset.state = 'none';
                return;
            }
            const zone = x.zone ? this.city.zones[x.zone] : null;
            if (x.free) {
                const near = LL.Geo.nearestAddress(this.city, x.point);
                const m = Math.round(LL.Geo.meters(this.city, x.point, near.point) / 10) * 10;
                box.append(span('floc__addr', t('form.loc_free', { street: near.street.name, m })));
            } else {
                box.append(span('floc__addr', `${x.street}${x.number ? ' ' + x.number : ', ' + t('form.no_number')}`));
            }
            if (zone) box.append(span('floc__zone', zone.name));
            if (zone) {
                const chip = span(`floc__chip floc__chip--${zone.police.toLowerCase()}`, t(`agencies_short.${zone.police}`));
                chip.title = t('form.competence', { police: t(`agencies.${zone.police}`) });
                box.append(chip);
            }
            box.append(span('floc__chip floc__chip--grid', LL.Geo.gridRef(this.city, x.point)));
            box.dataset.state = 'ok';
        }

        /* ---------- Completezza e invio ---------- */

        /** Dati minimi mancanti, come chiavi: 'place', 'event', 'agency'. */
        missing(x) {
            const m = [];
            if (!x.point) m.push('place');
            if (!x.eventType) m.push('event');
            if (!x.agencies.length) m.push('agency');
            return m;
        }

        /** Etichette leggibili delle chiavi restituite da missing(). */
        missingLabels(keys) { return keys.map((k) => t(MISS_LABEL[k])); }

        /** Porta il fuoco sul campo di un dato minimo. */
        focusMissing(key) {
            const e = this.el;
            if (!this.call) return;
            if (key === 'place') e.street.focus();
            else if (key === 'event') (e.cat.value && !e.type.disabled ? e.type : e.cat).focus();
            else if (key === 'agency') e.agencies.querySelector('input')?.focus();
        }

        _status() {
            if (!this.call) return;
            const x = this.draft(this.call);
            const keys = this.missing(x);
            const m = this.missingLabels(keys);
            const st = this.el.status;
            const tr = this.el.transfer;
            if (x.confirm) {
                st.textContent = t('form.confirm_incomplete', { list: m.join(', ') });
                st.dataset.state = 'warn';
                tr.textContent = t('form.transfer_anyway');
            } else {
                st.textContent = m.length ? t('form.missing', { list: m.join(', ') }) : t('form.ready');
                st.dataset.state = m.length ? 'missing' : 'ok';
                tr.textContent = t('form.transfer');
            }
            tr.classList.toggle('btn--warn', !!x.confirm);
            tr.title = st.textContent;
            for (const k of READY_KEYS) {
                const p = this.pills[k];
                if (!p) continue;
                const ok = !keys.includes(k);
                p.dataset.ok = String(ok);
                p.setAttribute('aria-label', t(ok ? 'console.pill_ok' : 'console.pill_missing', { what: t(`console.pill_${k}`) }));
            }
            // Annuncio per i lettori di schermo solo quando la completezza cambia
            const ready = keys.length === 0;
            const prev = this.readyState.get(this.call.id);
            if (prev !== undefined && prev !== ready) this.announce(ready ? t('form.ready') : t('form.missing', { list: m.join(', ') }));
            this.readyState.set(this.call.id, ready);
        }

        payload(x) {
            const f = {};
            if (x.point) {
                f.location = { x: x.point[0], y: x.point[1], street: x.street, number: x.free ? null : x.number, zone: x.zone || '' };
            }
            if (x.eventType) f.eventType = x.eventType;
            if (Number.isInteger(x.persons)) f.persons = x.persons;
            if (x.hazards.length) f.hazards = x.hazards.slice();
            if (x.notes.trim()) f.notes = x.notes.trim();
            return f;
        }

        transfer() {
            const c = this.call;
            if (!c || c.state !== S.ACTIVE) return;
            const x = this.draft(c);
            if (!x.agencies.length) {
                this.el.status.textContent = t('form.need_agency');
                this.el.status.dataset.state = 'warn';
                this.el.agencies.querySelector('input')?.focus();
                return;
            }
            if (this.missing(x).length && !x.confirm) {
                x.confirm = true;
                this._status();
                return;
            }
            this.engine.dispatch('transfer', { callId: c.id, agencies: x.agencies.slice(), form: this.payload(x) });
        }

        /** Nome storico, per compatibilità. */
        _transfer() { this.transfer(); }

        /** Attiva o disattiva un ente come se fosse cliccato (scorciatoie Z/X/C/V). */
        toggleAgency(code) {
            if (!this.call || this.call.state !== S.ACTIVE) return false;
            const i = this.el.agencies.querySelector(`input[value="${code}"]`);
            if (!i) return false;
            i.checked = !i.checked;
            i.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        /** Apre il riquadro "duplicato" con l'evento indicato già scelto come destinazione. */
        preselectMerge(id) {
            if (!this.call || !this.more) return;
            this.refreshMergeTargets();
            const sel = this.el['merge-target'];
            const key = String(id);
            if (![...sel.options].some((o) => o.value === key)) {
                // evento più vecchio dei 12 in elenco: lo si aggiunge per questa volta
                const k = [...this.engine.calls.values()].find((x) => x.id === id);
                if (!k || k.state !== S.TRANSFERRED || k.id === this.call.id) return;
                sel.append(this._mergeOption(k));
                sel.disabled = false;
                this.el.merge.disabled = false;
            }
            sel.value = key;
            this.more.open = true;
            sel.focus({ preventScroll: true });
        }

        _merge() {
            const c = this.call;
            const id = parseInt(this.el['merge-target'].value, 10);
            if (!c || !id) return;
            this.engine.dispatch('merge', { callId: c.id, targetId: id, form: this.payload(this.draft(c)) });
            this.more.open = false;
        }

        _close() {
            const c = this.call;
            if (!c) return;
            this.engine.dispatch('close', { callId: c.id, reason: this.el['close-reason'].value });
            this.more.open = false;
        }

        /** Eventi già trasferiti, per accorpare i duplicati. */
        refreshMergeTargets() {
            const sel = this.el['merge-target'];
            const list = [...this.engine.calls.values()]
                .filter((k) => k.state === S.TRANSFERRED && (!this.call || k.id !== this.call.id))
                .sort((a, b) => b.closedMs - a.closedMs)
                .slice(0, 12);
            sel.replaceChildren(option('', list.length ? t('form.choose') : t('form.no_incidents')));
            for (const k of list) sel.append(this._mergeOption(k));
            sel.disabled = list.length === 0;
            this.el.merge.disabled = list.length === 0;
        }

        _mergeOption(k) {
            const f = k.result.form || {};
            const when = LL.Time.clock(this.engine.gameStartSec + k.closedMs / 1000).slice(0, 5);
            const what = f.eventType ? t(`events.${f.eventType}`) : t('form.no_event');
            const where = f.location?.street || t('form.no_place');
            return option(String(k.id), `${when}, ${what}, ${where}`);
        }
    }

    LL.ContactForm = ContactForm;
})(globalThis.LL = globalThis.LL || {});
