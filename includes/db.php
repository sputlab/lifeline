<?php
/**
 * LifeLine - Accesso al database (PDO)
 */
declare(strict_types=1);

if (!defined('LIFELINE')) { http_response_code(403); exit; }

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            cfg('db_host'), (int) cfg('db_port'), cfg('db_name'), cfg('db_charset')
        );
        $pdo = new PDO($dsn, (string) cfg('db_user'), (string) cfg('db_pass'), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

/** Nome tabella con prefisso: tbl('users') => lifeline_users */
function tbl(string $name): string
{
    if (!preg_match('/^[a-z_]+$/', $name)) {
        throw new InvalidArgumentException('Nome tabella non valido: ' . $name);
    }
    return TABLE_PREFIX . $name;
}

/** Legge un'impostazione da lifeline_settings (con cache per richiesta). */
function setting(string $key, ?string $default = null): ?string
{
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        foreach (db()->query('SELECT key_name, value FROM ' . tbl('settings')) as $row) {
            $cache[$row['key_name']] = $row['value'];
        }
    }
    return $cache[$key] ?? $default;
}

/** Verifica se un'eccezione PDO è una violazione di chiave univoca. */
function is_duplicate_key(PDOException $e): bool
{
    return ($e->errorInfo[1] ?? null) === 1062;
}
