<?php
/**
 * LifeLine - API turni
 *
 * POST ?action=start    -> { mode }                       avvia un turno: seed, parametri e modelli di chiamata
 * POST ?action=finish   -> { shift_id, actions, summary, calls } chiude il turno: salva registro e chiamate,
 *                          ricalcola punteggio, voto ed XP, aggiorna la carriera
 * POST ?action=abandon  -> { shift_id }                   abbandona il turno
 *
 * Un solo turno "in_corso" per utente: avviarne uno nuovo abbandona il precedente.
 */
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';

api_init(['POST']);
session_boot();
verify_csrf();

$me     = require_login();
$userId = (int) $me['id'];
$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';

// Parametri di gioco per modalità (tempi in secondi di gioco).
// 'rules': versione delle regole del motore e meccaniche attive (salvate in rules_json per il replay).
const SHIFT_MODES = [
    'carriera' => [
        'duration_sec' => 6 * 3600,
        'starts'       => [6 * 3600, 14 * 3600, 22 * 3600], // 06:00, 14:00, 22:00
        'rules'        => ['version' => 2, 'deterioration' => true],
    ],
    'addestramento' => [
        'duration_sec' => 4 * 3600,
        'starts'       => [15 * 3600],
        'templates'    => ['SAN_001', 'IMP_004', 'INC_002'],
        'rules'        => ['version' => 2, 'deterioration' => false], // niente pressione aggiuntiva
    ],
];
const TRAINING_XP = 100; // solo al primo addestramento completato
const SHIFT_LINES      = 4;
const SHIFT_IDLE_SCALE = 90;
const SHIFT_MAX_LOG    = 2 * 1024 * 1024; // 2 MB

const STATE_MAP = [
    'transferred' => 'trasferita', 'closed' => 'chiusa', 'merged' => 'accorpata',
    'abandoned' => 'abbandonata', 'dropped' => 'caduta',
];
const AXES     = ['time', 'location', 'classification', 'agencies', 'protocol'];
const OUTCOMES = ['positivo', 'parziale', 'negativo', 'nessuno'];

/** Valida le chiamate inviate dal client e le normalizza. */
function validate_calls(mixed $calls): array
{
    if (!is_array($calls) || !array_is_list($calls) || count($calls) > 200) {
        json_error('invalid_calls', 'Elenco chiamate non valido.', 422);
    }
    $int = fn($v, $min, $max) => is_int($v) && $v >= $min && $v <= $max;
    $maxSec = 24 * 3600;
    $out = [];
    $seen = [];
    foreach ($calls as $c) {
        $bad = !is_array($c)
            || !$int($c['seq'] ?? null, 1, 10000) || isset($seen[$c['seq']])
            || !$int($c['templateId'] ?? null, 1, PHP_INT_MAX)
            || !$int($c['templateVersion'] ?? null, 1, 100000)
            || !$int($c['incidentKey'] ?? null, 1, 10000)
            || !isset(STATE_MAP[$c['state'] ?? ''])
            || !$int($c['arrivalSec'] ?? null, 0, $maxSec)
            || !in_array($c['outcome'] ?? null, OUTCOMES, true)
            || !is_array($c['axes'] ?? null);
        if ($bad) {
            json_error('invalid_calls', 'Dati di una chiamata non validi.', 422);
        }
        $axes = [];
        foreach (AXES as $k) {
            $v = $c['axes'][$k] ?? null;
            if ($v !== null && !$int($v, 0, 100)) {
                json_error('invalid_calls', 'Punteggio fuori intervallo.', 422);
            }
            $axes[$k] = $v;
        }
        foreach (['answeredSec', 'closedSec'] as $k) {
            if (($c[$k] ?? null) !== null && !$int($c[$k], 0, $maxSec)) {
                json_error('invalid_calls', 'Tempi non validi.', 422);
            }
        }
        $agencies = array_values(array_intersect(['118', '115', 'PS', 'CC'], (array) ($c['you']['agencies'] ?? [])));
        $err = $c['you']['errorM'] ?? null;
        $details = [
            'code'  => substr((string) ($c['code'] ?? ''), 0, 10),
            'truth' => is_array($c['truth'] ?? null) ? $c['truth'] : null,
            'you'   => is_array($c['you'] ?? null) ? $c['you'] : null,
            'notes' => array_slice(array_map(fn($n) => (string) ($n['key'] ?? ''), (array) ($c['notes'] ?? [])), 0, 12),
            'delay' => is_int($c['delaySec'] ?? null) ? $c['delaySec'] : null,
        ];
        if (strlen((string) json_encode($details)) > 4000) {
            $details = ['code' => $details['code'], 'notes' => $details['notes']];
        }
        $seen[$c['seq']] = true;
        $out[] = [
            'seq'              => $c['seq'],
            'template_id'      => $c['templateId'],
            'template_version' => $c['templateVersion'],
            'variant_index'    => is_int($c['variantIndex'] ?? null) ? $c['variantIndex'] : null,
            'incident_ref'     => $c['incidentKey'],
            'is_duplicate'     => !empty($c['isDuplicate']),
            'final_state'      => STATE_MAP[$c['state']],
            'arrival_sec'      => $c['arrivalSec'],
            'answered_sec'     => $c['answeredSec'] ?? null,
            'closed_sec'       => $c['closedSec'] ?? null,
            'agencies'         => $agencies,
            'location_error_m' => is_int($err) && $err >= 0 ? min($err, 1000000) : null,
            'axes'             => $axes,
            'outcome'          => $c['outcome'],
            'decisive'         => !empty($c['decisive']),
            'emergency'        => !empty($c['emergency']),
            'details'          => $details,
        ];
    }
    return $out;
}

