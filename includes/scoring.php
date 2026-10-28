<?php
/**
 * LifeLine - Punteggio lato server
 *
 * Replica le formule di assets/js/game/scoring.js (aritmetica intera) per la parte che produce voto ed XP:
 * il client invia gli assi e l'esito di ogni chiamata, il server ricalcola punteggio
 * finale, punti, percentuale, voto (con i tetti) ed XP usando la difficoltà presa dal
 * database, non dal client. Il registro azioni resta salvato per una verifica completa
 * con replay (validazione prevista per la sfida giornaliera).
 */
declare(strict_types=1);

if (!defined('LIFELINE')) { http_response_code(403); exit; }

// Tutti i calcoli usano interi (centesimi): risultati identici al client JavaScript.
const SCORE_WEIGHTS   = ['time' => 20, 'location' => 20, 'classification' => 20, 'agencies' => 25, 'protocol' => 15];
const OUTCOME_FACTORS = ['positivo' => 100, 'parziale' => 80, 'negativo' => 50, 'nessuno' => 100];
const GRADE_MULTS     = ['S' => 150, 'A' => 125, 'B' => 100, 'C' => 80, 'D' => 50];
const POINTS_FACTOR   = 35;
const COMPLETION_XP   = 50;

/** Divisione intera con arrotondamento a metà per eccesso (numeri non negativi). */
function score_idiv(int $num, int $den): int
{
    return $den > 0 ? intdiv(2 * $num + $den, 2 * $den) : 0;
}

function score_final(array $axes, int $factor): int
{
    $num = 0;
    $w = 0;
    foreach (SCORE_WEIGHTS as $k => $weight) {
        if (isset($axes[$k]) && is_int($axes[$k])) {
            $num += $axes[$k] * $weight;
            $w += $weight;
        }
    }
    return score_idiv($num * $factor, $w * 100);
}

function score_grade(int $pct): string
{
    return match (true) {
        $pct >= 90 => 'S',
        $pct >= 80 => 'A',
        $pct >= 65 => 'B',
        $pct >= 50 => 'C',
        default    => 'D',
    };
}

function score_cap_grade(string $grade, int $negative, int $partial): string
{
    $order = ['S', 'A', 'B', 'C', 'D'];
    $cap = $negative > 0 ? 'B' : ($partial >= 2 ? 'A' : 'S');
    return $order[max(array_search($grade, $order, true), array_search($cap, $order, true))];
}

/**
 * @param array $calls         chiamate validate (assi interi 0-100 o null)
 * @param array $difficulties  template_id => difficoltà
 * @return array{calls: array, percent: int, grade: string, points: int, xp: int, negative: int, partial: int}
 */
function score_shift(array $calls, array $difficulties): array
{
    $wsum = 0;
    $fsum = 0;
    $points = 0;
    $neg = 0;
    $par = 0;
    foreach ($calls as &$c) {
        $d  = $difficulties[$c['template_id']] ?? 1;
        $dw = 100 + (max(1, $d) - 1) * 15;
        $factor = $c['decisive'] ? (OUTCOME_FACTORS[$c['outcome']] ?? 100) : 100;
        $final = score_final($c['axes'], $factor);
        $c['final']  = $final;
        $c['points'] = score_idiv($final * $dw * POINTS_FACTOR, 10000);
        $weight = $dw * ($c['final_state'] === 'abbandonata' && !$c['emergency'] ? 1 : 2);
        $wsum += $weight;
        $fsum += $final * $weight;
        $points += $c['points'];
        if ($c['outcome'] === 'negativo') $neg++;
        if ($c['outcome'] === 'parziale') $par++;
    }
    unset($c);
    $pct = score_idiv($fsum, $wsum);
    $grade = score_cap_grade(score_grade($pct), $neg, $par);
    return [
        'calls'    => $calls,
        'percent'  => $pct,
        'grade'    => $grade,
        'points'   => $points,
        'xp'       => score_idiv($points * GRADE_MULTS[$grade], 100) + COMPLETION_XP,
        'negative' => $neg,
        'partial'  => $par,
    ];
}
