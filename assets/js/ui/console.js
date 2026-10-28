/**
 * LifeLine - Console dell'operatore
 *
 * Tre colonne a tutta altezza:
 *   sinistra  linee telefoniche e registro
 *   centro    in alto l'INTERLOCUTORE (identità, voce, agitazione, conversazione),
 *             in basso l'OPERATORE (domande con scorciatoie, informazioni raccolte)
 *   destra    mappa e scheda contatto
 * ConsoleUI legge lo stato del motore e non lo modifica mai direttamente: usa engine.dispatch().
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
    const QUESTION_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o'];
    const VOICE_BARS = 14;

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
        constructor(root, engine, { onPause, onAbandon, city, eventTypes }) {
            this.root = root;
            this.engine = engine;
            this.onPause = onPause;
            this.onAbandon = onAbandon;
            this.city = city;
            this.ac = new AbortController();
            this.lineEls = [];
            this.activeShownId = undefined;
            this.focusedCalls = new Set();
            this.seenFacts = new Map();
            this.speakingUntil = 0;
            this.unsubs = [];
            this.runnerScale = 1;

            this._buildLines();
            this.map = new LL.MapView($('#c-map', root), city, { onPick: (p) => this.form.pick(p) });
            this.form = new LL.ContactForm($('#c-form', root), { engine, city, eventTypes, map: this.map, signal: this.ac.signal });
            this._bindEngine();
            this._bindControls();
            $('#c-log', root).replaceChildren();
            Toast.clear();
            this.render();
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
                        this._speakCaller(call, call.dialog.transcript[0]?.text || '');
                    } else {
                        this._log(t('log.resumed', { line: lineName(line) }));
                    }
                }
                if (to === S.ON_HOLD) {
                    LL.Sound.play('hold');
                    this._log(t('log.hold', { line: lineName(line) }));
                }
            }));
            this.unsubs.push(ev.on('dialog:ask', ({ call, costSec }) => {
                if (call.id === this.engine.activeId) LL.Sound.speak({ seconds: Math.min(1.8, 0.8 + costSec * 0.12), voice: 'operator' });
            }));
            this.unsubs.push(ev.on('dialog:reply', ({ call }) => {
                if (call.id !== this.engine.activeId) return;
                const last = call.dialog.transcript[call.dialog.transcript.length - 1];
                this._speakCaller(call, last ? last.text : '');
            }));
            this.unsubs.push(ev.on('call:final', ({ call, line, result }) => {
                const L = lineName(line);
                this.form.discard(call.id);
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

        _speakCaller(call, text) {
            const secs = Math.max(1, Math.min(3.8, (text || '').length / (15 + call.panic / 12)));
            this.speakingUntil = performance.now() + secs * 1000;
            LL.Sound.speak({ seconds: secs, panic: call.panic, voice: call.content.caller.voice || 'male' });
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

            const bSound = $('#c-sound', this.root);
            const vol = $('#c-volume', this.root);
            const syncSound = () => {
                bSound.textContent = t(LL.Sound.on ? 'console.sound_on' : 'console.sound_off');
                bSound.setAttribute('aria-pressed', String(LL.Sound.on));
                vol.value = String(Math.round(LL.Sound.vol * 100));
                vol.disabled = !LL.Sound.on;
            };
            bSound.addEventListener('click', () => { LL.Sound.unlock(); LL.Sound.setOn(!LL.Sound.on); syncSound(); }, sig);
            vol.addEventListener('input', () => { LL.Sound.setVolume(Number(vol.value) / 100); LL.Sound.play('answer'); }, sig);
            syncSound();

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
                if (/^[1-9]$/.test(k)) {
                    const i = Number(k) - 1;
                    if (i < this.engine.board.lines.length) { this._lineAction(i); e.preventDefault(); }
                } else if (k === 'h') {
                    const a = this.engine.activeCall();
                    if (a) { this.engine.dispatch('hold', { callId: a.id }); e.preventDefault(); }
                } else if (k === 'p' || k === 'escape') {
                    this.onPause();
                    e.preventDefault();
                } else if (QUESTION_KEYS.includes(k)) {
                    const a = this.engine.activeCall();
                    if (!a || a.dialog.pending) return;
                    const opt = LL.Dialog.options(a)[QUESTION_KEYS.indexOf(k)];
                    if (opt) { this.engine.dispatch('ask', { callId: a.id, nodeId: opt.id }); e.preventDefault(); }
                }
            }, sig);
        }

        destroy() {
            LL.Sound.stopAll();
            Toast.clear();
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
            if (!c) {
                $('.line__state', li).textContent = t('console.state_free');
                $('.line__num', li).textContent = '';
                $('.line__type', li).textContent = '';
                $('.line__timer', li).textContent = '';
                $('.line__tag', li).textContent = '';
                bar.style.width = '0';
                btn.hidden = true;
                return;
            }
            const cl = c.content.caller;
            $('.line__state', li).textContent = t(`console.state_${state}`);
            $('.line__num', li).textContent = cl.phone;
            $('.line__type', li).textContent = t(`console.phone_${cl.phoneType}`);
            $('.line__tag', li).textContent = c.parentId !== null ? t('console.called_before') : '';
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
                this.activeShownId = id;
                this.dlgVersion = -1;
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

            // Identità e tempi
            $('.caller__talk', callerBox).textContent = LL.Time.duration(c.activeMs / 1000);

            // Agitazione
            const lvl = c.panicLevel();
            const mood = $('.mood', callerBox);
            mood.dataset.level = lvl;
            $('.mood__marker', mood).style.left = `${Math.max(2, Math.min(98, c.panic)).toFixed(1)}%`;
            $('.mood__label', mood).textContent = t(`console.mood_${lvl}`);
            callerBox.dataset.mood = lvl;

            // Voce: parla dopo ogni risposta, più ampia e rapida se agitato
            const voice = $('.voice', callerBox);
            const speaking = performance.now() < this.speakingUntil;
            voice.dataset.speaking = String(speaking);
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
            head.append(ic, el('p', 'section-tag', t('console.operator_title')), el('p', 'keys', t('console.keys_short')));
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

            const live = el('div', 'caller__livebox');
            const dot = el('span', 'caller__dot');
            live.append(dot, el('span', 'caller__live-text', t('console.live')), el('span', 'caller__talk'));
            head.append(av, id, live);

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
            wrap.append(head, meters, talk);
            return wrap;
        }

        _buildOperator(c) {
            const wrap = el('div', 'operator__live');
            const head = el('header', 'operator__head');
            const ic = el('span', 'operator__icon'); ic.innerHTML = ICON.headset;
            const bHold = el('button', 'btn btn--ghost btn--small active__hold', t('console.hold'));
            bHold.type = 'button';
            bHold.addEventListener('click', () => this.engine.dispatch('hold', { callId: c.id }));
            head.append(ic, el('p', 'section-tag', t('console.operator_title')), el('p', 'keys', t('console.keys_short')), bHold);

            const body = el('div', 'operator__body');
            const qs = el('section', 'dlg');
            qs.append(el('h3', 'operator__h', t('console.questions')), el('div', 'dlg__options'));
            const info = el('aside', 'facts');
            info.append(el('h3', 'operator__h', t('console.collected')), el('dl', 'facts__list'), el('p', 'facts__empty', t('console.collected_empty')));
            body.append(qs, info);
            wrap.append(head, body);
            return wrap;
        }

        _renderTranscript(c, list) {
            list.replaceChildren();
            const av = c.content.caller.voice === 'child' ? ICON.child : ICON.person;
            for (const entry of c.dialog.transcript) {
                const li = el('li', `bubble bubble--${entry.who}`);
                const ic = el('span', 'bubble__icon');
                ic.innerHTML = entry.who === 'op' ? ICON.headset : av;
                const body = el('div', 'bubble__body');
                const txt = el('p', 'bubble__text', entry.text);
                if (entry.interrupted) {
                    li.classList.add('bubble--interrupted');
                    txt.append(el('em', 'bubble__cut', ` ${t('console.interrupted')}`));
                }
                body.append(txt);
                li.append(ic, body);
                list.append(li);
            }
            if (c.dialog.pending) {
                const li = el('li', 'bubble bubble--caller bubble--typing');
                const ic = el('span', 'bubble__icon'); ic.innerHTML = av;
                const body = el('div', 'bubble__body');
                const dots = el('span', 'typing');
                dots.append(el('i'), el('i'), el('i'));
                const bar = el('span', 'typing__track'); bar.append(el('span', 'typing__bar'));
                body.append(dots, bar);
                li.append(ic, body);
                list.append(li);
            }
            list.scrollTop = list.scrollHeight;
        }

        _renderOptions(c, box) {
            box.replaceChildren();
            const busy = !!c.dialog.pending;
            LL.Dialog.options(c).forEach((o, i) => {
                const b = el('button', `qopt${o.type === 'reassure' ? ' qopt--reassure' : ''}${o.asked ? ' qopt--asked' : ''}`);
                b.type = 'button';
                b.disabled = busy;
                if (i < QUESTION_KEYS.length) {
                    const k = el('kbd', 'qopt__key', QUESTION_KEYS[i].toUpperCase());
                    k.setAttribute('aria-hidden', 'true');
                    b.append(k);
                }
                b.append(el('span', 'qopt__label', o.label));
                const meta = el('span', 'qopt__meta', `${o.costSec} s`);
                if (o.asked) meta.textContent += o.asked > 1 ? `, ×${o.asked}` : ' ✓';
                b.append(meta);
                b.addEventListener('click', () => this.engine.dispatch('ask', { callId: c.id, nodeId: o.id }));
                box.append(b);
            });
        }

        _renderFacts(c, list, empty) {
            list.replaceChildren();
            const items = LL.Dialog.collected(c);
            empty.hidden = items.length > 0;
            const seen = this.seenFacts.get(c.id) || new Map();
            let fresh = false;
            for (const f of items) {
                const d = el('div', f.conflict ? 'fact fact--conflict' : 'fact');
                const key = `facts.${f.key}`;
                const label = f.label || (I18n.t(key) !== key ? I18n.t(key) : f.key);
                d.append(el('dt', '', label), el('dd', '', f.display));
                if (f.conflict) d.append(el('dd', 'fact__warn', t('console.conflict', { list: f.variants.join(' / ') })));
                const sig = `${f.display}|${f.variants.length}`;
                if (seen.get(f.key) !== sig) { d.classList.add('fact--new'); seen.set(f.key, sig); fresh = true; }
                list.append(d);
            }
            this.seenFacts.set(c.id, seen);
            if (fresh && items.length) LL.Sound.play('fact');
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
            const engine = new LL.Engine({
                seed: cfg.seed,
                gameStartSec: cfg.game_start_sec,
                durationSec: cfg.duration_sec,
                rules: { lines: cfg.lines },
                scheduler: training
                    ? new LL.TrainingScheduler({ templates: cfg.templates, city })
                    : new LL.Director({ templates: cfg.templates, city, baseDifficulty: cfg.base_difficulty }),
            });

            const s = { cfg, engine, root, onExit, show, city, finished: false };
            this.session = s;

            s.ui = new ConsoleUI(root, engine, {
                onPause: () => this.pause(),
                onAbandon: () => this.askAbandon(),
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
            if (!this._tutorHolds()) s.runner.start();
        },

        askAbandon() {
            const s = this.session;
            if (!s || s.finished) return;
            const wasRunning = s.runner.running;
            s.runner.pause();
            const dlg = $('#c-abandon-dialog');
            dlg.onclose = async () => {
                if (dlg.returnValue === 'confirm') {
                    try { await Api.abandonShift(s.cfg.shift_id); } catch (_) { /* il server lo chiuderà al prossimo avvio */ }
                    this._teardown();
                    s.onExit();
                } else if (wasRunning && $('#c-pause-overlay').hidden && !this._tutorHolds()) {
                    s.runner.start();
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
    });

    LL.ConsoleUI = ConsoleUI;
    LL.Toast = Toast;
    LL.ShiftController = ShiftController;
})(globalThis.LL = globalThis.LL || {});
