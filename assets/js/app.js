/**
 * LifeLine - Avvio applicazione, accesso e postazione operatore
 */
'use strict';

(() => {
    const $ = (sel, root = document) => root.querySelector(sel);
    const views = { auth: $('#view-auth'), home: $('#view-home'), console: $('#view-console') };
    const USERNAME_RE = /^[A-Za-z0-9_.\-]{3,40}$/;

    function show(name) {
        $('#boot').hidden = true;
        Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
        document.body.classList.toggle('in-console', name === 'console');
    }

    function errorText(err) {
        const code = err && err.code ? err.code : 'server_error';
        const key = `errors.${code}`;
        const txt = I18n.t(key, err && err.vars ? err.vars : {});
        return txt !== key ? txt : (err && err.message ? err.message : 'Errore imprevisto.');
    }

    /** Errore di sistema visibile anche senza testi caricati. */
    function systemError(msg) {
        const box = $('#sys-error');
        box.textContent = msg;
        box.hidden = false;
    }

    function setError(form, msg) {
        const box = $('.form__error', form);
        box.textContent = msg || '';
        box.hidden = !msg;
    }

    function setBusy(form, busy) {
        const btn = $('button[type="submit"]', form);
        btn.disabled = busy;
        if (busy) {
            btn.dataset.label = btn.textContent;
            btn.textContent = I18n.t('common.wait');
        } else if (btn.dataset.label) {
            btn.textContent = btn.dataset.label;
        }
    }

    /* ---------- Schede Accedi / Registrati ---------- */

    const tabs = [$('#tab-login'), $('#tab-register')];

    function selectTab(tab) {
        tabs.forEach((t) => {
            const on = t === tab;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
            $('#' + t.getAttribute('aria-controls')).hidden = !on;
        });
        const panel = $('#' + tab.getAttribute('aria-controls'));
        setError(panel, '');
        $('input', panel)?.focus();
    }

    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                next.focus();
                selectTab(next);
            }
        });
    });

    /* ---------- Accesso ---------- */

    $('#form-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = { username: form.username.value.trim(), password: form.password.value };
        if (!data.username || !data.password) {
            setError(form, I18n.t('errors.missing_credentials'));
            return;
        }
        setError(form, '');
        setBusy(form, true);
        try {
            const res = await Api.login(data);
            form.reset();
            await enterHome(res.user);
        } catch (err) {
            setError(form, errorText(err));
            form.password.value = '';
            form.password.focus();
        } finally {
            setBusy(form, false);
        }
    });

    /* ---------- Registrazione ---------- */

    $('#form-register').lang.value = I18n.preferred();

    $('#form-register').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = {
            username: form.username.value.trim(),
            email: form.email.value.trim(),
            password: form.password.value,
            lang: form.lang.value,
        };
        let problem = null;
        if (!USERNAME_RE.test(data.username)) problem = 'invalid_username';
        else if (data.password.length < 8) problem = 'invalid_password';
        else if (data.password !== form.password_confirm.value) problem = 'password_mismatch';
        if (problem) {
            setError(form, I18n.t(`errors.${problem}`));
            return;
        }
        setError(form, '');
        setBusy(form, true);
        try {
            const res = await Api.register(data);
            form.reset();
            await enterHome(res.user);
        } catch (err) {
            setError(form, errorText(err));
        } finally {
            setBusy(form, false);
        }
    });

    /* ---------- Postazione operatore ---------- */

    let currentUser = null;

    async function enterHome(user) {
        currentUser = user;
        if (user.lang && user.lang !== I18n.lang) {
            await I18n.load(user.lang);
        }
        renderUser(user);
        show('home');
        try {
            const p = await Api.profile();
            currentUser = p.user;
            renderUser(p.user);
            renderHistory(p.recent_shifts);
            renderStats(p.stats);
        } catch (err) {
            if (err.code === 'unauthorized') { show('auth'); return; }
            renderHistory([]);
        }
    }

    function renderUser(user) {
        const c = user.career;
        const ranks = I18n.list('ranks');
        const phases = I18n.list('phases');
        const lvl = c.rank.level;

        $('#op-name').textContent = user.username;
        $('#op-rank').textContent = `${ranks[Math.min(lvl, ranks.length) - 1] || ''}, ${I18n.t('home.level', { level: lvl })}`;
        $('#stat-shifts').textContent = c.shifts_completed.toLocaleString(I18n.lang);
        $('#stat-calls').textContent = c.calls_handled.toLocaleString(I18n.lang);
        $('#stat-phase').textContent = phases[c.phase - 1] || '';

        const pct = c.rank.xp_needed > 0 ? Math.min(100, (c.rank.xp_into / c.rank.xp_needed) * 100) : 0;
        $('#xp-fill').style.width = `${pct}%`;
        const bar = $('#xp-bar');
        bar.setAttribute('aria-valuemax', String(c.rank.xp_needed));
        bar.setAttribute('aria-valuenow', String(c.rank.xp_into));
        $('#xp-label').textContent = I18n.t('home.xp', { into: c.rank.xp_into, needed: c.rank.xp_needed });
        $('#lang-switch').value = I18n.lang;
    }

    function renderStats(stats) {
        const done = !!(stats && stats.training_done);
        $('#training-hint').hidden = done;
        $('#btn-training').classList.toggle('btn--primary', !done);
        $('#btn-training').classList.toggle('btn--ghost', done);
        $('#btn-start').classList.toggle('btn--primary', done);
        $('#btn-start').classList.toggle('btn--ghost', !done);
        const box = $('#mystats');
        if (!stats || !stats.scored_shifts) { box.hidden = true; return; }
        box.hidden = false;
        const dl = $('#mystats-axes');
        dl.replaceChildren();
        for (const k of ['time', 'location', 'classification', 'agencies', 'protocol']) {
            const v = stats.axes ? stats.axes[k] : null;
            const row = document.createElement('div');
            row.className = 'axis';
            const dt = document.createElement('dt');
            dt.textContent = I18n.t(`axes.${k}`);
            const dd = document.createElement('dd');
            dd.className = 'axis__val';
            if (v === null || v === undefined) {
                dd.textContent = I18n.t('axes.na');
            } else {
                const bar = document.createElement('span');
                bar.className = 'axis__bar';
                const fill = document.createElement('span');
                fill.style.width = `${v}%`;
                fill.dataset.level = v >= 80 ? 'ok' : v >= 50 ? 'mid' : 'low';
                bar.append(fill);
                const num = document.createElement('span');
                num.className = 'axis__num';
                num.textContent = String(Math.round(v));
                dd.append(bar, num);
            }
            row.append(dt, dd);
            dl.append(row);
        }
        const o = stats.outcomes || {};
        $('#mystats-meta').textContent = I18n.t('home.mystats_meta', {
            n: stats.scored_shifts, best: stats.best_percent ?? 0,
            pos: o.positivo || 0, par: o.parziale || 0, neg: o.negativo || 0,
        });
    }

    function renderHistory(shifts) {
        const list = $('#history-list');
        list.replaceChildren();
        $('#history-empty').hidden = shifts.length > 0;
        const fmt = new Intl.DateTimeFormat(I18n.lang, { dateStyle: 'medium', timeStyle: 'short' });
        shifts.forEach((s) => {
            const li = document.createElement('li');
            const date = fmt.format(new Date(s.started_at.replace(' ', 'T') + 'Z'));
            li.textContent = s.grade
                ? I18n.t('home.shift_row', { date, mode: I18n.t(`modes.${s.mode}`), grade: s.grade, score: s.score ?? 0 })
                : I18n.t('home.shift_row_unscored', { date, mode: I18n.t(`modes.${s.mode}`), status: I18n.t(`shift_status.${s.status}`) });
            list.append(li);
        });
    }

    $('#lang-switch').addEventListener('change', async (e) => {
        const lang = e.target.value;
        try {
            const res = await Api.updateProfile({ lang });
            await I18n.load(lang);
            currentUser = res.user;
            renderUser(res.user);
            Api.profile().then((p) => { renderHistory(p.recent_shifts); renderStats(p.stats); }).catch(() => {});
        } catch (_) {
            e.target.value = I18n.lang;
        }
    });

    async function startShift(btn, mode) {
        const errBox = $('#start-error');
        errBox.hidden = true;
        btn.disabled = true;
        try {
            await LL.ShiftController.start({
                show,
                mode,
                onExit: () => enterHome(currentUser),
            });
        } catch (err) {
            if (err.code === 'unauthorized') { show('auth'); return; }
            errBox.textContent = errorText(err);
            errBox.hidden = false;
        } finally {
            btn.disabled = false;
        }
    }

    $('#btn-start').addEventListener('click', (e) => startShift(e.currentTarget, 'carriera'));
    $('#btn-training').addEventListener('click', (e) => startShift(e.currentTarget, 'addestramento'));

    $('#btn-logout').addEventListener('click', async () => {
        try { await Api.logout(); } catch (_) { /* si esce comunque */ }
        currentUser = null;
        show('auth');
        selectTab(tabs[0]);
    });

    /* ---------- Avvio ---------- */

    async function boot() {
        try {
            await I18n.load(I18n.preferred());
        } catch (err) {
            systemError(`Impossibile caricare i testi dell'interfaccia (${err.vars ? err.vars.file : 'lang'}): ${err.vars ? err.vars.detail : err.message}. `
                + 'Verifica che le cartelle lang/ e data/ siano state caricate sul server insieme al resto del gioco.');
        }
        try {
            const res = await Api.me();
            if (res.user) {
                await enterHome(res.user);
                return;
            }
        } catch (err) {
            $('#boot').textContent = errorText(err);
            return;
        }
        show('auth');
        $('#form-login').username.focus();
    }

    boot();
})();
