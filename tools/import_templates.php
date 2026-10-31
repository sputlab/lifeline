<?php
/**
 * LifeLine - Importazione e validazione dei modelli di chiamata
 *
 * Uso (solo da riga di comando):
 *   php tools/import_templates.php                 valida e importa sql/templates/*.json nel database
 *   php tools/import_templates.php --check         solo validazione
 *   php tools/import_templates.php --lint          validazione + avvisi di stile (non bloccanti)
 *   php tools/import_templates.php --sql > f.sql   genera lo script SQL (per phpMyAdmin), senza database
 *   (si può indicare una cartella diversa, es. tests/fixtures/t120)
 *
 * Se un modello esiste già (stesso code) e il contenuto è cambiato,
 * content_version viene incrementata: i turni salvati restano riferiti alla versione giocata.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

require __DIR__ . '/../includes/bootstrap.php';

const CATEGORIES = ['sanitaria', 'incendio_tecnico', 'sicurezza', 'mista', 'impropria'];
const BANDS      = ['mattina', 'pomeriggio', 'sera', 'notte'];
const NODE_TYPES = ['question', 'reassure'];

// Campi della 1.2.0 (vedi docs/template_format.md)
const TEXT_LEVELS  = ['calm', 'panic', 'hyst'];
const GENDERS      = ['f', 'm', 'any'];
const VOICE_NAMES  = ['child', 'adult', 'elderly', 'male', 'female'];
const VOICE_AGES   = ['child', 'adult', 'elderly'];
const VOICE_STYLES = ['whisper', 'breathless', 'slurred', 'crying'];
const FLAG_RE      = '/^[a-z_]+$/';
const TIMELINE_KEYS = ['id', 'at_s', 'say', 'if_flag', 'unless_flag', 'unless_asked', 'panic_delta', 'reveals', 'sets_flag', 'ends_call', 'interrupt'];
const SWITCH_KEYS  = ['name', 'gender', 'voice', 'panic_start', 'reliability', 'opening'];
const DETER_KEYS   = ['after_s', 'sets_flag', 'panic', 'line'];
// Indicazioni di scena note tra parentesi (solo per --lint)
const CUE_PHRASES  = ['sussurra', 'sottovoce', 'piange', 'singhiozza', 'tira su col naso', 'risate', 'risata', 'una risata',
    'interprete', 'riattacca', 'silenzio', 'una lunga pausa', 'lunga pausa', 'fruscio', 'voce di bambino', 'bip', 'tossisce', 'ansima'];
// Accordi al maschile riferiti a chi chiama (solo per --lint, genere "any"):
// in prima persona nelle sue frasi, in seconda persona nelle rassicurazioni dell'operatore
const GENDERED_RE  = '/\b(?:sono|mi sento|resto|sto|rimango|ero)\s+(?:\S+\s+)?(bloccato|tranquillo|seduto|fermo|solo|caduto|ferito|sicuro|stanco|preoccupato|chiuso|salito|uscito|entrato|rimasto)\b|\bio\s+da\s+solo\b/iu';
const GENDERED_OP_RE = '/\b(?:resti|stia|rimanga)\s+(?:\S+\s+)?(tranquillo|fermo|seduto|calmo|sereno|solo)\b/iu';

$args  = array_slice($argv, 1);
$mode  = in_array('--sql', $args, true) ? 'sql'
    : (in_array('--lint', $args, true) ? 'lint' : (in_array('--check', $args, true) ? 'check' : 'import'));
$dirs  = array_values(array_filter($args, fn($a) => !str_starts_with($a, '--')));
$dir   = $dirs[0] ?? __DIR__ . '/../sql/templates';

$eventTypes = json_decode((string) file_get_contents(__DIR__ . '/../data/event_types.json'), true);
$validEvents = [];
foreach ($eventTypes['categories'] as $cat => $list) {
    foreach ($list as $e) {
        $validEvents[] = "$cat.$e";
    }
}
$city = json_decode((string) file_get_contents(__DIR__ . '/../data/city_valdemara.json'), true) ?: [];

function is_assoc($v): bool
{
    return is_array($v) && ($v === [] || !array_is_list($v));
}

/** Stringa non vuota oppure elenco non vuoto di stringhe non vuote. */
function is_text_value($v): bool
{
    if (is_string($v)) {
        return trim($v) !== '';
    }
    if (!is_array($v) || !$v || !array_is_list($v)) {
        return false;
    }
    foreach ($v as $s) {
        if (!is_string($s) || trim($s) === '') {
            return false;
        }
    }
    return true;
}

