/**
 * LifeLine - Motore di gioco
 *
 * Simulazione deterministica a tick fissi, senza dipendenze dal DOM.
 * Le azioni del giocatore entrano con dispatch() e vengono applicate all'inizio
 * del tick successivo; ogni azione valida viene registrata con il suo numero di tick.
 * Con lo stesso seed e lo stesso registro azioni, il turno si riproduce identico
 * (base per la validazione lato server e per il replay).
 */
(function (LL) {
    'use strict';

    const S = LL.CallState;
    const AGENCIES = ['118', '115', 'PS', 'CC'];
    const HAZARDS = ['fuoco', 'gas', 'carburante', 'armi', 'traffico', 'elettricita'];
    const CLOSE_REASONS = ['informazioni', 'scherzo', 'errore', 'chiamata_muta'];

    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

    /** Scheda contatto: tiene solo campi validi, con limiti di lunghezza. */
    function sanitizeForm(f) {
        const out = {};
        if (!f || typeof f !== 'object') return out;
        const loc = f.location;
        if (loc && num(loc.x) !== null && num(loc.y) !== null) {
            out.location = {
                x: Math.round(loc.x * 10) / 10,
                y: Math.round(loc.y * 10) / 10,
                street: typeof loc.street === 'string' ? loc.street.slice(0, 80) : '',
                number: Number.isInteger(loc.number) && loc.number > 0 && loc.number < 10000 ? loc.number : null,
                zone: typeof loc.zone === 'string' ? loc.zone.slice(0, 20) : '',
            };
        }
        if (typeof f.eventType === 'string' && /^[a-z_]+\.[a-z_]+$/.test(f.eventType)) out.eventType = f.eventType;
        if (Number.isInteger(f.persons) && f.persons >= 0 && f.persons <= 99) out.persons = f.persons;
        if (Array.isArray(f.hazards)) out.hazards = HAZARDS.filter((h) => f.hazards.includes(h));
        if (typeof f.notes === 'string' && f.notes.trim()) out.notes = f.notes.trim().slice(0, 300);
        return out;
    }

    const DEFAULTS = {
        tickMs: 100,
        lines: 4,
        ringPanicPerSec: 0.2,     // il panico sale mentre il telefono squilla
        holdPanicPerSec: 0.5,     // e sale di più in attesa
        callbackDelaySec: [30, 150],
        callbackPanicBoost: 15,
    };

    class Engine {
        /**
         * @param {object} o
         * @param {number} o.seed
         * @param {number} o.gameStartSec  secondi dalla mezzanotte (es. 79200 = 22:00)
         * @param {number} o.durationSec   durata del turno in tempo di gioco
         * @param {object} o.scheduler     pianificatore degli arrivi
         * @param {object} [o.rules]       sovrascrive i DEFAULTS
         */
        constructor(o) {
            this.cfg = Object.assign({}, DEFAULTS, o.rules || {});
            this.seed = o.seed >>> 0;
            this.gameStartSec = o.gameStartSec;
            this.durationMs = o.durationSec * 1000;

            this.rng = new LL.RNG(this.seed);
            this.callbackRng = this.rng.fork('callbacks');
            this._dialogRngs = new Map();
            this._incidentTags = new Map();
            this.events = new LL.Emitter();
            this.board = new LL.LineBoard(this.cfg.lines);

            this.calls = new Map();
            this.nextId = 1;
            this.activeId = null;

            this.tick = 0;
            this.gameMs = 0;
            this.pending = [];
            this.log = [];

            this.arrivalsOpen = true;
            this.ended = false;

            this.scheduler = o.scheduler;
            this.scheduler.init(this);
        }

        /* ---------------- Lettura stato ---------------- */

        get clockSec() { return this.gameStartSec + this.gameMs / 1000; }
        get progress() { return Math.min(1, this.gameMs / this.durationMs); }

        getCall(id) { return this.calls.get(id) || null; }
        activeCall() { return this.activeId !== null ? this.calls.get(this.activeId) : null; }
        lineCall(index) {
            const id = this.board.lines[index];
            return id !== null ? this.calls.get(id) : null;
        }

        /** C'è qualcosa che richiede il tempo reale? */
        isBusy() { return this.board.occupied() > 0 || this.board.overflow.length > 0; }

        /* ---------------- Azioni del giocatore ---------------- */

        dispatch(type, payload = {}) {
            if (!this.ended) this.pending.push({ type, payload });
        }

        /** Evento non di gioco (pausa, ecc.): solo registrato, non cambia la simulazione. */
        logMeta(type, payload = {}) {
            this.log.push({ tick: this.tick, type, payload, meta: true });
        }

        /* ---------------- Simulazione ---------------- */

        step() {
            if (this.ended) return;

            // 1. azioni del giocatore
            const actions = this.pending;
            this.pending = [];
            for (const a of actions) {
                if (this._apply(a)) {
                    this.log.push({ tick: this.tick, type: a.type, payload: a.payload });
                } else {
                    this.events.emit('action:rejected', a);
                }
            }

            // 2. nuovi arrivi
            if (this.arrivalsOpen) {
                for (const item of this.scheduler.due(this.gameMs)) this._arrive(item);
            }

            // 3. aggiornamento chiamate aperte
            const dt = this.cfg.tickMs / 1000;
            for (const c of this.calls.values()) {
                if (!c.isFinal()) this._update(c, dt);
            }

            // 4. linee liberate -> chiamate in coda
            this._fillLines();

            // 5. avanzamento del tempo e fine turno
            this.tick++;
            this.gameMs += this.cfg.tickMs;

            if (this.arrivalsOpen && this.gameMs >= this.durationMs) {
                this.arrivalsOpen = false;
                this.events.emit('shift:closing', {});
            }
            if (!this.arrivalsOpen && !this.isBusy()) this._end();
        }

        _apply({ type, payload }) {
            const c = payload && payload.callId !== undefined ? this.calls.get(payload.callId) : null;

            switch (type) {
                case 'answer':
                    if (!c || c.state !== S.RINGING) return false;
                    this._holdActive();
                    c.answeredMs = this.gameMs;
                    this._setState(c, S.ACTIVE);
                    this.activeId = c.id;
                    LL.Dialog.onAnswer(this, c);
                    return true;

                case 'hold':
                    if (!c || c.state !== S.ACTIVE) return false;
                    LL.Dialog.cancelPending(c);
                    this._setState(c, S.ON_HOLD);
                    this.activeId = null;
                    return true;

                case 'resume':
                    if (!c || c.state !== S.ON_HOLD) return false;
                    this._holdActive();
                    LL.Dialog.onResume(this, c);
                    this._setState(c, S.ACTIVE);
                    this.activeId = c.id;
                    return true;

                case 'ask':
                    if (!c || c.state !== S.ACTIVE || typeof payload.nodeId !== 'string') return false;
                    return LL.Dialog.ask(this, c, payload.nodeId);

                case 'transfer': {
                    if (!c || c.state !== S.ACTIVE) return false;
                    const list = Array.isArray(payload.agencies) ? payload.agencies : [];
                    const agencies = AGENCIES.filter((a) => list.includes(a));
                    if (agencies.length === 0) return false;
                    this._finalize(c, S.TRANSFERRED, { agencies, form: sanitizeForm(payload.form) });
                    return true;
                }

                case 'close': {
                    if (!c || (c.state !== S.ACTIVE && c.state !== S.ON_HOLD)) return false;
                    const reason = CLOSE_REASONS.includes(payload.reason) ? payload.reason : 'informazioni';
                    this._finalize(c, S.CLOSED, { reason, form: { eventType: `impropria.${reason}` } });
                    return true;
                }

                case 'merge': {
                    if (!c || c.state !== S.ACTIVE) return false;
                    const target = this.calls.get(payload.targetId);
                    if (!target || target.id === c.id || target.state !== S.TRANSFERRED) return false;
                    this._finalize(c, S.MERGED, { targetId: target.id, form: sanitizeForm(payload.form) });
                    return true;
                }

                case 'spawn':
                    // Chiamata guidata (addestramento): la crea il pianificatore, se lo prevede
                    if (!this.arrivalsOpen || typeof this.scheduler.spawn !== 'function') return false;
                    return this.scheduler.spawn(this, payload) === true;

                case 'end_shift':
                    // Chiusura anticipata: niente nuove chiamate, il turno finisce quando la sala è libera
                    if (!this.arrivalsOpen) return false;
                    this.arrivalsOpen = false;
                    this.events.emit('shift:closing', { early: true });
                    return true;

                default:
                    return false;
            }
        }

        _holdActive() {
            const a = this.activeCall();
            if (a && a.state === S.ACTIVE) {
                LL.Dialog.cancelPending(a);
                this._setState(a, S.ON_HOLD);
            }
            this.activeId = null;
        }

        _arrive(item) {
            const c = new LL.Call({
                id: this.nextId++,
                arrivalMs: this.gameMs,
                content: item.content,
                parentId: item.parentId ?? null,
            });
            // Evento di appartenenza: le richiamate e i duplicati condividono quello originale
            const parent = c.parentId !== null ? this.calls.get(c.parentId) : null;
            if (item.incidentTag && this._incidentTags.has(item.incidentTag)) {
                c.incidentKey = this._incidentTags.get(item.incidentTag);
            } else {
                c.incidentKey = item.incidentKey ?? (parent ? parent.incidentKey : c.id);
                if (item.incidentTag) this._incidentTags.set(item.incidentTag, c.incidentKey);
            }
            c.variantIndex = item.variantIndex ?? (parent ? parent.variantIndex : null);
            LL.Dialog.initCall(c);
            this.calls.set(c.id, c);
            const line = this.board.assign(c.id);
            if (line >= 0) {
                c.line = line;
                this._setState(c, S.RINGING);
            } else {
                this._setState(c, S.QUEUED);
            }
            this.events.emit('call:new', { call: c, line: c.line });
        }

        _update(c, dt) {
            const tick = this.cfg.tickMs;
            switch (c.state) {
                case S.QUEUED:
                case S.RINGING:
                    c.waitMs += tick;
                    c.ringLeft -= dt;
                    c.panic = Math.min(100, c.panic + this.cfg.ringPanicPerSec * dt);
                    if (c.ringLeft <= 0) this._abandon(c, c.state === S.QUEUED ? 'queue' : 'ring');
                    break;

                case S.ACTIVE:
                    c.activeMs += tick;
                    LL.Dialog.update(this, c, dt);
                    if (c.isFinal()) break;
                    if (c.content.dropAtActiveMs != null && c.activeMs >= c.content.dropAtActiveMs) {
                        this._finalize(c, S.DROPPED, {});
                    }
                    break;

                case S.ON_HOLD:
                    c.holdMs += tick;
                    c.totalHoldMs += tick;
                    c.holdLeft -= dt;
                    c.panic = Math.min(100, c.panic + this.cfg.holdPanicPerSec * dt);
                    if (c.holdLeft <= 0) this._abandon(c, 'hold');
                    break;
            }
        }

        _abandon(c, where) {
            this._finalize(c, S.ABANDONED, { where });

            // Chi riattacca spesso richiama, più agitato e meno paziente
            const cb = c.content.caller.callbackChance || 0;
            if (this.arrivalsOpen && !c.content.isCallback && this.callbackRng.chance(cb)) {
                const [lo, hi] = this.cfg.callbackDelaySec;
                const delayMs = this.callbackRng.int(lo, hi) * 1000;
                const caller = Object.assign({}, c.content.caller, {
                    panicStart: Math.min(100, Math.round(c.panic + this.cfg.callbackPanicBoost)),
                    ringPatienceSec: Math.max(10, Math.round(c.content.caller.ringPatienceSec * 0.7)),
                    holdPatienceSec: Math.max(8, Math.round(c.content.caller.holdPatienceSec * 0.7)),
                });
                this.scheduler.addCallback({
                    atMs: this.gameMs + delayMs,
                    parentId: c.id,
                    content: Object.assign({}, c.content, { caller, isCallback: true }),
                });
            }
        }

        /** Il chiamante riattacca durante la conversazione (scherzo, linea che cade...). */
        endByCaller(c) {
            if (!c.isFinal()) this._finalize(c, S.DROPPED, { reason: 'caller_hangup' });
        }

        /** Flusso casuale del dialogo, indipendente per ogni chiamata. */
        dialogRng(c) {
            if (!this._dialogRngs.has(c.id)) this._dialogRngs.set(c.id, this.rng.fork('dlg:' + c.id));
            return this._dialogRngs.get(c.id);
        }

        _finalize(c, state, result) {
            LL.Dialog.cancelPending(c);
            const line = c.line;
            c.result = result;
            c.closedMs = this.gameMs;
            this._setState(c, state);
            if (line !== null) this.board.release(line);
            else this.board.removeQueued(c.id);
            c.line = null;
            if (this.activeId === c.id) this.activeId = null;
            this.events.emit('call:final', { call: c, line, result });
        }

        _fillLines() {
            let p;
            while ((p = this.board.promote())) {
                const c = this.calls.get(p.id);
                c.line = p.line;
                this._setState(c, S.RINGING);
                this.events.emit('call:ringing', { call: c, line: c.line });
            }
        }

        _setState(c, to) {
            const from = c.setState(to, this.gameMs);
            this.events.emit('call:state', { call: c, from, to, line: c.line });
        }

        _end() {
            this.ended = true;
            this.events.emit('shift:end', { summary: this.summary() });
        }

        /* ---------------- Riepilogo e verifica ---------------- */

        summary() {
            const count = {};
            Object.values(S).forEach((s) => { count[s] = 0; });
            let answered = 0;
            let answerSum = 0;
            let maxWait = 0;
            let questions = 0;
            for (const c of this.calls.values()) {
                questions += Object.values(c.dialog.asked).reduce((a, b) => a + b, 0);
                count[c.state] = (count[c.state] || 0) + 1;
                if (c.answeredMs !== null) {
                    answered++;
                    answerSum += c.answeredMs - c.arrivalMs;
                }
                maxWait = Math.max(maxWait, c.waitMs);
            }
            return {
                total: this.calls.size,
                byState: count,
                answered,
                avgAnswerSec: answered ? Math.round(answerSum / answered / 100) / 10 : 0,
                maxWaitSec: Math.round(maxWait / 100) / 10,
                questions,
                ticks: this.tick,
            };
        }

        /** Impronta dello stato: uguale se due simulazioni sono identiche. */
        fingerprint() {
            const parts = [];
            for (const c of this.calls.values()) {
                parts.push([c.id, c.state, c.arrivalMs, c.answeredMs, c.closedMs, c.waitMs,
                    c.totalHoldMs, Math.round(c.panic * 1000), c.content.code, c.parentId,
                    c.dialog.transcript.length, JSON.stringify(c.facts)].join(','));
            }
            return LL.hashString(parts.join('|') + '#' + this.tick).toString(16);
        }
    }

    Engine.AGENCIES = AGENCIES;
    Engine.HAZARDS = HAZARDS;
    Engine.CLOSE_REASONS = CLOSE_REASONS;
    Engine.sanitizeForm = sanitizeForm;
    LL.Engine = Engine;
})(globalThis.LL = globalThis.LL || {});
