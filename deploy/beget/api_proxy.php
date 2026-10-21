<?php
$target = 'http://api.bizwor.ru';
$uri = $_SERVER['REQUEST_URI'];
$path = preg_replace('#^/api#', '', parse_url($uri, PHP_URL_PATH));
if ($path === '' || $path === false) $path = '/';
$qs = $_SERVER['QUERY_STRING'] ?? '';
$url = $target . $path . ($qs !== '' ? '?' . $qs : '');
$method = $_SERVER['REQUEST_METHOD'];

$pass = ['CONTENT_TYPE' => 'Content-Type'];
$headers = [];
foreach ($_SERVER as $k => $v) {
    if (isset($pass[$k])) { $headers[] = $pass[$k] . ': ' . $v; continue; }
    if (strpos($k, 'HTTP_') !== 0) continue;
    $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($k, 5)))));
    if (in_array($name, ['Host', 'Content-Length', 'Connection', 'Accept-Encoding', 'Cookie'], true)) continue;
    if ($name === 'Authorization') $name = 'X-Authorization';
    $headers[] = $name . ': ' . $v;
}
if (!empty($_SERVER['HTTP_COOKIE'])) $headers[] = 'X-Cookie: ' . $_SERVER['HTTP_COOKIE'];
$headers[] = 'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? '');
$headers[] = 'X-Forwarded-Proto: https';
$headers[] = 'X-Forwarded-Host: ' . ($_SERVER['HTTP_HOST'] ?? '');

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 120,
]);
if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}
$resp = curl_exec($ch);
if ($resp === false) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    echo json_encode(['error' => 'Сервер АБИЗ недоступен: ' . curl_error($ch)], JSON_UNESCAPED_UNICODE);
    exit;
}
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$hsize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);
$rawHeaders = substr($resp, 0, $hsize);
$body = substr($resp, $hsize);
$blocks = preg_split("/\r\n\r\n/", trim($rawHeaders));
$last = end($blocks);
http_response_code($status);
foreach (explode("\r\n", $last) as $line) {
    if (strpos($line, ':') === false) continue;
    [$k, $v] = array_map('trim', explode(':', $line, 2));
    $lk = strtolower($k);
    if (in_array($lk, ['transfer-encoding', 'connection', 'content-length', 'content-encoding', 'server', 'date'], true)) continue;
    if ($lk === 'x-set-cookie') $k = 'Set-Cookie';
    header($k . ': ' . $v, false);
}
echo $body;
