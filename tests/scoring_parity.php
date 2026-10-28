<?php
// Supporto per tests/scoring_parity.test.js: legge turni valutati in JSON da STDIN e li ricalcola in PHP.
declare(strict_types=1);
define('LIFELINE', true);
require __DIR__ . '/../includes/scoring.php';
$shifts = json_decode(stream_get_contents(STDIN), true);
$out = [];
foreach ($shifts as $sh) {
    $calls = array_map(fn($c) => [
        'template_id' => $c['templateId'], 'axes' => $c['axes'], 'outcome' => $c['outcome'],
        'decisive' => $c['decisive'], 'emergency' => $c['emergency'],
        'final_state' => $c['state'] === 'abandoned' ? 'abbandonata' : 'altro',
    ], $sh['calls']);
    $r = score_shift($calls, $sh['difficulties']);
    $out[] = ['percent' => $r['percent'], 'grade' => $r['grade'], 'xp' => $r['xp'], 'points' => $r['points']];
}
echo json_encode($out);
