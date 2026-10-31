/**
 * LifeLine - Console dell'operatore
 *
 * Tre colonne a tutta altezza:
 *   sinistra  linee telefoniche e registro
 *   centro    in alto l'INTERLOCUTORE (identità, voce, agitazione, conversazione),
 *             in basso l'OPERATORE (domande con scorciatoie, informazioni raccolte)
 *   destra    mappa e scheda contatto
 * ConsoleUI legge lo stato del motore e non lo modifica mai direttamente: usa engine.dispatch().
 *
 * Moduli facoltativi (la console funziona anche senza, ogni uso è protetto):
 *   LL.CallAudio  voce del chiamante; pubblica ui.voiceState = {callId, entryIdx, startMs, endMs|null, est}
 *   LL.Settings   finestra delle impostazioni (pulsante ingranaggio)
 *   LL.Prefs      preferenze: sottotitoli 'typewriter'|'instant'
 *   engine.callsByPhone / engine.incidentAgeMs / evento call:deteriorated (meccaniche 1.2)
 */
(function (LL) {
    'use strict';

    const S = LL.CallState;
    const t = (k, v) => I18n.t(k, v);
    const $ = (sel, root = document) => root.querySelector(sel);
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    };
    /** Scrive il testo solo se cambia: render() gira a ogni frame. */
    const setText = (n, text) => { if (n && n.textContent !== text) n.textContent = text; };

    const QUESTION_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o'];
    const AGENCY_KEYS = { z: '118', x: '115', c: 'PS', v: 'CC' };
    const VOICE_BARS = 14;
    const NEAR_BOTTOM_PX = 40;     // entro questa distanza dal fondo la conversazione scorre da sola
    const TW_MAX_MS = 20000;       // il testo che compare parola per parola non dura mai più di così
    const QOPT_NEW_MS = 2400;      // evidenziazione di una domanda appena sbloccata

    /** Preferenza utente da LL.Prefs, se presente (get(chiave) oppure get() con l'oggetto intero). */
    function pref(key, dflt) {
        const P = LL.Prefs;
        if (!P || typeof P.get !== 'function') return dflt;
        try {
            let v = P.get(key);
            if (v && typeof v === 'object' && key in v) v = v[key];
            return v === undefined || v === null ? dflt : v;
        } catch (_) { return dflt; }
    }

    function reducedMotion() {
        if (document.body && document.body.dataset.motion === 'reduced') return true;
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
    }

    /** Durata prevista di una battuta in ms: `est` può arrivare in secondi o in millisecondi. */
    function estMs(vs) {
        const e = Number(vs && vs.est) || 0;
        return e > 0 && e < 120 ? e * 1000 : e;
    }

    /** Il chiamante sta parlando adesso, secondo lo stato pubblicato dalla voce? */
    function voiceActive(vs, callId, now) {
        if (!vs || vs.callId !== callId || typeof vs.startMs !== 'number') return false;
        if (now < vs.startMs) return false;
        if (typeof vs.endMs === 'number') return now < vs.endMs;
        // fine non ancora nota: la stima, con margine per le voci più lente del previsto
        return now < vs.startMs + estMs(vs) * 1.5 + 1000;
    }

    /** Tiene il fuoco dentro una sovrapposizione: Tab e Maiusc+Tab girano al suo interno. */
    function trapFocus(e, box) {
        const items = [...box.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
            .filter((n) => !n.disabled && !n.closest('[hidden]') && n.getClientRects().length > 0);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const cur = document.activeElement;
        if (!box.contains(cur)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }

    const settingsAvailable = () => !!(LL.Settings && typeof LL.Settings.open === 'function');
    const settingsOpen = () => !!document.querySelector('#settings-dialog[open]');

    const ICON = {
        person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2"/><path d="M3.5 21c.8-4.6 4.2-7 8.5-7s7.7 2.4 8.5 7z"/></svg>',
        child: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="3.6"/><path d="M6 21c.6-3.6 2.9-5.6 6-5.6s5.4 2 6 5.6z"/></svg>',
        headset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a8 8 0 0 0-8 8v5a3 3 0 0 0 3 3h1v-7H6v-1a6 6 0 0 1 12 0v1h-2v7h1.2A2.8 2.8 0 0 1 14.5 21H12v1.5h2.5A4.3 4.3 0 0 0 18.8 19 3 3 0 0 0 20 16.6V11a8 8 0 0 0-8-8z"/></svg>',
        mobile: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><circle cx="12" cy="18.5" r="1" fill="#0b1119"/></svg>',
        landline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8c4-4 12-4 16 0l-2 3-3-1V8H9v2l-3 1zM6 13h12l2 8H4z"/></svg>',
    };

    /* ---------------- Notifiche a comparsa ---------------- */

    const Toast = {
        show(text, kind = '') {
            const box = $('#c-toasts');
            if (!box) return;
            const n = el('div', `toast${kind ? ' toast--' + kind : ''}`, text);
            box.prepend(n);
            while (box.children.length > 3) box.lastElementChild.remove();
            setTimeout(() => n.classList.add('toast--out'), 3200);
            setTimeout(() => n.remove(), 3700);
        },
        clear() { const box = $('#c-toasts'); if (box) box.replaceChildren(); },
    };

    class ConsoleUI {
        constructor(root, engine, { onPause, onAbandon, onSettings, city, eventTypes }) {
            this.root = root;
            this.engine = engine;
            this.onPause = onPause;
            this.onAbandon = onAbandon;
            this.onSettings = onSettings;
            this.city = city;
            this.ac = new AbortController();
            this.lineEls = [];
            this.activeShownId = undefined;
            this.focusedCalls = new Set();
            this.seenFacts = new Map();
            this.unsubs = [];
            this.runnerScale = 1;
            this.voiceState = null;   // scritto da LL.CallAudio (o dal ripiego più sotto)
            this.tx = null;           // conversazione mostrata: { callId, count, stick }
            this.tw = null;           // battuta che sta comparendo parola per parola
            this.qFocusId = null;     // ultima domanda che aveva il fuoco, da ripristinare
            this.qFocusIdx = 0;
            this._liveQueue = [];
            this._liveTimer = null;

            this._buildLines();
            this.map = new LL.MapView($('#c-map', root), city, { onPick: (p) => this.form.pick(p) });
            this.form = new LL.ContactForm($('#c-form', root), {
                engine, city, eventTypes, map: this.map, signal: this.ac.signal, announce: (m) => this.announce(m),
            });
            this._bindEngine();
            this._bindControls();
            // La voce si aggancia da sola agli eventi del motore (contratto C4)
            this.audio = null;
            if (LL.CallAudio && typeof LL.CallAudio.attach === 'function') {
                try { this.audio = LL.CallAudio.attach(engine, this) || null; } catch (err) { console.error(err); }
            }
            $('#c-log', root).replaceChildren();
            const live = $('#c-live', root);
            if (live) live.textContent = '';
            Toast.clear();
            this.render();
        }

        /** Chiama un metodo della voce (frame, pause, resume, stop, skip, detach), se c'è. */
        _audio(fn) {
            const a = this.audio;
            if (a && typeof a[fn] === 'function') { try { a[fn](this); } catch (err) { console.error(err); } }
        }

        /** Messaggio per i lettori di schermo (#c-live). Più messaggi nello stesso istante si uniscono. */
        announce(text) {
            if (!text) return;
            this._liveQueue.push(text);
            if (this._liveTimer) return;
            this._liveTimer = setTimeout(() => {
                this._liveTimer = null;
                const box = $('#c-live', this.root);
                const msg = this._liveQueue.join(' ');
                this._liveQueue = [];
                if (!box) return;
                box.textContent = '';
                // un frame dopo, così anche un testo uguale al precedente viene riletto
                requestAnimationFrame(() => { box.textContent = msg; });
            }, 60);
        }

        /* ---------------- Linee ---------------- */

        _buildLines() {
            const list = $('#c-lines', this.root);
            list.replaceChildren();
            this.lineEls = [];
            this.engine.board.lines.forEach((_, i) => {
                const li = el('li', 'line');
                li.dataset.state = 'free';
                const top = el('div', 'line__top');
                const key = el('kbd', 'line__key', String(i + 1));
                key.setAttribute('aria-hidden', 'true');
                top.append(el('span', 'line__lamp'), el('span', 'line__name', t('console.line', { n: i + 1 })), key, el('span', 'line__state'));
                const num = el('p', 'line__num');
                const meta = el('p', 'line__meta');
                meta.append(el('span', 'line__type'), el('span', 'line__timer'));
                const tag = el('p', 'line__tag');
                const bar = el('div', 'line__patience');
                bar.append(el('span'));
                const btn = el('button', 'btn btn--line');
                btn.type = 'button';
                btn.addEventListener('click', () => this._lineAction(i));
                li.append(top, num, meta, tag, bar, btn);
                list.append(li);
                this.lineEls.push(li);
            });
        }

        _flashLine(line) {
            const li = this.lineEls[line];
            if (!li) return;
            li.classList.remove('line--flash');
            void li.offsetWidth;
            li.classList.add('line--flash');
        }

        /* ---------------- Eventi del motore ---------------- */

        _bindEngine() {
            const ev = this.engine.events;
            const lineName = (line) => (line !== null && line !== undefined ? t('console.line', { n: line + 1 }) : t('console.switchboard'));

            this.unsubs.push(ev.on('call:new', ({ call, line }) => {
                if (line === null) {
                    LL.Sound.play('queue');
                    Toast.show(t('console.toast_queue'), 'warn');
                    this._log(t('log.queued'), 'warn');
                    return;
                }
                this._flashLine(line);
                if (call.parentId !== null) {
                    this._log(t('log.callback', { line: lineName(line) }), 'warn');
                    Toast.show(t('console.toast_callback', { n: line + 1 }), 'warn');
                } else {
                    this._log(t('log.incoming', { line: lineName(line) }));
                    if (this.engine.activeCall()) Toast.show(t('console.toast_incoming', { n: line + 1 }), 'info');
                }
            }));
            this.unsubs.push(ev.on('call:ringing', ({ line }) => {
                this._flashLine(line);
                this._log(t('log.from_queue', { line: lineName(line) }));
            }));
            this.unsubs.push(ev.on('call:state', ({ call, from, to, line }) => {
                if (to === S.ACTIVE) {
                    LL.Sound.play('answer');
                    if (from === S.RINGING) {
                        this._log(t('log.answered', { line: lineName(line), wait: Math.round(call.waitMs / 1000) }));
                        this._announceEntry(call.dialog.transcript[0]);
                        if (!this.audio) this._fallbackVoice(call, 0);
                    } else {
                        this._log(t('log.resumed', { line: lineName(line) }));
                    }
                }
                if (to === S.ON_HOLD) {
                    LL.Sound.play('hold');
                    this._log(t('log.hold', { line: lineName(line) }));
                    if (!this.audio) this._fallbackStop(call.id);
                }
            }));
            this.unsubs.push(ev.on('dialog:ask', ({ call, costSec }) => {
                // con LL.CallAudio la voce (anche quella facoltativa dell'operatore) la gestisce lei
                if (!this.audio && call.id === this.engine.activeId) LL.Sound.speak({ seconds: Math.min(1.8, 0.8 + costSec * 0.12), voice: 'operator' });
            }));
            this.unsubs.push(ev.on('dialog:reply', (p) => {
                const call = p.call;
                if (call.id !== this.engine.activeId) return;
                const tr = call.dialog.transcript;
                this._announceEntry(p.entry || tr[tr.length - 1]);
                if (!this.audio) this._fallbackVoice(call, tr.length - 1);
            }));
            // Meccaniche 1.2 (contratto C3): l'evento peggiora mentre si aspetta
            this.unsubs.push(ev.on('call:deteriorated', ({ call, line }) => {
                if (!call) return;
                const ln = line ?? call.line;
                const msg = t('console.toast_deteriorated', { n: (ln ?? 0) + 1 });
                if (ln !== null && ln !== undefined) this._flashLine(ln);
                this._log(t('console.log_deteriorated', { line: lineName(ln) }), 'alert');
                Toast.show(msg, 'alert');
            }));
            this.unsubs.push(ev.on('call:final', ({ call, line, result }) => {
                const L = lineName(line);
                this.form.discard(call.id);
                if (!this.audio) this._fallbackStop(call.id);
                switch (call.state) {
                    case S.TRANSFERRED: {
                        const names = result.agencies.map((a) => t(`agencies_short.${a}`)).join(' + ');
                        this._log(t('log.transferred', { line: L, agencies: result.agencies.join(' + ') }), 'ok');
                        Toast.show(t('console.toast_transfer', { agencies: names }), 'ok');
                        LL.Sound.play('transfer');
                        LL.Sound.dispatch(result.agencies);
                        this._refreshIncidents();
                        this.form.refreshMergeTargets();
                        break;
                    }
                    case S.CLOSED: this._log(t('log.closed', { line: L })); Toast.show(t('console.toast_closed')); break;
                    case S.MERGED: this._log(t('log.merged', { line: L }), 'ok'); Toast.show(t('console.toast_merged'), 'ok'); LL.Sound.play('transfer'); break;
                    case S.DROPPED:
                        this._log(t('log.dropped', { line: L }), 'alert');
                        Toast.show(t('console.toast_dropped', { n: (line ?? 0) + 1 }), 'alert');
                        LL.Sound.play('hangup');
                        break;
                    case S.ABANDONED:
                        this._log(t(`log.abandoned_${result.where}`, { line: L }), 'alert');
                        Toast.show(t('console.toast_abandoned', { n: (line ?? 0) + 1 }), 'alert');
                        LL.Sound.play('hangup');
                        break;
                }
            }));
            this.unsubs.push(ev.on('shift:closing', () => this._log(t('log.closing'), 'warn')));
        }

        /** Legge al lettore di schermo una battuta completa del chiamante. */
        _announceEntry(entry) {
            if (!entry || entry.who === 'op' || !entry.text) return;
            const who = entry.speaker && entry.speaker.name;
            this.announce(who ? `${who}: ${entry.text}` : entry.text);
        }

        /*
         * Ripiego senza LL.CallAudio: il «parlato» sintetico di sound.js come nella 1.1, ma con lo
         * stesso voiceState che pubblicherebbe la voce vera, così barre e testo restano allineati.
         */
        _fallbackVoice(call, entryIdx) {
            const entry = call.dialog.transcript[entryIdx];
            if (!entry || entry.who === 'op') return;
            const text = entry.text || '';
            const secs = Math.max(1, Math.min(3.8, text.length / (15 + call.panic / 12)));
            let r = null;
            try { r = LL.Sound.speak({ seconds: secs, panic: call.panic, voice: call.content.caller.voice || 'male', text }); } catch (_) { r = null; }
            const now = performance.now();
            const startMs = r && typeof r.startMs === 'number' ? r.startMs : now;
            const endMs = r && typeof r.endMs === 'number' ? r.endMs : startMs + secs * 1000;
            this.voiceState = { callId: call.id, entryIdx, startMs, endMs, est: endMs - startMs };
        }

        _fallbackStop(callId) {
            if (!this.voiceState || (callId !== undefined && this.voiceState.callId !== callId)) return;
            if (typeof LL.Sound.stopVoice === 'function') { try { LL.Sound.stopVoice(); } catch (_) { /* ignora */ } }
            this.voiceState = null;
        }

        /** S: salta la battuta in corso (voce e testo). */
        skipVoice() {
            if (this.audio) this._audio('skip');
            else this._fallbackStop();
            this._twComplete();
        }

        /** Chiamate già chiuse dallo stesso numero (contratto C3), dalla più recente. */
        _phoneHistory(c) {
            const e = this.engine;
            if (!c || typeof e.callsByPhone !== 'function') return [];
            let list;
            try { list = e.callsByPhone(c.content.caller.phone) || []; } catch (_) { return []; }
            return list.filter((h) => h && h.id !== c.id && typeof h.closedMs === 'number')
                .sort((a, b) => b.closedMs - a.closedMs);
        }

        _histWhen(h) { return LL.Time.clock(this.engine.gameStartSec + h.closedMs / 1000).slice(0, 5); }

        _histState(h) {
            const key = `console.hist_${h.state}`;
            const v = t(key);
            return v === key ? String(h.state || '') : v;
        }

        /* ---------------- Comandi ---------------- */

        _bindControls() {
            const sig = { signal: this.ac.signal };
            $('#c-pause', this.root).addEventListener('click', () => this.onPause(), sig);
            $('#c-abandon', this.root).addEventListener('click', () => this.onAbandon(), sig);
            $('#m-zoom-in', this.root).addEventListener('click', () => this.map.zoomBy(1 / 1.5), sig);
            $('#m-zoom-out', this.root).addEventListener('click', () => this.map.zoomBy(1.5), sig);
            $('#m-reset', this.root).addEventListener('click', () => this.map.reset(), sig);
            $('#m-focus', this.root).addEventListener('click', () => this._focusCall(this.engine.activeCall()), sig);

            // Ingranaggio: impostazioni (LL.Settings) o, se manca, il vecchio interruttore dei suoni
            const bSet = $('#c-settings', this.root);
            if (bSet) {
                if (settingsAvailable()) {
                    bSet.title = t('console.settings');
                    bSet.removeAttribute('aria-pressed');
                    bSet.classList.remove('is-muted');
                    // in cattura: passa prima di un eventuale ascoltatore di LL.Settings, che aprirebbe senza pausa
                    bSet.addEventListener('click', (e) => {
                        if (settingsOpen()) return;
                        e.stopImmediatePropagation();
                        if (this.onSettings) this.onSettings(); else LL.Settings.open({});
                    }, { signal: this.ac.signal, capture: true });
                } else {
                    const syncSound = () => {
                        const label = t(LL.Sound.on ? 'console.sound_on' : 'console.sound_off');
                        bSet.title = label;
                        bSet.setAttribute('aria-label', label);
                        bSet.setAttribute('aria-pressed', String(LL.Sound.on));
                        bSet.classList.toggle('is-muted', !LL.Sound.on);
                    };
                    bSet.addEventListener('click', () => { LL.Sound.unlock(); LL.Sound.setOn(!LL.Sound.on); syncSound(); }, sig);
                    syncSound();
                }
            }

            // Conversazione: un clic sulla battuta la mostra tutta; la pillola "Nuovi messaggi" scende in fondo
            $('#c-caller', this.root).addEventListener('click', (e) => {
                if (e.target.closest('.bubble--speaking')) this._twComplete();
                if (e.target.closest('.dlg__newmsg')) {
                    const list = $('.dlg__transcript', this.root);
                    if (list) list.scrollTop = list.scrollHeight;
                    this._newMsgPill(false);
                }
            }, sig);

            // Domande: ricorda quale aveva il fuoco (un pulsante disabilitato lo perde)
            const op = $('#c-operator', this.root);
            op.addEventListener('focusin', (e) => {
                const b = e.target.closest('.qopt');
                if (!b) return;
                this.qFocusId = b.dataset.id;
                this.qFocusIdx = [...b.parentElement.children].indexOf(b);
            }, sig);
            op.addEventListener('focusout', (e) => {
                if (!e.target.closest('.qopt')) return;
                const next = e.relatedTarget;
                if (next && !next.closest('.qopt')) this.qFocusId = null;
            }, sig);

            document.addEventListener('keydown', (e) => {
                if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
                const tag = (e.target.tagName || '').toLowerCase();
                if ((tag === 'input' && e.target.type !== 'checkbox') || tag === 'textarea' || tag === 'select') return;
                if (!$('#c-pause-overlay').hidden) {
                    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { ShiftController.resume(); e.preventDefault(); }
                    return;
                }
                if (document.querySelector('dialog[open]') || !$('#c-end-overlay').hidden) return;
                const k = e.key.toLowerCase();
                const a = this.engine.activeCall();
                if (/^[1-9]$/.test(k)) {
                    const i = Number(k) - 1;
                    if (i < this.engine.board.lines.length) { this._lineAction(i); e.preventDefault(); }
                } else if (k === 'h') {
                    if (a) { this.engine.dispatch('hold', { callId: a.id }); e.preventDefault(); }
                } else if (k === 'p' || k === 'escape') {
                    this.onPause();
                    e.preventDefault();
                } else if (k === 's') {
                    if (a) { this.skipVoice(); e.preventDefault(); }
                } else if (k === 'a') {
                    if (a) { $('#f-street', this.root)?.focus(); e.preventDefault(); }
                } else if (k === 'g') {
                    if (a) { this.form.transfer(); e.preventDefault(); }
                } else if (AGENCY_KEYS[k]) {
                    if (this.form.toggleAgency(AGENCY_KEYS[k])) e.preventDefault();
                } else if (QUESTION_KEYS.includes(k)) {
                    if (!a || a.dialog.pending) return;
                    const opt = LL.Dialog.options(a)[QUESTION_KEYS.indexOf(k)];
                    if (opt) { this.engine.dispatch('ask', { callId: a.id, nodeId: opt.id }); e.preventDefault(); }
                }
            }, sig);
        }

        destroy() {
            this._audio('stop');
            this._audio('detach');
            this.audio = null;
            LL.Sound.stopAll();
            Toast.clear();
            clearTimeout(this._liveTimer);
            this._liveTimer = null;
            this.ac.abort();
            this.map.destroy();
            this.unsubs.forEach((u) => u());
        }

        _lineAction(i) {
            const c = this.engine.lineCall(i);
            if (!c) return;
            if (c.state === S.RINGING) this.engine.dispatch('answer', { callId: c.id });
            else if (c.state === S.ON_HOLD) this.engine.dispatch('resume', { callId: c.id });
        }

        _log(text, kind = '') {
            const list = $('#c-log', this.root);
            const li = el('li', kind ? `clog__item clog__item--${kind}` : 'clog__item');
            li.append(el('time', 'clog__time', LL.Time.clock(this.engine.clockSec)), el('span', 'clog__text', text));
            list.prepend(li);
            while (list.children.length > 80) list.lastElementChild.remove();
        }

        /* ---------------- Disegno ---------------- */

        render() {
            const e = this.engine;
            // la voce controlla attesa e cambio di linea e aggiorna voiceState
            this._audio('frame');
            $('#c-clock', this.root).textContent = LL.Time.clock(e.clockSec);
            const scale = this.runnerScale;
            const speed = $('#c-speed', this.root);
            speed.textContent = scale > 1 ? t('console.speed_fast', { x: scale }) : t('console.speed_real');
            speed.dataset.fast = String(scale > 1);
            $('#c-progress', this.root).style.width = `${(e.progress * 100).toFixed(2)}%`;
            $('#c-progress-label', this.root).textContent = e.arrivalsOpen
                ? t('console.shift_end_at', { time: LL.Time.clock(e.gameStartSec + e.durationMs / 1000).slice(0, 5) })
                : t('console.shift_closing');

            const q = e.board.overflow.length;
            const ov = $('#c-overflow', this.root);
            ov.hidden = q === 0;
            ov.textContent = t('console.queued', { n: q });

            let ringing = 0;
            let urgent = false;
            this.lineEls.forEach((li, i) => {
                const c = e.lineCall(i);
                this._renderLine(li, c);
                if (c && c.state === S.RINGING) {
                    ringing++;
                    if (c.patienceRatio() < 0.35) urgent = true;
                }
            });
            LL.Sound.ring(ringing, urgent);
            LL.Sound.lineOn(!!e.activeCall());
            this._renderActive();
        }

        _renderLine(li, c) {
            const state = c ? c.state : 'free';
            li.dataset.state = state;
            const btn = $('.btn--line', li);
            const bar = $('.line__patience span', li);
            const tag = $('.line__tag', li);
            if (!c) {
                $('.line__state', li).textContent = t('console.state_free');
                $('.line__num', li).textContent = '';
                $('.line__type', li).textContent = '';
                $('.line__timer', li).textContent = '';
                setText(tag, '');
                bar.style.width = '0';
                btn.hidden = true;
                return;
            }
            const cl = c.content.caller;
            $('.line__state', li).textContent = t(`console.state_${state}`);
            $('.line__num', li).textContent = cl.phone;
            $('.line__type', li).textContent = t(`console.phone_${cl.phoneType}`);
            // Storico del numero (N2): "Già chiamato alle HH:MM (esito)"
            const hist = this._phoneHistory(c);
            if (hist.length) setText(tag, t('console.hist_badge', { time: this._histWhen(hist[0]), outcome: this._histState(hist[0]) }));
            else setText(tag, c.parentId !== null ? t('console.called_before') : '');
            let secs = 0;
            if (state === S.RINGING) secs = c.waitMs / 1000;
            else if (state === S.ON_HOLD) secs = c.holdMs / 1000;
            else if (state === S.ACTIVE) secs = c.activeMs / 1000;
            $('.line__timer', li).textContent = LL.Time.duration(secs);
            const ratio = c.patienceRatio();
            const showBar = state === S.RINGING || state === S.ON_HOLD;
            bar.style.width = showBar ? `${(ratio * 100).toFixed(1)}%` : '0';
            bar.dataset.level = ratio < 0.3 ? 'low' : ratio < 0.6 ? 'mid' : 'ok';
            btn.hidden = !(state === S.RINGING || state === S.ON_HOLD);
            btn.textContent = state === S.RINGING ? t('console.answer') : t('console.resume');
        }

        _renderActive() {
            const c = this.engine.activeCall();
            const id = c ? c.id : null;
            const callerBox = $('#c-caller', this.root);
            const opBox = $('#c-operator', this.root);

            if (id !== this.activeShownId) {
                // cambio di linea: la voce della chiamata precedente si interrompe
                if (!this.audio && this.voiceState && this.voiceState.callId !== id) this._fallbackStop();
                this.activeShownId = id;
                this.dlgVersion = -1;
                this.tx = null;
                this.tw = null;
                this.qFocusId = null;
                callerBox.replaceChildren(c ? this._buildCaller(c) : this._buildIdleCaller());
                opBox.replaceChildren(c ? this._buildOperator(c) : this._buildIdleOperator());
                callerBox.dataset.state = c ? 'live' : 'idle';
                this.form.show(c);
                this.map.setCall(c);
                if (c && !this.focusedCalls.has(c.id)) {
                    this.focusedCalls.add(c.id);
                    this._focusCall(c);
                }
            }
            if (!c) return;
            const now = performance.now();

            // Identità e tempi
            setText($('.caller__talk', callerBox), LL.Time.duration(c.activeMs / 1000));
            this._renderAge(c, $('.caller__age', callerBox));

            // Agitazione
            const lvl = c.panicLevel();
            const mood = $('.mood', callerBox);
            mood.dataset.level = lvl;
            $('.mood__marker', mood).style.left = `${Math.max(2, Math.min(98, c.panic)).toFixed(1)}%`;
            setText($('.mood__label', mood), t(`console.mood_${lvl}`));
            callerBox.dataset.mood = lvl;

            // Voce: le barre seguono la battuta che si sente davvero (voiceState)
            const voice = $('.voice', callerBox);
            const speaking = String(voiceActive(this.voiceState, c.id, now));
            if (voice.dataset.speaking !== speaking) voice.dataset.speaking = speaking;
            voice.style.setProperty('--amp', (0.25 + c.panic / 100 * 0.75).toFixed(2));
            voice.style.setProperty('--spd', `${(0.9 - c.panic / 100 * 0.55).toFixed(2)}s`);

            // Batteria (linee destinate a cadere)
            const bat = $('.battery', callerBox);
            if (bat) {
                const left = Math.max(0, 1 - c.activeMs / c.content.dropAtActiveMs);
                $('.battery__fill', bat).style.width = `${(left * 100).toFixed(1)}%`;
                bat.dataset.level = left < 0.3 ? 'low' : left < 0.6 ? 'mid' : 'ok';
            }

            // Risposta in arrivo
            const prog = LL.Dialog.progress(c);
            const typing = $('.bubble--typing .typing__bar', callerBox);
            if (typing && prog !== null) typing.style.width = `${(prog * 100).toFixed(1)}%`;

            if (c.dialog.version !== this.dlgVersion || (prog === null) !== !$('.bubble--typing', callerBox)) {
                this.dlgVersion = c.dialog.version;
                this._renderTranscript(c, $('.dlg__transcript', callerBox));
                this._renderOptions(c, $('.dlg__options', opBox));
                this._renderFacts(c, $('.facts__list', opBox), $('.facts__empty', opBox));
            }
            this._stepTypewriter(c, now);
        }

        /** Età dell'evento (M1): colore rispetto ai tempi ottimale / accettabile / limite della gravità. */
        _renderAge(c, node) {
            if (!node) return;
            let ms = null;
            if (typeof this.engine.incidentAgeMs === 'function') {
                try { ms = this.engine.incidentAgeMs(c); } catch (_) { ms = null; }
            }
            if (typeof ms !== 'number' || !Number.isFinite(ms)) { if (!node.hidden) node.hidden = true; return; }
            if (node.hidden) node.hidden = false;
            const sec = Math.max(0, ms / 1000);
            setText(node, t('console.incident_age', { t: LL.Time.duration(sec) }));
            const sev = c.content.truth && c.content.truth.severity;
            let level = 'none';
            if (sev && typeof sev === 'object') {
                const lim = (v) => (typeof v === 'number' ? v : Infinity);
                const acc = lim(sev.acceptable_s);
                const opt = typeof sev.optimal_s === 'number' ? sev.optimal_s : acc;
                level = sec <= opt ? 'ok' : sec <= acc ? 'mid' : sec <= lim(sev.limit_s) ? 'late' : 'over';
            }
            if (node.dataset.level !== level) node.dataset.level = level;
        }

        _buildIdleCaller() {
            const wrap = el('div', 'caller__idle');
            const v = el('div', 'voice voice--idle');
            for (let i = 0; i < VOICE_BARS; i++) v.append(el('span'));
            wrap.append(el('p', 'section-tag', t('console.caller_title')), v, el('h2', 'caller__idle-title', t('console.idle_title')), el('p', 'caller__idle-text', t('console.idle_text')));
            return wrap;
        }

        _buildIdleOperator() {
            const wrap = el('div', 'operator__idle');
            const head = el('header', 'operator__head');
            const ic = el('span', 'operator__icon'); ic.innerHTML = ICON.headset;
            head.append(ic, el('p', 'section-tag', t('console.operator_title')), el('p', 'keys', t('console.keys_ops')));
            wrap.append(head, el('p', 'operator__idle-text', t('console.idle_op')));
            return wrap;
        }

        _buildCaller(c) {
            const cl = c.content.caller;
            const wrap = el('div', 'caller__live');

            const head = el('header', 'caller__head');
            const av = el('div', 'caller__avatar');
            av.innerHTML = cl.voice === 'child' ? ICON.child : ICON.person;
            const badge = el('span', 'caller__phone');
            badge.innerHTML = cl.phoneType === 'mobile' ? ICON.mobile : ICON.landline;
            av.append(badge);

            const id = el('div', 'caller__id');
            id.append(el('p', 'section-tag', t('console.caller_title')));
            const dir = c.content.directory;
            id.append(el('h2', 'caller__name', dir ? t('console.directory_of', { name: dir.surname }) : t('console.unknown_caller')));
            id.append(el('p', 'caller__num', `${t('console.line', { n: c.line + 1 })}, ${cl.phone}, ${t(cl.phoneType === 'mobile' ? 'console.mobile_line' : 'console.landline_line').toLowerCase()}`));

            // Storico del numero (N2) con scorciatoia per accorpare all'evento già trasferito
            const hist = this._phoneHistory(c);
            if (hist.length) {
                const hb = el('p', 'caller__hist');
                hb.append(el('span', 'caller__hist-title', t('console.hist_title')));
                for (const h of hist.slice(0, 2)) {
                    hb.append(el('span', `caller__hist-item caller__hist-item--${h.state}`,
                        t('console.hist_item', { id: h.id, time: this._histWhen(h), outcome: this._histState(h) })));
                    if (h.state === S.TRANSFERRED) {
                        const b = el('button', 'caller__merge', t('console.hist_merge', { id: h.id }));
                        b.type = 'button';
                        b.addEventListener('click', () => this.form.preselectMerge(h.id));
                        hb.append(b);
                    }
                }
                id.append(hb);
            }

            const age = el('span', 'caller__age');
            age.title = t('console.incident_age_title');
            age.hidden = true;

            const live = el('div', 'caller__livebox');
            const dot = el('span', 'caller__dot');
            live.append(dot, el('span', 'caller__live-text', t('console.live')), el('span', 'caller__talk'));
            head.append(av, id, age, live);

            const meters = el('div', 'caller__meters');
            const voice = el('div', 'voice');
            for (let i = 0; i < VOICE_BARS; i++) voice.append(el('span'));
            const mood = el('div', 'mood');
            const mt = el('div', 'mood__track');
            mt.append(el('span', 'mood__marker'));
            const ml = el('div', 'mood__legend');
            ml.append(el('span', '', t('console.mood_calm')), el('span', '', t('console.mood_agitated')), el('span', '', t('console.mood_panic')));
            mood.append(el('span', 'mood__title', t('console.mood_scale')), el('span', 'mood__label'), mt, ml);
            meters.append(voice, mood);
            if (c.content.dropAtActiveMs) {
                const bat = el('div', 'battery');
                const tr = el('div', 'battery__track');
                tr.append(el('span', 'battery__fill'));
                bat.append(el('span', 'battery__title', t('console.battery')), tr);
                meters.append(bat);
            }

            const talk = el('ol', 'dlg__transcript');
            // chi risale a rileggere non viene riportato in fondo a ogni battuta
            talk.addEventListener('scroll', () => {
                if (!this.tx) return;
                this.tx.stick = talk.scrollHeight - talk.scrollTop - talk.clientHeight <= NEAR_BOTTOM_PX;
                if (this.tx.stick) this._newMsgPill(false);
            }, { signal: this.ac.signal, passive: true });
            const pill = el('button', 'dlg__newmsg', t('console.new_messages'));
            pill.type = 'button';
            pill.hidden = true;
            wrap.append(head, meters, talk, pill);
            return wrap;
        }

        _buildOperator(c) {
            const wrap = el('div', 'operator__live');
            const head = el('header', 'operator__head');
            const ic = el('span', 'operator__icon'); ic.innerHTML = ICON.headset;
            const bHold = el('button', 'btn btn--ghost btn--small active__hold', t('console.hold'));
            bHold.type = 'button';
            bHold.addEventListener('click', () => this.engine.dispatch('hold', { callId: c.id }));
            head.append(ic, el('p', 'section-tag', t('console.operator_title')), el('p', 'keys', t('console.keys_ops')), bHold);

            const body = el('div', 'operator__body');
            const qs = el('section', 'dlg');
            qs.append(el('h3', 'operator__h', t('console.questions')), el('div', 'dlg__options'));
            const info = el('aside', 'facts');
            info.append(el('h3', 'operator__h', t('console.collected')), el('dl', 'facts__list'), el('p', 'facts__empty', t('console.collected_empty')));
            body.append(qs, info);
            wrap.append(head, body);
            return wrap;
        }

        /* ---------------- Conversazione ---------------- */

        _newMsgPill(show) {
            const p = $('.dlg__newmsg', this.root);
            if (p && p.hidden === show) p.hidden = !show;
        }

        _buildBubble(entry, idx, av, isStatic) {
            const li = el('li', `bubble bubble--${entry.who}${isStatic ? ' bubble--static' : ''}`);
            li.dataset.idx = String(idx);
            const ic = el('span', 'bubble__icon');
            ic.innerHTML = entry.who === 'op' ? ICON.headset : av;
            const body = el('div', 'bubble__body');
            // più voci nella stessa chiamata (testimone, interprete...): nome di chi parla
            if (entry.who !== 'op' && entry.speaker && entry.speaker.name) body.append(el('span', 'bubble__who', entry.speaker.name));
            const txt = el('p', 'bubble__text');
            txt.append(document.createTextNode(entry.text || ''));
            body.append(txt);
            li.append(ic, body);
            if (entry.interrupted) this._markInterrupted(li);
            return li;
        }

        _markInterrupted(li) {
            li.classList.add('bubble--interrupted');
            $('.bubble__text', li).append(el('em', 'bubble__cut', ` ${t('console.interrupted')}`));
        }

        /**
         * Conversazione incrementale: al cambio di chiamata si ridisegna tutto senza animazioni,
         * poi si aggiungono solo le battute nuove. L'ultima battuta del chiamante compare parola
         * per parola al ritmo della voce (vedi _stepTypewriter).
         */
        _renderTranscript(c, list) {
            const tr = c.dialog.transcript;
            const av = c.content.caller.voice === 'child' ? ICON.child : ICON.person;
            const fresh = !this.tx || this.tx.callId !== c.id;
            if (fresh) {
                list.replaceChildren();
                this.tx = { callId: c.id, count: 0, stick: true };
                this.tw = null;
            }
            const tx = this.tx;

            // segni di interruzione arrivati dopo che la battuta era già a schermo
            for (let i = Math.max(0, tx.count - 4); i < tx.count; i++) {
                if (!tr[i] || !tr[i].interrupted) continue;
                const li = list.querySelector(`li[data-idx="${i}"]`);
                if (!li || li.classList.contains('bubble--interrupted')) continue;
                if (this.tw && this.tw.idx === i) this._twComplete();
                this._markInterrupted(li);
            }

            const typing = $('.bubble--typing', list);
            const added = tr.length > tx.count;
            let lastLi = null;
            for (let i = tx.count; i < tr.length; i++) {
                lastLi = this._buildBubble(tr[i], i, av, fresh);
                list.insertBefore(lastLi, typing);
            }
            if (added) {
                const last = tr[tr.length - 1];
                const vs = this.voiceState;
                // la battuta d'apertura si "scrive" solo se la chiamata è appena stata risposta
                const justAnswered = tr.length === 1 && c.activeMs < 1500;
                const speakingNow = vs && vs.callId === c.id && vs.entryIdx === tr.length - 1 && typeof vs.endMs !== 'number';
                if (last.who !== 'op' && (!fresh || justAnswered || speakingNow)) this._twStart(c, tr.length - 1, lastLi);
            }
            tx.count = tr.length;

            if (c.dialog.pending && !typing) {
                const li = el('li', 'bubble bubble--caller bubble--typing');
                const ic = el('span', 'bubble__icon'); ic.innerHTML = av;
                const body = el('div', 'bubble__body');
                const dots = el('span', 'typing');
                dots.append(el('i'), el('i'), el('i'));
                const bar = el('span', 'typing__track'); bar.append(el('span', 'typing__bar'));
                body.append(dots, bar);
                li.append(ic, body);
                list.append(li);
            } else if (!c.dialog.pending && typing) {
                typing.remove();
            }

            if (fresh || tx.stick) {
                list.scrollTop = list.scrollHeight;
                this._newMsgPill(false);
            } else if (added) {
                this._newMsgPill(true);
            }
        }

        /** Avvia la comparsa parola per parola di una battuta del chiamante. */
        _twStart(c, idx, li) {
            this._twComplete();
            const entry = c.dialog.transcript[idx];
            if (!li || !entry || entry.interrupted) return;
            if (pref('subtitles', 'typewriter') === 'instant' || reducedMotion()) return;
            const text = entry.text || '';
            // fine di ogni parola (indice del carattere), per mostrarle intere
            const cuts = [];
            const re = /\S+/g;
            let m;
            while ((m = re.exec(text))) cuts.push(m.index + m[0].length);
            if (cuts.length < 2) return;
            const txt = $('.bubble__text', li);
            const shown = document.createTextNode('');
            // il resto occupa già il suo spazio (invisibile): la nuvoletta non cambia misura mentre si scrive
            const rest = el('span', 'bubble__rest', text);
            rest.setAttribute('aria-hidden', 'true');
            txt.replaceChildren(shown, rest);
            li.classList.add('bubble--speaking');
            const est = Math.max(1000, Math.min(9000, text.length * 60 * (1 - c.panic / 400)));
            this.tw = { callId: c.id, idx, li, shown, rest, text, cuts, n: 0, p: 0, t0: performance.now(), est };
        }

        /** Avanza la battuta che si sta scrivendo, al passo della voce (o di una stima se la voce non c'è). */
        _stepTypewriter(c, now) {
            const w = this.tw;
            if (!w) return;
            if (w.callId !== c.id || !w.li.isConnected) { this.tw = null; return; }
            const vs = this.voiceState;
            let p;
            if (vs && vs.callId === w.callId && vs.entryIdx === w.idx && typeof vs.startMs === 'number') {
                const est = estMs(vs) || w.est;
                if (typeof vs.endMs === 'number' && now >= vs.endMs) p = 1;
                else if (typeof vs.endMs === 'number') p = (now - vs.startMs) / Math.max(300, vs.endMs - vs.startMs);
                // fine non ancora nota: si resta un passo indietro finché la voce non finisce davvero
                else p = now > vs.startMs + est * 1.5 + 1000 ? 1 : Math.min(0.96, (now - vs.startMs) / Math.max(300, est));
            } else if (vs && vs.callId === w.callId && typeof vs.entryIdx === 'number' && vs.entryIdx > w.idx) {
                p = 1; // la voce è già passata a una battuta successiva
            } else {
                // nessuna voce per questa battuta (ancora): breve attesa per lasciarla partire, poi ritmo stimato
                const grace = this.audio ? 600 : 0;
                p = (now - w.t0 - grace) / w.est;
            }
            if (now - w.t0 > TW_MAX_MS) p = 1;
            p = Math.max(w.p, Math.min(1, p || 0));
            if (p >= 1) { this._twComplete(); return; }
            w.p = p;
            const n = Math.floor(p * w.cuts.length);
            if (n === w.n) return;
            w.n = n;
            const at = n > 0 ? w.cuts[n - 1] : 0;
            w.shown.data = w.text.slice(0, at);
            w.rest.textContent = w.text.slice(at);
        }

        /** Mostra subito per intero la battuta che si stava scrivendo. */
        _twComplete() {
            const w = this.tw;
            if (!w) return;
            this.tw = null;
            w.shown.data = w.text;
            w.rest.remove();
            w.li.classList.remove('bubble--speaking');
        }

        /**
         * Domande stabili: un pulsante per o.id, aggiornato sul posto. L'ordine nel DOM resta
         * quello di LL.Dialog.options(), così le scorciatoie Q-O corrispondono alle etichette.
         */
        _renderOptions(c, box) {
            const busy = !!c.dialog.pending;
            const opts = LL.Dialog.options(c);
            const initial = box.children.length === 0;
            const had = document.activeElement && box.contains(document.activeElement);
            const existing = new Map([...box.children].map((b) => [b.dataset.id, b]));
            const motion = !reducedMotion();

            opts.forEach((o, i) => {
                let b = existing.get(String(o.id));
                existing.delete(String(o.id));
                if (!b) {
                    b = el('button', 'qopt');
                    b.type = 'button';
                    b.dataset.id = String(o.id);
                    const k = el('kbd', 'qopt__key');
                    k.setAttribute('aria-hidden', 'true');
                    b.append(k, el('span', 'qopt__label'), el('span', 'qopt__meta'));
                    b.addEventListener('click', () => this.engine.dispatch('ask', { callId: c.id, nodeId: o.id }));
                    if (!initial) {
                        b.classList.add('qopt--new');
                        if (!motion) b.classList.add('qopt--static');
                        setTimeout(() => b.classList.remove('qopt--new'), QOPT_NEW_MS);
                    }
                }
                b.classList.toggle('qopt--reassure', o.type === 'reassure');
                b.classList.toggle('qopt--asked', !!o.asked);
                if (b.disabled !== busy) b.disabled = busy;
                const key = $('.qopt__key', b);
                const kt = i < QUESTION_KEYS.length ? QUESTION_KEYS[i].toUpperCase() : '';
                setText(key, kt);
                key.hidden = !kt;
                setText($('.qopt__label', b), o.label);
                let meta = `${o.costSec} s`;
                if (o.asked) meta += o.asked > 1 ? `, ×${o.asked}` : ' ✓';
                setText($('.qopt__meta', b), meta);
                if (box.children[i] !== b) box.insertBefore(b, box.children[i] || null);
            });
            for (const b of existing.values()) b.remove();

            // Fuoco: torna sulla stessa domanda (o su quella al suo posto) appena i pulsanti si riattivano
            if (!busy && this.qFocusId !== null) {
                const lost = !document.activeElement || document.activeElement === document.body || had;
                if (lost) {
                    let target = [...box.children].find((b) => b.dataset.id === this.qFocusId);
                    if (!target) target = box.children[Math.min(box.children.length - 1, this.qFocusIdx || 0)] || null;
                    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
                }
            }
        }

        _renderFacts(c, list, empty) {
            list.replaceChildren();
            const items = LL.Dialog.collected(c);
            empty.hidden = items.length > 0;
            const seen = this.seenFacts.get(c.id) || new Map();
            const fresh = [];
            for (const f of items) {
                const d = el('div', f.conflict ? 'fact fact--conflict' : 'fact');
                const key = `facts.${f.key}`;
                const label = f.label || (I18n.t(key) !== key ? I18n.t(key) : f.key);
                d.append(el('dt', '', label), el('dd', '', f.display));
                if (f.conflict) d.append(el('dd', 'fact__warn', t('console.conflict', { list: f.variants.join(' / ') })));
                const sig = `${f.display}|${f.variants.length}`;
                if (seen.get(f.key) !== sig) { d.classList.add('fact--new'); seen.set(f.key, sig); fresh.push(`${label}: ${f.display}`); }
                list.append(d);
            }
            this.seenFacts.set(c.id, seen);
            if (fresh.length && items.length) {
                LL.Sound.play('fact');
                this.announce(t('console.live_fact', { fact: fresh.join('; ') }));
            }
        }

        _focusCall(c) {
            if (!c) return;
            const a = c.content.aml;
            const d = c.content.directory;
            if (a) this.map.focus(a.x, a.y, Math.max(a.r, 25));
            else if (d) this.map.focus(d.x, d.y, 30);
        }

        _refreshIncidents() {
            const list = [];
            for (const k of this.engine.calls.values()) {
                const loc = k.result?.form?.location;
                if (k.state !== S.TRANSFERRED || !loc) continue;
                const f = k.result.form;
                const when = LL.Time.clock(this.engine.gameStartSec + k.closedMs / 1000).slice(0, 5);
                list.push({ id: k.id, x: loc.x, y: loc.y, agencies: k.result.agencies,
                    title: `${when}, ${f.eventType ? t(`events.${f.eventType}`) : ''} ${loc.street || ''}`.trim() });
            }
            this.map.setIncidents(list);
        }
    }

    /* =================================================================== */

    const ShiftController = {
        session: null,

        /**
         * Avvia un turno.
         * @param {object} o
         * @param {function} o.show    mostra una vista ('console', 'home', ...)
         * @param {function} o.onExit  chiamata al ritorno alla postazione
         */
        async start({ show, onExit, mode = 'carriera' }) {
            if (this.session) return;
            LL.Sound.unlock();
            // Prima i dati statici: se mancano, il turno non viene nemmeno creato sul server
            const [city, eventTypes] = await Promise.all([LL.Data.load('city'), LL.Data.load('events')]);
            const cfg = await Api.startShift(mode);
            const training = cfg.mode === 'addestramento';

            const root = $('#view-console');
            // Regole del turno decise dal server (contratto C3); senza, i valori predefiniti della 1.1
            const rules = Object.assign({ lines: cfg.lines }, cfg.rules && typeof cfg.rules === 'object' ? cfg.rules : {});
            const engine = new LL.Engine({
                seed: cfg.seed,
                gameStartSec: cfg.game_start_sec,
                durationSec: cfg.duration_sec,
                rules,
                scheduler: training
                    ? new LL.TrainingScheduler({ templates: cfg.templates, city })
                    : new LL.Director({ templates: cfg.templates, city, baseDifficulty: cfg.base_difficulty }),
            });

            const s = { cfg, engine, root, onExit, show, city, finished: false };
            this.session = s;

            s.ui = new ConsoleUI(root, engine, {
                onPause: () => this.pause(),
                onAbandon: () => this.askAbandon(),
                onSettings: () => this.openSettings(),
                city,
                eventTypes,
            });
            s.runner = new LL.Runner(engine, {
                idleScale: cfg.idle_scale,
                onFrame: () => { s.ui.runnerScale = s.runner.gameScale; s.ui.render(); if (s.tutor) s.tutor.update(); },
            });

            engine.events.on('shift:end', ({ summary }) => this._finish(summary));

            // Uscire dalla scheda del browser mette in pausa: niente tempo "rubato".
            s.onVisibility = () => { if (document.hidden) this.pause(); };
            document.addEventListener('visibilitychange', s.onVisibility);
            s.onBeforeUnload = (e) => { if (!s.finished) { e.preventDefault(); e.returnValue = ''; } };
            window.addEventListener('beforeunload', s.onBeforeUnload);

            // Velocità di sviluppo, solo con debug attivo sul server
            const dbg = $('#c-debug', root);
            dbg.hidden = !cfg.debug;
            dbg.value = '1';
            s.onDebug = () => { s.runner.debugMult = Number(dbg.value) || 1; };
            dbg.addEventListener('change', s.onDebug);

            $('#c-mode', root).textContent = I18n.t(`modes.${cfg.mode}`);
            $('#c-pause-overlay').hidden = true;
            $('#c-end-overlay').hidden = true;

            show('console');
            if (training) s.tutor = new LL.Tutor({ engine, runner: s.runner, ui: s.ui, onFinish: () => { s.tutor = null; } });
            else s.runner.start();
        },

        /** In un passo "spiegazione" del tutor il turno deve restare fermo. */
        _tutorHolds() {
            const s = this.session;
            return !!(s && s.tutor && s.tutor.steps[s.tutor.i]?.mode === 'next');
        },

        pause() {
            const s = this.session;
            if (!s || s.finished || !s.runner.running) return;
            s.runner.pause();
            s.ui._audio('pause');
            LL.Sound.stopAll();
            s.engine.logMeta('pause');
            const ov = $('#c-pause-overlay');
            ov.hidden = false;
            $('#c-resume').focus();
        },

        resume() {
            const s = this.session;
            if (!s || s.finished) return;
            $('#c-pause-overlay').hidden = true;
            s.engine.logMeta('resume');
            if (!this._tutorHolds()) { s.runner.start(); s.ui._audio('resume'); }
        },

        /**
         * Una finestra modale ferma il turno come la richiesta di abbandono, senza registrare nulla:
         * al termine riparte solo se stava andando e non c'è la pausa o un passo del tutor.
         */
        _holdFor() {
            const s = this.session;
            const wasRunning = s.runner.running;
            s.runner.pause();
            if (wasRunning) s.ui._audio('pause');
            return () => {
                if (this.session !== s || s.finished) return;
                if (wasRunning && $('#c-pause-overlay').hidden && !this._tutorHolds()) {
                    s.runner.start();
                    s.ui._audio('resume');
                }
            };
        },

        /** Impostazioni durante il turno (LL.Settings, contratto C4). */
        openSettings() {
            if (!settingsAvailable() || settingsOpen()) return;
            const s = this.session;
            if (!s || s.finished) { LL.Settings.open({}); return; }
            const back = this._holdFor();
            try { LL.Settings.open({ onClose: back }); } catch (err) { console.error(err); back(); }
        },

        askAbandon() {
            const s = this.session;
            if (!s || s.finished) return;
            const back = this._holdFor();
            const dlg = $('#c-abandon-dialog');
            dlg.onclose = async () => {
                if (dlg.returnValue === 'confirm') {
                    try { await Api.abandonShift(s.cfg.shift_id); } catch (_) { /* il server lo chiuderà al prossimo avvio */ }
                    this._teardown();
                    s.onExit();
                } else {
                    back();
                }
            };
            dlg.returnValue = '';
            dlg.showModal();
        },

        async _finish(summary) {
            const s = this.session;
            if (!s || s.finished) return;
            s.finished = true;
            s.ui.render();

            s.ui._audio('stop');
            LL.Sound.stopAll();
            LL.Sound.play('end');
            const ev = LL.Scoring.evaluateShift(s.engine, s.city);
            LL.Debrief.render(ev, s.engine, summary);
            const status = $('#c-end-status');
            status.textContent = I18n.t('end.saving');
            $('#c-end-overlay').hidden = false;
            $('#c-end-overlay').scrollTop = 0;
            $('#c-end-back').focus({ preventScroll: true });

            try {
                const res = await Api.finishShift({
                    shift_id: s.cfg.shift_id,
                    actions: s.engine.log,
                    summary,
                    calls: ev.calls,
                });
                LL.Debrief.renderServer(res);
            } catch (err) {
                status.textContent = I18n.t('end.save_failed');
            }
        },

        exitAfterEnd() {
            const s = this.session;
            if (!s) return;
            this._teardown();
            s.onExit();
        },

        _teardown() {
            const s = this.session;
            if (!s) return;
            s.runner.pause();
            if (s.tutor) s.tutor.destroy();
            s.ui.destroy();
            s.engine.events.clear();
            document.removeEventListener('visibilitychange', s.onVisibility);
            window.removeEventListener('beforeunload', s.onBeforeUnload);
            $('#c-debug', s.root).removeEventListener('change', s.onDebug);
            $('#c-pause-overlay').hidden = true;
            $('#c-end-overlay').hidden = true;
            this.session = null;
        },
    };

    document.addEventListener('DOMContentLoaded', () => {
        $('#c-resume')?.addEventListener('click', () => ShiftController.resume());
        $('#c-end-back')?.addEventListener('click', () => ShiftController.exitAfterEnd());

        // Pausa e fine turno sono sovrapposizioni modali: il Tab non ne esce
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab' || document.querySelector('dialog[open]')) return;
            for (const sel of ['#c-end-overlay', '#c-pause-overlay']) {
                const ov = $(sel);
                if (ov && !ov.hidden && !ov.parentElement.closest('[hidden]')) { trapFocus(e, ov); return; }
            }
        });

        // Ingranaggio della postazione: impostazioni fuori dal turno
        const hs = $('#h-settings');
        if (hs) {
            if (!settingsAvailable()) {
                hs.hidden = true;
            } else {
                hs.addEventListener('pointerenter', () => { hs.title = hs.getAttribute('aria-label') || ''; });
                hs.addEventListener('click', (e) => {
                    if (settingsOpen()) return;
                    e.stopImmediatePropagation();
                    LL.Settings.open({});
                }, { capture: true });
            }
        }
    });

    LL.ConsoleUI = ConsoleUI;
    LL.Toast = Toast;
    LL.ShiftController = ShiftController;
})(globalThis.LL = globalThis.LL || {});
