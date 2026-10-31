/**
 * LifeLine - Dialogo con il chiamante
 *
 * Ogni domanda costa tempo: mentre l'operatore parla e il chiamante risponde
 * non si può fare altro con quella chiamata. La risposta arriva dopo cost_s secondi
 * e dipende dal panico in quel momento: sopra la soglia di errore il chiamante può
 * dare un'informazione sbagliata. Le domande si possono ripetere per verificare:
 * se le risposte non coincidono, la scheda segnala la discordanza.
 *
 * Il silenzio prolungato dell'operatore fa salire il panico.
 *
 * Dalla 1.2.0 (tutto facoltativo, nessuna estrazione in più per i modelli che non lo usano):
 * testi a elenco e terzo livello "hyst", risposte diverse alle domande ripetute,
 * cronologia del chiamante (frasi spontanee a tempo), frasi nel silenzio e
 * cambio di interlocutore (vicino, adulto, interprete). Vedi docs/template_format.md.
 */
(function (LL) {
    'use strict';

    const PANIC_REPLY = 60;          // da qui in su risponde "nel panico"
    const PANIC_HYST = 85;           // da qui in su "isterico" (testi hyst, se ci sono)
    const SILENCE_GRACE_MS = 8000;   // silenzio tollerato
    const SILENCE_PANIC_PER_SEC = 0.6;
    const IDLE_LINE_MS = 12000;      // silenzio dopo cui il chiamante dice una frase di attesa
    const SWITCH_DELAY_MS = 2000;    // pausa tra "gliela passo" e la voce della nuova persona

    const clamp = (v) => Math.max(0, Math.min(100, v));

    function initCall(c) {
        c.dialog = {
            transcript: [],   // { who: 'op'|'caller', text, ms, nodeId?, error?, interrupted?, speaker? }
            asked: {},        // nodeId -> numero di risposte ricevute
            pending: null,    // { nodeId, doneAt (activeMs), startAt }
            lastSpeechAt: 0,  // activeMs dell'ultima frase
            version: 0,       // cambia a ogni aggiornamento (per l'interfaccia)
            flags: {},        // condizioni attivate (es. interprete in linea)
            fired: [],        // voci della cronologia già dette (id, in ordine)
            speaker: null,    // interlocutore dopo un cambio: { key, name, gender, voice, reliability }
            deferred: [],     // frasi in arrivo: { atMs, text, nodeId, lvl }
            idle: 0,          // frasi di attesa già dette
            idleAt: null,     // activeMs dell'ultima frase di attesa
        };
        c.facts = {};         // key -> { reports: [{ display, correct, ms, nodeId }] }
        // richiamata: la cronologia riparte da dove era arrivata, con le condizioni che aveva attivato
        const tf = c.content && c.content.timelineFired;
        if (tf && tf.length) {
            c.dialog.fired = tf.slice();
            for (const t of c.content.timeline || []) if (tf.includes(t.id) && t.setsFlag) c.dialog.flags[t.setsFlag] = true;
        }
    }

    function speakerTag(s) { return { name: s.name, gender: s.gender, voice: s.voice }; }

    /** Aggiunge una frase alla trascrizione. keepSilence: non interrompe il conteggio del silenzio. */
    function push(c, entry, gameMs, keepSilence) {
        const d = c.dialog;
        const e = Object.assign({ ms: gameMs }, entry);
        if (e.who === 'caller' && d.speaker && !e.speaker) e.speaker = speakerTag(d.speaker);
        d.transcript.push(e);
        if (!keepSilence) d.lastSpeechAt = c.activeMs;
        d.version++;
        return e;
    }

    function level(c) {
        if (c.panic >= PANIC_HYST) return 'hyst';
        return c.panic >= PANIC_REPLY ? 'panic' : 'calm';
    }

    const ORDER = { calm: ['calm', 'panic'], panic: ['panic', 'calm'], hyst: ['hyst', 'panic', 'calm'] };

    function textOf(v, n) {
        if (Array.isArray(v)) return v.length ? v[n % v.length] : null;
        return v || null;
    }

    /**
     * Testo per il livello di panico, scendendo hyst -> panic -> calm (calm -> panic).
     * Un elenco restituisce l'elemento n, modulo la lunghezza.
     */
    function pickText(pair, lvl, n = 0) {
        if (!pair) return '…';
        if (typeof pair === 'string') return pair;
        for (const k of ORDER[lvl] || ORDER.calm) {
            const t = textOf(pair[k], n);
            if (t) return t;
        }
        return '…';
    }

    /** Indice stabile per le aperture a elenco: dipende dal telefono, nessuna estrazione. */
    function openingIndex(c) {
        return LL.hashString(String(c.content.caller.phone || ''));
    }

    /** Il nodo è disponibile (prerequisiti soddisfatti)? */
    function isUnlocked(c, node) {
        const f = c.dialog.flags;
        if (node.requiresFlag && !f[node.requiresFlag]) return false;
        if (node.hiddenIfFlag && f[node.hiddenIfFlag]) return false;
        return node.requires.every((id) => (c.dialog.asked[id] || 0) > 0);
    }

    /**
     * Il nodo può dare una risposta sbagliata in questo momento? No se la condizione di
     * error.unless_flag è attiva, né quando vale la risposta legata a una condizione (reply_flag).
     */
    function errorPossible(c, node) {
        const f = c.dialog.flags;
        return !!node.error && !(node.error.unless_flag && f[node.error.unless_flag]) && !(node.replyFlag && f[node.replyFlag.flag]);
    }

    /**
     * Testo di una risposta corretta. Alla domanda ripetuta: "repeat" se c'è, altrimenti
     * (nel panico) il prefisso "Gliel'ho già detto!". Mai sui nodi che possono sbagliare:
     * l'assenza del prefisso tradirebbe la risposta sbagliata.
     */
    function replyText(c, node, lvl, count, useFlagReply) {
        if (useFlagReply) return pickText(node.replyFlag, lvl, count);
        if (count > 0 && node.repeat) return pickText(node.repeat, lvl, count - 1);
        const text = pickText(node.reply, lvl, count);
        const prefix = (c.content.lines || {}).repeat_panic;
        // solo sulle domande: rassicurare di nuovo non è chiedere di nuovo
        if (count > 0 && lvl !== 'calm' && prefix && node.type !== 'reassure' && !errorPossible(c, node)) {
            return `${pickText({ calm: prefix }, 'calm', count - 1)} ${text}`;
        }
        return text;
    }

    function addReport(c, key, report) {
        if (!c.facts[key]) c.facts[key] = { reports: [] };
        c.facts[key].reports.push(report);
    }

    function emitReply(engine, c, nodeId, entry, lvl, error) {
        engine.events.emit('dialog:reply', { call: c, nodeId, entry, lvl, speaker: entry.speaker || null, error: !!error });
    }

    /** Impronta canonica dello stato del dialogo: condizioni, cronologia, interlocutore, domande. */
    function fingerprintState(d) {
        if (!d) return '';
        const flags = Object.keys(d.flags || {}).filter((k) => d.flags[k]).sort().join(',');
        const asked = Object.keys(d.asked || {}).sort().map((k) => `${k}=${d.asked[k]}`).join(',');
        return `f:${flags};t:${(d.fired || []).join(',')};s:${d.speaker ? d.speaker.key : ''};a:${asked}`;
    }

    const Dialog = {
        SILENCE_GRACE_MS,
        PANIC_REPLY,
        PANIC_HYST,
        initCall,
        pickText,
        level,
        fingerprintState,

        /**
         * Frase del chiamante fuori dal ciclo domanda/risposta (es. peggioramento).
         * text: stringa oppure testo { calm, panic, hyst } scelto con il panico attuale.
         * meta: { ms (tempo di gioco), nodeId, who, ... } copiati nella trascrizione.
         * Restituisce la voce della trascrizione.
         */
        say(c, text, meta = {}) {
            const m = Object.assign({}, meta);
            const t = c.dialog.transcript;
            const ms = typeof m.ms === 'number' ? m.ms : (t.length ? t[t.length - 1].ms : 0);
            delete m.ms;
            const str = typeof text === 'string' ? text : pickText(text, level(c), 0);
            return push(c, Object.assign({ who: 'caller' }, m, { text: str }), ms);
        },

        /** Prima risposta dell'operatore: il chiamante pronuncia l'apertura. */
        onAnswer(engine, c) {
            if (c.dialog.transcript.length === 0) {
                push(c, { who: 'caller', text: pickText(c.content.opening, level(c), openingIndex(c)) }, engine.gameMs);
            }
        },

        onResume(engine, c) {
            if (c.holdMs >= 5000) {
                const lines = c.content.lines || {};
                const text = level(c) !== 'calm' ? lines.resume_panic : lines.resume_calm;
                if (text) push(c, { who: 'caller', text }, engine.gameMs);
            }
            c.dialog.lastSpeechAt = c.activeMs;
        },

        /** Interrompe la domanda in corso (attesa, chiusura). */
        cancelPending(c) {
            const p = c.dialog.pending;
            if (!p) return;
            const last = [...c.dialog.transcript].reverse().find((t) => t.who === 'op' && t.nodeId === p.nodeId);
            if (last) last.interrupted = true;
            c.dialog.pending = null;
            c.dialog.version++;
        },

        /** Azione "ask": restituisce false se non è possibile. */
        ask(engine, c, nodeId) {
            const node = c.content.nodesById[nodeId];
            if (!node || c.dialog.pending || !isUnlocked(c, node)) return false;
            push(c, { who: 'op', text: node.label, nodeId }, engine.gameMs);
            c.dialog.pending = { nodeId, startAt: c.activeMs, doneAt: c.activeMs + node.costSec * 1000 };
            engine.events.emit('dialog:ask', { call: c, nodeId, costSec: node.costSec });
            return true;
        },

        /** Aggiornamento a ogni tick mentre la chiamata è in linea. */
        update(engine, c, dt) {
            const d = c.dialog;
            if (d.pending && c.activeMs >= d.pending.doneAt) {
                this._resolve(engine, c);
                return;
            }
            // Novità 1.2.0: senza i campi nuovi nessuno di questi rami viene eseguito
            if (d.deferred.length) this._flushDeferred(engine, c);
            if (c.content.timeline && this._timeline(engine, c)) return;
            if (d.pending) return;
            if (c.content.idleLines) this._idle(engine, c);
            if (c.activeMs - d.lastSpeechAt > SILENCE_GRACE_MS) {
                c.panic = clamp(c.panic + SILENCE_PANIC_PER_SEC * dt);
            }
        },

        _resolve(engine, c) {
            const d = c.dialog;
            const node = c.content.nodesById[d.pending.nodeId];
            const count = d.asked[node.id] || 0;
            d.pending = null;

            // Le rassicurazioni ripetute perdono efficacia (metà ogni volta)
            const delta = node.type === 'reassure' ? node.panicDelta * Math.pow(0.5, count) : node.panicDelta;
            c.panic = clamp(c.panic + delta);
            const lvl = level(c);

            // Errore del chiamante: nel panico (sopra soglia) o per scarsa affidabilità
            let isError = false;
            const flags = d.flags;
            if (errorPossible(c, node)) {
                const threshold = typeof node.error.threshold === 'number' ? node.error.threshold : 60;
                const p = c.panic >= threshold
                    ? (typeof node.error.chance === 'number' ? node.error.chance : 0.5)
                    : 1 - (d.speaker || c.content.caller).reliability;
                if (p > 0) isError = engine.dialogRng(c).chance(p);
            }

            const useFlagReply = node.replyFlag && flags[node.replyFlag.flag];
            const text = isError ? pickText(node.error.reply, lvl, count) : replyText(c, node, lvl, count, useFlagReply);
            const entry = push(c, { who: 'caller', text, nodeId: node.id, error: isError }, engine.gameMs);

            for (const key of node.reveals) {
                const wrong = isError && node.error.fact === key;
                const def = c.content.facts[key] || {};
                const display = wrong ? node.error.display : def.display;
                addReport(c, key, { display, correct: !wrong, ms: engine.gameMs, nodeId: node.id });
            }
            // un errore su un fatto non elencato in reveals (es. risposta sbagliata a sorpresa)
            if (isError && node.error.fact && !node.reveals.includes(node.error.fact)) {
                addReport(c, node.error.fact, { display: node.error.display, correct: false, ms: engine.gameMs, nodeId: node.id });
            }

            if (node.setsFlag) flags[node.setsFlag] = true;
            d.asked[node.id] = count + 1;
            d.version++;
            emitReply(engine, c, node.id, entry, lvl, isError);

            if (node.endsCall) {
                engine.endByCaller(c);
                return;
            }
            if (node.switchCaller) this._switch(c, node);
        },

        /** Il telefono passa a un'altra persona: panico e affidabilità sono i suoi. */
        _switch(c, node) {
            const sw = node.switchCaller;
            const d = c.dialog;
            if (d.speaker && d.speaker.key === sw.key) return;
            d.speaker = { key: sw.key, name: sw.name, gender: sw.gender, voice: sw.voice, reliability: sw.reliability };
            c.panic = clamp(sw.panicStart);
            if (sw.opening) {
                d.deferred.push({ atMs: c.activeMs + SWITCH_DELAY_MS, pair: sw.opening, nodeId: 'sw:' + sw.key });
            }
            d.version++;
        },

        /** Frasi rimandate (apertura della nuova persona): arrivano anche durante una domanda. */
        _flushDeferred(engine, c) {
            const d = c.dialog;
            while (d.deferred.length && c.activeMs >= d.deferred[0].atMs) {
                const item = d.deferred.shift();
                const lvl = level(c);
                const entry = push(c, { who: 'caller', text: pickText(item.pair, lvl, 0), nodeId: item.nodeId }, engine.gameMs);
                emitReply(engine, c, item.nodeId, entry, lvl, false);
            }
        },

        /** Cronologia: al massimo una voce per tick. Restituisce true se la chiamata è finita. */
        _timeline(engine, c) {
            const d = c.dialog;
            const f = d.flags;
            for (const t of c.content.timeline) {
                if (c.activeMs < t.atMs || d.fired.includes(t.id)) continue;
                if (t.ifFlag && !f[t.ifFlag]) continue;
                if (t.unlessFlag && f[t.unlessFlag]) continue;
                if (t.unlessAsked.some((id) => (d.asked[id] || 0) > 0)) continue;
                if (d.pending) {
                    if (!t.interrupt) continue;
                    this.cancelPending(c);
                }
                d.fired.push(t.id);
                if (t.panicDelta) c.panic = clamp(c.panic + t.panicDelta);
                const lvl = level(c);
                const nodeId = 'tl:' + t.id;
                const entry = push(c, { who: 'caller', text: pickText(t.say, lvl, 0), nodeId }, engine.gameMs);
                for (const key of t.reveals) {
                    addReport(c, key, { display: (c.content.facts[key] || {}).display, correct: true, ms: engine.gameMs, nodeId });
                }
                if (t.setsFlag) f[t.setsFlag] = true;
                emitReply(engine, c, nodeId, entry, lvl, false);
                if (t.endsCall) {
                    engine.endByCaller(c);
                    return true;
                }
                return false;
            }
            return false;
        },

        /** Frasi nel silenzio: a turno, ogni IDLE_LINE_MS. Il panico continua a salire. */
        _idle(engine, c) {
            const d = c.dialog;
            const since = d.idleAt === null ? d.lastSpeechAt : Math.max(d.lastSpeechAt, d.idleAt);
            if (c.activeMs - since <= IDLE_LINE_MS) return;
            const lvl = level(c);
            const entry = push(c, { who: 'caller', text: pickText(c.content.idleLines, lvl, d.idle), nodeId: 'idle' }, engine.gameMs, true);
            d.idle++;
            d.idleAt = c.activeMs;
            emitReply(engine, c, 'idle', entry, lvl, false);
        },

        /** Stato delle domande per l'interfaccia. */
        options(c) {
            return c.content.nodes
                .filter((n) => isUnlocked(c, n))
                .map((n) => ({
                    id: n.id,
                    label: n.label,
                    type: n.type,
                    costSec: n.costSec,
                    asked: c.dialog.asked[n.id] || 0,
                    pending: c.dialog.pending?.nodeId === n.id,
                }));
        },

        /** Informazioni raccolte, con segnalazione delle risposte discordanti. */
        collected(c) {
            return Object.entries(c.facts).map(([key, f]) => {
                const displays = [...new Set(f.reports.map((r) => r.display))];
                return {
                    key,
                    label: c.content.facts[key]?.label || null,
                    display: f.reports[f.reports.length - 1].display,
                    conflict: displays.length > 1,
                    variants: displays,
                };
            });
        },

        progress(c) {
            const p = c.dialog.pending;
            if (!p) return null;
            return Math.min(1, (c.activeMs - p.startAt) / (p.doneAt - p.startAt));
        },
    };

    LL.Dialog = Dialog;
})(globalThis.LL = globalThis.LL || {});
