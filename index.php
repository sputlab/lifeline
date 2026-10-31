<?php
/**
 * LifeLine - Pagina principale
 */
declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';

$v = htmlspecialchars(APP_VERSION, ENT_QUOTES);
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="it">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="app-version" content="<?= $v ?>">
    <meta name="color-scheme" content="dark">
    <meta name="theme-color" content="#0b0e14">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="LifeLine">
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="icon" type="image/png" sizes="32x32" href="assets/icons/icon-32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="assets/icons/icon-16.png">
    <link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">
    <link rel="apple-touch-icon" sizes="120x120" href="assets/icons/apple-touch-icon-120.png">
    <link rel="apple-touch-icon" sizes="152x152" href="assets/icons/apple-touch-icon-152.png">
    <link rel="apple-touch-icon" sizes="167x167" href="assets/icons/apple-touch-icon-167.png">
    <link rel="apple-touch-icon" sizes="180x180" href="assets/icons/apple-touch-icon-180.png">
    <title>LifeLine</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&display=swap">
    <link rel="stylesheet" href="assets/css/base.css?v=<?= $v ?>">
    <link rel="stylesheet" href="assets/css/console.css?v=<?= $v ?>">
    <link rel="stylesheet" href="assets/css/settings.css?v=<?= $v ?>">
    <link rel="stylesheet" href="assets/css/debrief.css?v=<?= $v ?>">
</head>
<body>

<p class="sys-error" id="sys-error" role="alert" hidden></p>

<div class="boot" id="boot" role="status">
    <span data-i18n="common.loading">Collegamento alla centrale…</span>
</div>

<!-- ============ ACCESSO ============ -->
<main class="auth" id="view-auth" hidden>
    <section class="auth__brand">
        <h1 class="wordmark">LifeLine</h1>
        <svg class="ecg" viewBox="0 0 320 44" aria-hidden="true" focusable="false">
            <path class="ecg__trace" pathLength="1"
                  d="M0 26 H108 l6 -6 l6 6 H138 l5 12 l10 -36 l9 32 l6 -8 H198 l8 -5 l8 5 H320"/>
        </svg>
        <p class="auth__place" data-i18n="auth.place">Centrale Unica di Risposta 112 di Valdemara</p>
        <p class="auth__lead" data-i18n="auth.lead">Ogni chiamata è una persona che aspetta una risposta. Il turno sta per iniziare.</p>
    </section>

    <section class="auth__panel" aria-labelledby="auth-title">
        <h2 class="visually-hidden" id="auth-title" data-i18n="auth.title">Accesso operatore</h2>

        <div class="tabs" role="tablist">
            <button class="tabs__btn" role="tab" id="tab-login" aria-controls="form-login" aria-selected="true" data-i18n="auth.tab_login">Accedi</button>
            <button class="tabs__btn" role="tab" id="tab-register" aria-controls="form-register" aria-selected="false" tabindex="-1" data-i18n="auth.tab_register">Registrati</button>
        </div>

        <form class="form" id="form-login" role="tabpanel" aria-labelledby="tab-login" novalidate>
            <label class="field">
                <span data-i18n="auth.username">Nome utente</span>
                <input name="username" autocomplete="username" required maxlength="40">
            </label>
            <label class="field">
                <span data-i18n="auth.password">Password</span>
                <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <p class="form__error" role="alert" hidden></p>
            <button class="btn btn--primary" type="submit" data-i18n="auth.submit_login">Inizia il turno</button>
        </form>

        <form class="form" id="form-register" role="tabpanel" aria-labelledby="tab-register" novalidate hidden>
            <label class="field">
                <span data-i18n="auth.username">Nome utente</span>
                <input name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\-]{3,40}">
                <small data-i18n="auth.username_hint">Da 3 a 40 caratteri: lettere, numeri, punto, trattino, underscore.</small>
            </label>
            <label class="field">
                <span data-i18n="auth.email_optional">Email (facoltativa)</span>
                <input name="email" type="email" autocomplete="email" maxlength="190">
            </label>
            <label class="field">
                <span data-i18n="auth.password">Password</span>
                <input name="password" type="password" autocomplete="new-password" required minlength="8">
                <small data-i18n="auth.password_hint">Almeno 8 caratteri.</small>
            </label>
            <label class="field">
                <span data-i18n="auth.password_confirm">Ripeti la password</span>
                <input name="password_confirm" type="password" autocomplete="new-password" required minlength="8">
            </label>
            <label class="field">
                <span data-i18n="common.language">Lingua</span>
                <select name="lang">
                    <option value="it">Italiano</option>
                    <option value="en">English</option>
                </select>
            </label>
            <p class="form__error" role="alert" hidden></p>
            <button class="btn btn--primary" type="submit" data-i18n="auth.submit_register">Crea il profilo operatore</button>
        </form>
    </section>
