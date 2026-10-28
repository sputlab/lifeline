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
| `caller` | Chiamante: `gender` (f/m), `phone_type` (mobile/landline/any), `panic_start` 0-100, `ring_patience_s`, `hold_patience_s`, `reliability` 0-1, `callback_chance` 0-1 |
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
Sempre disponibili: `caller_first`, `caller_surname`, `caller_name`.

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
