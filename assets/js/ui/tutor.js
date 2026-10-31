/**
 * LifeLine - Tutor dell'addestramento
 *
 * Due tipi di passo:
 *   next  il turno è in pausa, il tutor spiega e si prosegue con "Avanti"
 *   wait  il turno scorre, il tutor aspetta che l'operatore faccia l'azione richiesta
 * Le chiamate compaiono con l'azione "spawn" del motore, registrata come ogni altra azione.
 */
(function (LL) {
    'use strict';

    const S = LL.CallState;
    const t = (k, v) => I18n.t(k, v);
    const $ = (sel, root = document) => root.querySelector(sel);

    /** Trova la chiamata arrivata per un evento guidato (per tag). */
    function findByTag(engine, tag) {
        const key = engine._incidentTags.get(tag);
        if (key === undefined) return null;
        return [...engine.calls.values()].filter((c) => c.incidentKey === key).pop() || null;
    }

    function steps() {
        return [
            { id: 'welcome', mode: 'next', target: '.cbar' },
            { id: 'lines', mode: 'next', target: '.lines' },
            { id: 'ring', mode: 'wait', target: '.lines__list',
              enter: (x) => x.spawn({ code: 'SAN_001', tag: 't1', require: '118+115' }),
              until: (x) => x.call('t1')?.state === S.ACTIVE },
            { id: 'dialog', mode: 'next', target: '.dlg__transcript' },
            { id: 'ask_address', mode: 'wait', target: '.dlg__options',
              until: (x) => !!x.call('t1')?.facts.indirizzo },
            { id: 'facts', mode: 'next', target: '.facts' },
            { id: 'place', mode: 'wait', target: '#f-body .fgroup:nth-of-type(1)',
              until: (x) => { const c = x.call('t1'); return !!(c && x.ui.form.draft(c).point); } },
            { id: 'map', mode: 'next', target: '.mapbox' },
            { id: 'ask_access', mode: 'wait', target: '.dlg__options',
              until: (x) => !!x.call('t1')?.facts.accesso },
            { id: 'event', mode: 'wait', target: '#f-body .fgroup:nth-of-type(2)',
              until: (x) => { const c = x.call('t1'); return !!(c && x.ui.form.draft(c).eventType); } },
            { id: 'agencies', mode: 'wait', target: '#f-agencies',
              until: (x) => { const c = x.call('t1'); if (!c) return false; const a = x.ui.form.draft(c).agencies; return a.includes('118') && a.includes('115'); } },
            { id: 'transfer', mode: 'wait', target: '.factions',
              until: (x) => x.call('t1')?.isFinal() },
            { id: 'prank', mode: 'wait', target: '.lines__list',
              enter: (x) => x.spawn({ code: 'IMP_004', tag: 't2', delaySec: 3 }),
              until: (x) => x.call('t2')?.state === S.ACTIVE },
            { id: 'prank_listen', mode: 'wait', target: '.dlg__options',
              until: (x) => { const c = x.call('t2'); return !!c && (Object.keys(c.facts).length >= 2 || c.isFinal()); } },
            { id: 'prank_close', mode: 'wait', target: '.fmore',
              enter: () => { const d = $('.fmore'); if (d) d.open = true; },
              until: (x) => x.call('t2')?.isFinal() },
            { id: 'fire', mode: 'wait', target: '.col-right',
              enter: (x) => x.spawn({ code: 'INC_002', tag: 't3', delaySec: 3 }),
              until: (x) => x.call('t3')?.isFinal() },
            { id: 'witness', mode: 'wait', target: '.fmore',
              enter: (x) => x.spawn({ code: 'INC_002', tag: 't4', witnessOf: 't3', delaySec: 3 }),
              until: (x) => { const c = x.witness(); return !!c && c.isFinal(); } },
            { id: 'hold', mode: 'next', target: '.operator__head' },
            { id: 'done', mode: 'next', target: null, last: true },
        ];
    }

    class Tutor {
        constructor({ engine, runner, ui, onFinish }) {
            this.engine = engine;
            this.runner = runner;
            this.ui = ui;
            this.onFinish = onFinish;
            this.steps = steps();
            this.i = -1;
            this.box = $('#tutor');
            this.textEl = $('#tutor-text');
            this.stepEl = $('#tutor-step');
            this.nextBtn = $('#tutor-next');
            this.ac = new AbortController();
            this.nextBtn.addEventListener('click', () => this._next(), { signal: this.ac.signal });

            const eng = engine;
            this.ctx = {
                ui,
                engine: eng,
                spawn: (p) => eng.dispatch('spawn', p),
                call: (tag) => findByTag(eng, tag),
                witness: () => [...eng.calls.values()].find((c) => c.content.isWitness) || null,
            };
            this.box.hidden = false;
            this._next();
        }

        _next() {
            const cur = this.steps[this.i];
            if (cur && cur.last) { this.finish(); return; }
            this.i++;
            this._enter(this.steps[this.i]);
        }

        _enter(step) {
            document.querySelectorAll('.tutor-focus').forEach((n) => n.classList.remove('tutor-focus'));
            this.stepEl.textContent = t('tutor.step', { n: this.i + 1, total: this.steps.length })
                + (step.mode === 'wait' ? `, ${t('tutor.waiting')}` : '');
            this.textEl.textContent = t(`tutor.${step.id}`);
            this.nextBtn.hidden = step.mode !== 'next';
            this.nextBtn.textContent = step.last ? t('tutor.finish') : t('tutor.next');
            this.box.dataset.mode = step.mode;
            if (step.enter) step.enter(this.ctx);
            if (step.mode === 'next') this.runner.pause();
            else this.runner.start();
            this._focusTarget(step);
            if (step.mode === 'next') this.nextBtn.focus({ preventScroll: true });
        }

        _focusTarget(step) {
            if (!step.target) return;
            // l'elemento può comparire dopo il primo disegno (es. pannello della chiamata)
            requestAnimationFrame(() => {
                const el = $(step.target);
                if (!el) return;
                el.classList.add('tutor-focus');
                el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
        }

        /** Chiamato a ogni frame: nei passi "wait" controlla se l'azione è stata fatta. */
        update() {
            const step = this.steps[this.i];
            if (!step) return;
            const el = step.target ? $(step.target) : null;
            if (el && !el.classList.contains('tutor-focus')) el.classList.add('tutor-focus');
            if (step.mode === 'wait' && step.until && step.until(this.ctx)) this._next();
        }

        finish() {
            this.destroy();
            this.engine.dispatch('end_shift', {});
            this.runner.start();
            if (this.onFinish) this.onFinish();
        }

        destroy() {
            this.ac.abort();
            this.box.hidden = true;
            document.querySelectorAll('.tutor-focus').forEach((n) => n.classList.remove('tutor-focus'));
        }
    }

    LL.Tutor = Tutor;
})(globalThis.LL = globalThis.LL || {});
