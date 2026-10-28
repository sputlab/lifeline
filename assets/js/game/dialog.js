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
 */
(function (LL) {
    'use strict';

    const PANIC_REPLY = 60;          // da qui in su risponde "nel panico"
    const SILENCE_GRACE_MS = 8000;   // silenzio tollerato
    const SILENCE_PANIC_PER_SEC = 0.6;

    const clamp = (v) => Math.max(0, Math.min(100, v));

    function initCall(c) {
        c.dialog = {
            transcript: [],   // { who: 'op'|'caller', text, ms, nodeId?, error?, interrupted? }
            asked: {},        // nodeId -> numero di risposte ricevute
            pending: null,    // { nodeId, doneAt (activeMs), startAt }
            lastSpeechAt: 0,  // activeMs dell'ultima frase
            version: 0,       // cambia a ogni aggiornamento (per l'interfaccia)
            flags: {},        // condizioni attivate (es. interprete in linea)
        };
        c.facts = {};         // key -> { reports: [{ display, correct, ms, nodeId }] }
    }

    function say(c, entry, gameMs) {
        c.dialog.transcript.push(Object.assign({ ms: gameMs }, entry));
        c.dialog.lastSpeechAt = c.activeMs;
        c.dialog.version++;
    }

    function level(c) { return c.panic >= PANIC_REPLY ? 'panic' : 'calm'; }

    function pickText(pair, lvl) {
        if (!pair) return '…';
        return pair[lvl] || pair.calm || pair.panic || '…';
    }

    /** Il nodo è disponibile (prerequisiti soddisfatti)? */
    function isUnlocked(c, node) {
        const f = c.dialog.flags;
        if (node.requiresFlag && !f[node.requiresFlag]) return false;
        if (node.hiddenIfFlag && f[node.hiddenIfFlag]) return false;
        return node.requires.every((id) => (c.dialog.asked[id] || 0) > 0);
    }

    const Dialog = {
        initCall,

        /** Prima risposta dell'operatore: il chiamante pronuncia l'apertura. */
        onAnswer(engine, c) {
            if (c.dialog.transcript.length === 0) {
                say(c, { who: 'caller', text: pickText(c.content.opening, level(c)) }, engine.gameMs);
            }
        },

        onResume(engine, c) {
            if (c.holdMs >= 5000) {
                const lines = c.content.lines || {};
                const text = level(c) === 'panic' ? lines.resume_panic : lines.resume_calm;
                if (text) say(c, { who: 'caller', text }, engine.gameMs);
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
            say(c, { who: 'op', text: node.label, nodeId }, engine.gameMs);
            c.dialog.pending = { nodeId, startAt: c.activeMs, doneAt: c.activeMs + node.costSec * 1000 };
            engine.events.emit('dialog:ask', { call: c, nodeId, costSec: node.costSec });
            return true;
        },

        /** Aggiornamento a ogni tick mentre la chiamata è in linea. */
        update(engine, c, dt) {
            const d = c.dialog;
            if (d.pending) {
                if (c.activeMs >= d.pending.doneAt) this._resolve(engine, c);
                return;
            }
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
            if (node.error && !(node.error.unless_flag && flags[node.error.unless_flag])) {
                const threshold = typeof node.error.threshold === 'number' ? node.error.threshold : 60;
                const p = c.panic >= threshold
                    ? (typeof node.error.chance === 'number' ? node.error.chance : 0.5)
                    : 1 - c.content.caller.reliability;
                if (p > 0) isError = engine.dialogRng(c).chance(p);
            }

            const useFlagReply = node.replyFlag && flags[node.replyFlag.flag];
            const text = isError ? pickText(node.error.reply, lvl) : pickText(useFlagReply ? node.replyFlag : node.reply, lvl);
            say(c, { who: 'caller', text, nodeId: node.id, error: isError }, engine.gameMs);

            for (const key of node.reveals) {
                const wrong = isError && node.error.fact === key;
                const def = c.content.facts[key] || {};
                const display = wrong ? node.error.display : def.display;
                if (!c.facts[key]) c.facts[key] = { reports: [] };
                c.facts[key].reports.push({ display, correct: !wrong, ms: engine.gameMs, nodeId: node.id });
            }
            // un errore su un fatto non elencato in reveals (es. risposta sbagliata a sorpresa)
            if (isError && node.error.fact && !node.reveals.includes(node.error.fact)) {
                const key = node.error.fact;
                if (!c.facts[key]) c.facts[key] = { reports: [] };
                c.facts[key].reports.push({ display: node.error.display, correct: false, ms: engine.gameMs, nodeId: node.id });
            }

            if (node.setsFlag) flags[node.setsFlag] = true;
            d.asked[node.id] = count + 1;
            d.version++;
            engine.events.emit('dialog:reply', { call: c, nodeId: node.id, error: isError });

            if (node.endsCall) engine.endByCaller(c);
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
