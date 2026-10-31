# Formato dei modelli di chiamata

I modelli stanno in `sql/templates/<CODICE>.json` e si importano con:

```
php tools/import_templates.php --check     # solo validazione
php tools/import_templates.php             # validazione + importazione nel database
php tools/import_templates.php --sql > sql/seed/call_templates.sql   # script per phpMyAdmin
```

Se il contenuto di un modello cambia, `content_version` aumenta: i turni già giocati restano legati alla versione usata.

## Campi principali

| Campo | Significato |
|---|---|
| `code` | Identificativo `ABC_123` (SAN sanitaria, INC incendio/tecnico, SIC sicurezza, STR strada, IMP impropria) |
| `category` | `sanitaria`, `incendio_tecnico`, `sicurezza`, `mista`, `impropria` |
| `difficulty` | 1-10, usata dal pianificatore rispetto al grado del giocatore |
| `weight` | Frequenza relativa (100 = normale) |
| `time_bands` | Fasce in cui compare: `mattina`, `pomeriggio`, `sera`, `notte` |
| `variables` | Valori estratti a caso per ogni chiamata (vedi sotto) |
| `caller` | Chiamante: `gender` (f/m/any), `phone_type` (mobile/landline/any), `panic_start` 0-100, `ring_patience_s`, `hold_patience_s`, `reliability` 0-1, `callback_chance` 0-1 |
| `opening` | Prima frase, versione `calm` e `panic` (panico ≥ 60) |
| `facts` | Informazioni ottenibili: `display` è ciò che l'operatore annota, **come l'ha detto il chiamante**, non la diagnosi. `label` facoltativa |
| `nodes` | Domande e frasi dell'operatore |
| `truth` | Verità nascosta: `event_type`, `agencies_required`, `severity`, `critical_facts`, `hint_debrief` |

## Variabili

```json
"location": { "pool": "stradario", "zones": ["centro", "residenziale"], "floor": [0, 4] }
"nome":     { "pool": "names_f" }
"eta":      { "range": [58, 79] }
"variante": { "choice": [ {...}, {...} ], "weights": [70, 30] }
```

`location` fornisce: `street`, `street_wrong`, `number`, `number_wrong`, `floor`, `floor_text`, `zone`, `zone_name`, `landmark`, `police` (PS o CC secondo la zona), `aml_radius_m`.
Sempre disponibili: `caller_first`, `caller_surname`, `caller_name` e, dalla 1.2.0, `g` (accordo di genere, vedi sotto).

Nei testi si usa `{variabile}` o `{variabile.campo}`. Un segnaposto da solo, ad esempio `"{access.agencies}"`, restituisce il valore grezzo: così le varianti possono cambiare la verità (enti richiesti, tipo di evento).

## Nodi

```json
{
  "id": "q_dove",
  "label": "Mi dica l'indirizzo esatto.",
  "type": "question",              // oppure "reassure"
  "cost_s": 6,                     // secondi di conversazione
  "panic_delta": 0,                // effetto sul panico (le rassicurazioni ripetute valgono la metà ogni volta)
  "requires": ["q_altro"],         // visibile solo dopo queste domande
  "reveals": ["indirizzo"],        // fatti ottenuti
  "reply": { "calm": "...", "panic": "..." },
  "error": {                       // facoltativo: risposta sbagliata
    "threshold": 60, "chance": 0.5, "fact": "indirizzo",
    "display": "...", "reply": { "panic": "..." }
  },
  "ends_call": false               // true: il chiamante riattacca dopo la risposta
}
```

Probabilità di errore: `chance` se il panico è ≥ `threshold`, altrimenti `1 - reliability` del chiamante. Con `threshold` 101 l'errore dipende solo dall'affidabilità.

## Verità

`agencies_required` accetta enti (`118`, `115`, `PS`, `CC`) e segnaposto di varianti, anche annidati: la lista viene appiattita. `event_type` deve esistere in `data/event_types.json`.

## Campi aggiuntivi (dalla 0.6.0)

| Campo | Significato |
|---|---|
| `truth.acceptable_event_types` | Tipologie accettabili, valutate 80 invece di 100 |
| `truth.agencies_acceptable` | Enti non richiesti ma non penalizzati come superflui |
| `caller.first_pool`, `caller.surname_pool` | Elenchi di nomi dalla città (es. `names_de_f`, `surnames_de`) |
| `drop_after_s` | `[min, max]`: la linea cade dopo questi secondi di conversazione (batteria scarica) |
| `can_duplicate` + `duplicates` | Testimoni dello stesso evento: `chance`, `max`, `delay_s` `[min, max]`, `near_twin_chance` (evento distinto nella stessa zona) |
| `witness_opening` | Prima frase dei testimoni, `calm` e `panic`; stessi segnaposto del modello |

### Condizioni nel dialogo