</main>

<!-- ============ POSTAZIONE OPERATORE ============ -->
<main class="home" id="view-home" hidden>
    <header class="topbar">
        <span class="wordmark wordmark--small">LifeLine</span>
        <div class="topbar__right">
            <label class="topbar__lang">
                <span class="visually-hidden" data-i18n="common.language">Lingua</span>
                <select id="lang-switch">
                    <option value="it">IT</option>
                    <option value="en">EN</option>
                </select>
            </label>
            <button class="btn btn--ghost btn--icon" id="h-settings" type="button" aria-label="Impostazioni" data-i18n-aria="console.settings"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.7h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg></button>
            <button class="btn btn--ghost" id="btn-logout" type="button" data-i18n="home.logout">Esci</button>
        </div>
    </header>

    <section class="badge" aria-labelledby="op-name">
        <p class="badge__role" id="op-rank"></p>
        <h1 class="badge__name" id="op-name"></h1>
        <div class="xp">
            <div class="xp__bar" role="progressbar" aria-valuemin="0" id="xp-bar"><span id="xp-fill"></span></div>
            <p class="xp__label" id="xp-label"></p>
        </div>
        <dl class="stats">
            <div><dt data-i18n="home.stat_shifts">Turni completati</dt><dd id="stat-shifts">0</dd></div>
            <div><dt data-i18n="home.stat_calls">Chiamate gestite</dt><dd id="stat-calls">0</dd></div>
            <div><dt data-i18n="home.stat_phase">Ruolo</dt><dd id="stat-phase"></dd></div>
        </dl>
    </section>

    <section class="start">
        <p class="start__hint" id="training-hint" data-i18n="home.training_hint">Prima volta in centrale? L'addestramento guidato dura pochi minuti e ti mostra tutta la console.</p>
        <div class="start__buttons">
            <button class="btn btn--primary btn--large" id="btn-training" type="button" data-i18n="home.training">Addestramento guidato</button>
            <button class="btn btn--ghost btn--large" id="btn-start" type="button" data-i18n="home.start_shift">Prendi servizio</button>
        </div>
        <p class="start__note" data-i18n="home.start_note">Turno di 6 ore di gioco, circa 15-20 minuti reali.</p>
        <p class="form__error" id="start-error" role="alert" hidden></p>
    </section>

    <section class="mystats" id="mystats" aria-labelledby="mystats-title" hidden>
        <h2 id="mystats-title" data-i18n="home.mystats">Le tue medie</h2>
        <dl class="axes" id="mystats-axes"></dl>
        <p class="mystats__meta" id="mystats-meta"></p>
    </section>

    <section class="history" aria-labelledby="history-title">
        <h2 id="history-title" data-i18n="home.history">Ultimi turni</h2>
        <ol class="history__list" id="history-list"></ol>
        <p class="history__empty" id="history-empty" data-i18n="home.history_empty">Nessun turno ancora. Il primo registro si aprirà quando prenderai servizio.</p>
    </section>
</main>

