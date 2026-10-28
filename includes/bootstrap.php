<?php
/**
 * LifeLine - Bootstrap comune a pagine e API
 */
declare(strict_types=1);

define('LIFELINE', true);

require __DIR__ . '/../config/config.php';

error_reporting(E_ALL);
ini_set('display_errors', cfg('debug') ? '1' : '0');
ini_set('log_errors', '1');
date_default_timezone_set('Europe/Rome');
mb_internal_encoding('UTF-8');

require __DIR__ . '/response.php';
require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/career.php';
require __DIR__ . '/scoring.php';
