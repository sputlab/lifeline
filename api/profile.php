<?php
/**
 * LifeLine - API profilo
 *
 * GET  ?action=get              -> profilo, carriera, statistiche, ultimi turni
 * POST ?action=update           -> { lang?, email? }  (email "" = rimuovi)
 * POST ?action=change_password  -> { current_password, new_password }
 */
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';

api_init(['GET', 'POST']);
session_boot();

$me     = require_login();
$userId = (int) $me['id'];
$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : 'get';

switch ($action) {

    case 'get':
        require_method('GET');
        $user = load_user_public($userId);

        $st = db()->prepare('SELECT stats_json FROM ' . tbl('careers') . ' WHERE user_id = ?');
        $st->execute([$userId]);
        $stats = json_decode((string) $st->fetchColumn(), true);

        $st = db()->prepare(
            'SELECT id, mode, phase, status, score, grade, xp_gained, started_at, ended_at
             FROM ' . tbl('shifts') . '
             WHERE user_id = ?
             ORDER BY started_at DESC
             LIMIT 10'
        );
        $st->execute([$userId]);
        $shifts = array_map(static fn(array $s) => [
            'id'         => (int) $s['id'],
            'mode'       => $s['mode'],
            'phase'      => (int) $s['phase'],
            'status'     => $s['status'],
            'score'      => $s['score'] !== null ? (int) $s['score'] : null,
            'grade'      => $s['grade'],
            'xp_gained'  => $s['xp_gained'] !== null ? (int) $s['xp_gained'] : null,
            'started_at' => $s['started_at'],
            'ended_at'   => $s['ended_at'],
        ], $st->fetchAll());

        json_ok([
            'user'          => $user,
            'stats'         => is_array($stats) ? $stats : new stdClass(),
            'recent_shifts' => $shifts,
            'app_version'   => APP_VERSION,
        ]);

    case 'update':
        require_method('POST');
        verify_csrf();
        $in = read_json();

        $fields = [];
        $params = [];

        if (array_key_exists('lang', $in)) {
            if (!in_array($in['lang'], SUPPORTED_LANGS, true)) {
                json_error('invalid_lang', 'Lingua non supportata.', 422);
            }
            $fields[] = 'lang = ?';
            $params[] = $in['lang'];
        }

        if (array_key_exists('email', $in)) {
            $email = normalize_email(input_str($in, 'email', 250));
            if ($email === false) {
                json_error('invalid_email', 'Indirizzo email non valido.', 422);
            }
            if ($email !== null) {
                $st = db()->prepare('SELECT 1 FROM ' . tbl('users') . ' WHERE email = ? AND id <> ?');
                $st->execute([$email, $userId]);
                if ($st->fetchColumn()) {
                    json_error('email_taken', 'Questa email è già registrata.', 409);
                }
            }
            $fields[] = 'email = ?';
            $params[] = $email;
        }

        if ($fields) {
            $params[] = $userId;
            try {
                $st = db()->prepare('UPDATE ' . tbl('users') . ' SET ' . implode(', ', $fields) . ' WHERE id = ?');
                $st->execute($params);
            } catch (PDOException $e) {
                if (is_duplicate_key($e)) {
                    json_error('email_taken', 'Questa email è già registrata.', 409);
                }
                throw $e;
            }
        }
        json_ok(['user' => load_user_public($userId)]);

    case 'change_password':
        require_method('POST');
        verify_csrf();
        $in = read_json();

        $current = input_str($in, 'current_password', 250, false);
        $new     = input_str($in, 'new_password', 250, false);

        if (!valid_password($new)) {
            json_error('invalid_password', 'La nuova password deve avere almeno 8 caratteri.', 422);
        }
        if (login_blocked($me['username'])) {
            json_error('too_many_attempts', 'Troppi tentativi falliti. Riprova tra qualche minuto.', 429);
        }

        $st = db()->prepare('SELECT password_hash FROM ' . tbl('users') . ' WHERE id = ?');
        $st->execute([$userId]);
        if (!password_verify($current, (string) $st->fetchColumn())) {
            record_attempt('login', $me['username'], false);
            json_error('wrong_password', 'La password attuale non è corretta.', 403);
        }

        $st = db()->prepare('UPDATE ' . tbl('users') . ' SET password_hash = ? WHERE id = ?');
        $st->execute([password_hash($new, PASSWORD_DEFAULT), $userId]);

        login_user($userId); // nuovo ID di sessione e nuovo token CSRF
        json_ok(['csrf' => csrf_token()]);

    default:
        json_error('unknown_action', 'Azione non valida.', 404);
}