/** Errori di un testo { calm, panic, hyst }; $extra: chiavi in più ammesse (es. "flag"). */
function text_errors($pair, string $where, array $extra = []): array
{
    if (!is_assoc($pair) || $pair === []) {
        return ["$where: deve essere un oggetto { calm, panic, hyst }"];
    }
    $err = [];
    foreach ($pair as $k => $v) {
        if (in_array($k, $extra, true)) {
            continue;
        }
        if (!in_array($k, TEXT_LEVELS, true)) {
            $err[] = "$where: chiave \"$k\" non ammessa (calm, panic, hyst)";
        } elseif (!is_text_value($v)) {
            $err[] = "$where.$k: serve una stringa non vuota o un elenco di stringhe non vuote";
        }
    }
    if (!array_key_exists('calm', $pair) && !array_key_exists('panic', $pair)) {
        $err[] = "$where: serve almeno calm o panic";
    }
    return $err;
}

/** Errori di una voce: stringa nota o { age, accent, style }. */
function voice_errors($v, string $where): array
{
    if (is_string($v)) {
        return in_array($v, VOICE_NAMES, true) ? [] : ["$where: voce \"$v\" non valida"];
    }
    if (!is_assoc($v)) {
        return ["$where: deve essere una stringa o un oggetto { age, accent, style }"];
    }
    $err = [];
    foreach (array_keys($v) as $k) {
        if (!in_array($k, ['age', 'accent', 'style'], true)) {
            $err[] = "$where: chiave \"$k\" non ammessa";
        }
    }
    if (isset($v['age']) && !in_array($v['age'], VOICE_AGES, true)) {
        $err[] = "$where.age deve essere " . implode(', ', VOICE_AGES);
    }
    if (isset($v['accent']) && !(is_string($v['accent']) && preg_match('/^[a-z]{2}$/', $v['accent']))) {
        $err[] = "$where.accent deve essere un codice di due lettere";
    }
    if (isset($v['style']) && !in_array($v['style'], VOICE_STYLES, true)) {
        $err[] = "$where.style deve essere " . implode(', ', VOICE_STYLES);
    }
    return $err;
}

function unknown_keys(array $o, array $allowed, string $where): array
{
    $err = [];
    foreach (array_keys($o) as $k) {
        if (!in_array($k, $allowed, true)) {
            $err[] = "$where: chiave \"$k\" non ammessa";
        }
    }
    return $err;
}

function valid_flag($v): bool
{
    return is_string($v) && preg_match(FLAG_RE, $v) === 1;
}

