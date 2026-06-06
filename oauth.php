<?php
/**
 * MKX GitHub Cloud — GitHub OAuth Callback Handler
 * Exchanges the OAuth code for an access token and creates session
 */

session_start();
session_regenerate_id(true);

require_once __DIR__ . '/config.php';

// Security headers
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');

// ─── Validate state (CSRF protection for OAuth) ───────────────────────────────
$stateParam   = $_GET['state']   ?? '';
$stateSession = $_SESSION['oauth_state'] ?? '';

// Clear the state from session regardless of outcome
unset($_SESSION['oauth_state']);

if (!$stateParam || !$stateSession || !hash_equals($stateSession, $stateParam)) {
    header('Location: index.php?error=oauth_state_mismatch');
    exit;
}

// ─── Check for OAuth error from GitHub ────────────────────────────────────────
if (isset($_GET['error'])) {
    $ghError = htmlspecialchars($_GET['error_description'] ?? $_GET['error'], ENT_QUOTES);
    header('Location: index.php?error=oauth_denied&desc=' . urlencode($ghError));
    exit;
}

// ─── Get the code ─────────────────────────────────────────────────────────────
$code = $_GET['code'] ?? '';
if (!$code) {
    header('Location: index.php?error=oauth_no_code');
    exit;
}

// ─── Exchange code for access token ───────────────────────────────────────────
// Use the same callback URL as in config.php — must match GitHub OAuth App exactly
$callbackUrl = defined('OAUTH_CALLBACK_URL') ? OAUTH_CALLBACK_URL : '';

$ch = curl_init('https://github.com/login/oauth/access_token');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_POSTFIELDS     => http_build_query([
        'client_id'     => GITHUB_CLIENT_ID,
        'client_secret' => GITHUB_CLIENT_SECRET,
        'code'          => $code,
        'redirect_uri'  => $callbackUrl,
    ]),
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
        'User-Agent: MKX-GitHub-Cloud/2.0',
    ],
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($curlErr || $httpCode !== 200) {
    header('Location: index.php?error=oauth_token_exchange_failed');
    exit;
}

$tokenData = json_decode($response, true);
$token     = $tokenData['access_token'] ?? '';

if (!$token) {
    $ghErr = $tokenData['error_description'] ?? ($tokenData['error'] ?? 'Unknown error');
    header('Location: index.php?error=oauth_no_token&desc=' . urlencode($ghErr));
    exit;
}

// ─── Validate token by fetching user profile ─────────────────────────────────
$ch2 = curl_init('https://api.github.com/user');
curl_setopt_array($ch2, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        'Authorization: token ' . $token,
        'Accept: application/vnd.github.v3+json',
        'User-Agent: MKX-GitHub-Cloud/2.0',
        'X-GitHub-Api-Version: 2022-11-28',
    ],
]);

$userResponse = curl_exec($ch2);
$userCode     = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
curl_close($ch2);

if ($userCode !== 200) {
    header('Location: index.php?error=oauth_user_fetch_failed');
    exit;
}

$user = json_decode($userResponse, true);
if (!isset($user['login'])) {
    header('Location: index.php?error=oauth_invalid_user');
    exit;
}

// ─── Create session (same as PAT login) ──────────────────────────────────────
$_SESSION['github_token']  = $token;
$_SESSION['github_user']   = $user['login'];
$_SESSION['github_name']   = $user['name'] ?? $user['login'];
$_SESSION['github_avatar'] = $user['avatar_url'] ?? '';
$_SESSION['github_bio']    = $user['bio'] ?? '';
$_SESSION['github_data']   = json_encode([
    'login'        => $user['login'],
    'name'         => $user['name'] ?? $user['login'],
    'avatar_url'   => $user['avatar_url'] ?? '',
    'bio'          => $user['bio'] ?? '',
    'followers'    => $user['followers'] ?? 0,
    'following'    => $user['following'] ?? 0,
    'public_repos' => $user['public_repos'] ?? 0,
    'html_url'     => $user['html_url'] ?? '',
]);
$_SESSION['csrf_token']    = bin2hex(random_bytes(32));
$_SESSION['login_time']    = time();
$_SESSION['login_method']  = 'oauth';  // Track how they logged in
$_SESSION['ip']            = $_SERVER['REMOTE_ADDR'];

// ─── Redirect to dashboard ────────────────────────────────────────────────────
header('Location: dashboard.php');
exit;
