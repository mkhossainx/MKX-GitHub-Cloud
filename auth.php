<?php
/**
 * MKX GitHub Cloud — Auth Handler
 * Validates GitHub PAT and creates secure session
 */

session_start();
session_regenerate_id(true);
if (file_exists(__DIR__ . '/config.php')) require_once __DIR__ . '/config.php';

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('X-XSS-Protection: 1; mode=block');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: index.php');
    exit;
}

$token = trim($_POST['token'] ?? '');

// Token format validation (PAT, fine-grained PAT, OAuth)
if (empty($token) || !preg_match('/^(ghp_|github_pat_|gho_|ghs_)[a-zA-Z0-9_]+$/', $token)) {
    header('Location: index.php?error=invalid_token');
    exit;
}

// Sanitize token length
if (strlen($token) > 255) {
    header('Location: index.php?error=invalid_token');
    exit;
}

// Validate token with GitHub API
$ch = curl_init('https://api.github.com/user');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Authorization: token ' . $token,
        'Accept: application/vnd.github.v3+json',
        'User-Agent: MKX-GitHub-Cloud/1.0',
        'X-GitHub-Api-Version: 2022-11-28',
    ],
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_FOLLOWLOCATION => false,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    header('Location: index.php?error=network_error');
    exit;
}

if ($httpCode === 401) {
    header('Location: index.php?error=auth_failed');
    exit;
}

if ($httpCode !== 200) {
    header('Location: index.php?error=github_error');
    exit;
}

$user = json_decode($response, true);

if (!isset($user['login'])) {
    header('Location: index.php?error=invalid_response');
    exit;
}

// Store in session (server-side, never exposed to client)
$_SESSION['github_token']  = $token;
$_SESSION['github_user']   = $user['login'];
$_SESSION['github_name']   = $user['name'] ?? $user['login'];
$_SESSION['github_avatar'] = $user['avatar_url'] ?? '';
$_SESSION['github_bio']    = $user['bio'] ?? '';
$_SESSION['github_data']   = json_encode([
    'login'       => $user['login'],
    'name'        => $user['name'] ?? $user['login'],
    'avatar_url'  => $user['avatar_url'] ?? '',
    'bio'         => $user['bio'] ?? '',
    'followers'   => $user['followers'] ?? 0,
    'following'   => $user['following'] ?? 0,
    'public_repos'=> $user['public_repos'] ?? 0,
    'html_url'    => $user['html_url'] ?? '',
]);
$_SESSION['csrf_token']    = bin2hex(random_bytes(32));
$_SESSION['login_time']    = time();
$_SESSION['ip']            = $_SERVER['REMOTE_ADDR'];

header('Location: dashboard.php');
exit;