/** Controlli dei campi della 1.2.0 (testi, voce, cronologia, cambio di interlocutore, peggioramento...). */
function validate_v120(array $t, array $city): array
{
    $err = [];
    $facts = is_array($t['facts']) ? $t['facts'] : [];
    $nodes = is_array($t['nodes']) ? $t['nodes'] : [];
    $nodeIds = [];
    foreach ($nodes as $n) {
        if (isset($n['id'])) {
            $nodeIds[$n['id']] = true;
        }
    }
    $critical = array_values(array_filter(is_array($t['truth']['critical_facts'] ?? null) ? $t['truth']['critical_facts'] : [],
        fn($f) => is_string($f) && !str_starts_with($f, '{')));
    $setters = [];
    $consumers = [];

    // Chiamante e voce
    $cl = is_array($t['caller']) ? $t['caller'] : [];
    if (isset($cl['gender']) && !in_array($cl['gender'], GENDERS, true)) {
        $err[] = 'caller.gender deve essere f, m o any';
    }
    if (isset($cl['voice'])) {
        $err = array_merge($err, voice_errors($cl['voice'], 'caller.voice'));
    }
    if (isset($t['witness_voice'])) {
        $err = array_merge($err, voice_errors($t['witness_voice'], 'witness_voice'));
    }
    foreach (['first_pool', 'surname_pool'] as $p) {
        if (isset($cl[$p]) && !is_array($city[$cl[$p]] ?? null)) {
            $err[] = "caller.$p: l'elenco \"{$cl[$p]}\" non esiste nella città";
        }
    }
    foreach (is_array($t['variables'] ?? null) ? $t['variables'] : [] as $name => $def) {
        if (is_array($def) && isset($def['pool']) && $def['pool'] !== 'stradario' && !is_array($city[$def['pool']] ?? null)) {
            $err[] = "variabile $name: l'elenco \"{$def['pool']}\" non esiste nella città";
        }
    }

    // Testi del chiamante
    $err = array_merge($err, text_errors($t['opening'], 'opening'));
    foreach (['witness_opening', 'callback_opening', 'idle_lines'] as $k) {
        if (array_key_exists($k, $t)) {
            $err = array_merge($err, text_errors($t[$k], $k));
        }
    }

    // Nodi
    $revealed = [];
    foreach ($nodes as $n) {
        if (empty($n['id'])) {
            continue;
        }
        $w = "nodo {$n['id']}";
        if (isset($n['reply'])) {
            $err = array_merge($err, text_errors($n['reply'], "$w: reply"));
        }
        if (isset($n['repeat'])) {
            $err = array_merge($err, text_errors($n['repeat'], "$w: repeat"));
        }
        if (isset($n['reply_flag'])) {
            $err = array_merge($err, text_errors($n['reply_flag'], "$w: reply_flag", ['flag']));
            $consumers[] = [$n['reply_flag']['flag'] ?? null, "$w: reply_flag.flag"];
        }
        if (isset($n['error']['reply'])) {
            $err = array_merge($err, text_errors($n['error']['reply'], "$w: error.reply"));
        }
        if (isset($n['error']['unless_flag'])) {
            $consumers[] = [$n['error']['unless_flag'], "$w: error.unless_flag"];
        }
        foreach (['requires_flag', 'hidden_if_flag'] as $f) {
            if (isset($n[$f])) {
                $consumers[] = [$n[$f], "$w: $f"];
            }
        }
        if (isset($n['sets_flag'])) {
            $setters[$n['sets_flag']] = true;
        }
        foreach ($n['reveals'] ?? [] as $f) {
            $revealed[$f] = true;
        }
        if (isset($n['switch_caller'])) {
            $sw = $n['switch_caller'];
            if (!is_assoc($sw)) {
                $err[] = "$w: switch_caller deve essere un oggetto";
            } else {
                $err = array_merge($err, unknown_keys($sw, SWITCH_KEYS, "$w: switch_caller"));
                if (!in_array($sw['gender'] ?? null, ['f', 'm'], true)) {
                    $err[] = "$w: switch_caller.gender deve essere f o m";
                }
                if (!is_int($sw['panic_start'] ?? null) || $sw['panic_start'] < 0 || $sw['panic_start'] > 100) {
                    $err[] = "$w: switch_caller.panic_start deve essere un intero 0-100";
                }
                if (isset($sw['reliability']) && (!is_numeric($sw['reliability']) || $sw['reliability'] < 0 || $sw['reliability'] > 1)) {
                    $err[] = "$w: switch_caller.reliability deve essere tra 0 e 1";
                }
                if (isset($sw['name']) && (!is_string($sw['name']) || trim($sw['name']) === '')) {
                    $err[] = "$w: switch_caller.name deve essere una stringa";
                }
                if (isset($sw['voice'])) {
                    $err = array_merge($err, voice_errors($sw['voice'], "$w: switch_caller.voice"));
                }
                $err = array_merge($err, text_errors($sw['opening'] ?? null, "$w: switch_caller.opening"));
                if (!empty($n['ends_call'])) {
                    $err[] = "$w: switch_caller e ends_call insieme (il cambio non avverrebbe)";
                }
            }
        }
    }

    // Cronologia
    if (array_key_exists('timeline', $t)) {
        if (!is_array($t['timeline']) || !array_is_list($t['timeline'])) {
            $err[] = 'timeline deve essere un elenco';
        } else {
            $seen = [];
            foreach ($t['timeline'] as $i => $e) {
                $w = 'timeline #' . ($i + 1) . (isset($e['id']) && is_string($e['id']) ? " ({$e['id']})" : '');
                if (!is_assoc($e)) {
                    $err[] = "$w: deve essere un oggetto";
                    continue;
                }
                $err = array_merge($err, unknown_keys($e, TIMELINE_KEYS, $w));
                if (!is_string($e['id'] ?? null) || !preg_match('/^[a-z0-9_]+$/', $e['id'])) {
                    $err[] = "$w: id obbligatorio ([a-z0-9_])";
                } elseif (isset($seen[$e['id']])) {
                    $err[] = "$w: id duplicato";
                } else {
                    $seen[$e['id']] = true;
                }
                $at = $e['at_s'] ?? null;
                $okAt = (is_int($at) && $at >= 0)
                    || (is_array($at) && array_is_list($at) && count($at) === 2 && is_int($at[0]) && is_int($at[1]) && $at[0] >= 0 && $at[0] <= $at[1]);
                if (!$okAt) {
                    $err[] = "$w: at_s deve essere un intero o [min, max] in secondi";
                }
                $err = array_merge($err, text_errors($e['say'] ?? null, "$w: say"));
                foreach (['if_flag', 'unless_flag', 'sets_flag'] as $f) {
                    if (isset($e[$f]) && !valid_flag($e[$f])) {
                        $err[] = "$w: $f non valido";
                    }
                }
                foreach (['if_flag', 'unless_flag'] as $f) {
                    if (isset($e[$f])) {
                        $consumers[] = [$e[$f], "$w: $f"];
                    }
                }
                if (isset($e['sets_flag'])) {
                    $setters[$e['sets_flag']] = true;
                }
                if (isset($e['unless_asked'])) {
                    $ua = is_string($e['unless_asked']) ? [$e['unless_asked']] : $e['unless_asked'];
                    if (!is_array($ua) || !array_is_list($ua)) {
                        $err[] = "$w: unless_asked deve essere un id di nodo o un elenco";
                    } else {
                        foreach ($ua as $id) {
                            if (!is_string($id) || !isset($nodeIds[$id])) {
                                $err[] = "$w: unless_asked \"" . (is_string($id) ? $id : '?') . '" non è un nodo';
                            }
                        }
                    }
                }
                if (isset($e['panic_delta']) && !is_int($e['panic_delta']) && !is_float($e['panic_delta'])) {
                    $err[] = "$w: panic_delta deve essere un numero";
                }
                foreach (['ends_call', 'interrupt'] as $f) {
                    if (isset($e[$f]) && !is_bool($e[$f])) {
                        $err[] = "$w: $f deve essere true o false";
                    }
                }
                if (isset($e['reveals'])) {
                    if (!is_array($e['reveals']) || !array_is_list($e['reveals'])) {
                        $err[] = "$w: reveals deve essere un elenco";
                    } else {
                        foreach ($e['reveals'] as $f) {
                            if (!is_string($f) || !array_key_exists($f, $facts)) {
                                $err[] = "$w: reveals \"" . (is_string($f) ? $f : '?') . '" non è tra i facts';
                            } elseif (in_array($f, $critical, true)) {
                                $err[] = "$w: la cronologia non può rivelare il fatto critico \"$f\" (lo deve chiedere l'operatore)";
                            }
                        }
                    }
                }
            }
        }
    }

    // Peggioramento (comportamento nel motore)
    if (array_key_exists('deterioration', $t)) {
        $det = $t['deterioration'];
        if (!is_array($det) || !array_is_list($det) || count($det) < 1 || count($det) > 3) {
            $err[] = 'deterioration deve essere un elenco di 1-3 stadi';
        } else {
            $prev = 0;
            foreach ($det as $i => $s) {
                $w = 'deterioration #' . ($i + 1);
                if (!is_assoc($s)) {
                    $err[] = "$w: deve essere un oggetto";
                    continue;
                }
                $err = array_merge($err, unknown_keys($s, DETER_KEYS, $w));
                if (!is_int($s['after_s'] ?? null) || $s['after_s'] <= $prev) {
                    $err[] = "$w: after_s deve essere un intero positivo, crescente";
                } else {
                    $prev = $s['after_s'];
                }
                if (isset($s['panic']) && !is_int($s['panic'])) {
                    $err[] = "$w: panic deve essere un intero";
                }
                if (isset($s['sets_flag'])) {
                    if (!valid_flag($s['sets_flag'])) {
                        $err[] = "$w: sets_flag non valido";
                    } else {
                        $setters[$s['sets_flag']] = true;
                    }
                }
                if (isset($s['line'])) {
                    $err = array_merge($err, text_errors($s['line'], "$w: line"));
                }
            }
        }
    }

    // Fatti critici: devono esistere ed essere chiesti dall'operatore
    foreach ($critical as $f) {
        if (!array_key_exists($f, $facts)) {
            $err[] = "critical_facts: \"$f\" non è tra i facts";
        } elseif (!isset($revealed[$f])) {
            $err[] = "critical_facts: \"$f\" non è rivelato da nessuna domanda";
        }
    }
    // Ogni condizione usata deve essere attivata da qualcosa
    foreach ($consumers as [$flag, $w]) {
        if (is_string($flag) && !isset($setters[$flag])) {
            $err[] = "$w: la condizione \"$flag\" non è mai attivata (sets_flag)";
        }
    }
    return $err;
}

