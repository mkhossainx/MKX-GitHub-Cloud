<?php
/**
 * MKX GitHub Cloud — API Proxy
 * Secure GitHub REST API gateway with CSRF protection
 */

// Suppress ALL PHP warnings/notices — prevents HTML leaking into JSON responses
error_reporting(0);
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');

// Buffer output — any accidental output gets discarded before JSON is sent
ob_start();

session_start();

// Force JSON content type immediately
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store, no-cache, must-revalidate');

// Rate limiting per session (simple)
$rateKey = 'api_calls_' . date('Y-m-d-H-i');
$_SESSION[$rateKey] = ($_SESSION[$rateKey] ?? 0) + 1;
if ($_SESSION[$rateKey] > 300) {
    http_response_code(429);
    echo json_encode(['error' => 'Local rate limit exceeded. Try again in a minute.']);
    exit;
}

// Auth check
if (empty($_SESSION['github_token'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized', 'redirect' => 'index.php']);
    exit;
}

// CSRF check for mutating methods
$method = $_SERVER['REQUEST_METHOD'];
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'])) {
    $csrfHeader = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $csrfPost   = $_POST['csrf_token'] ?? '';
    $csrf       = $csrfHeader ?: $csrfPost;
    if (!hash_equals($_SESSION['csrf_token'] ?? '', $csrf)) {
        http_response_code(403);
        echo json_encode(['error' => 'CSRF token invalid']);
        exit;
    }
}

$token  = $_SESSION['github_token'];
$action = $_GET['action'] ?? '';

// ─── GitHub cURL helper ───────────────────────────────────────────────────────
function gh($method, $path, $data = null, $token = '') {
    $url = 'https://api.github.com' . $path;
    $headers = [
        'Authorization: token ' . $token,
        'Accept: application/vnd.github.v3+json',
        'User-Agent: MKX-GitHub-Cloud/1.0',
        'X-GitHub-Api-Version: 2022-11-28',
        'Content-Type: application/json',
    ];

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_FOLLOWLOCATION => false,
    ]);

    switch (strtoupper($method)) {
        case 'POST':
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            break;
        case 'PUT':
        case 'PATCH':
        case 'DELETE':
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
            if ($data !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            }
            break;
    }

    $body     = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err      = curl_error($ch);
    curl_close($ch);

    if ($err) return ['status' => 0, 'body' => json_encode(['error' => 'cURL: ' . $err])];
    return ['status' => $status, 'body' => $body];
}

// ─── Sanitise helpers ─────────────────────────────────────────────────────────
function sanitiseSlug($v) {
    return preg_replace('/[^a-zA-Z0-9\-_.]/', '', $v ?? '');
}
function sanitisePath($v) {
    $p = preg_replace('/[^a-zA-Z0-9\-_.\/ ]/', '', $v ?? '');
    return ltrim(str_replace('..', '', $p), '/');
}

// ─── Body parser ─────────────────────────────────────────────────────────────
function body() {
    static $parsed = null;
    if ($parsed === null) {
        $raw    = file_get_contents('php://input');
        $parsed = json_decode($raw, true) ?? [];
    }
    return $parsed;
}

