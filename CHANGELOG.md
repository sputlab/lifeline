# Changelog - LifeLine

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni secondo [SemVer](https://semver.org/lang/it/).

## [1.0.0] - 2026-09-26

### Interfaccia
- Console a tutto schermo senza scorrimento della pagina (da 1100 × 660 in su): registro, conversazione e domande scorrono al loro interno. Verificata a 1366 × 768, 1440 × 900 e 1920 × 1080.
- Colonna centrale divisa in due sezioni ben distinte:
  - **Interlocutore** (toni caldi): avatar con tipo di telefono, intestazione della linea fissa, indicatore «in linea» con durata, barre della voce animate quando parla, indicatore di agitazione con cursore, batteria per le linee che stanno per cadere, conversazione a nuvolette con indicatore di risposta in arrivo.
  - **Operatore** (toni freddi): domande con scorciatoie da tastiera (Q W E R T Y U I O), durata di ogni domanda, informazioni raccolte evidenziate quando arrivano.
- Registro a tutta altezza nella colonna sinistra, con colori per tipo di evento.
- Scheda contatto compatta, sempre interamente visibile: luogo in una riga con zona, competenza e quadrante; pericoli come etichette; enti come quattro grandi pulsanti a icona colorati; «duplicato o non pertinente» in un riquadro sopra la scheda, che si chiude da solo.
- Notifiche a comparsa per nuove chiamate, trasferimenti, riattacchi e chiamate in coda.
- Debriefing in un'unica schermata a due colonne: riepilogo a sinistra, chiamate a destra con scorrimento proprio.
- Mappa che si adatta allo spazio disponibile, con legenda.

### Effetti visivi
- Linee che lampeggiano e vibrano mentre squillano; lampo all'arrivo di una chiamata; barra della pazienza che lampeggia quando sta per esaurirsi.
- Pannello dell'interlocutore che pulsa di rosso quando il chiamante è nel panico.
- Nuvolette che compaiono con un'animazione, puntini di risposta in arrivo, informazioni nuove evidenziate.
- Cerchio AML pulsante, onde sul luogo scelto e sugli eventi trasferiti (colorati per ente), indicatore di tempo accelerato animato.
- Debriefing: voto che si «timbra», barre che si riempiono, curva che si disegna, chiamate che compaiono in sequenza.
- Tutti gli effetti si disattivano con l'impostazione di sistema «riduci movimento».

### Mappa
- Confini di zona organici e senza sovrapposizioni, centro storico dalla forma raccolta, vie del quartiere leggermente incurvate, strade di collina e montagna come curve morbide, torrente con anse, rilievi ombreggiati, edifici disposti lungo le curve delle vie, centro storico più compatto.

### Suoni (tutti sintetizzati, nessun file)
- Voce telefonica sintetica per il chiamante e per l'operatore: tono, ritmo, intensità e tremolio cambiano con l'agitazione; voce maschile, femminile o di bambino.
- Sirene a trasferimento avvenuto: bitonale dell'ambulanza, bitonale più grave dei Vigili del fuoco, sirena ululante per Polizia e Carabinieri, in lontananza.
- Fruscio di linea durante la conversazione, squillo che accelera quando qualcuno sta per riattaccare, suono per ogni nuova informazione raccolta.

### Corretto
- Il riquadro «duplicato o non pertinente» restava aperto passando alla chiamata successiva e copriva gli enti.

### Aggiornamento da 0.9.0
- Carica tutti i file, esegui `sql/updates/1.0.0.sql` e ricarica la pagina con Ctrl+F5.

## [0.9.0] - 2026-09-26

### Aggiunto
- 39 nuovi modelli di chiamata (54 in totale), organizzati come famiglie di situazioni: circa 135 situazioni distinte, ciascuna con verità, enti e gravità propri, contro le circa 40 di prima.
  - Sanitarie: difficoltà respiratoria (asma, allergia, soffocamento, malattia cronica), parto, convulsioni, persona a terra in strada, monossido di carbonio, intossicazioni, infortunio in azienda, ferita (anche da aggressione), punture e morso di vipera, attacco di panico o embolia, anziana con febbre.
  - Incendio e soccorso tecnico: persona nel torrente, anziana che non risponde (chiamata da lontano), auto in fiamme, fuga di gas, incendio di vegetazione, allagamenti, alberi caduti, ascensore bloccato, animali, emergenza in capannone, cavo elettrico a terra, canna fumaria.
  - Sicurezza: rapina, persona sospetta, rissa, persona scomparsa, truffa agli anziani, atti persecutori, rumori molesti (che possono nascondere una lite), pericoli sulla strada, aggressione sull'autobus, furto d'auto.
  - Strada: pedone investito, motociclista a terra, auto fuori strada in collina.
  - Non pertinenti ma insidiose: chiamata muta (tasca, bambino, oppure qualcuno che non riesce più a parlare), richieste improprie, anziano che vuole solo parlare (o che minimizza una caduta o un ictus).
- Nuovi tipi di evento: convulsioni, ferita, reazione allergica, incendio di vegetazione, allagamento, danni da maltempo, soccorso ad animale, rapina, truffa, atti persecutori, pericolo per la circolazione.
- Costruttore: scelta limitata a vie specifiche (`location.streets`); modelli senza AML per chi chiama da lontano.

### Modificato
- Director: scelta per difficoltà più larga, forte penalità per i modelli già usciti nel turno e per due chiamate di fila della stessa categoria. Ora in un turno quasi ogni chiamata è di un tipo diverso e nessun modello supera il 5% delle uscite (prima il più frequente arrivava al 25%).
- Eventi "gemelli" possibili anche per auto in fiamme, incendi di vegetazione, persone a terra e investimenti.

### Aggiornamento da 0.8.0
- Esegui `sql/updates/0.9.0.sql` (versione e 54 modelli), oppure `php tools/import_templates.php`.

## [0.8.0] - 2026-09-26

### Modificato
- Nuova mappa in stile cartografia da sala operativa, generata dalle stesse coordinate della logica di gioco (sempre allineata):
  - terreno tinto per competenza territoriale (blu Polizia di Stato, verde Carabinieri) con confini di zona tratteggiati;
  - circa 1250 edifici disposti lungo le vie, con densità e dimensioni per zona (centro compatto, quartiere residenziale, capannoni, case sparse in collina);
  - strade con gerarchia (viali più larghi, bordo scuro, sentieri tratteggiati) e ponti dove incrociano il torrente;
  - torrente con argini, prolungato attraverso la città; parchi alberati con vialetto, campo sportivo, vigneti a filari, boschi, curve di livello in montagna e in collina;
  - griglia di riferimento a quadranti da 500 m (colonne A-L, righe 1-8), scala metrica che si adatta allo zoom, indicatore del nord;
  - nomi delle vie posizionati lontano dagli incroci e senza sovrapposizioni; i nomi che non trovano spazio compaiono allo zoom massimo.
- La scheda contatto indica il quadrante del luogo scelto (es. «Quadrante D5»).
- `data/city_valdemara.json` alla versione 4, con la sezione `art` (parchi, vigneti, boschi, cime, strade principali).

### Aggiunto
- `game/cityart.js`: generazione deterministica degli elementi grafici, con indice spaziale (circa 0,2 s).
- Test `tests/cityart.test.js`: nessun edificio su carreggiate, torrente o parchi, nessun civico coperto, generazione deterministica.

### Aggiornamento da 0.7.1
- Carica tutti i file ed esegui `sql/updates/0.8.0.sql`.

## [0.7.1] - 2026-09-25

### Corretto
- Su alcuni server i file JSON del gioco (testi in `lang/`, città e tipi di evento in `data/`) non arrivavano al browser: comparivano chiavi come «home.level» e «home.xp», e l'avvio del turno falliva con «city_unavailable». Ora i dati vengono serviti da `api/data.php`, con il file diretto come riserva.
- L'avvio del turno creava il turno sul server prima di caricare i dati della città: a ogni tentativo fallito restava un turno abbandonato nello storico. Ora i dati si caricano prima; lo script di aggiornamento elimina i turni rimasti a metà.
- Se un file manca davvero, un messaggio indica quale file e perché, invece di un codice incomprensibile.

### Aggiornamento da 0.7.0
- Carica tutti i file, comprese le cartelle `lang/` e `data/`, ed esegui `sql/updates/0.7.1.sql`.

## [0.7.0] - 2026-09-25 - MVP completo

### Aggiunto
- Addestramento guidato: 19 passi con un tutor che spiega la console, evidenzia l'elemento giusto e aspetta l'azione del giocatore. Quattro chiamate guidate: caduta in casa con porta chiusa (118 + 115), scherzo da chiudere, cassonetto in fiamme, testimone da accorpare. Chiamanti pazienti e calmi, nessuna richiamata.
- Chiamate guidate e chiusura anticipata del turno come azioni del motore (`spawn`, `end_shift`): anche l'addestramento si riproduce identico dal registro.
- Lato server: modalità `addestramento` con i soli modelli del tutor; 100 XP solo al primo completamento; non conta nelle medie né nei turni completati.
- Nella postazione: "Addestramento guidato" in evidenza finché non è stato fatto, poi "Prendi servizio".
- Suoni sintetizzati con Web Audio (nessun file): trillo delle linee che squillano (più fitto con più linee), risposta, attesa, trasferimento, chiamante che riattacca, chiamata in coda, fine turno. Attivazione e volume nella barra della console, salvati nel browser.
- Test: `tests/training.test.js`.

### Modificato
- Su schermi ampi (almeno 1250 × 720) la console occupa esattamente la finestra: colonne con scorrimento proprio invece dello scorrimento della pagina.
- Durata del turno indicata come 15-20 minuti reali, in base al bilanciamento con operatori simulati dai tempi umani.

### Aggiornamento da 0.6.0
- Esegui `sql/updates/0.7.0.sql`.

## [0.6.0] - 2026-09-25

### Aggiunto
- Director: decide quando arriva la prossima chiamata e quale, seguendo una curva di tensione (crescita nel turno + 2-3 picchi gaussiani). Nei picchi le chiamate arrivano a raffica; nelle valli c'è respiro; con la sala piena il ritmo rallenta.
- Adattamento alla performance: il Director osserva come vengono gestite le chiamate e alza o abbassa pressione e difficoltà entro limiti stretti. La difficoltà di riferimento cresce anche con il grado.
- Testimoni multipli dello stesso evento (stesso luogo e verità, chiamante e apertura diversi) da accorpare, ed eventi "gemelli" nella stessa zona che invece vanno trasferiti.
- 8 nuovi modelli (15 in totale): dolore al petto minimizzato, fumo da un appartamento, turista straniera con sospetto ictus (servizio di interpretariato), lite violenta sentita dal vicino, escursionista con la batteria che si scarica, auto fuori strada con conducente incastrato, bambino con la mamma che non si sveglia, «vorrei ordinare una pizza».
- Testimoni per il cassonetto in fiamme e il tamponamento.
- Condizioni nel dialogo (`sets_flag`, `reply_flag`, `unless_flag`...), linea che cade dopo un tempo (`drop_after_s`), nomi stranieri, tipologie accettabili.
- Nuovi tipi di evento: sospetto ictus, soccorso in ambiente impervio, violenza domestica.
- Debriefing: grafico dell'andamento del turno con la curva di tensione e le chiamate colorate per esito; testimoni e richiamate etichettati.
- Test: `tests/director.test.js` e nuovi casi in `tests/dialog.test.js`.

### Modificato
- Punteggio calcolato in aritmetica intera in JavaScript e PHP: il `round()` di PHP corregge gli errori dei decimali e poteva differire di un punto da JavaScript. Parità verificata su 60 turni simulati.
- XP ritarati (fattore punti 0,35): un turno ottimo vale circa 1000-1800 XP, uno buono 700-900.

### Aggiornamento da 0.5.0
- Esegui `sql/updates/0.6.0.sql` (versione e 15 modelli), oppure `php tools/import_templates.php`.

## [0.5.0] - 2026-09-25

### Aggiunto
- Valutazione deterministica di ogni chiamata su 5 assi: tempo, luogo, tipologia, enti, protocollo.
- Esito per evento (le richiamate appartengono all'evento originale): il ritardo effettivo parte dal primo squillo e include penalità per scheda incompleta (+45 s per campo), errore di luogo (tempo di percorrenza extra) e competenza PS/CC scambiata (+3 minuti). Esito positivo, parziale o negativo secondo la gravità dell'evento; un ente mancante peggiora di un livello, nessun ente utile dà esito negativo.
- Tolleranza sul luogo per zona (30 m in centro, 200 m in montagna).
- Voto del turno (S, A, B, C, D) pesato sulla difficoltà, con tetti: un esito negativo limita a B, due parziali ad A. XP con moltiplicatore per voto.
- Debriefing di fine turno: voto, XP e promozioni, assi medi, numeri del turno, e per ogni chiamata il confronto tra cosa era successo e cosa hai fatto, i tempi, le informazioni critiche (raccolte, mancanti o sbagliate), note specifiche e il suggerimento del modello.
- Salvataggio lato server: chiamate in `lifeline_shift_calls`, punteggio, voto ed XP ricalcolati dal server con le difficoltà del database, aggiornamento della carriera (XP, grado, statistiche).
- "Le tue medie" nella postazione operatore.
- Test: `tests/scoring.test.js` (scenari di valutazione) e `tests/scoring_parity.test.js` (parità delle formule JavaScript e PHP).

### Aggiornamento da 0.4.0
- Esegui `sql/updates/0.5.0.sql`.

## [0.4.0] - 2026-09-25

### Aggiunto
- Mappa di Valdemara in SVG: 5 zone, 32 vie con numerazione civica, punti di riferimento, torrente. Zoom con rotellina e pulsanti, trascinamento, nomi delle vie e dei riferimenti visibili con lo zoom.
- Posizione AML per i cellulari: cerchio di incertezza (da 20 m in centro a 3 km in montagna) che contiene sempre il punto reale, con centro spostato. Per le linee fisse: indirizzo di intestazione.
- La mappa si centra sulla chiamata quando rispondi; gli eventi già trasferiti restano segnati.
- Scheda contatto: luogo (via e civico dallo stradario o clic sulla mappa, con aggancio al civico più vicino), zona e competenza territoriale PS/CC, categoria e tipologia di evento, persone coinvolte, pericoli, note, enti.
- Dati minimi per il trasferimento (luogo, tipologia, ente) con conferma se la scheda è incompleta.
- Accorpamento dei duplicati a un evento già trasferito; chiusura delle chiamate non pertinenti con motivo (informazioni, scherzo, errore, chiamata muta).
- Una bozza di scheda per chiamata, conservata durante l'attesa.
- La scheda trasferita viene validata dal motore e registrata nel registro azioni (replay).
- Modulo geometrico condiviso (`game/geo.js`) e test dedicati (`tests/geo.test.js`).

### Modificato
- Console su tre colonne: linee e registro, chiamata, mappa e scheda. Il pannello della chiamata si adatta alla propria larghezza.
- `data/city_valdemara.json` alla versione 2, con geometria. I punti di riferimento citati dal chiamante sono i più vicini alla posizione reale.

### Rimosso
- Comandi provvisori di trasferimento della console.

### Aggiornamento da 0.3.0
- Esegui `sql/updates/0.4.0.sql`.

## [0.3.0] - 2026-09-25

### Aggiunto
- Modelli di chiamata nel database: il server li invia all'avvio del turno, filtrati per fase e grado.
- 7 modelli completi con varianti che cambiano la verità nascosta: anziana caduta (a volte serve anche il 115 per aprire la porta), cassonetto in fiamme (a volte c'è un ustionato), farmacia di turno (a volte nasconde un dolore toracico), scherzo, tamponamento (competenza PS o CC secondo la zona, feriti e perdite di carburante), ladri in casa, arresto cardiaco mascherato.
- Costruttore delle chiamate: variabili, stradario di Valdemara, segnaposto, verità calcolata dalle varianti.
- Dialogo a domande: ogni domanda costa secondi, le risposte dipendono dal panico, il chiamante può sbagliare (indirizzo, respiro...). Domande ripetibili per verificare, con segnalazione delle risposte discordanti.
- Rassicurazioni con efficacia decrescente; il silenzio dell'operatore fa salire il panico; mettere in attesa interrompe la domanda in corso; alcune domande fanno riattaccare il chiamante.
- Pannello "Informazioni raccolte" con ciò che il chiamante ha detto.
- Dati della città (`data/city_valdemara.json`) e tassonomia degli eventi (`data/event_types.json`).
- Strumento `tools/import_templates.php`: validazione, importazione con versionamento, generazione SQL.
- Documentazione del formato: `docs/template_format.md`. Nuovi test: `tests/dialog.test.js`.

### Rimosso
- Chiamate dimostrative (`stubs.js`) e pianificatore provvisorio.

### Aggiornamento da 0.2.0
- Esegui `sql/updates/0.3.0.sql` (versione + 7 modelli), oppure `php tools/import_templates.php`.

## [0.2.0] - 2026-09-25

### Aggiunto
- Motore di gioco deterministico a tick fissi (100 ms di gioco), indipendente dall'interfaccia.
- Generatore casuale con seed (sfc32) e flussi indipendenti per etichetta: arrivi, contenuti e richiamate non si influenzano a vicenda.
- Orologio di gioco: tempo reale quando c'è attività, accelerato ×90 quando la sala è vuota; pausa automatica se si cambia scheda del browser.
- 4 linee telefoniche con coda del centralino quando sono tutte occupate.
- Ciclo di vita della chiamata: in coda, squilla, in linea, in attesa, trasferita, chiusa, accorpata, abbandonata, caduta.
- Pazienza e panico del chiamante che cambiano durante squillo e attesa; chi riattacca può richiamare, più agitato.
- Registro azioni con numero di tick, salvato a fine turno: il turno si può riprodurre identico (base per la validazione server).
- API turni: avvio con seed generato dal server, chiusura con salvataggio del registro, abbandono.
- Console di collaudo: linee, chiamata in linea, registro eventi, pausa, abbandono, riepilogo di fine turno, scorciatoie da tastiera.
- Test automatici del motore (`tests/engine_replay.test.js`).

### Provvisorio
- Chiamate dimostrative in `assets/js/game/stubs.js` e pianificatore semplice: saranno sostituiti dai modelli nel database (step 3) e dal Director (step 6).

### Aggiornamento da 0.1.0
- Esegui `sql/updates/0.2.0.sql`.

## [0.1.0] - 2026-09-25

### Aggiunto
- Struttura del progetto e configurazione con override locale (`config/config.local.php`).
- Schema database MVP (prefisso `lifeline_`): utenti, carriere, modelli di chiamata, turni, chiamate del turno, log azioni, tentativi di accesso, impostazioni.
- API di autenticazione: registrazione, accesso, uscita, utente corrente, token CSRF.
- API profilo: lettura profilo e ultimi turni, cambio lingua ed email, cambio password.
- Sicurezza: password con `password_hash`, sessioni con cookie HttpOnly/SameSite e logout per inattività, protezione CSRF su tutte le richieste POST, limite ai tentativi di accesso e alle registrazioni, risposta a tempo costante per utenti inesistenti.
- Sistema di gradi con XP progressivi (1000, 2000, 3000… XP per grado).
- Interfaccia di accesso e postazione operatore, in italiano e inglese.