/** Testi detti da chi chiama (per --lint): [dove, testo]. */
function caller_lines(array $t): array
{
    $out = [];
    $add = function ($pair, string $where) use (&$out) {
        if (!is_array($pair)) {
            return;
        }
        foreach (TEXT_LEVELS as $k) {
            foreach ((array) ($pair[$k] ?? []) as $s) {
                if (is_string($s)) {
                    $out[] = ["$where.$k", $s];
                }
            }
        }
    };
    foreach (['opening', 'callback_opening', 'idle_lines'] as $k) {
        $add($t[$k] ?? null, $k);
    }
    foreach ($t['nodes'] as $n) {
        $id = $n['id'] ?? '?';
        $add($n['reply'] ?? null, "$id.reply");
        $add($n['repeat'] ?? null, "$id.repeat");
        $add($n['reply_flag'] ?? null, "$id.reply_flag");
        $add($n['error']['reply'] ?? null, "$id.error.reply");
    }
    foreach (is_array($t['timeline'] ?? null) ? $t['timeline'] : [] as $e) {
        $add($e['say'] ?? null, 'timeline.' . ($e['id'] ?? '?'));
    }
    return $out;
}

/** Avvisi di stile (non bloccanti). $doveLabels: etichetta di q_dove -> numero di modelli. */
function lint_template(array $t, array $doveLabels): array
{
    $warn = [];
    $pairs = [['opening', $t['opening']]];
    foreach ($t['nodes'] as $n) {
        $pairs[] = [($n['id'] ?? '?') . '.reply', $n['reply'] ?? null];
    }
    foreach ($pairs as [$w, $p]) {
        if (is_array($p) && isset($p['calm'], $p['panic']) && $p['calm'] === $p['panic']) {
            $warn[] = "$w: calm e panic identici";
        }
    }
    foreach ($t['nodes'] as $n) {
        if (($n['id'] ?? '') === 'q_dove' && ($doveLabels[$n['label'] ?? ''] ?? 0) >= 3) {
            $warn[] = "q_dove: etichetta «{$n['label']}» uguale in {$doveLabels[$n['label']]} modelli";
        }
    }
    if (!array_filter($t['nodes'], fn($n) => ($n['type'] ?? '') === 'reassure')) {
        $warn[] = 'nessun nodo di rassicurazione (type "reassure")';
    }
    $lines = caller_lines($t);
    if (($t['caller']['gender'] ?? 'any') === 'any') {
        $check = array_map(fn($l) => [$l[0], $l[1], GENDERED_RE], $lines);
        foreach ($t['nodes'] as $n) {
            $check[] = [($n['id'] ?? '?') . '.label', (string) ($n['label'] ?? ''), GENDERED_OP_RE];
        }
        foreach ($check as [$w, $s, $re]) {
            if (!str_contains($s, '{g.') && preg_match($re, $s, $m)) {
                $warn[] = "$w: «{$m[0]}» con genere any (usare {g.o})";
            }
        }
    }
    foreach ($lines as [$w, $s]) {
        if (preg_match_all('/\(([^()]*)\)/u', $s, $mm)) {
            foreach ($mm[1] as $inside) {
                if (str_contains($inside, '{')) {
                    continue;
                }
                $low = mb_strtolower(trim($inside));
                $known = false;
                foreach (CUE_PHRASES as $cue) {
                    if (str_starts_with($low, $cue)) {
                        $known = true;
                        break;
                    }
                }
                if (!$known) {
                    $warn[] = "$w: parentesi non riconosciuta come indicazione di scena: ($inside)";
                }
            }
        }
    }
    return $warn;
}

