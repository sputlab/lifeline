<?php
/**
 * LifeLine - Dati statici del gioco serviti da PHP
 *
 * GET ?file=lang-it | lang-en | city | events
 *
 * Alcuni hosting bloccano o riscrivono le richieste dirette ai file .json:
 * servendoli da PHP il gioco funziona comunque. Se un file manca o non è valido,
 * l'errore indica esattamente quale.
 */
declare(strict_types=1);

require __DIR__ . '/../includes/bootstrap.php';

api_init(['GET']);

const DATA_FILES = [
    'lang-it' => 'lang/it.json',
    'lang-en' => 'lang/en.json',
    'city'    => 'data/city_valdemara.json',
    'events'  => 'data/event_types.json',
];

$key = is_string($_GET['file'] ?? null) ? $_GET['file'] : '';
if (!isset(DATA_FILES[$key])) {
    json_error('unknown_file', 'File non disponibile.', 404);
}
$rel  = DATA_FILES[$key];
$path = dirname(__DIR__) . '/' . $rel;

if (!is_file($path)) {
    json_error('file_missing', "File mancante sul server: $rel", 500, ['file' => $rel]);
}
$raw = (string) file_get_contents($path);
if (str_starts_with($raw, "\xEF\xBB\xBF")) {
    $raw = substr($raw, 3); // BOM aggiunto da alcuni editor
}
$data = json_decode($raw, true);
if (!is_array($data)) {
    json_error('file_invalid', "File non valido ($rel): " . json_last_error_msg(), 500, ['file' => $rel]);
}
header('Cache-Control: no-cache');
json_ok($data);