// ─── Route ────────────────────────────────────────────────────────────────────
switch ($action) {

    // ── Auth / Meta ──────────────────────────────────────────────────────────
    case 'csrf':
        echo json_encode(['token' => $_SESSION['csrf_token']]);
        break;

    case 'user':
        $r = gh('GET', '/user', null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    case 'rate_limit':
        $r = gh('GET', '/rate_limit', null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    // ── Repos ────────────────────────────────────────────────────────────────
    case 'repos':
        $page     = max(1, (int)($_GET['page'] ?? 1));
        $per      = min(100, max(10, (int)($_GET['per_page'] ?? 30)));
        $sort     = in_array($_GET['sort'] ?? '', ['created','updated','pushed','full_name'])
                    ? $_GET['sort'] : 'updated';
        $r = gh('GET', "/user/repos?page={$page}&per_page={$per}&sort={$sort}&affiliation=owner", null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    case 'repo':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        if (!$owner || !$repo) { echo json_encode(['error' => 'Missing params']); break; }
        $r = gh('GET', "/repos/{$owner}/{$repo}", null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    case 'create_repo':
        $b = body();
        $name = sanitiseSlug($b['name'] ?? '');
        if (!$name) { http_response_code(400); echo json_encode(['error' => 'Repo name required']); break; }
        $data = [
            'name'        => $name,
            'description' => htmlspecialchars(substr($b['description'] ?? '', 0, 350), ENT_QUOTES),
            'private'     => (bool)($b['private'] ?? false),
            'auto_init'   => (bool)($b['auto_init'] ?? false),
        ];
        if (!empty($b['gitignore_template'])) {
            $data['gitignore_template'] = preg_replace('/[^a-zA-Z0-9]/', '', $b['gitignore_template']);
        }
        if (!empty($b['license_template'])) {
            $data['license_template'] = preg_replace('/[^a-zA-Z0-9\-]/', '', $b['license_template']);
        }
        $r = gh('POST', '/user/repos', $data, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    case 'delete_repo':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        $r = gh('DELETE', "/repos/{$owner}/{$repo}", null, $token);
        http_response_code($r['status']);
        echo ($r['status'] === 204) ? json_encode(['success' => true, 'message' => 'Repository deleted']) : $r['body'];
        break;

    case 'rename_repo':
        $b     = body();
        $owner = sanitiseSlug($b['owner'] ?? '');
        $repo  = sanitiseSlug($b['repo'] ?? '');
        $new   = sanitiseSlug($b['new_name'] ?? '');
        if (!$new) { http_response_code(400); echo json_encode(['error' => 'New name required']); break; }
        $r = gh('PATCH', "/repos/{$owner}/{$repo}", ['name' => $new], $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    case 'fork':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        $r = gh('POST', "/repos/{$owner}/{$repo}/forks", new \stdClass(), $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    case 'update_repo_visibility':
        $b     = body();
        $owner = sanitiseSlug($b['owner'] ?? '');
        $repo  = sanitiseSlug($b['repo'] ?? '');
        $priv  = (bool)($b['private'] ?? false);
        $r = gh('PATCH', "/repos/{$owner}/{$repo}", ['private' => $priv, 'visibility' => $priv ? 'private' : 'public'], $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    // ── Commits ──────────────────────────────────────────────────────────────
    case 'commits':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        $per   = min(30, max(5, (int)($_GET['per_page'] ?? 10)));
        $r = gh('GET', "/repos/{$owner}/{$repo}/commits?per_page={$per}", null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    // ── File Contents ─────────────────────────────────────────────────────────
    case 'contents':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        $path  = sanitisePath($_GET['path'] ?? '');
        $ref   = preg_replace('/[^a-zA-Z0-9\-_.]/', '', $_GET['ref'] ?? '');
        $apiPath = "/repos/{$owner}/{$repo}/contents" . ($path ? '/' . $path : '');
        if ($ref) $apiPath .= "?ref={$ref}";
        $r = gh('GET', $apiPath, null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    case 'create_file':
    case 'update_file':
        $b       = body();
        $owner   = sanitiseSlug($b['owner'] ?? '');
        $repo    = sanitiseSlug($b['repo'] ?? '');
        $path    = sanitisePath($b['path'] ?? '');
        $content = $b['content'] ?? '';
        $msg     = htmlspecialchars(substr($b['message'] ?? 'Update via MKX GitHub Cloud', 0, 255), ENT_QUOTES);

        if (!$owner || !$repo || !$path) {
            http_response_code(400); echo json_encode(['error' => 'Missing required fields']); break;
        }

        // content_is_b64=true  → JS sent pre-encoded base64 (file upload) → pass through
        // content_is_b64 absent → raw text from Monaco editor → must base64-encode
        $alreadyB64   = !empty($b['content_is_b64']);
        $finalContent = $alreadyB64 ? $content : base64_encode($content);
        $data = [
            'message' => $msg,
            'content' => $finalContent,
        ];
        if (!empty($b['sha'])) $data['sha'] = preg_replace('/[^a-f0-9]/', '', $b['sha']);

        $r = gh('PUT', "/repos/{$owner}/{$repo}/contents/{$path}", $data, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    case 'delete_file':
        $b     = body();
        $owner = sanitiseSlug($b['owner'] ?? '');
        $repo  = sanitiseSlug($b['repo'] ?? '');
        $path  = sanitisePath($b['path'] ?? '');
        $sha   = preg_replace('/[^a-f0-9]/', '', $b['sha'] ?? '');
        $msg   = htmlspecialchars(substr($b['message'] ?? 'Delete via MKX GitHub Cloud', 0, 255), ENT_QUOTES);

        if (!$sha) { http_response_code(400); echo json_encode(['error' => 'SHA required for deletion']); break; }

        $r = gh('DELETE', "/repos/{$owner}/{$repo}/contents/{$path}", [
            'message' => $msg,
            'sha'     => $sha,
        ], $token);
        http_response_code($r['status']);
        echo ($r['status'] === 200) ? json_encode(['success' => true]) : $r['body'];
        break;

    // ── Branches ─────────────────────────────────────────────────────────────
    case 'branches':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        $r = gh('GET', "/repos/{$owner}/{$repo}/branches?per_page=30", null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    // ── Search ───────────────────────────────────────────────────────────────
    case 'search_repos':
        $q    = urlencode(htmlspecialchars($_GET['q'] ?? '', ENT_QUOTES));
        $user = sanitiseSlug($_SESSION['github_user'] ?? '');
        $r = gh('GET', "/search/repositories?q={$q}+user:{$user}&per_page=30&sort=updated", null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;


    // ── Code Search (across all user repos) ──────────────────────────────────
    case 'code_search':
        $q    = htmlspecialchars(trim($_GET['q'] ?? ''), ENT_QUOTES);
        $user = sanitiseSlug($_SESSION['github_user'] ?? '');
        if (!$q) { echo json_encode(['items' => []]); break; }
        $encoded = urlencode($q . ' user:' . $user);
        $r = gh('GET', "/search/code?q={$encoded}&per_page=20", null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    // ── Repo Languages ────────────────────────────────────────────────────────
    case 'repo_languages':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        $r = gh('GET', "/repos/{$owner}/{$repo}/languages", null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;

    // ── Pinned Repos (session-based, no GitHub API needed) ───────────────────
    case 'get_pins':
        echo json_encode(['pins' => $_SESSION['pinned_repos'] ?? []]);
        break;

    case 'toggle_pin':
        $b    = body();
        $full = sanitiseSlug(str_replace('/', '_', ($b['full_name'] ?? '')));
        $pins = $_SESSION['pinned_repos'] ?? [];
        if (in_array($full, $pins)) {
            $pins = array_values(array_filter($pins, fn($p) => $p !== $full));
            $msg  = 'unpinned';
        } else {
            $pins[] = $full;
            $msg    = 'pinned';
        }
        $_SESSION['pinned_repos'] = $pins;
        echo json_encode(['pins' => $pins, 'action' => $msg]);
        break;

    // ── ZIP Download redirect ─────────────────────────────────────────────────
    case 'zip_url':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        // Return the GitHub archive URL — browser will follow the redirect
        $url   = "https://api.github.com/repos/{$owner}/{$repo}/zipball";
        // We proxy the redirect so token is kept server-side
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => [
                'Authorization: token ' . $token,
                'User-Agent: MKX-GitHub-Cloud/1.0',
                'X-GitHub-Api-Version: 2022-11-28',
            ],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT        => 10,
        ]);
        curl_exec($ch);
        $redirectUrl = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        curl_close($ch);
        echo json_encode(['url' => $redirectUrl ?: '']);
        break;

    // ── Commit Activity (for analytics) ──────────────────────────────────────
    case 'commit_activity':
        $owner = sanitiseSlug($_GET['owner'] ?? '');
        $repo  = sanitiseSlug($_GET['repo'] ?? '');
        $r = gh('GET', "/repos/{$owner}/{$repo}/stats/commit_activity", null, $token);
        http_response_code($r['status']);
        echo $r['body'];
        break;


    // ── SSH: Test if ssh2 extension available ─────────────────────────────────
    case 'ssh_check':
        echo json_encode(['available' => extension_loaded('ssh2'), 'version' => phpversion()]);
        break;

    // ── SSH: Connect & test credentials ───────────────────────────────────────
    case 'ssh_connect':
        if (!extension_loaded('ssh2')) {
            http_response_code(501);
            echo json_encode(['error' => 'PHP ssh2 extension is not installed on this server. Ask your host to install php-ssh2 / libssh2.']);
            break;
        }
        $b    = body();
        $host = htmlspecialchars(trim($b['host'] ?? ''), ENT_QUOTES);
        $port = max(1, min(65535, (int)($b['port'] ?? 22)));
        $user = htmlspecialchars(trim($b['username'] ?? ''), ENT_QUOTES);
        $pass = $b['password'] ?? '';
        if (!$host || !$user) { http_response_code(400); echo json_encode(['error' => 'Host and username required']); break; }

        // Connect — no third param, broader compatibility with cPanel/shared hosts
        $conn = @ssh2_connect($host, $port);
        if (!$conn) {
            ob_end_clean();
            http_response_code(400);
            echo json_encode(['error' => "Cannot connect to {$host}:{$port} — check host/port and firewall"]);
            break;
        }

        $auth = @ssh2_auth_password($conn, $user, $pass);
        if (!$auth) {
            ob_end_clean();
            http_response_code(401);
            echo json_encode(['error' => 'Authentication failed — wrong username or password']);
            break;
        }

        // Store creds in session (server-side only, never sent to client)
        $_SESSION['ssh'] = ['host' => $host, 'port' => $port, 'user' => $user, 'pass' => $pass];

        // Get system info
        $info = '';
        $st = @ssh2_exec($conn, 'uname -sr && hostname && whoami && pwd 2>/dev/null');
        if ($st) { stream_set_blocking($st, true); $info = trim(stream_get_contents($st)); fclose($st); }

        ob_end_clean();
        echo json_encode(['success' => true, 'info' => $info, 'user' => $user, 'host' => $host]);
        break;

    // ── SSH: Execute command ───────────────────────────────────────────────────
    case 'ssh_exec':
        if (!isset($_SESSION['ssh'])) { http_response_code(400); echo json_encode(['output' => "\r\n\e[31mNot connected. Please connect first.\e[0m\r\n", 'error' => true]); break; }
        if (!extension_loaded('ssh2')) { echo json_encode(['output' => "\r\n\e[31mssh2 extension not available.\e[0m\r\n", 'error' => true]); break; }

        $b   = body();
        $cmd = trim($b['command'] ?? '');
        $cwd = trim($b['cwd'] ?? '~');
        if (!$cmd) { echo json_encode(['output' => '', 'cwd' => $cwd]); break; }

        // Soft-block catastrophic commands
        $blocked = ['rm -rf /', 'rm -rf ~', 'mkfs', ':(){:|:&};:', 'dd if=/dev/zero of=/', '> /dev/sda'];
        foreach ($blocked as $bad) {
            if (stripos($cmd, $bad) !== false) {
                echo json_encode(['output' => "\r\n\e[31mCommand blocked: potential system-destructive operation.\e[0m\r\n"]);
                break 2;
            }
        }

        $ssh = $_SESSION['ssh'];
        $conn = @ssh2_connect($ssh['host'], $ssh['port']);
        if (!$conn || !@ssh2_auth_password($conn, $ssh['user'], $ssh['pass'])) {
            unset($_SESSION['ssh']);
            ob_end_clean();
            echo json_encode(['output' => "\r\n\e[31mConnection lost. Please reconnect.\e[0m\r\n", 'reconnect' => true]);
            break;
        }

        // cd into cwd first, then run command, capture output + new pwd
        $fullCmd = "cd " . escapeshellarg($cwd) . " 2>/dev/null; " . $cmd . " 2>&1; echo \"__CWD__\$(pwd)\"";
        $st = @ssh2_exec($conn, $fullCmd);
        if (!$st) { echo json_encode(['output' => "\r\n\e[31mFailed to execute command.\e[0m\r\n", 'cwd' => $cwd]); break; }

        stream_set_blocking($st, true);
        $raw    = '';
        $start  = microtime(true);
        while (!feof($st)) {
            if ((microtime(true) - $start) > 20) { $raw .= "\r\n\e[33m[Timeout: command exceeded 20s]\e[0m"; break; }
            $raw .= fread($st, 8192);
        }
        fclose($st);

        // Extract new cwd
        $newCwd = $cwd;
        if (preg_match('/__CWD__(.+)$/m', $raw, $m)) {
            $newCwd = trim($m[1]);
            $raw    = preg_replace('/__CWD__.+(\r\n|\n|$)/m', '', $raw);
        }

        // Convert newlines for xterm
        $output = str_replace("\n", "\r\n", rtrim($raw));
        ob_end_clean();
        echo json_encode(['output' => $output, 'cwd' => $newCwd]);
        break;

    // ── SSH: Disconnect ────────────────────────────────────────────────────────
    case 'ssh_disconnect':
        unset($_SESSION['ssh']);
        echo json_encode(['success' => true]);
        break;

    // ── SSH: SFTP list directory ───────────────────────────────────────────────
    case 'ssh_sftp':
        if (!isset($_SESSION['ssh'])) { echo json_encode(['error' => 'Not connected']); break; }
        if (!extension_loaded('ssh2')) { echo json_encode(['error' => 'ssh2 not available']); break; }

        $path = trim($_GET['path'] ?? '~');
        $ssh  = $_SESSION['ssh'];
        $conn = @ssh2_connect($ssh['host'], $ssh['port']);
        if (!$conn || !@ssh2_auth_password($conn, $ssh['user'], $ssh['pass'])) {
            echo json_encode(['error' => 'Connection failed']);
            break;
        }

        $sftp = ssh2_sftp($conn);
        $real = ssh2_sftp_realpath($sftp, $path);
        $dir  = "ssh2.sftp://{$sftp}{$real}";

        $files = [];
        if ($dh = @opendir($dir)) {
            while (($file = readdir($dh)) !== false) {
                if ($file === '.') continue;
                $stat    = @stat("{$dir}/{$file}");
                $isDir   = $stat && ($stat['mode'] & 0170000) === 0040000;
                $files[] = [
                    'name'  => $file,
                    'type'  => $isDir ? 'dir' : 'file',
                    'size'  => $stat['size'] ?? 0,
                    'mtime' => $stat['mtime'] ?? 0,
                    'path'  => rtrim($real, '/') . '/' . $file,
                ];
            }
            closedir($dh);
        }
        usort($files, fn($a,$b) => ($a['type'] === $b['type'] ? strcmp($a['name'], $b['name']) : ($a['type'] === 'dir' ? -1 : 1)));
        echo json_encode(['files' => $files, 'cwd' => $real]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Unknown action: ' . htmlspecialchars($action, ENT_QUOTES)]);
}