<!-- ============ CONSOLE DI TURNO ============ -->
<main class="console" id="view-console" hidden>
    <header class="cbar">
        <div class="cbar__brand">
            <span class="wordmark wordmark--small">LifeLine</span>
            <span class="cbar__mode" id="c-mode"></span>
        </div>
        <div class="cbar__clock">
            <span class="cbar__time" id="c-clock">00:00:00</span>
            <span class="cbar__speed" id="c-speed"></span>
        </div>
        <div class="cbar__progress">
            <div class="cbar__track"><span id="c-progress"></span></div>
            <small id="c-progress-label"></small>
        </div>
        <div class="cbar__actions">
            <label class="visually-hidden" for="c-debug">Velocità di sviluppo</label>
            <select id="c-debug" hidden>
                <option value="1">Debug ×1</option>
                <option value="5">Debug ×5</option>
                <option value="20">Debug ×20</option>
            </select>
            <button class="btn btn--ghost btn--small btn--icon" id="c-settings" type="button" aria-label="Impostazioni" data-i18n-aria="console.settings"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.7h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg></button>
            <button class="btn btn--ghost btn--small" id="c-pause" type="button" data-i18n="console.pause">Pausa</button>
            <button class="btn btn--ghost btn--small" id="c-abandon" type="button" data-i18n="console.abandon">Abbandona turno</button>
        </div>
    </header>

    <div class="toasts" id="c-toasts" aria-live="polite"></div>
    <div class="visually-hidden" id="c-live" aria-live="polite" aria-atomic="true"></div>

    <div class="cgrid">
        <aside class="col-left">
            <section class="panel lines" aria-labelledby="c-lines-title">
                <header class="panel__head">
                    <h2 class="panel-title" id="c-lines-title" data-i18n="console.lines">Linee</h2>
                    <span class="lines__overflow" id="c-overflow" hidden></span>
                </header>
                <ol class="lines__list" id="c-lines"></ol>
            </section>
            <section class="panel clog" aria-labelledby="c-log-title">
                <header class="panel__head">
                    <h2 class="panel-title" id="c-log-title" data-i18n="console.log">Registro</h2>
                </header>
                <ol class="clog__list" id="c-log"></ol>
            </section>
        </aside>

        <section class="col-call" id="c-active">
            <div class="caller" id="c-caller"></div>
            <div class="operator" id="c-operator"></div>
        </section>

        <aside class="col-right">
            <section class="panel mapbox" aria-labelledby="c-map-title">
                <header class="panel__head">
                    <h2 class="panel-title" id="c-map-title" data-i18n="map.title">Mappa</h2>
                    <div class="mapbox__tools">
                        <button class="mtool" id="m-zoom-in" type="button" aria-label="Ingrandisci" data-i18n-aria="map.zoom_in">+</button>
                        <button class="mtool" id="m-zoom-out" type="button" aria-label="Riduci" data-i18n-aria="map.zoom_out">−</button>
                        <button class="mtool mtool--text" id="m-focus" type="button" data-i18n="map.focus">Centra chiamata</button>
                        <button class="mtool mtool--text" id="m-reset" type="button" data-i18n="map.reset">Tutta la città</button>
                    </div>
                </header>
                <div class="mapbox__canvas" id="c-map"></div>
                <div class="mapbox__legend" aria-hidden="true">
                    <span class="lg lg--ps" data-i18n="map.leg_ps">Polizia</span>
                    <span class="lg lg--cc" data-i18n="map.leg_cc">Carabinieri</span>
                    <span class="lg lg--aml" data-i18n="map.leg_aml">Posizione stimata</span>
                    <span class="lg lg--dir" data-i18n="map.leg_dir">Intestazione</span>
                    <span class="lg lg--inc" data-i18n="map.leg_inc">Eventi</span>
                </div>
            </section>

            <section class="panel cform" aria-labelledby="c-form-title" id="c-form">
                <header class="panel__head">
                    <h2 class="panel-title" id="c-form-title" data-i18n="form.title">Scheda contatto</h2>
                    <div class="fready" id="f-ready" role="group" aria-label="Dati minimi" data-i18n-aria="console.pills_title" hidden></div>
                    <span class="fstatus visually-hidden" id="f-status"></span>
                </header>
                <p class="cform__empty" id="f-empty" data-i18n="form.empty">La scheda si apre quando rispondi a una chiamata.</p>
                <form id="f-body" novalidate hidden>
                    <fieldset class="fgroup fgroup--place">
                        <legend class="visually-hidden" data-i18n="form.place">Luogo</legend>
                        <div class="frow">
                            <label class="field field--grow" data-key="A"><span data-i18n="form.street">Via</span>
                                <input id="f-street" list="f-streets" autocomplete="off" spellcheck="false"></label>
                            <label class="field field--num"><span data-i18n="form.number">Civico</span>
                                <input id="f-number" type="number" min="1" max="999" inputmode="numeric"></label>
                            <button class="btn btn--tiny btn--ghost" id="f-use-dir" type="button" hidden data-i18n="form.use_directory_short">Intestazione</button>
                        </div>
                        <datalist id="f-streets"></datalist>
                        <p class="floc" id="f-loc"></p>
                    </fieldset>

                    <fieldset class="fgroup fgroup--event">
                        <legend class="visually-hidden" data-i18n="form.event">Evento</legend>
                        <div class="frow">
                            <label class="field field--cat"><span data-i18n="form.category">Categoria</span><select id="f-cat"></select></label>
                            <label class="field field--grow"><span data-i18n="form.type">Tipologia</span><select id="f-type"></select></label>
                            <label class="field field--num"><span data-i18n="form.persons_short">Persone</span>
                                <input id="f-persons" type="number" min="0" max="99" inputmode="numeric"></label>
                        </div>
                        <div class="fchips" id="f-hazards" role="group" aria-label="Pericoli segnalati" data-i18n-aria="form.hazards"></div>
                        <label class="field field--notes"><span class="visually-hidden" data-i18n="form.notes">Note per il secondo livello</span>
                            <input id="f-notes" maxlength="300" autocomplete="off" data-i18n-placeholder="form.notes"></label>
                    </fieldset>

                    <fieldset class="fgroup fgroup--agencies">
                        <legend class="visually-hidden" data-i18n="form.agencies">Trasferisci a</legend>
                        <div class="ftiles" id="f-agencies"></div>
                    </fieldset>

                    <div class="factions">
                        <button class="btn btn--primary btn--transfer" id="f-transfer" type="button" data-i18n="form.transfer">Trasferisci</button>
                        <details class="fmore">
                            <summary data-i18n="form.more_short">Duplicato o non pertinente</summary>
                            <div class="fmore__panel">
                                <div class="frow frow--end">
                                    <label class="field field--grow"><span data-i18n="form.merge_target">Evento già trasferito</span><select id="f-merge-target"></select></label>
                                    <button class="btn btn--ghost btn--small" id="f-merge" type="button" data-i18n="form.merge">Associa</button>
                                </div>
                                <div class="frow frow--end">
                                    <label class="field field--grow"><span data-i18n="form.close_reason">Motivo</span><select id="f-close-reason"></select></label>
                                    <button class="btn btn--ghost btn--small" id="f-close" type="button" data-i18n="form.close">Chiudi chiamata</button>
                                </div>
                            </div>
                        </details>
                    </div>
                </form>
            </section>
        </aside>
    </div>

    <aside class="tutor" id="tutor" hidden aria-live="polite" aria-labelledby="tutor-step">
        <p class="tutor__step" id="tutor-step"></p>
        <p class="tutor__text" id="tutor-text"></p>
        <button class="btn btn--primary btn--small" id="tutor-next" type="button">Avanti</button>
    </aside>

    <div class="overlay" id="c-pause-overlay" hidden>
        <div class="overlay__box" role="dialog" aria-modal="true" aria-labelledby="c-pause-title">
            <h2 id="c-pause-title" data-i18n="console.paused_title">Turno in pausa</h2>
            <p data-i18n="console.paused_text">Le linee sono nascoste finché il turno è fermo.</p>
            <button class="btn btn--primary" id="c-resume" type="button" data-i18n="console.resume_shift">Riprendi il turno</button>
        </div>
    </div>

    <div class="overlay overlay--debrief" id="c-end-overlay" hidden>
        <div class="debrief" role="dialog" aria-modal="true" aria-labelledby="c-end-title">
            <div class="debrief__side">
                <header class="debrief__head">
                    <div>
                        <h2 id="c-end-title" data-i18n="end.title">Fine turno</h2>
                        <p class="debrief__sub" id="db-sub"></p>
                    </div>
                    <div class="debrief__grade">
                        <span class="debrief__letter" id="db-grade"></span>
                        <span class="debrief__pct" id="db-percent"></span>
                    </div>
                </header>
                <div class="debrief__xp" id="db-xp">
                    <p class="end__status" id="c-end-status"></p>
                    <div class="xp__bar" id="db-xpbar" hidden><span id="db-xpfill"></span></div>
                    <p class="debrief__rank" id="db-rank"></p>
                </div>
                <section>
                    <h3 class="debrief__h" data-i18n="end.axes_title">Valutazione per aspetto</h3>
                    <dl class="axes" id="db-axes"></dl>
                </section>
                <section>
                    <h3 class="debrief__h" data-i18n="end.numbers_title">Il turno in numeri</h3>
                    <dl class="end__stats" id="c-end-stats"></dl>
                </section>
                <section>
                    <h3 class="debrief__h" data-i18n="end.curve_title">Andamento del turno</h3>
                    <div class="curve" id="db-curve"></div>
                </section>
                <div class="debrief__foot">
                    <button class="btn btn--primary" id="c-end-back" type="button" data-i18n="end.back">Torna alla postazione</button>
                </div>
            </div>
            <section class="debrief__calls">
                <h3 class="debrief__h" data-i18n="end.calls_title">Le chiamate del turno</h3>
                <p class="debrief__hint" data-i18n="end.calls_hint">Apri una chiamata per vedere cosa era successo davvero e cosa si poteva capire prima.</p>
                <ol class="dbcalls" id="db-calls"></ol>
            </section>
        </div>
    </div>