/** Statistiche di carriera: medie mobili per asse, esiti, voti, miglior turno. */
function update_stats(array $s, array $res): array
{
    $n = (int) ($s['scored_shifts'] ?? 0);
    $avg = [];
    foreach (AXES as $k) {
        $vals = array_filter(array_column(array_column($res['calls'], 'axes'), $k), fn($v) => $v !== null);
        if ($vals) {
            $shiftAvg = array_sum($vals) / count($vals);
            $prev = $s['axes'][$k] ?? null;
            $avg[$k] = $prev === null ? round($shiftAvg, 1) : round(($prev * $n + $shiftAvg) / ($n + 1), 1);
        } else {
            $avg[$k] = $s['axes'][$k] ?? null;
        }
    }
    $outcomes = $s['outcomes'] ?? ['positivo' => 0, 'parziale' => 0, 'negativo' => 0];
    foreach ($res['calls'] as $c) {
        if (isset($outcomes[$c['outcome']])) {
            $outcomes[$c['outcome']]++;
        }
    }
    $grades = $s['grades'] ?? [];
    $grades[$res['grade']] = ($grades[$res['grade']] ?? 0) + 1;
    return [
        'training_done' => !empty($s['training_done']),
        'scored_shifts' => $n + 1,
        'axes'          => $avg,
        'outcomes'      => $outcomes,
        'grades'        => $grades,
        'best_percent'  => max((int) ($s['best_percent'] ?? 0), $res['percent']),
    ];
}

/** Carica un turno dell'utente in corso, altrimenti risponde con errore. */
function load_open_shift(int $userId, mixed $shiftId): array
{
    if (!is_int($shiftId) || $shiftId <= 0) {
        json_error('invalid_shift', 'Turno non valido.', 422);
    }
    $st = db()->prepare('SELECT id, status, mode FROM ' . tbl('shifts') . ' WHERE id = ? AND user_id = ?');
    $st->execute([$shiftId, $userId]);
    $shift = $st->fetch();
    if (!$shift) {
        json_error('shift_not_found', 'Turno non trovato.', 404);
    }
    if ($shift['status'] !== 'in_corso') {
        json_error('shift_closed', 'Questo turno è già chiuso.', 409);
    }
    return $shift;
}

