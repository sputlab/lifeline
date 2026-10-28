/**
 * LifeLine - Chiamata e suoi stati
 *
 *   IN CODA  --(linea libera)-->  SQUILLA  --(risposta)-->  ATTIVA  <--> IN ATTESA
 *      |                             |                         |            |
 *      +------> ABBANDONATA <--------+                         |            +--> ABBANDONATA
 *                                                              +--> TRASFERITA / CHIUSA / ACCORPATA / CADUTA
 */
(function (LL) {
    'use strict';

    const CallState = Object.freeze({
        QUEUED:      'queued',       // tutte le linee occupate: in coda al centralino
        RINGING:     'ringing',      // su una linea, squilla
        ACTIVE:      'active',       // in conversazione con l'operatore
        ON_HOLD:     'on_hold',      // messa in attesa
        TRANSFERRED: 'transferred',  // trasferita al PSAP di secondo livello
        CLOSED:      'closed',       // chiusa (impropria, scherzo, informazione)
        MERGED:      'merged',       // accorpata a un evento già in corso
        ABANDONED:   'abandoned',    // il chiamante ha riattaccato
        DROPPED:     'dropped',      // linea caduta
    });

    const FINAL = new Set([
        CallState.TRANSFERRED, CallState.CLOSED, CallState.MERGED,
        CallState.ABANDONED, CallState.DROPPED,
    ]);

    const WAITING = new Set([CallState.QUEUED, CallState.RINGING]);

    class Call {
        /**
         * @param {object} p
         * @param {number} p.id
         * @param {number} p.arrivalMs   tempo di gioco (ms dall'inizio turno)
         * @param {object} p.content     contenuto della chiamata (chiamante, apertura, verità...)
         * @param {number|null} p.parentId  chiamata originale, se è una richiamata
         */
        constructor({ id, arrivalMs, content, parentId = null }) {
            const c = content.caller;
            this.id = id;
            this.arrivalMs = arrivalMs;
            this.content = content;
            this.parentId = parentId;

            this.state = null;
            this.line = null;

            this.ringLeft = c.ringPatienceSec;   // pazienza prima della risposta (s)
            this.holdLeft = c.holdPatienceSec;   // pazienza totale in attesa (s)
            this.panic = c.panicStart;           // 0..100

            this.waitMs = 0;        // coda + squillo prima della risposta
            this.activeMs = 0;      // tempo in conversazione
            this.holdMs = 0;        // attesa corrente
            this.totalHoldMs = 0;   // attesa complessiva
            this.holdCount = 0;

            this.answeredMs = null;
            this.closedMs = null;
            this.result = null;     // dettagli dell'esito (enti, motivo, ...)
            this.history = [];
        }

        setState(to, gameMs) {
            const from = this.state;
            if (from === to) return from;
            this.state = to;
            this.history.push({ ms: gameMs, from, to });
            if (to === CallState.ON_HOLD) {
                this.holdMs = 0;
                this.holdCount++;
            }
            return from;
        }

        isFinal() { return FINAL.has(this.state); }
        isWaiting() { return WAITING.has(this.state); }

        /** Pazienza residua come frazione 0..1 dello stato corrente. */
        patienceRatio() {
            const c = this.content.caller;
            if (this.isWaiting()) return Math.max(0, this.ringLeft / c.ringPatienceSec);
            if (this.state === CallState.ON_HOLD) return Math.max(0, this.holdLeft / c.holdPatienceSec);
            return 1;
        }

        panicLevel() {
            if (this.panic < 35) return 'calm';
            if (this.panic < 70) return 'agitated';
            return 'panic';
        }
    }

    LL.CallState = CallState;
    LL.Call = Call;
})(globalThis.LL = globalThis.LL || {});
