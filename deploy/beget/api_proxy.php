<?php
error_reporting(E_ALL);
ini_set('display_errors', '0');

function abiz_fail($text)
{
    if (!headers_sent()) {
        header('HTTP/1.1 502 Bad Gateway');
        header('Content-Type: application/json; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
    }
    echo json_encode(array('error' => $text));
    exit;
}

function abiz_shutdown()
{
    $e = error_get_last();
    if ($e && in_array($e['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR), true)) {
        abiz_fail('API proxy: ' . $e['message'] . ' (PHP ' . PHP_VERSION . ')');
    }
}
register_shutdown_function('abiz_shutdown');

$target = 'http://api.bizwor.ru';
$uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
$path = (string)parse_url($uri, PHP_URL_PATH);
$path = preg_replace('#^/api#', '', $path);
if ($path === '' || $path === '/index.php') $path = '/';
$qs = isset($_SERVER['QUERY_STRING']) ? $_SERVER['QUERY_STRING'] : '';
$url = $target . $path . ($qs !== '' ? '?' . $qs : '');
$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ($method === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Authorization, X-Session-Id, X-Skud-Key, X-Auth-Token, X-User-Id');
    header('Access-Control-Max-Age: 86400');
    exit;
}

$headers = array();
if (!empty($_SERVER['CONTENT_TYPE'])) $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
$skip = array('Host', 'Content-Length', 'Content-Type', 'Connection', 'Accept-Encoding', 'Cookie', 'Expect');
foreach ($_SERVER as $k => $v) {
    if (strpos($k, 'HTTP_') !== 0) continue;
    $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($k, 5)))));
    if (in_array($name, $skip, true)) continue;
    if ($name === 'Authorization') $name = 'X-Authorization';
    $headers[] = $name . ': ' . $v;
}
if (!empty($_SERVER['HTTP_COOKIE'])) $headers[] = 'X-Cookie: ' . $_SERVER['HTTP_COOKIE'];
$headers[] = 'X-Forwarded-For: ' . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
$headers[] = 'X-Forwarded-Proto: https';
$body = in_array($method, array('GET', 'HEAD'), true) ? '' : file_get_contents('php://input');

$status = 502;
$respHeaders = array();
$respBody = '';

if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_TIMEOUT, 120);
    if ($body !== '') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp = curl_exec($ch);
    if ($resp === false) abiz_fail('ABIZ server unavailable: ' . curl_error($ch));
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $hsize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $blocks = preg_split("/\r\n\r\n/", trim(substr($resp, 0, $hsize)));
    $respHeaders = explode("\r\n", end($blocks));
    $respBody = substr($resp, $hsize);
} else {
    $ctx = stream_context_create(array('http' => array(
        'method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body,
        'ignore_errors' => true, 'timeout' => 120, 'follow_location' => 0,
    )));
    $respBody = @file_get_contents($url, false, $ctx);
    if ($respBody === false) abiz_fail('ABIZ server unavailable (no curl)');
    $respHeaders = isset($http_response_header) ? $http_response_header : array();
    if ($respHeaders && preg_match('#\s(\d{3})#', $respHeaders[0], $m)) $status = (int)$m[1];
}

header('HTTP/1.1 ' . $status . ' X');
$drop = array('transfer-encoding', 'connection', 'content-length', 'content-encoding', 'server', 'date', 'keep-alive');
foreach ($respHeaders as $line) {
    $p = strpos($line, ':');
    if ($p === false) continue;
    $k = trim(substr($line, 0, $p));
    $v = trim(substr($line, $p + 1));
    $lk = strtolower($k);
    if (in_array($lk, $drop, true)) continue;
    if ($lk === 'x-set-cookie') $k = 'Set-Cookie';
    header($k . ': ' . $v, false);
}
echo $respBody;