```json
{ "id": "a_interprete", "sets_flag": "interprete", "hidden_if_flag": "interprete", ... }
{ "id": "q_dove",
  "reply_flag": { "flag": "interprete", "calm": "...", "panic": "..." },
  "error": { "unless_flag": "interprete", "threshold": 0, "chance": 1, ... } }
```

- `sets_flag`: attiva una condizione dopo la risposta.
- `requires_flag` / `hidden_if_flag`: la domanda compare solo con / senza la condizione.
- `reply_flag`: risposta alternativa quando la condizione è attiva.
- `error.unless_flag`: l'errore non si verifica se la condizione è attiva.

## Campi aggiuntivi (dalla 0.9.0)

| Campo | Significato |
|---|---|
| `variables.location.streets` | Elenco di vie tra cui scegliere (es. solo quelle vicine al torrente); se vuoto, qualsiasi via delle zone indicate |
| `aml.available: false` | Nessun cerchio AML: per chi chiama da lontano (es. una figlia che chiama da un'altra città) |
| `truth.severity: "{sc.sev}"` | Gravità presa dalla variante: ogni situazione della famiglia ha i suoi tempi |
| `truth.acceptable_event_types: "{sc.acc}"` | Tipologie accettabili prese dalla variante |

### Famiglie di situazioni

Un modello può contenere più situazioni diverse in una variabile a scelta (per convenzione `sc`), ciascuna con testi, verità, enti e gravità propri:

```json
"sc": { "choice": [
  { "open": "Mio figlio ha l'asma…", "event": "sanitaria.difficolta_respiratoria", "sev": {"optimal_s": 240, "acceptable_s": 480, "limit_s": 1200} },
  { "open": "Mia moglie ha mangiato dei gamberetti…", "event": "sanitaria.reazione_allergica", "sev": {"optimal_s": 180, "acceptable_s": 360, "limit_s": 900} }
], "weights": [60, 40] }
```

e poi `"opening": {"calm": "{sc.open}"}`, `"truth": {"event_type": "{sc.event}", "severity": "{sc.sev}"}`.

## Campi aggiuntivi (dalla 1.2.0)

Tutti i campi seguenti sono **facoltativi**. Un modello che non li usa si comporta esattamente come nella 1.1.0: stesse estrazioni casuali, stesse impronte di replay. Le nuove estrazioni (tempi della cronologia) usano solo il flusso dedicato `timeline`, derivato da quello della chiamata.

### Forme dei testi

Ovunque il chiamante parla (`opening`, `witness_opening`, `callback_opening`, `reply`, `reply_flag`, `error.reply`, `repeat`, `switch_caller.opening`, `timeline[].say`, `idle_lines`, `deterioration[].line`) il testo è un oggetto con le chiavi `calm`, `panic` e, novità, `hyst`. Serve almeno `calm` o `panic`; altre chiavi sono un errore (in `reply_flag` è ammessa anche `flag`).

Ogni valore è una stringa non vuota **oppure** un elenco non vuoto di stringhe non vuote:

```json
"reply": {
  "calm":  ["Via Roma 12, secondo piano.", "Sono in via Roma, al 12. Secondo piano."],
  "panic": "Via Roma… il 12! Faccia presto!",
  "hyst":  "Via… via… non mi ricordo! Aiuto!"
}
```

- **Livello.** `calm` sotto panico 60, `panic` da 60, `hyst` da 85. Se manca il testo del livello si scende: `hyst` → `panic` → `calm` (e `calm` → `panic`).
- **Elenchi.** Nelle risposte si usa l'elemento `n % lunghezza`, dove `n` è il numero di volte che la domanda ha già ricevuto risposta: la prima volta il primo, alla seconda richiesta il secondo, e così via. Per `opening`, `witness_opening` e `callback_opening` l'elemento dipende dal numero di telefono del chiamante (stabile, nessuna estrazione casuale). In `timeline` e `deterioration` si usa il primo elemento, in `idle_lines` il contatore delle frasi di attesa.
- Il livello finisce anche nell'evento `dialog:reply` (`lvl`: `calm`, `panic`, `hyst`), così la voce può essere più concitata.

### Domande ripetute: `repeat`

```json
{ "id": "q_dove", "reply": {...},
  "repeat": { "calm": "Gliel'ho detto: via Roma 12.", "panic": "Via Roma 12! Gliel'ho già detto!" } }
```

Dalla seconda risposta in poi si usa `repeat` (se è un elenco: prima ripetizione il primo elemento, e così via). Senza `repeat`, un chiamante nel panico (≥ 60) a cui si rifà la stessa domanda antepone `city.generic_lines.repeat_panic` («Gliel'ho già detto!»). Il prefisso non compare mai:
- sulle risposte di `reply_flag` né sulle risposte sbagliate (`error`);
- sui nodi che hanno un blocco `error` attivo: altrimenti l'assenza del prefisso rivelerebbe al giocatore che la risposta è sbagliata. Per quei nodi, se serve, si scrive un `repeat` (vale solo per le risposte corrette, ma ha lo stesso tono di quelle sbagliate).

### Genere del chiamante: `gender: "any"` e `{g.*}`

Con `caller.gender` `"any"` (o assente) il genere si estrae a caso. Per scrivere frasi accordate senza varianti, il costruttore aggiunge la variabile `g` (derivata dal genere, nessuna estrazione):

| Segnaposto | Donna | Uomo |
|---|---|---|
| `{g.o}` | `a` | `o` |
| `{g.lui}` | `lei` | `lui` |
| `{g.sig}` | `Signora` | `Signore` |

Esempio: `"Sono bloccat{g.o} in ascensore"`, `"label": "Resti tranquill{g.o}, arriviamo."`. Per i testimoni `g` segue il genere del testimone. Con genere `any` evitare parole accordate senza `{g.o}` (il `--lint` le segnala).

### Voce del chiamante: `caller.voice` e `witness_voice`

`caller.voice` accetta la vecchia stringa `"child"` oppure un oggetto:

```json
"caller": { "gender": "f", "voice": { "age": "elderly", "accent": "de", "style": "breathless" } }
```

| Chiave | Valori |
|---|---|
| `age` | `child`, `adult`, `elderly` |
| `accent` | facoltativo, codice lingua a due lettere (`de`, `ro`, `en`…) |
| `style` | facoltativo: `whisper`, `breathless`, `slurred`, `crying` |

`witness_voice` (al primo livello) ha la stessa forma e vale per i testimoni, il cui genere resta quello estratto per il testimone. Il costruttore espone `content.caller.voiceProfile = { kind: 'male'|'female'|'child', age, accent?, style? }` e mantiene la vecchia stringa `content.caller.voice` (`child`/`female`/`male`, usata per le icone). La voce è solo presentazione: non cambia mai la simulazione.

### Richiamata: `callback_opening`

```json
"callback_opening": { "calm": "Sono io di nuovo, ho chiamato prima…", "panic": "Sono di nuovo io! Mia madre adesso non risponde più!" }
```

Prima frase quando il chiamante, dopo aver riattaccato, richiama. Gli stessi segnaposto del modello. Senza questo campo si usano `city.generic_lines.callback_calm` / `callback_panic`. Il costruttore lo espone come `content.callbackOpening` (`null` se assente); i testimoni non lo ereditano.

### Cronologia del chiamante: `timeline`

Frasi che il chiamante dice da solo, a un certo punto della conversazione (il tempo in attesa non conta: il tempo si ferma con la chiamata in attesa).

```json
"timeline": [
  { "id": "smette", "at_s": [60, 90], "unless_flag": "rcp",
    "say": { "calm": "Aspetti… non respira più!", "panic": "Non respira più! Non respira più!" },
    "panic_delta": 25, "sets_flag": "arresto", "interrupt": true },
  { "id": "batteria", "at_s": 45, "say": { "calm": "(bip) Ho la batteria quasi a zero…" } }
]
```

| Chiave | Significato |
|---|---|
| `id` | Obbligatorio, `[a-z0-9_]`, unico nella cronologia |
| `at_s` | Secondi di conversazione: un intero o `[min, max]` (estratto dal flusso `timeline`) |
| `say` | Testo (forme sopra; per gli elenchi si usa il primo elemento) |
| `if_flag` / `unless_flag` | Scatta solo con / senza la condizione |
| `unless_asked` | Id di nodo (o elenco): non scatta se l'operatore ha già fatto una di quelle domande |
| `panic_delta` | Variazione del panico, applicata prima di scegliere il livello del testo |
| `reveals` | Fatti ottenuti; **mai** fatti di `truth.critical_facts` (il protocollo li richiede all'operatore) |
| `sets_flag` | Condizione attivata (sblocca nodi con `requires_flag`, risposte `reply_flag`…) |
| `ends_call` | Il chiamante riattacca dopo la frase |
| `interrupt` | `true`: interrompe la domanda in corso (che va persa e va rifatta); altrimenti aspetta che la risposta arrivi |

Ogni voce scatta al massimo una volta, nel primo momento dopo `at_s` in cui le condizioni sono vere (se non lo diventano mai, non scatta). Nella trascrizione e nell'evento `dialog:reply` il nodo è `tl:<id>`. I testimoni non hanno cronologia.

### Frasi di attesa: `idle_lines`

```json
"idle_lines": { "calm": ["Pronto? È ancora lì?"], "panic": ["Pronto?! Mi sente?!", "C'è qualcuno?!"] }
```

Dopo 12 s di silenzio dell'operatore (nessuna domanda in corso) il chiamante dice una di queste frasi, a turno, poi di nuovo ogni 12 s di silenzio. Il panico continua a salire come prima: le frasi di attesa non contano come risposta dell'operatore. Nodo `idle` nell'evento `dialog:reply`.

### Cambio di interlocutore: `switch_caller`

Su un nodo: dopo la risposta, il telefono passa a un'altra persona (vicino, adulto, interprete).

```json
{ "id": "q_vicina", "label": "C'è un adulto lì vicino? Me lo passi.", "cost_s": 8,
  "sets_flag": "adulto", "hidden_if_flag": "adulto",
  "reply": { "calm": "Sì, c'è la signora del piano di sopra… gliela passo." },
  "switch_caller": {
    "name": "La vicina", "gender": "f", "voice": { "age": "elderly" },
    "panic_start": 35, "reliability": 0.95,
    "opening": { "calm": "Pronto, sono la vicina. Mi dica, cosa devo fare?" }
  } }
```

| Chiave | Significato |
|---|---|
| `name` | Facoltativo: etichetta mostrata accanto alle frasi (accetta segnaposto) |
| `gender` | Obbligatorio, `f` o `m` |
| `voice` | Facoltativo: stringa o oggetto come `caller.voice` |
| `panic_start` | Obbligatorio, 0-100: il panico della chiamata diventa questo valore (senza estrazioni) |
| `reliability` | Facoltativo, 0-1 (predefinito 1): da qui in poi gli errori usano l'affidabilità della nuova persona |
| `opening` | Obbligatorio: prima frase della nuova persona, detta circa 2 s dopo la risposta |

Da quel momento le frasi del chiamante nella trascrizione hanno `speaker: { name, gender, voice }`. Combinare con `sets_flag` / `requires_flag` per sbloccare le domande che solo la nuova persona sa. Se il nodo fa anche riattaccare (`ends_call`), il cambio non avviene.

### Peggioramento: `deterioration`

Comportamento a cura del motore (regole `deterioration` attive, carriera); il formato è:

```json
"deterioration": [
  { "after_s": 240, "sets_flag": "arresto", "panic": 20,
    "line": { "calm": "Non respira più!", "panic": "Non respira più! Faccia presto!" } }
]
```

Da 1 a 3 stadi, `after_s` crescenti (secondi dall'arrivo della prima chiamata dell'evento), `sets_flag` e `line` facoltativi, `panic` intero. Il costruttore lo espone risolto come `content.deterioration` (`null` se assente).

### Modelli disattivati: `is_active`

`"is_active": 0` al primo livello importa il modello disattivato (non entra nei turni), ad esempio in attesa di revisione. L'importazione di un modello già presente non cambia `is_active`: per attivarlo dopo la revisione si aggiorna la riga nel database (`UPDATE … SET is_active = 1 WHERE code = '…'`). I test in Node caricano comunque tutti i file di `sql/templates`.

### Punti di riferimento e articoli

I punti di riferimento della città hanno l'articolo (`il supermercato`, `la malga`, `l'agriturismo`): scrivere «c'è {location.landmark} lì vicino», «verso {location.landmark}», «presso {location.landmark}», mai «vicino a {location.landmark}» (darebbe «vicino a il supermercato»). I segnaposto accettano solo lettere minuscole e `_`: niente cifre nei nomi delle chiavi (`{sc.i1}` non verrebbe mai risolto).

### Controlli in `--check` e `--lint`

```
php tools/import_templates.php --check     # errori bloccanti
php tools/import_templates.php --lint      # errori + avvisi (non bloccanti)
```

Oltre ai controlli precedenti, `--check` verifica:
- le forme dei testi in tutti i campi sopra (stringa o elenco di stringhe, chiavi ammesse);
- `caller.gender` (`f`, `m`, `any`), `caller.voice`, `witness_voice`, `timeline`, `idle_lines`, `switch_caller`, `callback_opening`, `deterioration`, `repeat`;
- ogni fatto di `truth.critical_facts` esiste in `facts` ed è rivelato da almeno un nodo dell'operatore;
- ogni condizione usata (`requires_flag`, `hidden_if_flag`, `reply_flag.flag`, `error.unless_flag`, `if_flag`, `unless_flag`) è attivata da qualcosa (`sets_flag` di un nodo, della cronologia o di un peggioramento);
- gli elenchi di nomi (`first_pool`, `surname_pool`, variabili `pool`) esistono nella città.

`--lint` aggiunge avvisi: testi `calm` identici a `panic`, etichetta di `q_dove` identica in molti modelli, parole accordate nelle frasi dei chiamanti di genere `any` senza `{g.o}`, nessun nodo di rassicurazione, parentesi che non sono indicazioni di scena note (`sussurra`, `piange`, `interprete`, `riattacca`, `silenzio`…).
