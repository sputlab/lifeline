<?php
/**
 * LifeLine - Risposte JSON e utilità per le API
 *
 * Formato di risposta:
 *   successo: { "ok": true,  "data": {...} }
 *   errore:   { "ok": false, "error": { "code": "...", "message": "..." } }
 * Il frontend traduce "code"; "message" è un fallback leggibile.
 */
declare(strict_types=1);

if (!defined('LIFELINE')) { http_response_code(403); exit; }

function json_out(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_ok(array $data = [], int $status = 200): never
{
    json_out(['ok' => true, 'data' => $data], $status);
}

function json_error(string $code, string $message, int $status = 400, array $extra = []): never
{
    json_out(['ok' => false, 'error' => ['code' => $code, 'message' => $message] + $extra], $status);
}

/** Inizializza un endpoint API: header, gestione errori, metodi consentiti. */
function api_init(array $allowedMethods = ['GET', 'POST']): void
{
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');

    set_exception_handler(static function (Throwable $e): void {
        error_log('[LifeLine] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        $msg = cfg('debug') ? $e->getMessage() : 'Errore interno del server.';
        json_error('server_error', $msg, 500);
    });

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, $allowedMethods, true)) {
        header('Allow: ' . implode(', ', $allowedMethods));
        json_error('method_not_allowed', 'Metodo non consentito.', 405);
    }
}

function require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== $method) {
        header('Allow: ' . $method);
        json_error('method_not_allowed', 'Metodo non consentito.', 405);
    }
}

/** Legge il corpo JSON della richiesta (predefinito max 64 KB). */
function read_json(int $maxBytes = 65536): array
{
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || strlen($raw) > $maxBytes) {
        json_error('payload_too_large', 'Richiesta troppo grande.', 413);
    }
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_error('bad_request', 'Formato della richiesta non valido.', 400);
    }
    return $data;
}

/** Stringa dal payload, ripulita (trim) e con lunghezza massima. */
function input_str(array $in, string $key, int $maxLen = 255, bool $trim = true): string
{
    $v = $in[$key] ?? '';
    if (!is_string($v)) {
        return '';
    }
    if ($trim) {
        $v = trim($v);
    }
    return mb_substr($v, 0, $maxLen);
}
