# LifeLine

Web game in cui si impersona un operatore della Centrale Unica di Risposta del NUE 112 nella città immaginaria di Valdemara. Ogni chiamata è una missione: capire cosa succede, localizzare l'evento, scegliere gli enti e trasferire, sotto la pressione del tempo e di chiamanti che non sempre dicono la verità.

Stack: HTML, CSS, JavaScript, PHP 8.1+, MySQL 8 / MariaDB 10.5+. Tabelle con prefisso `lifeline_`.

## Installazione

1. Crea il database (utf8mb4) e importa `sql/lifeline_schema.sql`, poi `sql/seed/call_templates.sql` (i 54 modelli di chiamata).
2. Copia `config/config.local.example.php` in `config/config.local.php` e inserisci le credenziali.
3. Se l'app non è nella root del dominio, imposta `cookie_path` (es. `/webapp/lifeline/`).
4. In produzione usa HTTPS: il cookie di sessione diventa automaticamente `Secure`.

Su Apache i file `.htaccess` bloccano l'accesso diretto a `config/`, `includes/`, `sql/`, `tools/` e `tests/`. Su Nginx replica le stesse regole nella configurazione del server.

### Aggiornamento da una versione precedente

Esegui in ordine gli script di `sql/updates/` successivi alla tua versione. Il changelog elenca cosa cambia.

## App installabile (PWA)

LifeLine è una Progressive Web App: con HTTPS (o `localhost`) il browser propone l'installazione.

- **Chrome / Edge (desktop e Android)**: icona di installazione nella barra degli indirizzi, oppure menu → «Installa LifeLine».
- **iOS / iPadOS (Safari)**: Condividi → «Aggiungi alla schermata Home».

| File | Funzione |
|---|---|
| `manifest.webmanifest` | Nome, colori, icone, ambito (percorsi relativi, funziona anche in sottocartella) |
| `sw.js` | Service worker: cache dei file statici, `api/*` sempre in rete. Registrato come `sw.js?v=VERSIONE`, così ogni rilascio lo aggiorna |
| `offline.html` | Mostrata se si apre l'app senza rete (il gioco richiede la connessione) |
| `assets/js/pwa.js` | Registrazione e aggiornamento; non ricarica durante un turno |
| `assets/icons/` | Icone generate da `master.png` |

Per cambiare l'icona sostituisci `assets/icons/master.png` e rigenera il set con `swift tools/make_icons.swift` (macOS). Se aggiungi o rinomini file JS/CSS, aggiorna l'elenco `PRECACHE` in `sw.js`. Su Apache il `.htaccess` nella radice imposta il tipo MIME del manifest; su Nginx servi `.webmanifest` come `application/manifest+json` e `sw.js` con `Cache-Control: no-cache`.

## Come si gioca

- **Addestramento guidato**: consigliato la prima volta, pochi minuti. Non conta nelle medie.
- **Prendi servizio**: turno di carriera di 6 ore di gioco (15-20 minuti reali), con il Director che regola ritmo e difficoltà.
- A fine turno: voto (S, A, B, C, D), XP, debriefing chiamata per chiamata e grafico dell'andamento.

Tasti: 1-4 rispondi o riprendi una linea, Q W E R T Y U I O per le domande, H metti in attesa, P pausa, Esc chiude i riquadri. Sulla mappa: rotellina per lo zoom, trascina per spostarti.

La console è pensata per schermi da 1100 × 660 in su, dove sta tutta nello schermo; su schermi più piccoli si scorre la pagina.

## Struttura

| Percorso | Contenuto |
|---|---|
| `api/` | Endpoint JSON: autenticazione, profilo, turni |
| `includes/` | Bootstrap, database, sessione e sicurezza, carriera, punteggio lato server |
| `assets/js/core/` | Generatore casuale con seed, eventi, orologio, motore di gioco |
| `assets/js/game/` | Chiamata, linee, geometria, costruttore dei modelli, dialogo, Director, addestramento, valutazione |
| `assets/js/ui/` | Console, mappa, scheda contatto, tutor, suoni, debriefing |
| `data/` | Città di Valdemara (zone, stradario, riferimenti, elementi grafici nella sezione `art`) e tipi di evento |
| `sql/templates/` | Modelli di chiamata in JSON (formato in `docs/template_format.md`) |
| `tools/import_templates.php` | Validazione e importazione dei modelli |
| `tools/make_icons.swift` | Generazione delle icone PWA dall'icona principale |

## Modelli di chiamata

I modelli sono file JSON in `sql/templates/`. Dopo averli modificati: `php tools/import_templates.php` (con `--check` solo validazione, con `--sql` genera lo script SQL). Se un modello cambia, la sua versione sale automaticamente.

## Test

Il motore non dipende dal browser e si verifica con Node 18+:

```
node tests/engine_replay.test.js
node tests/dialog.test.js
node tests/geo.test.js
node tests/scoring.test.js
node tests/director.test.js
node tests/training.test.js
node tests/cityart.test.js
node tests/scoring_parity.test.js   # richiede php nel PATH
```

I test coprono: determinismo e replay dal registro azioni, coda del centralino e richiamate, i 54 modelli (300 varianti ciascuno), dialogo e meccaniche speciali, geometria e AML, scheda contatto, valutazione, Director, addestramento, cartografia e parità delle formule di punteggio tra client e server.

## Rilasci

A ogni rilascio aggiorna `VERSION`, `CHANGELOG.md` e crea lo script in `sql/updates/` che imposta `app_version` in `lifeline_settings`.