</main>

<dialog class="dialog" id="c-abandon-dialog" aria-labelledby="c-abandon-title">
    <form method="dialog">
        <h2 id="c-abandon-title" data-i18n="console.abandon_title">Abbandonare il turno?</h2>
        <p data-i18n="console.abandon_text">Il turno verrà chiuso senza valutazione e le chiamate aperte andranno perse.</p>
        <div class="dialog__actions">
            <button class="btn btn--ghost" value="cancel" data-i18n="console.abandon_cancel">Continua il turno</button>
            <button class="btn btn--danger" value="confirm" data-i18n="console.abandon_confirm">Abbandona</button>
        </div>
    </form>
</dialog>

<footer class="appfoot">LifeLine v<?= $v ?></footer>

<script src="assets/js/core/loader.js?v=<?= $v ?>" defer></script>
<script src="assets/js/i18n.js?v=<?= $v ?>" defer></script>
<script src="assets/js/api.js?v=<?= $v ?>" defer></script>
<script src="assets/js/core/rng.js?v=<?= $v ?>" defer></script>
<script src="assets/js/core/events.js?v=<?= $v ?>" defer></script>
<script src="assets/js/core/clock.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/call.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/queue.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/geo.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/cityart.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/builder.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/dialog.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/speechtext.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/scheduler.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/scoring.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/director.js?v=<?= $v ?>" defer></script>
<script src="assets/js/game/training.js?v=<?= $v ?>" defer></script>
<script src="assets/js/core/engine.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/map.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/form.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/prefs.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/sound.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/voice.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/callaudio.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/settings.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/tutor.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/debrief.js?v=<?= $v ?>" defer></script>
<script src="assets/js/ui/console.js?v=<?= $v ?>" defer></script>
<script src="assets/js/app.js?v=<?= $v ?>" defer></script>
<script src="assets/js/pwa.js?v=<?= $v ?>" defer></script>
</body>
</html>