/** Restituisce l'elenco degli errori di un modello. */
function validate_template(array $t, array $validEvents, array $city = []): array
{
    $err = [];
    foreach (['code', 'title', 'category', 'difficulty', 'caller', 'opening', 'facts', 'nodes', 'truth'] as $k) {
        if (!array_key_exists($k, $t)) {
            $err[] = "manca il campo \"$k\"";
        }
    }
    if ($err) {
        return $err;
    }
    if (!preg_match('/^[A-Z]{3}_\d{3}$/', (string) $t['code'])) {
        $err[] = 'code deve avere il formato ABC_123';
    }
    if (!in_array($t['category'], CATEGORIES, true)) {
        $err[] = 'category non valida';
    }
    if (!is_int($t['difficulty']) || $t['difficulty'] < 1 || $t['difficulty'] > 10) {
        $err[] = 'difficulty deve essere un intero 1-10';
    }
    foreach ($t['time_bands'] ?? [] as $b) {
        if (!in_array($b, BANDS, true)) {
            $err[] = "fascia oraria non valida: $b";
        }
    }

    $facts = $t['facts'];
    if (!is_array($facts)) {
        $err[] = 'facts deve essere un oggetto';
        $facts = [];
    }
    $ids = [];
    foreach ($t['nodes'] as $i => $n) {
        $where = 'nodo #' . ($i + 1) . (isset($n['id']) ? " ({$n['id']})" : '');
        if (empty($n['id']) || empty($n['label'])) {
            $err[] = "$where: servono id e label";
            continue;
        }
        if (isset($ids[$n['id']])) {
            $err[] = "$where: id duplicato";
        }
        $ids[$n['id']] = true;
        if (isset($n['type']) && !in_array($n['type'], NODE_TYPES, true)) {
            $err[] = "$where: type non valido";
        }
        if (empty($n['reply']['calm']) && empty($n['reply']['panic'])) {
            $err[] = "$where: manca reply";
        }
        foreach ($n['reveals'] ?? [] as $f) {
            if (!array_key_exists($f, $facts)) {
                $err[] = "$where: reveals \"$f\" non è tra i facts";
            }
        }
        if (isset($n['error'])) {
            if (empty($n['error']['fact']) || !array_key_exists($n['error']['fact'], $facts)) {
                $err[] = "$where: error.fact deve essere uno dei facts";
            }
            if (empty($n['error']['display']) || empty($n['error']['reply'])) {
                $err[] = "$where: error richiede display e reply";
            }
        }
    }
    foreach ($t['nodes'] as $n) {
        foreach ($n['requires'] ?? [] as $r) {
            if (!isset($ids[$r])) {
                $err[] = "nodo {$n['id']}: requires \"$r\" non esiste";
            }
        }
    }
    foreach ($t['nodes'] as $n) {
        foreach (['sets_flag', 'requires_flag', 'hidden_if_flag'] as $f) {
            if (isset($n[$f]) && !preg_match('/^[a-z_]+$/', (string) $n[$f])) {
                $err[] = "nodo {$n['id']}: $f non valido";
            }
        }
        if (isset($n['reply_flag']) && (empty($n['reply_flag']['flag']) || (empty($n['reply_flag']['calm']) && empty($n['reply_flag']['panic'])))) {
            $err[] = "nodo {$n['id']}: reply_flag richiede flag e almeno un testo";
        }
    }
    if (isset($t['drop_after_s']) && (!is_array($t['drop_after_s']) || count($t['drop_after_s']) !== 2
        || !is_int($t['drop_after_s'][0]) || $t['drop_after_s'][0] > $t['drop_after_s'][1])) {
        $err[] = 'drop_after_s deve essere [min, max] in secondi';
    }
    if (isset($t['duplicates'])) {
        $d = $t['duplicates'];
        if (!is_array($d) || !is_numeric($d['chance'] ?? null) || !is_int($d['max'] ?? null) || !is_array($d['delay_s'] ?? null)) {
            $err[] = 'duplicates richiede chance, max e delay_s';
        }
        if (empty($t['can_duplicate'])) {
            $err[] = 'duplicates presente ma can_duplicate non è true';
        }
    }
    $acc = $t['truth']['acceptable_event_types'] ?? [];
    foreach (is_array($acc) ? $acc : [] as $a) {
        if (!str_starts_with((string) $a, '{') && !in_array($a, $validEvents, true)) {
            $err[] = "acceptable_event_types non valido: $a";
        }
    }
    $ev = $t['truth']['event_type'] ?? '';
    if (!str_starts_with($ev, '{') && !in_array($ev, $validEvents, true)) {
        $err[] = "truth.event_type non valido: $ev";
    }
    // eventi dichiarati nelle varianti ("event": ...)
    $vars = is_array($t['variables'] ?? null) ? $t['variables'] : [];
    array_walk_recursive($vars, function ($v, $k) use (&$err, $validEvents) {
        if (($k === 'event' || $k === 'acc') && is_string($v) && !str_starts_with($v, '{') && !in_array($v, $validEvents, true)) {
            $err[] = "evento non valido in una variante: $v";
        }
    });
    return array_merge($err, validate_v120($t, $city));
}

