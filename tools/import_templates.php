<?php
/**
 * LifeLine - Importazione e validazione dei modelli di chiamata
 *
 * Uso (solo da riga di comando):
 *   php tools/import_templates.php                 valida e importa sql/templates/*.json nel database
 *   php tools/import_templates.php --check         solo validazione
 *   php tools/import_templates.php --sql > f.sql   genera lo script SQL (per phpMyAdmin), senza database
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

$args  = array_slice($argv, 1);
$mode  = in_array('--sql', $args, true) ? 'sql' : (in_array('--check', $args, true) ? 'check' : 'import');
$dirs  = array_values(array_filter($args, fn($a) => !str_starts_with($a, '--')));
$dir   = $dirs[0] ?? __DIR__ . '/../sql/templates';

$eventTypes = json_decode((string) file_get_contents(__DIR__ . '/../data/event_types.json'), true);
$validEvents = [];
foreach ($eventTypes['categories'] as $cat => $list) {
    foreach ($list as $e) {
        $validEvents[] = "$cat.$e";
    }
}

/** Restituisce l'elenco degli errori di un modello. */
function validate_template(array $t, array $validEvents): array
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
    return $err;
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
    $errors = validate_template($t, $validEvents);
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

if ($failed) {
    fwrite(STDERR, "\n$failed modelli con errori: nessuna importazione eseguita.\n");
    exit(1);
}
if ($mode === 'check') {
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
    1,
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
