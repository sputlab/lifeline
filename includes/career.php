<?php
/**
 * LifeLine - Carriera: gradi, XP e dati pubblici dell'utente
 */
declare(strict_types=1);

if (!defined('LIFELINE')) { http_response_code(403); exit; }

/**
 * Calcola il grado dall'XP. Ogni grado richiede più XP del precedente:
 * grado n -> n+1 costa xp_per_rank * n  (1000, 2000, 3000, ...).
 */
function rank_from_xp(int $xp): array
{
    $step  = max(100, (int) setting('xp_per_rank', '1000'));
    $level = 1;
    $floor = 0;
    while ($xp >= $floor + $step * $level) {
        $floor += $step * $level;
        $level++;
    }
    return [
        'level'     => $level,
        'xp_into'   => $xp - $floor,       // XP accumulati nel grado attuale
        'xp_needed' => $step * $level,     // XP totali del grado attuale
    ];
}

/** Dati dell'utente sicuri da inviare al client (mai l'hash della password). */
function load_user_public(int $userId): ?array
{
    $st = db()->prepare(
        'SELECT u.id, u.username, u.email, u.lang, u.created_at, u.last_login_at, u.is_active,
                c.phase, c.xp, c.shifts_completed, c.calls_handled
         FROM ' . tbl('users') . ' u
         JOIN ' . tbl('careers') . ' c ON c.user_id = u.id
         WHERE u.id = ?'
    );
    $st->execute([$userId]);
    $r = $st->fetch();
    if (!$r || (int) $r['is_active'] !== 1) {
        return null;
    }
    $xp = (int) $r['xp'];
    return [
        'id'            => (int) $r['id'],
        'username'      => $r['username'],
        'email'         => $r['email'],
        'lang'          => $r['lang'],
        'created_at'    => $r['created_at'],
        'last_login_at' => $r['last_login_at'],
        'career' => [
            'phase'            => (int) $r['phase'],
            'xp'               => $xp,
            'rank'             => rank_from_xp($xp),
            'shifts_completed' => (int) $r['shifts_completed'],
            'calls_handled'    => (int) $r['calls_handled'],
        ],
    ];
}
