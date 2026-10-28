<?php
/**
 * LifeLine - Sessione, CSRF, autenticazione e limitazione tentativi
 */
declare(strict_types=1);

if (!defined('LIFELINE')) { http_response_code(403); exit; }

// Hash bcrypt fittizio: usato quando l'utente non esiste,
// così la risposta impiega lo stesso tempo (nessuna enumerazione utenti).
const DUMMY_HASH = '$2y$10$abcdefghijklmnopqrstuuMR1bDwOd6RvqOcIVAKPiJFbyFyLo0yG';

function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    return cfg('trust_proxy') && (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function session_boot(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name((string) cfg('session_name'));
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => (string) cfg('cookie_path'),
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();

    // Logout automatico per inattività
    $now = time();
    if (isset($_SESSION['uid'], $_SESSION['last_activity'])
        && $now - (int) $_SESSION['last_activity'] > (int) cfg('session_idle')) {
        logout_user();
        session_boot();
        return;
    }
    $_SESSION['last_activity'] = $now;
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

/** Richiede l'header X-CSRF-Token valido su ogni richiesta che modifica dati. */
function verify_csrf(): void
{
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf']) || !is_string($sent) || !hash_equals($_SESSION['csrf'], $sent)) {
        json_error('csrf_invalid', 'Sessione scaduta, ricarica la pagina.', 419);
    }
}

function current_user_id(): ?int
{
    return isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : null;
}

/** Restituisce l'utente autenticato e attivo, altrimenti risponde 401. */
function require_login(): array
{
    $uid = current_user_id();
    if ($uid !== null) {
        $st = db()->prepare('SELECT id, username, is_active FROM ' . tbl('users') . ' WHERE id = ?');
        $st->execute([$uid]);
        $user = $st->fetch();
        if ($user && (int) $user['is_active'] === 1) {
            return $user;
        }
        logout_user();
    }
    json_error('unauthorized', 'Accesso richiesto.', 401);
}

function login_user(int $userId): void
{
    session_regenerate_id(true);
    $_SESSION['uid'] = $userId;
    $_SESSION['login_at'] = time();
    $_SESSION['last_activity'] = time();
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function logout_user(): void
{
    $_SESSION = [];
    if (session_status() === PHP_SESSION_ACTIVE) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 3600,
            'path'     => $p['path'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'],
        ]);
        session_destroy();
    }
}

function client_ip(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if (cfg('trust_proxy') && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $first = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        if (filter_var($first, FILTER_VALIDATE_IP)) {
            $ip = $first;
        }
    }
    return $ip;
}

function ip_bin(string $ip): string
{
    $bin = @inet_pton($ip);
    return $bin !== false ? $bin : (string) inet_pton('0.0.0.0');
}

/* ---------------------------------------------------------------------
 * Limitazione tentativi (tabella lifeline_auth_attempts)
 * ------------------------------------------------------------------- */

function record_attempt(string $action, string $username, bool $success): void
{
    $st = db()->prepare(
        'INSERT INTO ' . tbl('auth_attempts') . ' (action, ip, username, success) VALUES (?, ?, ?, ?)'
    );
    $st->execute([$action, ip_bin(client_ip()), mb_strtolower($username), $success ? 1 : 0]);

    // Pulizia occasionale dei record vecchi (circa 1 richiesta su 50)
    if (random_int(1, 50) === 1) {
        db()->exec('DELETE FROM ' . tbl('auth_attempts') . ' WHERE attempted_at < (UTC_TIMESTAMP() - INTERVAL 2 DAY)');
    }
}

/** True se l'IP (o la coppia IP + utente) ha superato il limite di login falliti. */
function login_blocked(string $username): bool
{
    $st = db()->prepare(
        'SELECT
            COALESCE(SUM(username = ?), 0) AS combo,
            COUNT(*)                       AS by_ip
         FROM ' . tbl('auth_attempts') . '
         WHERE action = \'login\' AND success = 0 AND ip = ?
           AND attempted_at > (UTC_TIMESTAMP() - INTERVAL ? SECOND)'
    );
    $st->execute([mb_strtolower($username), ip_bin(client_ip()), (int) cfg('login_window')]);
    $r = $st->fetch();
    return (int) $r['combo'] >= (int) cfg('login_max_combo')
        || (int) $r['by_ip'] >= (int) cfg('login_max_ip');
}

function clear_login_failures(string $username): void
{
    $st = db()->prepare(
        'DELETE FROM ' . tbl('auth_attempts') . ' WHERE action = \'login\' AND success = 0 AND ip = ? AND username = ?'
    );
    $st->execute([ip_bin(client_ip()), mb_strtolower($username)]);
}

function register_blocked(): bool
{
    $st = db()->prepare(
        'SELECT COUNT(*) FROM ' . tbl('auth_attempts') . '
         WHERE action = \'register\' AND success = 1 AND ip = ?
           AND attempted_at > (UTC_TIMESTAMP() - INTERVAL ? SECOND)'
    );
    $st->execute([ip_bin(client_ip()), (int) cfg('register_window')]);
    return (int) $st->fetchColumn() >= (int) cfg('register_max_ip');
}

/* ---------------------------------------------------------------------
 * Validazioni
 * ------------------------------------------------------------------- */

function valid_username(string $u): bool
{
    return (bool) preg_match('/^[A-Za-z0-9_.\-]{3,40}$/', $u);
}

function valid_password(string $p): bool
{
    $len = mb_strlen($p);
    return $len >= 8 && $len <= 200;
}

/** Restituisce l'email normalizzata, null se vuota, false se non valida. */
function normalize_email(string $e): string|null|false
{
    $e = trim($e);
    if ($e === '') {
        return null;
    }
    if (mb_strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    return mb_strtolower($e);
}

function normalize_lang(mixed $lang): string
{
    return in_array($lang, SUPPORTED_LANGS, true) ? $lang : (string) cfg('default_lang');
}