$files = glob(rtrim($dir, '/') . '/*.json') ?: [];
if (!$files) {
    fwrite(STDERR, "Nessun modello trovato in $dir\n");
    exit(1);
}

$templates = [];
$failed = 0;
foreach ($files as $file) {
    $t = json_decode((string) file_get_contents($file), true);
    $name = basename($file);
    if (!is_array($t)) {
        fwrite(STDERR, "ERRORE $name: JSON non valido (" . json_last_error_msg() . ")\n");
        $failed++;
        continue;
    }
    $errors = validate_template($t, $validEvents, $city);
    if ($errors) {
        fwrite(STDERR, "ERRORE $name:\n  - " . implode("\n  - ", $errors) . "\n");
        $failed++;
        continue;
    }
    $templates[] = $t;
    if ($mode !== 'sql') {
        echo "OK     $name  ({$t['code']}, difficoltà {$t['difficulty']}, " . count($t['nodes']) . " domande)\n";
    }
}

if ($mode === 'lint') {
    $doveLabels = [];
    foreach ($templates as $t) {
        foreach ($t['nodes'] as $n) {
            if (($n['id'] ?? '') === 'q_dove' && is_string($n['label'] ?? null)) {
                $doveLabels[$n['label']] = ($doveLabels[$n['label']] ?? 0) + 1;
            }
        }
    }
    $total = 0;
    foreach ($templates as $t) {
        $warn = lint_template($t, $doveLabels);
        $total += count($warn);
        if ($warn) {
            echo "AVVISO {$t['code']}:\n  - " . implode("\n  - ", $warn) . "\n";
        }
    }
    echo "\n$total avvisi.\n";
}
if ($failed) {
    fwrite(STDERR, "\n$failed modelli con errori: nessuna importazione eseguita.\n");
    exit(1);
}
if ($mode === 'check' || $mode === 'lint') {
    echo "\nTutti i modelli sono validi.\n";
    exit(0);
}