switch ($action) {

    case 'start': {
        $in   = read_json();
        $mode = is_string($in['mode'] ?? null) ? $in['mode'] : 'carriera';
        if (!isset(SHIFT_MODES[$mode])) {
            json_error('invalid_mode', 'Modalità non disponibile.', 422);
        }
        $params = SHIFT_MODES[$mode];

        $st = db()->prepare('SELECT phase, xp FROM ' . tbl('careers') . ' WHERE user_id = ?');
        $st->execute([$userId]);
        $career = $st->fetch();
        $rank   = rank_from_xp((int) $career['xp']);

        // Modelli disponibili per fase e grado
        if (isset($params['templates'])) {
            $ph = implode(',', array_fill(0, count($params['templates']), '?'));
            $st = db()->prepare(
                'SELECT id, code, content_version, weight, content_json FROM ' . tbl('call_templates') . "
                 WHERE is_active = 1 AND code IN ($ph) ORDER BY code"
            );
            $st->execute($params['templates']);
        } else {
            $st = db()->prepare(
                'SELECT id, code, content_version, weight, content_json
                 FROM ' . tbl('call_templates') . '
                 WHERE is_active = 1 AND phase <= ? AND min_rank <= ?
                 ORDER BY code'
            );
            $st->execute([(int) $career['phase'], $rank['level']]);
        }
        $templates = [];
        foreach ($st->fetchAll() as $t) {
            $content = json_decode((string) $t['content_json'], true);
            if (!is_array($content)) {
                continue;
            }
            $templates[] = [
                'id'      => (int) $t['id'],
                'code'    => $t['code'],
                'version' => (int) $t['content_version'],
                'weight'  => (int) $t['weight'],
                'content' => $content,
            ];
        }
        if (!$templates) {
            json_error('no_templates', 'Nessun modello di chiamata disponibile: importa i modelli con tools/import_templates.php.', 503);
        }

        $seed      = random_int(1, 0xFFFFFFFF);
        $startSec  = $params['starts'][$seed % count($params['starts'])];
        $difficulty = min(10, $rank['level']);
        // Regole passate al motore così come sono; il registro salvato contiene anche idle_scale
        $rules     = $params['rules'] + ['lines' => SHIFT_LINES];
        $rulesJson = json_encode($rules + ['idle_scale' => SHIFT_IDLE_SCALE]);

        $pdo = db();
        $pdo->beginTransaction();
        $st = $pdo->prepare(
            'UPDATE ' . tbl('shifts') . ' SET status = \'abbandonato\', ended_at = UTC_TIMESTAMP()
             WHERE user_id = ? AND status = \'in_corso\''
        );
        $st->execute([$userId]);

        $st = $pdo->prepare(
            'INSERT INTO ' . tbl('shifts') . '
                (user_id, seed, mode, phase, base_difficulty, game_start_time, client_version, rules_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            $userId, $seed, $mode, (int) $career['phase'], $difficulty,
            gmdate('H:i:s', $startSec), APP_VERSION, $rulesJson,
        ]);
        $shiftId = (int) $pdo->lastInsertId();
        $pdo->commit();

        json_ok([
            'shift_id'        => $shiftId,
            'seed'            => $seed,
            'mode'            => $mode,
            'phase'           => (int) $career['phase'],
            'base_difficulty' => $difficulty,
            'game_start_sec'  => $startSec,
            'duration_sec'    => $params['duration_sec'],
            'lines'           => SHIFT_LINES,
            'idle_scale'      => SHIFT_IDLE_SCALE,
            'rules'           => $rules,
            'debug'         => (bool) cfg('debug'),
            'templates'       => $templates,
        ], 201);
    }

    case 'finish': {
        $in    = read_json(SHIFT_MAX_LOG);
        $shift = load_open_shift($userId, $in['shift_id'] ?? null);
        $shiftId = (int) $shift['id'];

        $actions = $in['actions'] ?? null;
        if (!is_array($actions) || !array_is_list($actions) || count($actions) > 20000) {
            json_error('invalid_log', 'Registro azioni non valido.', 422);
        }
        foreach ($actions as $a) {
            if (!is_array($a) || !is_int($a['tick'] ?? null) || !is_string($a['type'] ?? null)) {
                json_error('invalid_log', 'Registro azioni non valido.', 422);
            }
        }
        $calls = validate_calls($in['calls'] ?? null);
        $summary = is_array($in['summary'] ?? null) ? $in['summary'] : [];

        // Difficoltà dal database, non dal client
        $ids = array_values(array_unique(array_column($calls, 'template_id')));
        $difficulties = [];
        if ($ids) {
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $st = db()->prepare('SELECT id, difficulty FROM ' . tbl('call_templates') . " WHERE id IN ($ph)");
            $st->execute($ids);
            foreach ($st->fetchAll() as $r) {
                $difficulties[(int) $r['id']] = (int) $r['difficulty'];
            }
            foreach ($ids as $id) {
                if (!isset($difficulties[$id])) {
                    json_error('invalid_calls', 'Chiamata con modello sconosciuto.', 422);
                }
            }
        }
        $res = score_shift($calls, $difficulties);
        $training = $shift['mode'] === 'addestramento';

        $pdo = db();
        $pdo->beginTransaction();

        $st = $pdo->prepare(
            'INSERT INTO ' . tbl('shift_logs') . ' (shift_id, actions_json) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE actions_json = VALUES(actions_json)'
        );
        $st->execute([$shiftId, json_encode(['actions' => $actions, 'client_summary' => $summary], JSON_UNESCAPED_UNICODE)]);

        $ins = $pdo->prepare(
            'INSERT INTO ' . tbl('shift_calls') . '
                (shift_id, seq, template_id, template_version, variant_seed, incident_ref, is_duplicate,
                 arrival_game_sec, answered_game_sec, closed_game_sec, final_state, agencies_sent,
                 location_error_m, classification_ok, score_time, score_location, score_classification,
                 score_agencies, score_protocol, outcome, details_json)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        foreach ($res['calls'] as $c) {
            $ax = $c['axes'];
            $ins->execute([
                $shiftId, $c['seq'], $c['template_id'], $c['template_version'], $c['variant_index'] ?? 0,
                $c['incident_ref'], $c['is_duplicate'] ? 1 : 0,
                $c['arrival_sec'], $c['answered_sec'], $c['closed_sec'], $c['final_state'],
                $c['agencies'] ? implode(',', $c['agencies']) : null,
                $c['location_error_m'], $ax['classification'] === null ? null : ($ax['classification'] === 100 ? 1 : 0),
                $ax['time'] ?? 0, $ax['location'] ?? 0, $ax['classification'] ?? 0, $ax['agencies'] ?? 0, $ax['protocol'] ?? 0,
                $c['outcome'],
                json_encode(['final' => $c['final'], 'points' => $c['points'], 'axes' => $ax, 'details' => $c['details']], JSON_UNESCAPED_UNICODE),
            ]);
        }

        $st = $pdo->prepare(
            'UPDATE ' . tbl('shifts') . ' SET status = \'completato\', ended_at = UTC_TIMESTAMP(),
                score = ?, grade = ?, xp_gained = ? WHERE id = ?'
        );
        $st->execute([$res['percent'], $res['grade'], $res['xp'], $shiftId]);

        // Carriera
        $st = $pdo->prepare('SELECT xp, shifts_completed, calls_handled, stats_json FROM ' . tbl('careers') . ' WHERE user_id = ? FOR UPDATE');
        $st->execute([$userId]);
        $career = $st->fetch();
        $xpBefore = (int) $career['xp'];
        $oldStats = json_decode((string) $career['stats_json'], true) ?: [];
        if ($training) {
            // L'addestramento non entra nelle medie: XP fissi, solo la prima volta
            $res['xp'] = empty($oldStats['training_done']) ? TRAINING_XP : 0;
            $stats = $oldStats;
            $stats['training_done'] = true;
            $answered = 0;
            $shiftsInc = 0;
        } else {
            $stats = update_stats($oldStats, $res);
            $answered = count(array_filter($res['calls'], fn($c) => $c['answered_sec'] !== null));
            $shiftsInc = 1;
        }
        $xpAfter = $xpBefore + $res['xp'];

        $st = $pdo->prepare(
            'UPDATE ' . tbl('careers') . ' SET xp = ?, shifts_completed = shifts_completed + ?,
                calls_handled = calls_handled + ?, rank_level = ?, stats_json = ? WHERE user_id = ?'
        );
        $rankAfter = rank_from_xp($xpAfter);
        $st->execute([$xpAfter, $shiftsInc, $answered, $rankAfter['level'], json_encode($stats), $userId]);
        $st = $pdo->prepare('UPDATE ' . tbl('shifts') . ' SET xp_gained = ? WHERE id = ?');
        $st->execute([$res['xp'], $shiftId]);
        $pdo->commit();

        $rankBefore = rank_from_xp($xpBefore);
        json_ok([
            'shift_id'   => $shiftId,
            'status'     => 'completato',
            'percent'    => $res['percent'],
            'grade'      => $res['grade'],
            'xp_gained'  => $res['xp'],
            'career'     => ['xp' => $xpAfter, 'rank_before' => $rankBefore, 'rank_after' => $rankAfter],
            'leveled_up' => $rankAfter['level'] > $rankBefore['level'],
            'training'   => $training,
        ]);
    }

    case 'abandon': {
        $in    = read_json();
        $shift = load_open_shift($userId, $in['shift_id'] ?? null);
        $st = db()->prepare(
            'UPDATE ' . tbl('shifts') . ' SET status = \'abbandonato\', ended_at = UTC_TIMESTAMP() WHERE id = ?'
        );
        $st->execute([(int) $shift['id']]);
        json_ok(['shift_id' => (int) $shift['id'], 'status' => 'abbandonato']);
    }

    default:
        json_error('unknown_action', 'Azione non valida.', 404);
}
