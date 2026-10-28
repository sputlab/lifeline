/**
 * LifeLine - Bus eventi minimale
 */
(function (LL) {
    'use strict';

    class Emitter {
        constructor() { this._h = new Map(); }

        on(type, fn) {
            if (!this._h.has(type)) this._h.set(type, new Set());
            this._h.get(type).add(fn);
            return () => this._h.get(type)?.delete(fn);
        }

        emit(type, payload) {
            this._h.get(type)?.forEach((fn) => fn(payload, type));
            this._h.get('*')?.forEach((fn) => fn(payload, type));
        }

        clear() { this._h.clear(); }
    }

    LL.Emitter = Emitter;
})(globalThis.LL = globalThis.LL || {});
