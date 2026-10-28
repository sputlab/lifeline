/**
 * LifeLine - Linee telefoniche e coda del centralino
 */
(function (LL) {
    'use strict';

    class LineBoard {
        constructor(count) {
            this.lines = new Array(count).fill(null); // id chiamata o null
            this.overflow = [];                       // id in coda (FIFO)
        }

        freeIndex() { return this.lines.indexOf(null); }

        /** Assegna una linea; se sono tutte occupate mette in coda e restituisce -1. */
        assign(callId) {
            const i = this.freeIndex();
            if (i >= 0) {
                this.lines[i] = callId;
                return i;
            }
            this.overflow.push(callId);
            return -1;
        }

        release(index) {
            if (index !== null && index >= 0) this.lines[index] = null;
        }

        removeQueued(callId) {
            const k = this.overflow.indexOf(callId);
            if (k >= 0) this.overflow.splice(k, 1);
        }

        /** Sposta la prima chiamata in coda su una linea libera. */
        promote() {
            const i = this.freeIndex();
            if (i < 0 || this.overflow.length === 0) return null;
            const id = this.overflow.shift();
            this.lines[i] = id;
            return { id, line: i };
        }

        occupied() { return this.lines.reduce((n, id) => n + (id !== null ? 1 : 0), 0); }
    }

    LL.LineBoard = LineBoard;
})(globalThis.LL = globalThis.LL || {});
