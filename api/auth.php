<?php
/**
 * LifeLine - API autenticazione
 *
 * GET  ?action=csrf      -> token CSRF
 * GET  ?action=me        -> utente corrente (o null) + token CSRF
 * POST ?action=register  -> { username, password, email?, lang? }
 * POST ?action=login     -> { username, password }
 * POST ?action=logout
 *
 * Tutte le POST richiedono l'header X-CSRF-Token.
 */
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';

api_init(['GET', 'POST']);
session_boot();

$action = is_string($_GET['action'] ?? null) ? $_GET['action'] : '';

switch ($action) {

    case 'csrf':
        require_method('GET');
        json_ok(['csrf' => csrf_token()]);

    case 'me':
        require_method('GET');
        $uid  = current_user_id();
        $user = $uid !== null ? load_user_public($uid) : null;
        if ($uid !== null && $user === null) {
            logout_user();
            session_boot();
        }
        json_ok(['user' => $user, 'csrf' => csrf_token(), 'app_version' => APP_VERSION]);

    case 'register':
        require_method('POST');
        verify_csrf();
        $in = read_json();

        $username = input_str($in, 'username', 60);
        $password = input_str($in, 'password', 250, false);
        $email    = normalize_email(input_str($in, 'email', 250));
        $lang     = normalize_lang($in['lang'] ?? null);

        if (!valid_username($username)) {
            json_error('invalid_username', 'Nome utente non valido: 3-40 caratteri tra lettere, numeri, punto, trattino e underscore.', 422);
        }
        if (!valid_password($password)) {
            json_error('invalid_password', 'La password deve avere almeno 8 caratteri.', 422);
        }
        if ($email === false) {
            json_error('invalid_email', 'Indirizzo email non valido.', 422);
        }
        if (register_blocked()) {
            json_error('too_many_registrations', 'Troppe registrazioni da questa rete. Riprova più tardi.', 429);
        }

        $pdo = db();
        $st = $pdo->prepare('SELECT 1 FROM ' . tbl('users') . ' WHERE username = ?');
        $st->execute([$username]);
        if ($st->fetchColumn()) {
            json_error('username_taken', 'Questo nome utente è già in uso.', 409);
        }
        if ($email !== null) {
            $st = $pdo->prepare('SELECT 1 FROM ' . tbl('users') . ' WHERE email = ?');
            $st->execute([$email]);
            if ($st->fetchColumn()) {
                json_error('email_taken', 'Questa email è già registrata.', 409);
            }
        }

        try {
            $pdo->beginTransaction();
            $st = $pdo->prepare(
                'INSERT INTO ' . tbl('users') . ' (username, email, password_hash, lang, last_login_at)
                 VALUES (?, ?, ?, ?, UTC_TIMESTAMP())'
            );
            $st->execute([$username, $email, password_hash($password, PASSWORD_DEFAULT), $lang]);
            $userId = (int) $pdo->lastInsertId();

            $st = $pdo->prepare('INSERT INTO ' . tbl('careers') . ' (user_id) VALUES (?)');
            $st->execute([$userId]);
            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if (is_duplicate_key($e)) {
                json_error('username_taken', 'Questo nome utente o email è già in uso.', 409);
            }
            throw $e;
        }

        record_attempt('register', $username, true);
        login_user($userId);
        json_ok(['user' => load_user_public($userId), 'csrf' => csrf_token()], 201);

    case 'login':
        require_method('POST');
        verify_csrf();
        $in = read_json();

        $username = input_str($in, 'username', 60);
        $password = input_str($in, 'password', 250, false);

        if ($username === '' || $password === '') {
            json_error('missing_credentials', 'Inserisci nome utente e password.', 422);
        }
        if (login_blocked($username)) {
            json_error('too_many_attempts', 'Troppi tentativi falliti. Riprova tra qualche minuto.', 429,
                ['retry_after' => (int) cfg('login_window')]);
        }

        $st = db()->prepare('SELECT id, password_hash, is_active FROM ' . tbl('users') . ' WHERE username = ?');
        $st->execute([$username]);
        $row = $st->fetch();

        $valid = password_verify($password, $row ? $row['password_hash'] : DUMMY_HASH) && $row;

        if (!$valid) {
            record_attempt('login', $username, false);
            json_error('invalid_credentials', 'Nome utente o password non corretti.', 401);
        }
        if ((int) $row['is_active'] !== 1) {
            json_error('account_disabled', 'Questo account è disattivato.', 403);
        }

        $userId = (int) $row['id'];
        if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
            $up = db()->prepare('UPDATE ' . tbl('users') . ' SET password_hash = ? WHERE id = ?');
            $up->execute([password_hash($password, PASSWORD_DEFAULT), $userId]);
        }
        $up = db()->prepare('UPDATE ' . tbl('users') . ' SET last_login_at = UTC_TIMESTAMP() WHERE id = ?');
        $up->execute([$userId]);

        clear_login_failures($username);
        login_user($userId);
        json_ok(['user' => load_user_public($userId), 'csrf' => csrf_token()]);

    case 'logout':
        require_method('POST');
        verify_csrf();
        logout_user();
        session_boot();
        json_ok(['csrf' => csrf_token()]);

    default:
        json_error('unknown_action', 'Azione non valida.', 404);
}
