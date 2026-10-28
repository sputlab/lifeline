/**
 * LifeLine - Debriefing di fine turno
 *
 * Mostra voto, assi medi, numeri del turno e, per ogni chiamata, il confronto
 * tra verità nascosta e azioni dell'operatore, con le note su cosa si poteva fare meglio.
 */
(function (LL) {
    'use strict';

    const t = (k, v) => I18n.t(k, v);
    const $ = (sel, root = document) => root.querySelector(sel);
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    };
    const AXES = ['time', 'location', 'classification', 'agencies', 'protocol'];

    function axisRows(dl, values, { compact = false } = {}) {
        dl.replaceChildren();
        for (const k of AXES) {
            const v = values[k];
            const row = el('div', 'axis');
            row.append(el('dt', '', t(`axes.${k}`)));
            const dd = el('dd', 'axis__val');
            if (v === null || v === undefined) {
                dd.append(el('span', 'axis__na', t('axes.na')));
            } else {
                const bar = el('span', 'axis__bar');
                const fill = el('span');
                fill.style.width = `${v}%`;
                fill.dataset.level = v >= 80 ? 'ok' : v >= 50 ? 'mid' : 'low';
                bar.append(fill);
                dd.append(bar, el('span', 'axis__num', String(Math.round(v))));
            }
            row.append(dd);
            if (compact) row.classList.add('axis--compact');
            dl.append(row);
        }
    }

    function eventLabel(key) {
        if (!key) return t('end.not_set');
        const k = `events.${key}`;
        const v = t(k);
        return v !== k ? v : key;
    }

    function agencyList(list) {
        return list && list.length ? list.map((a) => t(`agencies.${a}`)).join(', ') : t('end.none');
    }

    function factLabel(f) {
        if (f.label) return f.label;
        const k = `facts.${f.key}`;
        const v = t(k);
        return v !== k ? v : f.key;
    }

    function buildCall(r, engine) {
        const li = el('li', `dbcall dbcall--${r.outcome}${r.final < 50 ? ' dbcall--weak' : ''}`);
        const det = el('details');
        const sum = el('summary', 'dbcall__sum');
        const clock = LL.Time.clock(engine.gameStartSec + r.arrivalSec).slice(0, 5);
        sum.append(
            el('span', 'dbcall__time', clock),
            el('span', 'dbcall__title', r.isCallback ? `${r.title} (${t('end.callback_tag')})` : r.isWitness ? `${r.title} (${t('end.witness_tag')})` : r.title),
            el('span', `dbcall__badge dbcall__badge--${r.outcome}`, r.outcome === 'nessuno' ? t(`end.state_${r.state}`) : t(`outcome.${r.outcome}`)),
            el('span', 'dbcall__score', String(r.final)),
        );
        det.append(sum);

        const body = el('div', 'dbcall__body');

        // Verità e azioni
        const cmp = el('div', 'dbcmp');
        const truthBox = el('div', 'dbcmp__col');
        truthBox.append(el('h4', '', t('end.truth')));
        const tdl = el('dl');
        const addRow = (dl, k, v, cls) => { const d = el('div', cls); d.append(el('dt', '', k), el('dd', '', v)); dl.append(d); };
        addRow(tdl, t('end.event'), eventLabel(r.truth.event));
        addRow(tdl, t('end.agencies'), r.emergency ? agencyList(r.truth.agencies) : t('end.no_agencies_needed'));
        addRow(tdl, t('end.place'), `${r.truth.street} ${r.truth.number}, ${r.truth.zoneName}`);
        truthBox.append(tdl);

        const youBox = el('div', 'dbcmp__col');
        youBox.append(el('h4', '', t('end.you')));
        const ydl = el('dl');
        addRow(ydl, t('end.outcome_state'), t(`end.state_${r.state}`));
        addRow(ydl, t('end.event'), eventLabel(r.you.event), r.axes.classification !== null && r.axes.classification < 100 ? 'dbcmp--off' : '');
        addRow(ydl, t('end.agencies'), agencyList(r.you.agencies), r.axes.agencies !== null && r.axes.agencies < 100 ? 'dbcmp--off' : '');
        const place = r.you.street ? `${r.you.street}${r.you.number ? ' ' + r.you.number : ''}${r.you.errorM !== null ? ` (${t('end.error_m', { m: r.you.errorM })})` : ''}` : t('end.not_set');
        addRow(ydl, t('end.place'), place, r.axes.location !== null && r.axes.location < 100 ? 'dbcmp--off' : '');
        youBox.append(ydl);
        cmp.append(truthBox, youBox);
        body.append(cmp);

        // Tempi
        const times = [];
        times.push(r.answeredSec !== null ? t('end.t_answer', { s: r.waitSec }) : t('end.t_unanswered'));
        if (r.handleSec !== null) times.push(t('end.t_handle', { s: r.handleSec }));
        if (r.delaySec !== null) times.push(t('end.t_delay', { s: r.delaySec }));
        const tp = el('p', 'dbcall__times');
        times.forEach((x) => tp.append(el('span', '', x)));
        body.append(tp);

        // Assi
        const ax = el('dl', 'axes axes--compact');
        axisRows(ax, r.axes, { compact: true });
        body.append(ax);

        // Informazioni critiche
        if (r.critical.length && r.answeredSec !== null) {
            body.append(el('h4', 'dbcall__h', t('end.critical')));
            const ul = el('ul', 'dbfacts');
            for (const f of r.critical) {
                let txt;
                let cls;
                if (f.atSec === null) { txt = t('end.fact_missing'); cls = 'miss'; }
                else if (f.wrong) { txt = t('end.fact_wrong', { s: f.atSec }); cls = 'wrong'; }
                else { txt = t('end.fact_ok', { s: f.atSec }); cls = 'ok'; }
                if (f.conflict) txt += `, ${t('end.fact_conflict')}`;
                const li2 = el('li', `dbfact dbfact--${cls}`);
                li2.append(el('span', 'dbfact__k', factLabel(f)), el('span', '', txt));
                ul.append(li2);
            }
            body.append(ul);
        }

        // Note
        if (r.notes.length) {
            const ul = el('ul', 'dbnotes');
            for (const n of r.notes) ul.append(el('li', '', t(n.key, n.vars || {})));
            body.append(ul);
        }
        if (r.hint) body.append(el('p', 'dbcall__hint', r.hint));

        det.append(body);
        li.append(det);
        return li;
    }

    /** Grafico della tensione del turno con gli arrivi delle chiamate. */
    function drawCurve(box, engine, ev) {
        box.replaceChildren();
        const hist = engine.scheduler && engine.scheduler.history;
        if (!hist || hist.length < 2) { box.hidden = true; return; }
        box.hidden = false;
        const NS = 'http://www.w3.org/2000/svg';
        const W = 640, H = 130, P = 8, B = 22;
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('class', 'curve__svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', t('end.curve_title'));
        const dur = engine.durationMs;
        const x = (ms) => P + (ms / dur) * (W - 2 * P);
        const y = (v) => H - B - v * (H - B - P);
        const tension = (ms) => {
            let prev = hist[0];
            for (const h of hist) { if (h.ms > ms) break; prev = h; }
            return prev.tension;
        };
        const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };

        mk('line', { x1: P, y1: y(0), x2: W - P, y2: y(0), class: 'curve__axis' });
        const pts = hist.map((h) => `${x(h.ms).toFixed(1)},${y(h.tension).toFixed(1)}`);
        mk('path', { d: `M${x(hist[0].ms)},${y(0)} L${pts.join(' L')} L${x(hist[hist.length - 1].ms)},${y(0)} Z`, class: 'curve__area' });
        mk('path', { d: `M${pts.join(' L')}`, class: 'curve__line' });

        const byId = new Map(ev.calls.map((r) => [r.id, r]));
        for (const c of engine.calls.values()) {
            const r = byId.get(c.id);
            if (!r) continue;
            const cls = r.outcome !== 'nessuno' ? r.outcome : (r.final >= 70 ? 'ok' : 'weak');
            const dot = mk('circle', { cx: x(c.arrivalMs), cy: y(tension(c.arrivalMs)), r: c.content.isWitness || c.parentId !== null ? 2.5 : 4, class: `curve__dot curve__dot--${cls}` });
            const title = document.createElementNS(NS, 'title');
            title.textContent = `${LL.Time.clock(engine.gameStartSec + c.arrivalMs / 1000).slice(0, 5)} ${r.title}`;
            dot.append(title);
        }
        for (let h = 0; h <= dur / 3600000; h++) {
            const tx = mk('text', { x: x(h * 3600000), y: H - 6, class: 'curve__tick', 'text-anchor': h === 0 ? 'start' : h * 3600000 >= dur ? 'end' : 'middle' });
            tx.textContent = LL.Time.clock(engine.gameStartSec + h * 3600).slice(0, 5);
        }
        box.append(svg);
    }

    const Debrief = {
        /** Disegna il debriefing a partire dalla valutazione locale. */
        render(ev, engine, summary) {
            $('#db-grade').textContent = ev.grade;
            $('#db-grade').dataset.grade = ev.grade;
            $('#db-percent').textContent = `${ev.percent}/100`;
            $('#db-sub').textContent = t('end.sub', {
                from: LL.Time.clock(engine.gameStartSec).slice(0, 5),
                to: LL.Time.clock(engine.gameStartSec + engine.durationMs / 1000).slice(0, 5),
            });
            axisRows($('#db-axes'), ev.axesAvg);

            const stats = $('#c-end-stats');
            stats.replaceChildren();
            const rows = [
                ['end.total', summary.total],
                ['end.emergencies', ev.emergencies],
                ['outcome.positivo', ev.outcomes.positivo],
                ['outcome.parziale', ev.outcomes.parziale],
                ['outcome.negativo', ev.outcomes.negativo],
                ['end.abandoned', summary.byState.abandoned],
                ['end.avg_answer', `${summary.avgAnswerSec} s`],
                ['end.questions', summary.questions],
            ];
            for (const [k, v] of rows) {
                const d = el('div');
                d.append(el('dt', '', t(k)), el('dd', '', String(v)));
                stats.append(d);
            }

            drawCurve($('#db-curve'), engine, ev);

            const list = $('#db-calls');
            list.replaceChildren(...ev.calls.map((r) => buildCall(r, engine)));

            $('#db-xpbar').hidden = true;
            $('#db-rank').textContent = '';
        },

        /** Risposta del server: XP guadagnati e grado. */
        renderServer(res) {
            if (res.grade) {
                $('#db-grade').textContent = res.grade;
                $('#db-grade').dataset.grade = res.grade;
                $('#db-percent').textContent = `${res.percent}/100`;
            }
            const r = res.career.rank_after;
            const ranks = I18n.list('ranks');
            const title = ranks[Math.min(r.level, ranks.length) - 1] || '';
            $('#c-end-status').textContent = res.training
                ? (res.xp_gained ? t('end.training_done_xp', { xp: res.xp_gained }) : t('end.training_done'))
                : t('end.xp_gained', { xp: res.xp_gained });
            $('#db-xpbar').hidden = false;
            $('#db-xpfill').style.width = `${Math.min(100, (r.xp_into / r.xp_needed) * 100)}%`;
            $('#db-rank').textContent = res.leveled_up
                ? t('end.level_up', { title, level: r.level })
                : t('end.rank_progress', { title, level: r.level, into: r.xp_into, needed: r.xp_needed });
            $('#db-rank').dataset.up = String(!!res.leveled_up);
        },
    };

    LL.Debrief = Debrief;
})(globalThis.LL = globalThis.LL || {});
