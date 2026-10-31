/**
 * LifeLine - Motore di gioco
 *
 * Simulazione deterministica a tick fissi, senza dipendenze dal DOM.
 * Le azioni del giocatore entrano con dispatch() e vengono applicate all'inizio
 * del tick successivo; ogni azione valida viene registrata con il suo numero di tick.
 * Con lo stesso seed e lo stesso registro azioni, il turno si riproduce identico
 * (base per la validazione lato server e per il replay).
 *
 * Regole del turno (rules): oltre ai parametri numerici, una versione e alcune meccaniche
 * attivabili. Senza regole (versione 1, tutto spento) il comportamento è quello della 1.1.0;
 * il server salva le regole di ogni turno (lifeline_shifts.rules_json) per poterlo rigiocare.
 */
(function (LL) {
    'use strict';

    const S = LL.CallState;
    const AGENCIES = ['118', '115', 'PS', 'CC'];
    const HAZARDS = ['fuoco', 'gas', 'carburante', 'armi', 'traffico', 'elettricita'];
    const CLOSE_REASONS = ['informazioni', 'scherzo', 'errore', 'chiamata_muta'];

    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const clampPanic = (v) => Math.max(0, Math.min(100, v));
    const PANIC_LINE = 60;   // come in dialog.js: da qui in su la frase "nel panico"
    const HYST_LINE = 85;

    /**
     * Fasi di peggioramento di un evento (campo "deterioration" del modello), normalizzate
     * e ordinate per tempo. Memorizzate per array: le richiamate e i testimoni condividono
     * lo stesso array del contenuto originale.
     */
    const stagesCache = new WeakMap();
    function deteriorationStages(content) {
        const raw = content && content.deterioration;
        if (!Array.isArray(raw) || raw.length === 0) return [];
        if (stagesCache.has(raw)) return stagesCache.get(raw);
        const stages = raw
            .filter((st) => st && typeof st === 'object')
            .map((st) => {
                const after = num(st.after_s) ?? num(st.afterSec) ?? 0;
                const flag = [st.sets_flag, st.setsFlag, st.set_flag, st.flag].find((f) => typeof f === 'string' && f) || null;
                return {
                    afterMs: Math.max(0, Math.round(after * 1000)),
                    flag,
                    panic: num(st.panic) ?? num(st.panic_delta) ?? 0,
                    line: st.line ?? null,
                };
            })
            .sort((a, b) => a.afterMs - b.afterMs);
        stagesCache.set(raw, stages);
        return stages;
    }

    /** Testo di una frase secondo il panico: stringa, { calm, panic, hyst } o elenco (primo elemento). */
    function lineText(line, panic) {
        if (typeof line === 'string') return line || null;
        if (Array.isArray(line)) return lineText(line[0], panic);
        if (!line || typeof line !== 'object') return null;
        const order = panic >= HYST_LINE ? ['hyst', 'panic', 'calm']
            : panic >= PANIC_LINE ? ['panic', 'calm'] : ['calm', 'panic'];
        for (const k of order) {
            const t = Array.isArray(line[k]) ? line[k][0] : line[k];
            if (typeof t === 'string' && t) return t;
        }
        return null;
    }

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
        version: 1,               // versione delle regole: 1 = comportamento della 1.1.0
        deterioration: false,     // gli eventi gravi peggiorano col passare del tempo
        redial: false,            // riservata (richiamata da parte dell'operatore, non ancora attiva)
    };

    class Engine {
        /**
         * @param {object} o
         * @param {number} o.seed
         * @param {number} o.gameStartSec  secondi dalla mezzanotte (es. 79200 = 22:00)
         * @param {number} o.durationSec   durata del turno in tempo di gioco
         * @param {object} o.scheduler     pianificatore degli arrivi
         * @param {object} [o.rules]       sovrascrive i DEFAULTS (anche version, deterioration, redial)
         */
        constructor(o) {
            this.cfg = Object.assign({}, DEFAULTS, o.rules || {});
            const v = Number(this.cfg.version);
            this.rules = Object.freeze({
                version: Number.isInteger(v) && v >= 1 ? v : 1,
                deterioration: this.cfg.deterioration === true,
                redial: this.cfg.redial === true,
            });
            this.seed = o.seed >>> 0;
            this.gameStartSec = o.gameStartSec;
            this.durationMs = o.durationSec * 1000;

            this.rng = new LL.RNG(this.seed);
            this.callbackRng = this.rng.fork('callbacks');
            this._dialogRngs = new Map();
            this._incidentTags = new Map();
            this._incidentFirstMs = new Map();   // evento -> arrivo della prima chiamata
            this._incidentHelpedMs = new Map();  // evento -> primo trasferimento (soccorsi partiti)
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

        /** Da quanto tempo (ms di gioco) è in corso l'evento della chiamata: dal primo arrivo. */
        incidentAgeMs(c) {
            const first = this._incidentFirstMs.get(c.incidentKey);
            return this.gameMs - (first !== undefined ? first : c.arrivalMs);
        }

        /**
         * Storico di un numero di telefono (sola lettura, nessun effetto sulla simulazione):
         * tutte le chiamate arrivate da quel numero, in ordine di arrivo, compresa quella corrente.
         */
        callsByPhone(phone) {
            const out = [];
            if (typeof phone !== 'string' || !phone) return out;
            for (const c of this.calls.values()) {
                if (c.content.caller.phone !== phone) continue;
                out.push({
                    id: c.id,
                    state: c.state,
                    arrivalMs: c.arrivalMs,
                    closedMs: c.closedMs,
                    agencies: c.result && Array.isArray(c.result.agencies) ? c.result.agencies.slice() : [],
                    incidentKey: c.incidentKey,
                    isCallback: c.parentId !== null,
                });
            }
            return out;
        }

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
                    this._flushDeterioration(c);
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
                    this._flushDeterioration(c);
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
            if (!this._incidentFirstMs.has(c.incidentKey)) this._incidentFirstMs.set(c.incidentKey, c.arrivalMs);
            LL.Dialog.initCall(c);
            if (this.rules.deterioration) this._deteriorationCatchUp(c);
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
            if (this.rules.deterioration && c.content.deterioration) this._deteriorate(c);
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
                    // le voci della cronologia già dette non si ripetono nella richiamata
                    content: Object.assign({}, c.content, {
                        caller, isCallback: true, opening: this._callbackOpening(c.content),
                        timelineFired: ((c.dialog && c.dialog.fired) || []).slice(),
                    }),
                });
            }
        }

        /**
         * Apertura di chi richiama: quella del modello (callbackOpening), altrimenti la frase
         * generica della città, altrimenti la stessa apertura. Solo testo: nessuna estrazione.
         */
        _callbackOpening(content) {
            if (content.callbackOpening) return content.callbackOpening;
            const lines = content.lines || {};
            const ok = (t) => (typeof t === 'string' && t !== '') || (Array.isArray(t) && t.length > 0);
            if (!ok(lines.callback_calm)) return content.opening;
            const vars = content.vars || {};
            const res = (t) => (Array.isArray(t) ? t.map(res) : LL.CallBuilder ? LL.CallBuilder.resolveString(String(t), vars) : t);
            const calm = res(lines.callback_calm);
            return { calm, panic: ok(lines.callback_panic) ? res(lines.callback_panic) : calm };
        }

        /* ---------------- Peggioramento degli eventi (rules.deterioration) ---------------- */

        /**
         * Fasi del modello raggiunte dall'età dell'evento: imposta la condizione, alza il panico
         * e fa dire la frase (subito se in linea, alla ripresa se in attesa, alla risposta se
         * ancora squilla). Si ferma quando l'evento è stato trasferito. Nessuna estrazione casuale.
         */
        _deteriorate(c) {
            const stages = deteriorationStages(c.content);
            if (c.deterStage >= stages.length || this._incidentHelpedMs.has(c.incidentKey)) return;
            const age = this.incidentAgeMs(c);
            while (c.deterStage < stages.length && age >= stages[c.deterStage].afterMs) {
                const stage = c.deterStage++;
                const st = stages[stage];
                if (st.flag) c.dialog.flags[st.flag] = true;
                if (st.panic) c.panic = clampPanic(c.panic + st.panic);
                const line = st.line !== null ? lineText(st.line, c.panic) : null;
                let queued = false;
                if (line) {
                    if (c.state === S.ACTIVE) this._sayDeterioration(c, stage, line);
                    else { c.deterQueue.push({ stage, line }); queued = true; }
                }
                c.dialog.version++;
                this.events.emit('call:deteriorated', { call: c, stage, line, queued });
            }
        }

        /**
         * Chiamata nuova di un evento già in corso (richiamata, testimone): la situazione è già
         * peggiorata. Solo le condizioni, senza panico né frasi (il chiamante parte già agitato).
         */
        _deteriorationCatchUp(c) {
            const stages = deteriorationStages(c.content);
            if (!stages.length) return;
            const helped = this._incidentHelpedMs.get(c.incidentKey);
            const age = (helped !== undefined ? Math.min(helped, this.gameMs) : this.gameMs) - this._incidentFirstMs.get(c.incidentKey);
            while (c.deterStage < stages.length && age >= stages[c.deterStage].afterMs) {
                const st = stages[c.deterStage++];
                if (st.flag) c.dialog.flags[st.flag] = true;
            }
        }

        /** Frasi di peggioramento rimaste in sospeso (chiamata in attesa o non ancora risposta). */
        _flushDeterioration(c) {
            if (c.deterQueue.length === 0) return;
            for (const q of c.deterQueue) this._sayDeterioration(c, q.stage, q.line);
            c.deterQueue = [];
        }

        _sayDeterioration(c, stage, text) {
            const meta = { who: 'caller', nodeId: 'det:' + stage, deterioration: stage, ms: this.gameMs };
            if (typeof LL.Dialog.say === 'function') {
                LL.Dialog.say(c, text, meta);
            } else {
                c.dialog.transcript.push(Object.assign({}, meta, { text }));
                c.dialog.lastSpeechAt = c.activeMs;
                c.dialog.version++;
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
            if (state === S.TRANSFERRED && !this._incidentHelpedMs.has(c.incidentKey)) {
                this._incidentHelpedMs.set(c.incidentKey, this.gameMs);
            }
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

        /**
         * Impronta dello stato: uguale se due simulazioni sono identiche.
         * Con regole di versione 1 il formato è quello della 1.1.0; dalla 2 include anche
         * lo stato del dialogo (condizioni) e la fase di peggioramento.
         */
        fingerprint() {
            const parts = [];
            const v2 = this.rules.version >= 2;
            for (const c of this.calls.values()) {
                const row = [c.id, c.state, c.arrivalMs, c.answeredMs, c.closedMs, c.waitMs,
                    c.totalHoldMs, Math.round(c.panic * 1000), c.content.code, c.parentId,
                    c.dialog.transcript.length, JSON.stringify(c.facts)];
                if (v2) {
                    const ds = typeof LL.Dialog.fingerprintState === 'function'
                        ? LL.Dialog.fingerprintState(c.dialog)
                        : Object.keys(c.dialog.flags).filter((k) => c.dialog.flags[k]).sort().join(';');
                    row.push(c.deterStage, ds);
                }
                parts.push(row.join(','));
            }
            return LL.hashString(parts.join('|') + '#' + this.tick).toString(16);
        }
    }

    Engine.AGENCIES = AGENCIES;
    Engine.HAZARDS = HAZARDS;
    Engine.CLOSE_REASONS = CLOSE_REASONS;
    Engine.sanitizeForm = sanitizeForm;
    Engine.deteriorationStages = deteriorationStages;
    LL.Engine = Engine;
})(globalThis.LL = globalThis.LL || {});
