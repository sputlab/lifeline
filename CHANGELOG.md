# Changelog - LifeLine

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/), versioni secondo [SemVer](https://semver.org/lang/it/).

## [1.2.0] - 2026-10-31

### Voce e audio
- **Voce reale dei chiamanti**: i chiamanti pronunciano davvero le loro frasi con la sintesi vocale del browser.
  - Ogni chiamante ha una voce stabile: chi richiama ha la stessa voce, testimoni e interprete ne hanno un'altra.
  - Tono per sesso ed età; ritmo che cresce con il panico, fino al tono isterico.
  - Le frasi in inglese o tedesco usano una voce straniera, se il browser ne ha una.
- **Didascalie mai lette**: «(sussurra)», «(piange)», «(risate)» e simili diventano effetti (sussurro, singhiozzi, risate) e non vengono più lette.
- **Ritmo della conversazione**: con la lunghezza «Adattiva» le frasi lunghe vengono dette più in fretta o si fermano a fine frase; il testo nella nuvoletta resta completo. Una nuova domanda interrompe il chiamante.
- **Voce tagliata subito** su attesa, pausa, cambio linea e riattacco: niente più voci «fantasma» della chiamata precedente.
- **Effetto telefonico migliorato**: dove il browser non ha voci italiane, il parlato sintetico segue sillabe e punteggiatura della frase (domande che salgono, pause sui puntini), con un timbro diverso per ogni chiamante. Fisso e cellulare suonano diversi.
- **Mixer**: volumi separati per voce ed effetti; squilli e sirene si abbassano mentre il chiamante parla, ma uno squillo urgente resta udibile.
- **Nuova finestra Impostazioni** (ingranaggio nella console e nella postazione; sostituisce il pulsante Suoni e il cursore del volume; il turno si ferma mentre è aperta):
  - modalità voce: Automatica, Voce reale, Voce HD, Effetto telefonico, Disattivata
  - lunghezza del parlato e voce preferita
  - lettura delle domande dell'operatore e pulsanti «Prova voce»
  - dimensione del testo, animazioni e scorrimento del testo
- **Preferenze**: le preferenze audio passano a `lifeline.prefs`. Le impostazioni 1.1 vengono importate: chi aveva i suoni spenti li ritrova spenti.
- **Numeri ordinali letti bene**: «3° piano» si legge «terzo piano» (prima la voce diceva «3 gradi piano»); vale anche per 1°-20°, per «º» e per il femminile «2ª».
- **Voce HD (facoltativa)**:
  - voce neurale italiana Piper (paola femminile, riccardo maschile), filtrata come una vera linea telefonica, generata in un worker separato
  - si scarica solo premendo «Scarica» nelle impostazioni: circa 116 MB, una volta sola, nella cache `ll-tts-v1` (che il service worker non cancella); si può eliminare dalle impostazioni
  - componenti con versione fissata: onnxruntime-web 1.18.0 e @diffusionstudio/piper-wasm 1.0.0 (jsDelivr), voci da rhasspy/piper-voices (Hugging Face)
  - licenze: repository piper-voices MIT; paola addestrata su un dataset CC0-1.0; riccardo sul dataset M-AILABS (audio LibriVox di pubblico dominio, termini da confermare); il fonemizzatore include espeak-ng (GPL-3.0), scaricato dalla CDN e non distribuito con LifeLine. I crediti sono nelle impostazioni
  - se una frase tarda o qualcosa non funziona, si torna alla voce del browser

### Console
- Schermata di accesso con l'icona di LifeLine in grande sopra il titolo.
- La conversazione non si ridisegna più a ogni battuta: compaiono solo le frasi nuove, e chi sta rileggendo più in alto non viene riportato in fondo (appare la pillola «Nuovi messaggi»).
- L'ultima frase del chiamante compare parola per parola al ritmo della voce. Un clic o il tasto S la mostrano subito; con i sottotitoli istantanei o il movimento ridotto compare intera. Le barre della voce seguono la battuta che si sente davvero.
- Se in chiamata parla un'altra persona (vicina, mamma, interprete) il suo nome compare sopra la nuvoletta.
- Le domande restano al loro posto: le nuove si illuminano brevemente e il fuoco della tastiera non si perde.
- Pillole Luogo / Evento / Ente nella scheda contatto: mostrano cosa manca e portano al campo con un clic. Il pulsante Trasferisci avverte quando si sta trasferendo una scheda incompleta.
- Nuovi tasti: A (via), Z/X/C/V (118, 115, Polizia, Carabinieri), G (trasferisci), S (salta la voce), Ctrl/Cmd+Invio (trasferisci dalla scheda). I suggerimenti dei tasti sono nascosti sugli schermi touch.
- Le linee mostrano «Già chiamato alle HH:MM (esito)» per i numeri che hanno già chiamato. Nella scheda del chiamante compare lo storico, con «Accorpa a #id».
- Età dell'evento colorata rispetto ai tempi della sua gravità e avviso quando la situazione peggiora.

### Accessibilità
- I lettori di schermo annunciano le frasi complete del chiamante, le nuove informazioni e i cambi di completezza della scheda, senza più rileggere i timer a ogni frame.
- Etichette piccole ad almeno 0.72rem con contrasto 4.5:1; etichetta «Pericoli» tradotta.
- Il tasto Tab resta dentro la pausa e la fine turno.
- La dimensione del testo vale per conversazione, domande e scheda; il movimento ridotto si può scegliere anche dalle impostazioni.

### Motore di dialogo
- **Risposte più vive**: i testi del chiamante possono avere più formulazioni (elenchi) e un terzo livello `hyst` per il panico estremo (≥ 85).
- **Domande ripetute**: dalla seconda richiesta il chiamante risponde con `repeat`. Senza `repeat`, nel panico, sbotta «Gliel'ho già detto!»; mai sulle risposte sbagliate né sui nodi che possono sbagliare.
- **Cronologia del chiamante** (`timeline`): frasi spontanee a tempo, per esempio «non respira più», con condizioni, interruzione della domanda in corso e attivazione di condizioni. Il tempo si ferma in attesa.
- **Frasi nel silenzio** (`idle_lines`) dopo 12 s senza domande.
- **Cambio di interlocutore** (`switch_caller`): vicino, adulto o interprete prendono il telefono, con nome, voce, panico e affidabilità propri. Il panico finale della chiamata è quello di chi parla per ultimo, quindi conta nella parte «gestione del panico» dell'asse protocollo.
- **Costruttore**: accordo di genere `{g.o}`, `{g.lui}`, `{g.sig}` per i chiamanti di genere `any`; profilo voce (`caller.voice` come oggetto, `witness_voice`); apertura della richiamata (`callback_opening`); stadi di peggioramento (`deterioration`).
- **Validatore**: controlli rigorosi dei nuovi campi; i fatti critici devono essere chiesti dall'operatore; ogni condizione usata deve poter essere attivata; gli elenchi di nomi devono esistere nella città. Nuova modalità `--lint` con avvisi di stile. Campo `is_active` per importare un modello disattivato.
- Documentazione del formato aggiornata in `docs/template_format.md`.

### Meccaniche
- **Le emergenze peggiorano col tempo** (solo in carriera). I modelli definiscono fasi di peggioramento legate al tempo trascorso dal primo arrivo dell'evento. A ogni fase si attiva una condizione (per esempio «non respira più», che cambia le risposte), il panico sale e il chiamante dice una frase: subito se è in linea, alla ripresa se è in attesa. Il peggioramento si ferma quando l'evento viene trasferito. Richiamate e testimoni arrivano con la situazione già peggiorata. Nessuna estrazione casuale.
- **Storico del numero**: il motore elenca le chiamate già arrivate dallo stesso numero (`callsByPhone`), con stato, ora di chiusura ed enti.
- **Chi richiama ha una frase propria**: l'apertura da richiamata del modello o, se manca, una frase generica della città, invece di ripetere la prima frase.
- **Nuova nota nel debriefing** quando i soccorsi partono entro il tempo ottimale. Il punteggio non cambia.
- **Regole del motore versionate**: il server indica a ogni turno la versione delle regole e le meccaniche attive (carriera: versione 2 con peggioramento; addestramento: versione 2 senza) e le salva nella nuova colonna `lifeline_shifts.rules_json`, insieme a linee e accelerazione, per poter rigiocare il turno. Senza regole il motore si comporta esattamente come nella 1.1.0. Dalla versione 2 l'impronta di verifica include anche lo stato del dialogo.

### Debriefing
- **«Rivedi la chiamata»**: ogni chiamata contiene la conversazione completa, con minuto e secondo di ogni battuta. Le domande che hanno fatto emergere un'informazione critica sono in verde se la risposta era giusta, in rosso se era sbagliata. Compaiono anche il nome di chi parla quando il telefono passa a un'altra persona e le battute spontanee del chiamante.
- **Informazioni critiche mancanti**: per ognuna viene indicata la domanda che bastava porre.
- **Elenco delle chiamate**: si può ordinare per orario o per punteggio, e la chiamata andata peggio si apre da sola.

### Contenuti delle chiamate
- **Dieci nuovi scenari** (65 modelli in totale):
  - neonato che non respira (rianimazione e disostruzione nel lattante);
  - auto contromano, con testimoni che la vedono in punti diversi;
  - spari o petardi?;
  - la badante romena, con l'interprete;
  - chiamante abituale ubriaco;
  - scherzo con un allarme antifumo vero;
  - anziano confuso alla fermata;
  - bambino chiuso in auto al sole;
  - monossido sotto la doccia, in garage o in taverna;
  - batteria al litio che fuma.
- **«Persona in crisi» (SIC_056)**, nuova tipologia `sicurezza.persona_in_crisi`: scritto ma **disattivato** (`is_active = 0`) in attesa di revisione. Il debriefing indica i servizi di ascolto e il Centro di salute mentale, senza numeri. Per attivarlo dopo la revisione: `UPDATE lifeline_call_templates SET is_active = 1 WHERE code = 'SIC_056';`.
- **Rianimazione guidata al telefono** in «Non si sveglia» (SAN_007) e «Persona a terra in strada» (SAN_019): a terra sulla schiena, mani al centro del petto, spinte forti e veloci.
- **Chiamate che cambiano**: frasi spontanee («non respira più», «stanno salendo le scale», il bip della batteria); il telefono passa a una vicina, alla mamma o a un interprete, ciascuno con la propria voce; frasi di richiamata su misura in 13 modelli; peggioramenti dell'evento in 11 modelli gravi.
- **Dialoghi più vari**: più formulazioni, panico estremo, risposte nel panico diverse da quelle calme, voci con età, accento e tono in 30 modelli.
- **Valutazione per variante**: SIC_043, IMP_046, IMP_048 e INC_034 hanno ora gravità (tempi ottimale, accettabile e limite), consiglio del debriefing e, per SIC_043, tipologie accettabili diverse per ciascuna variante (la lite violenta richiede `lite_violenza`). Cambiano quindi i tempi di riferimento e il punteggio di queste chiamate. Difficoltà, peso, grado minimo e fasce orarie dei modelli esistenti non cambiano.
- **Correzioni**: accordo maschile e femminile per chi chiama; consigli giusti per ogni situazione (soffocamento, allergia, asma); niente più «vicino a il supermercato» né segnaposto non risolti; domande sull'indirizzo adatte al contesto; errori sulla via, non solo sul civico.
- **Modelli brevi arricchiti**: rumori molesti, farmacia di turno, richieste non urgenti, animale in difficoltà; ogni modello ha almeno una frase di rassicurazione.
- Città: nomi e cognomi romeni, frasi generiche per richiamate, domande ripetute e interprete. `data/event_types.json` alla versione 4.

### Test
- Nuovi: `speechtext.test.js`, `prefs.test.js`, `callaudio.test.js` (la voce non cambia l'impronta del motore), `form_missing.test.js`, `mechanics.test.js`; modelli di prova in `tests/fixtures/t120`.

### Rimandato alla 1.3
- Sottofondi ambientali delle chiamate (S1); profili di linea e cali di batteria (S2), richiami nel silenzio (V7).
- Console: ui-3, ui-6, ui-9, ui-10 (aiuto dei tasti `?`).
- Meccaniche: M2, M4 (aggravamenti con nuovo chiamante), M7, M8, M9 (richiamare un numero).
- Medaglie (M6) e riepilogo nella postazione; modello SIC_067.

### Aggiornamento da 1.1.0
- Carica tutti i file, esegui `sql/updates/1.2.0.sql` (versione, colonna `rules_json`, 65 modelli) e ricarica con Ctrl+F5. Il nuovo service worker aggiorna da solo la cache dei file.

## [1.1.0] - 2026-10-28

### PWA
- LifeLine si può installare come app su desktop (Chrome, Edge), Android e iOS/iPadOS («Aggiungi alla schermata Home»), con finestra dedicata a schermo intero e icona propria.
- Nuova icona principale `assets/icons/master.png` e set completo generato da `tools/make_icons.swift`: 16-512 px, versioni *maskable* (192 e 512) per Android e `apple-touch-icon` (120, 152, 167, 180) senza trasparenza per iOS.
- `manifest.webmanifest`: nome, colori, orientamento orizzontale, ambito relativo (funziona anche in una sottocartella del dominio).
- `sw.js` (service worker): file statici in cache per un avvio rapido; pagina principale con rete prioritaria e copia di riserva; `api/*` mai in cache; font di Google in cache. La cache si rinnova da sola a ogni versione.
- `offline.html`: schermata mostrata se l'app viene aperta senza connessione. Il gioco richiede comunque la rete per accesso e turni.
- `assets/js/pwa.js`: registra il service worker e applica gli aggiornamenti; non ricarica mai la pagina durante un turno.
- `.htaccess` nella radice: tipo MIME del manifest e `sw.js` sempre rivalidato.
- Meta tag per colore della barra, icone e modalità app su iOS in `index.php`.

### Aggiornamento da 1.0.0
- Carica tutti i file (comprese `assets/icons/`, `manifest.webmanifest`, `sw.js`, `offline.html`, `.htaccess`), esegui `sql/updates/1.1.0.sql` e ricarica con Ctrl+F5. Serve HTTPS (o `localhost`) perché il service worker si attivi.

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
