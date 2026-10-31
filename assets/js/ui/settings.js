/**
 * LifeLine - Impostazioni (audio, voce, schermo)
 *
 *   LL.Settings.open({ onClose })   apre <dialog id="settings-dialog">, costruito qui in JS
 *
 * Ogni modifica vale subito (LL.Prefs). In console chi apre il dialogo ferma il turno e lo
 * riprende in onClose, come per «Abbandona turno». Il pulsante #h-settings della home apre
 * il dialogo da solo; #c-settings della console lo collega console.js (per la pausa).
 *
 * La «Voce HD» si scarica solo premendo «Scarica»: scegliere la modalità non scarica nulla.
 */
(function (LL) {
    'use strict';

    const t = (k, v) => (typeof I18n !== 'undefined' ? I18n.t(k, v) : k);
    const pref = (k) => LL.Prefs.get(k);
    const set = (k, v) => LL.Prefs.set(k, v);

    const el = (tag, attrs = {}, ...kids) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, v === true ? '' : String(v));
        }
        for (const c of kids.flat()) if (c) n.append(c);
        return n;
    };

    const mb = (bytes) => Math.round(bytes / 1048576);

    // download della Voce HD: sopravvive alla chiusura del dialogo
    const hd = { loading: false, loaded: 0, total: 0, error: '', listeners: new Set() };
    const hdNotify = () => hd.listeners.forEach((fn) => { try { fn(); } catch (_) { /* */ } });

    function hdSupported() {
        try {
            return typeof Worker === 'function' && typeof caches !== 'undefined' && typeof WebAssembly === 'object'
                && typeof BigInt64Array === 'function' && (typeof isSecureContext === 'undefined' || isSecureContext);
        } catch (_) { return false; }
    }

    let uid = 0;
    function radios(name, options, current, onPick) {
        const box = el('div', { class: 'settings__radios', role: 'radiogroup' });
        for (const o of options) {
            if (o.hidden) continue;
            const id = `set-${name}-${o.value}-${++uid}`;
            const input = el('input', { type: 'radio', name, id, value: o.value, checked: o.value === current });
            input.addEventListener('change', () => { if (input.checked) onPick(o.value); });
            box.append(el('label', { class: 'settings__radio', for: id }, input,
                el('span', { class: 'settings__radio-text' }, el('span', { text: o.label }), o.hint ? el('small', { text: o.hint }) : null)));
        }
        return box;
    }

    function range(key, label, { min = 0, max = 100, step = 5, scale = 100, unit = '%', onCommit } = {}) {
        const id = `set-${key}-${++uid}`;
        const out = el('output', { class: 'settings__value', for: id });
        const input = el('input', { type: 'range', id, min, max, step, value: Math.round(pref(key) * scale) });
        const show = () => { out.textContent = `${input.value}${unit}`; };
        input.addEventListener('input', () => { set(key, Number(input.value) / scale); show(); });
        if (onCommit) input.addEventListener('change', onCommit);
        show();
        return el('div', { class: 'settings__range' }, el('label', { for: id, text: label }), input, out);
    }

    function check(key, label, hint) {
        const id = `set-${key}-${++uid}`;
        const input = el('input', { type: 'checkbox', id, checked: !!pref(key) });
        input.addEventListener('change', () => set(key, input.checked));
        return el('label', { class: 'settings__check', for: id }, input,
            el('span', { class: 'settings__radio-text' }, el('span', { text: label }), hint ? el('small', { text: hint }) : null));
    }

    /* ---------------- Pannello Voce HD ---------------- */

    function hdPanel() {
        const status = el('p', { class: 'settings__hd-status', 'aria-live': 'polite' });
        const bar = el('progress', { class: 'settings__progress', max: 100, value: 0, hidden: true });
        const bDown = el('button', { type: 'button', class: 'btn btn--primary btn--small' });
        const bDel = el('button', { type: 'button', class: 'btn btn--ghost btn--small', text: t('voice.hd_delete') });
        const credits = el('details', { class: 'settings__credits' }, el('summary', { text: t('voice.hd_credits') }));
        const panel = el('div', { class: 'settings__hd' },
            el('p', { class: 'settings__hint', text: t('voice.hd_intro') }),
            status, bar, el('div', { class: 'settings__row' }, bDown, bDel), credits);

        let installed = false;
        let N = null;

        async function refresh() {
            N = N || (LL.Voice ? await LL.Voice.loadNeural() : null);
            if (!N || !N.supported()) {
                status.textContent = t('voice.hd_unsupported');
                bDown.hidden = true; bDel.hidden = true; bar.hidden = true;
                return;
            }
            if (!credits.dataset.filled) {
                credits.dataset.filled = '1';
                for (const c of N.CREDITS) credits.append(el('p', { text: c }));
            }
            const total = mb(N.TOTAL_BYTES);
            if (hd.loading) {
                const pct = hd.total ? Math.floor((hd.loaded / hd.total) * 100) : 0;
                bar.hidden = false; bar.value = pct;
                status.textContent = t('voice.hd_downloading', { pct, mb: mb(hd.loaded), total });
                bDown.hidden = true; bDel.hidden = true;
                return;
            }
            bar.hidden = true;
            let st = { installed: false, bytes: 0 };
            try { st = await N.status(); } catch (_) { /* */ }
            installed = st.installed;
            const err = hd.error || (installed && N.lastError);
            if (err) status.textContent = t('voice.hd_error', { err });
            else if (installed) status.textContent = N.isReady() ? t('voice.hd_ready') : t('voice.hd_installed');
            else status.textContent = st.bytes ? t('voice.hd_partial', { mb: mb(st.bytes), total }) : t('voice.hd_not_installed', { total });
            bDown.hidden = installed;
            bDown.textContent = st.bytes ? t('voice.hd_resume', { total }) : t('voice.hd_download', { total });
            bDel.hidden = !installed && !st.bytes;
        }

        bDown.addEventListener('click', async () => {
            const N2 = N || (LL.Voice ? await LL.Voice.loadNeural() : null);
            if (!N2 || hd.loading) return;
            hd.loading = true; hd.error = ''; hd.loaded = 0; hd.total = N2.TOTAL_BYTES;
            hdNotify();
            let last = 0;
            try {
                await N2.download((loaded, total) => {
                    hd.loaded = loaded; hd.total = total;
                    const n = performance.now();
                    if (n - last > 250) { last = n; hdNotify(); }
                });
                hd.loading = false;
                hdNotify();
                if (pref('voiceMode') !== 'hd') set('voiceMode', 'hd');
                await N2.init();
            } catch (e) {
                hd.loading = false;
                hd.error = String((e && e.message) || e);
            }
            hdNotify();
        });
        bDel.addEventListener('click', async () => {
            const N2 = N || (LL.Voice ? await LL.Voice.loadNeural() : null);
            if (!N2) return;
            if (LL.Voice) LL.Voice.stop();
            await N2.remove();
            hd.error = '';
            hdNotify();
        });

        const onHd = () => refresh();
        hd.listeners.add(onHd);
        panel._dispose = () => hd.listeners.delete(onHd);
        refresh();
        return panel;
    }

    /* ---------------- Dialogo ---------------- */

    function build() {
        const V = LL.Voice;
        const tts = !!(V && V.supported());
        const voices = V ? V.list('it') : [];

        const voiceBox = el('div', { class: 'settings__voicebox' });
        const hdBox = el('div', { class: 'settings__hdbox' });
        let panel = null;
        const syncMode = () => {
            const m = pref('voiceMode');
            voiceBox.hidden = m === 'off';
            if (m === 'hd' && !panel) { panel = hdPanel(); hdBox.append(panel); }
            hdBox.hidden = m !== 'hd';
        };

        // voce preferita
        let voiceSel = null;
        if (tts && voices.length) {
            const id = `set-voiceName-${++uid}`;
            voiceSel = el('select', { id });
            voiceSel.append(el('option', { value: '', text: t('settings.voice_auto') }));
            for (const v of voices) voiceSel.append(el('option', { value: v.name, text: `${v.name} (${v.lang})`, selected: v.name === pref('voiceName') }));
            voiceSel.addEventListener('change', () => set('voiceName', voiceSel.value));
        }

        const sample = (lvl) => el('button', { type: 'button', class: 'btn btn--ghost btn--small', text: t(`settings.test_${lvl}`), onclick: () => V && V.sample(lvl) });

        const audio = el('fieldset', { class: 'settings__group' },
            el('legend', { text: t('settings.audio') }),
            check('on', t('settings.sound_on')),
            range('master', t('settings.master')),
            range('voiceVol', t('settings.voice_vol')),
            range('sfxVol', t('settings.sfx_vol'), { onCommit: () => LL.Sound && LL.Sound.play('answer') }));

        const voice = el('fieldset', { class: 'settings__group' },
            el('legend', { text: t('settings.voice') }),
            radios('voiceMode', [
                { value: 'auto', label: t('settings.mode_auto'), hint: t('settings.mode_auto_hint') },
                { value: 'tts', label: t('settings.mode_tts'), hint: t('settings.mode_tts_hint'), hidden: !tts },
                { value: 'hd', label: t('settings.mode_hd'), hint: t('settings.mode_hd_hint'), hidden: !hdSupported() },
                { value: 'babble', label: t('settings.mode_babble'), hint: t('settings.mode_babble_hint') },
                { value: 'off', label: t('settings.mode_off'), hint: t('settings.mode_off_hint') },
            ], pref('voiceMode'), (v) => { set('voiceMode', v); syncMode(); }),
            hdBox,
            voiceBox);

        voiceBox.append(
            el('p', { class: 'settings__label', text: t('settings.speech_len') }),
            radios('speechLen', [
                { value: 'full', label: t('settings.len_full') },
                { value: 'adaptive', label: t('settings.len_adaptive'), hint: t('settings.len_adaptive_hint') },
                { value: 'short', label: t('settings.len_short') },
            ], pref('speechLen'), (v) => set('speechLen', v)),
            voiceSel ? el('div', { class: 'settings__field' }, el('label', { for: voiceSel.id, text: t('settings.voice_pref') }), voiceSel) : null,
            check('operatorVoice', t('settings.operator_voice'), t('settings.operator_voice_hint')),
            el('div', { class: 'settings__row' }, sample('calm'), sample('panic')),
            !tts ? el('p', { class: 'settings__hint', text: t('settings.no_tts') }) : (!voices.length ? el('p', { class: 'settings__hint', text: t('settings.no_it_voice') }) : null));

        const screen = el('fieldset', { class: 'settings__group' },
            el('legend', { text: t('settings.screen') }),
            range('textScale', t('settings.text_scale'), { min: 90, max: 115, step: 5 }),
            el('p', { class: 'settings__label', text: t('settings.motion') }),
            radios('motion', [
                { value: 'system', label: t('settings.motion_system') },
                { value: 'reduced', label: t('settings.motion_reduced') },
            ], pref('motion'), (v) => set('motion', v)),
            el('p', { class: 'settings__label', text: t('settings.subtitles') }),
            radios('subtitles', [
                { value: 'typewriter', label: t('settings.subs_typewriter') },
                { value: 'instant', label: t('settings.subs_instant') },
            ], pref('subtitles'), (v) => set('subtitles', v)),
            el('p', { class: 'settings__hint', text: t('settings.sr_hint') }));

        const dlg = el('dialog', { id: 'settings-dialog', class: 'dialog settings', 'aria-labelledby': 'settings-title' },
            el('form', { method: 'dialog', class: 'settings__form' },
                el('div', { class: 'settings__head' },
                    el('h2', { id: 'settings-title', text: t('settings.title') }),
                    el('button', { class: 'settings__x', value: 'close', 'aria-label': t('settings.close'), text: '×' })),
                el('div', { class: 'settings__body' }, audio, voice, screen),
                el('div', { class: 'dialog__actions' },
                    el('button', { class: 'btn btn--primary', value: 'close', text: t('settings.done') }))));
        syncMode();
        dlg._dispose = () => { if (panel && panel._dispose) panel._dispose(); };
        return dlg;
    }

    const Settings = {
        /**
         * Apre il dialogo delle impostazioni.
         * @param {object} [o]
         * @param {function} [o.onClose]  chiamata alla chiusura (in console: riprendi il turno)
         */
        open({ onClose } = {}) {
            if (!LL.Prefs || typeof document === 'undefined') { if (onClose) onClose(); return; }
            const old = document.getElementById('settings-dialog');
            if (old) {
                if (old.open) return;
                if (old._dispose) old._dispose();
                old.remove();
            }
            if (LL.Voice) LL.Voice.refresh();
            const dlg = build();
            document.body.append(dlg);
            dlg.addEventListener('close', () => {
                if (dlg._dispose) dlg._dispose();
                if (onClose) { try { onClose(); } catch (e) { console.error(e); } }
            }, { once: true });
            if (LL.Sound) LL.Sound.unlock();
            if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
            const first = dlg.querySelector('input:checked, input, button');
            if (first) first.focus();
        },

        close() {
            const d = document.getElementById('settings-dialog');
            if (d && d.open) d.close();
        },
    };

    if (typeof document !== 'undefined') {
        // pulsante della home (in console lo collega console.js per mettere in pausa il turno)
        document.addEventListener('click', (e) => {
            const b = e.target && e.target.closest ? e.target.closest('#h-settings, [data-open-settings]') : null;
            if (b) { e.preventDefault(); Settings.open(); }
        });
    }

    LL.Settings = Settings;
})(globalThis.LL = globalThis.LL || {});
