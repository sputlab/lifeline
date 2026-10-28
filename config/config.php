<?php
/**
 * LifeLine - Configurazione principale
 *
 * Non inserire qui le credenziali reali: crea config/config.local.php
 * partendo da config.local.example.php. I valori locali sovrascrivono questi.
 */
declare(strict_types=1);

if (!defined('LIFELINE')) {
    http_response_code(403);
    exit;
}

$lifelineConfig = [
    // Database
    'db_host'    => 'localhost',
    'db_port'    => 3306,
    'db_name'    => 'lifeline',
    'db_user'    => 'root',
    'db_pass'    => '',
    'db_charset' => 'utf8mb4',

    // Applicazione
    'debug'        => false,          // true solo in sviluppo: mostra i messaggi di errore
    'default_lang' => 'it',

    // Sessione
    'session_name' => 'LIFELINESESSID',
    'cookie_path'  => '/',            // es. '/webapp/lifeline/' se l'app non è nella root
    'session_idle' => 60 * 60 * 12,   // secondi di inattività prima del logout automatico

    // Protezione accessi
    'login_max_combo' => 5,           // tentativi falliti per IP + utente
    'login_max_ip'    => 20,          // tentativi falliti per IP
    'login_window'    => 900,         // finestra in secondi (15 minuti)
    'register_max_ip' => 5,           // registrazioni per IP
    'register_window' => 3600,        // finestra in secondi (1 ora)
    'trust_proxy'     => false,       // true se dietro reverse proxy fidato (usa X-Forwarded-For)
];

$lifelineLocal = __DIR__ . '/config.local.php';
if (is_file($lifelineLocal)) {
    $lifelineConfig = array_replace($lifelineConfig, (array) require $lifelineLocal);
}

define('LIFELINE_CFG', $lifelineConfig);
unset($lifelineConfig, $lifelineLocal);

$lifelineVersion = @file_get_contents(dirname(__DIR__) . '/VERSION');
define('APP_NAME', 'LifeLine');
define('APP_VERSION', $lifelineVersion !== false ? trim($lifelineVersion) : '0.0.0');
define('TABLE_PREFIX', 'lifeline_');
define('SUPPORTED_LANGS', ['it', 'en']);
unset($lifelineVersion);

/** Legge un valore di configurazione. */
function cfg(string $key, mixed $default = null): mixed
{
    return LIFELINE_CFG[$key] ?? $default;
}