$sqlCols = '(code, title, category, phase, difficulty, weight, min_rank, time_bands, can_duplicate, is_story, content_json, content_version, is_active)';
$upsert = 'ON DUPLICATE KEY UPDATE
    content_version = IF(content_json <> VALUES(content_json), content_version + 1, content_version),
    title = VALUES(title), category = VALUES(category), phase = VALUES(phase), difficulty = VALUES(difficulty),
    weight = VALUES(weight), min_rank = VALUES(min_rank), time_bands = VALUES(time_bands),
    can_duplicate = VALUES(can_duplicate), is_story = VALUES(is_story), content_json = VALUES(content_json)';

$rows = array_map(fn(array $t) => [
    $t['code'],
    $t['title'],
    $t['category'],
    (int) ($t['phase'] ?? 1),
    (int) $t['difficulty'],
    (int) ($t['weight'] ?? 100),
    (int) ($t['min_rank'] ?? 1),
    implode(',', $t['time_bands'] ?? BANDS),
    !empty($t['can_duplicate']) ? 1 : 0,
    !empty($t['is_story']) ? 1 : 0,
    json_encode($t, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    1,
    // "is_active": 0 nel modello lo importa disattivato (es. in attesa di revisione);
    // l'aggiornamento di un modello esistente non tocca is_active
    isset($t['is_active']) ? (int) $t['is_active'] : 1,
], $templates);

if ($mode === 'sql') {
    $q = fn($v) => is_int($v) ? (string) $v : "'" . str_replace(["\\", "'"], ["\\\\", "''"], (string) $v) . "'";
    echo "-- LifeLine - modelli di chiamata generati il " . gmdate('Y-m-d H:i') . " UTC\n";
    echo "-- Generato da tools/import_templates.php --sql\n\nSET NAMES utf8mb4;\n\n";
    foreach ($rows as $r) {
        echo 'INSERT INTO ' . tbl('call_templates') . " $sqlCols VALUES\n(" . implode(', ', array_map($q, $r)) . ")\n$upsert;\n\n";
    }
    exit(0);
}

$st = db()->prepare('INSERT INTO ' . tbl('call_templates') . " $sqlCols VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) $upsert");
foreach ($rows as $r) {
    $st->execute($r);
}
echo "\nImportati " . count($rows) . " modelli.\n";
