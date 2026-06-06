<?php
/**
 * MKX GitHub Cloud — Advanced File Manager API
 * ZIP upload/extract, copy, move, rename, bulk delete, compress, clipboard
 * Version: 2.0 — Production Ready
 */

error_reporting(0);
ini_set('display_errors', '0');
ob_start();

session_start();

// ── Security headers ──────────────────────────────────────────────────────────
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Cache-Control: no-store, no-cache, must-revalidate');

// ── Auth check ────────────────────────────────────────────────────────────────
if (empty($_SESSION['github_token'])) {
    respond(401, ['error' => 'Unauthorized. Please login again.']);
}

// ── CSRF for all POST ─────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf_token'] ?? '');
    if (!hash_equals($_SESSION['csrf_token'] ?? '', $csrf)) {
        respond(403, ['error' => 'CSRF token invalid.']);
    }
}

define('GH_TOKEN', $_SESSION['github_token']);
// Temp dir — try system temp first, fall back to app-local folder
function fmTmpDir(): string {
    $candidates = [
        rtrim(sys_get_temp_dir(), '/') . '/mkx_fm',
        rtrim(ini_get('upload_tmp_dir') ?: '', '/') . '/mkx_fm',
        __DIR__ . '/fm_tmp',
    ];
    foreach ($candidates as $dir) {
        if (!$dir || $dir === '/mkx_fm') continue;
        if (!is_dir($dir)) @mkdir($dir, 0700, true);
        if (is_dir($dir) && is_writable($dir)) return $dir;
    }
    // Last resort: system temp without subdirectory
    return rtrim(sys_get_temp_dir(), '/');
}
define('FM_TMP', fmTmpDir());

// Protect local tmp folder from web access
if (str_starts_with(FM_TMP, __DIR__) && !file_exists(FM_TMP . '/.htaccess')) {
    @file_put_contents(FM_TMP . '/.htaccess', "Deny from all
");
}

// ── Core helpers ──────────────────────────────────────────────────────────────

function respond(int $code, mixed $data): never {
    while (ob_get_level() > 0) ob_end_clean();
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array {
    static $b = null;
    if ($b === null) $b = json_decode(file_get_contents('php://input'), true) ?? [];
    return $b;
}

function slug(string $s): string {
    return preg_replace('/[^a-zA-Z0-9._\-]/', '', $s);
}

function safePath(string $p): string {
    $p = str_replace('\\', '/', $p);
    $parts = [];
    foreach (explode('/', $p) as $seg) {
        if ($seg === '' || $seg === '.') continue;
        if ($seg === '..') { array_pop($parts); continue; }
        $parts[] = $seg;
    }
    return implode('/', $parts);
}

function safeFileName(string $n): string {
    return preg_replace('/[^a-zA-Z0-9._\-\s]/', '', $n);
}

// ── GitHub API helper ─────────────────────────────────────────────────────────

function gh(string $method, string $path, mixed $data = null): array {
    static $ch_base = null;
    $url = 'https://api.github.com' . $path;
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER     => [
            'Authorization: token ' . GH_TOKEN,
            'Accept: application/vnd.github.v3+json',
            'User-Agent: MKX-GitHub-Cloud/2.0',
            'X-GitHub-Api-Version: 2022-11-28',
            'Content-Type: application/json',
        ],
    ]);
    switch (strtoupper($method)) {
        case 'POST':
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            break;
        case 'PUT': case 'PATCH': case 'DELETE':
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
            if ($data !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            break;
    }
    $body   = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    if ($err) return ['status' => 0, 'body' => null, 'raw' => $err];
    return ['status' => $status, 'body' => json_decode($body, true), 'raw' => $body];
}

function ghGet(string $path): array    { return gh('GET',    $path); }
function ghPut(string $path, $d): array  { return gh('PUT',    $path, $d); }
function ghDel(string $path, $d): array  { return gh('DELETE', $path, $d); }

function getFileSha(string $owner, string $repo, string $path): ?string {
    $r = ghGet("/repos/{$owner}/{$repo}/contents/{$path}");
    return ($r['status'] === 200 && isset($r['body']['sha'])) ? $r['body']['sha'] : null;
}

function cleanB64(string $b): string {
    return str_replace(["\n", "\r", ' '], '', $b);
}

// ── Blocked extensions (upload & extract) ────────────────────────────────────
const BLOCKED_EXTS = ['exe','bat','cmd','com','scr','ps1','vbs','phtml',
                      'php3','php4','php5','php7','php8','phar','cgi'];

function isBlockedExt(string $filename): bool {
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    return in_array($ext, BLOCKED_EXTS, true);
}

// ─────────────────────────────────────────────────────────────────────────────
//  RECURSIVE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function listDirRecursive(string $owner, string $repo, string $path): array {
    $res = ghGet("/repos/{$owner}/{$repo}/contents/{$path}");
    if ($res['status'] !== 200 || !is_array($res['body'])) return [];
    $files = [];
    foreach ($res['body'] as $item) {
        if ($item['type'] === 'file') {
            $files[] = $item;
        } elseif ($item['type'] === 'dir') {
            $files = array_merge($files, listDirRecursive($owner, $repo, $item['path']));
        }
    }
    return $files;
}

function copyMoveDir(
    string $srcOwner, string $srcRepo, string $srcPath,
    string $dstOwner, string $dstRepo, string $dstPath,
    bool $isMove, array &$errors
): int {
    $res = ghGet("/repos/{$srcOwner}/{$srcRepo}/contents/{$srcPath}");
    if ($res['status'] !== 200 || !is_array($res['body'])) {
        $errors[] = "Cannot list: {$srcPath}";
        return 0;
    }
    $done = 0;
    foreach ($res['body'] as $item) {
        $itemDst = "{$dstPath}/{$item['name']}";
        if ($item['type'] === 'file') {
            $fRes = ghGet("/repos/{$srcOwner}/{$srcRepo}/contents/{$item['path']}");
            if ($fRes['status'] !== 200) { $errors[] = "Cannot read: {$item['path']}"; continue; }
            $content  = cleanB64($fRes['body']['content'] ?? '');
            $srcSha   = $fRes['body']['sha'] ?? null;
            $existSha = getFileSha($dstOwner, $dstRepo, $itemDst);
            $payload  = ['message' => ($isMove ? 'Move' : 'Copy') . ": {$item['path']}", 'content' => $content];
            if ($existSha) $payload['sha'] = $existSha;
            $put = ghPut("/repos/{$dstOwner}/{$dstRepo}/contents/{$itemDst}", $payload);
            if (in_array($put['status'], [200, 201])) {
                $done++;
                if ($isMove && $srcSha) {
                    ghDel("/repos/{$srcOwner}/{$srcRepo}/contents/{$item['path']}",
                        ['message' => "Move: delete {$item['path']}", 'sha' => $srcSha]);
                }
            } else {
                $errors[] = "Failed write: {$itemDst} (" . ($put['body']['message'] ?? $put['status']) . ")";
            }
        } elseif ($item['type'] === 'dir') {
            $done += copyMoveDir($srcOwner, $srcRepo, $item['path'], $dstOwner, $dstRepo, $itemDst, $isMove, $errors);
        }
    }
    return $done;
}

function deleteDir(string $owner, string $repo, string $path, array &$errors): int {
    $res = ghGet("/repos/{$owner}/{$repo}/contents/{$path}");
    if ($res['status'] !== 200 || !is_array($res['body'])) {
        $errors[] = "Cannot list: {$path}";
        return 0;
    }
    $done = 0;
    foreach ($res['body'] as $item) {
        if ($item['type'] === 'file') {
            $del = ghDel("/repos/{$owner}/{$repo}/contents/{$item['path']}",
                ['message' => "Delete: {$item['path']}", 'sha' => $item['sha']]);
            if ($del['status'] === 200) $done++;
            else $errors[] = "Delete failed: {$item['path']}";
        } elseif ($item['type'] === 'dir') {
            $done += deleteDir($owner, $repo, $item['path'], $errors);
        }
    }
    return $done;
}

function fetchDirForZip(string $owner, string $repo, string $path, ZipArchive $zip, string $baseStrip, array &$errors): int {
    $res = ghGet("/repos/{$owner}/{$repo}/contents/{$path}");
    if ($res['status'] !== 200 || !is_array($res['body'])) {
        $errors[] = "Cannot list: {$path}";
        return 0;
    }
    $done = 0;
    foreach ($res['body'] as $item) {
        if ($item['type'] === 'file') {
            $fRes = ghGet("/repos/{$owner}/{$repo}/contents/{$item['path']}");
            if ($fRes['status'] === 200 && isset($fRes['body']['content'])) {
                $content  = base64_decode(cleanB64($fRes['body']['content']));
                $entry    = $baseStrip ? ltrim(str_replace($baseStrip . '/', '', $item['path']), '/') : $item['path'];
                $zip->addFromString($entry, $content);
                $done++;
            } else {
                $errors[] = "Cannot fetch: {$item['path']}";
            }
        } elseif ($item['type'] === 'dir') {
            $done += fetchDirForZip($owner, $repo, $item['path'], $zip, $baseStrip, $errors);
        }
    }
    return $done;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ACTION ROUTER
// ─────────────────────────────────────────────────────────────────────────────

$action = $_GET['action'] ?? '';

switch ($action) {

// ═══════════════════════════════════════════════════════════════════════════
//  1. ZIP UPLOAD (chunked, large file support)
// ═══════════════════════════════════════════════════════════════════════════
case 'upload_zip': {
    $b      = body();
    $owner  = slug($b['owner'] ?? '');
    $repo   = slug($b['repo']  ?? '');
    $b64    = $b['zip_b64']    ?? '';
    $chunk  = (int)($b['chunk'] ?? 0);
    $total  = max(1, (int)($b['total'] ?? 1));
    $tmpKey = preg_replace('/[^a-zA-Z0-9_]/', '', $b['tmp_key'] ?? uniqid('z', true));

    if (!$owner || !$repo || !$b64) respond(400, ['error' => 'Missing required fields.']);

    // Strip whitespace before decode (strict mode rejects \n \r space)
    $b64Clean = preg_replace('/[\s]/', '', $b64);
    $decoded  = base64_decode($b64Clean, false);
    if ($decoded === false || $decoded === '') respond(400, ['error' => 'Invalid base64 data in chunk ' . $chunk . '. Data may be corrupted.']);

    $tmpFile = FM_TMP . '/' . $tmpKey . '.zip';
    $flags   = ($chunk === 0) ? 0 : FILE_APPEND;
    if (file_put_contents($tmpFile, $decoded, $flags) === false)
        respond(500, ['error' => 'Server write error. Check temp dir permissions.']);

    // Last chunk — validate
    if ($chunk + 1 >= $total) {
        if (!class_exists('ZipArchive')) { @unlink($tmpFile); respond(501, ['error' => 'PHP ZipArchive extension not available on server.']); }

        // Auto-decode: handle double-base64 encoded ZIPs (Upload button bug)
        $raw = file_get_contents($tmpFile) ?: '';
        if ($raw && substr($raw, 0, 2) !== 'PK') {
            $dec = base64_decode(preg_replace('/[\s]/', '', $raw), false);
            if ($dec !== false && substr($dec, 0, 2) === 'PK') {
                file_put_contents($tmpFile, $dec);
            } else {
                $dec2 = ($dec !== false) ? base64_decode(preg_replace('/[\s]/', '', $dec), false) : false;
                if ($dec2 !== false && substr($dec2, 0, 2) === 'PK') file_put_contents($tmpFile, $dec2);
            }
        }

        $zip = new ZipArchive();
        $ok  = $zip->open($tmpFile);
        if ($ok !== true) {
            @unlink($tmpFile);
            $hex = bin2hex(substr($raw, 0, 4));
            respond(400, ['error' => "Not a valid ZIP (code {$ok}, first bytes: {$hex}). File may be corrupted."]);
        }
        $numFiles = $zip->numFiles;
        $zip->close();
        respond(200, ['success' => true, 'tmp_key' => $tmpKey, 'num_files' => $numFiles, 'message' => "ZIP uploaded ({$numFiles} entries). Ready to extract."]);
    }

    respond(200, ['success' => true, 'chunk' => $chunk, 'tmp_key' => $tmpKey]);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. ZIP EXTRACT — extracts to GitHub repo with ZIP Slip protection
// ═══════════════════════════════════════════════════════════════════════════
case 'extract_zip': {
    if (!class_exists('ZipArchive')) respond(501, ['error' => 'ZipArchive not available on this server.']);
    $b        = body();
    $owner    = slug($b['owner']     ?? '');
    $repo     = slug($b['repo']      ?? '');
    $basePath = safePath($b['base_path'] ?? '');
    $tmpKey   = preg_replace('/[^a-zA-Z0-9_]/', '', $b['tmp_key'] ?? '');

    if (!$owner || !$repo || !$tmpKey) respond(400, ['error' => 'Missing owner, repo, or tmp_key.']);

    $tmpFile = FM_TMP . '/' . $tmpKey . '.zip';
    if (!file_exists($tmpFile)) respond(404, ['error' => 'ZIP not found on server. Please re-upload.']);

    $zip = new ZipArchive();
    if ($zip->open($tmpFile) !== true) respond(400, ['error' => 'Cannot open ZIP file.']);

    $total    = $zip->numFiles;
    $done     = 0;
    $skipped  = 0;
    $errors   = [];
    $created  = [];

    for ($i = 0; $i < $total; $i++) {
        $entry = $zip->getNameIndex($i);
        if ($entry === false) continue;

        // Normalize path separators
        $entry = str_replace('\\', '/', $entry);

        // ── ZIP Slip / Path Traversal Protection ───────────────────────
        if (strpos($entry, '..') !== false)   { $skipped++; $errors[] = "Blocked (traversal): {$entry}"; continue; }
        if (preg_match('/^\/|:\/\/|~\//', $entry)) { $skipped++; $errors[] = "Blocked (absolute): {$entry}"; continue; }

        // Skip macOS/Windows metadata
        if (preg_match('/^(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/', $entry)) { $skipped++; continue; }

        // Skip directories (GitHub creates them implicitly)
        if (substr($entry, -1) === '/') continue;

        // Build target path in repo
        $target = $basePath ? safePath($basePath . '/' . $entry) : safePath($entry);
        if (!$target) { $skipped++; continue; }

        // Validate extension
        if (isBlockedExt($target)) { $skipped++; $errors[] = "Blocked extension: {$entry}"; continue; }

        // Read content
        $content = $zip->getFromIndex($i);
        if ($content === false) { $errors[] = "Read error: {$entry}"; continue; }

        // Get existing SHA
        $sha     = getFileSha($owner, $repo, $target);
        $payload = ['message' => "Extract: {$entry}", 'content' => base64_encode($content)];
        if ($sha) $payload['sha'] = $sha;

        $res = ghPut("/repos/{$owner}/{$repo}/contents/{$target}", $payload);
        if (in_array($res['status'], [200, 201])) {
            $done++;
            $created[] = $target;
        } else {
            $msg = $res['body']['message'] ?? "HTTP {$res['status']}";
            $errors[] = "Failed {$entry}: {$msg}";
            if ($res['status'] === 403 && stripos($msg, 'rate limit') !== false) {
                $errors[] = 'GitHub rate limit reached. Partial extraction completed.';
                break;
            }
        }

        // Throttle every 15 files to avoid rate limiting
        if ($done > 0 && $done % 15 === 0) usleep(200000);
    }

    $zip->close();
    @unlink($tmpFile);

    respond(200, [
        'success'   => $done > 0,
        'total'     => $total,
        'extracted' => $done,
        'skipped'   => $skipped,
        'errors'    => $errors,
        'created'   => array_slice($created, 0, 30),
        'message'   => "{$done} files extracted successfully." . ($skipped ? " {$skipped} skipped." : '') . (count($errors) ? ' ' . count($errors) . ' errors.' : ''),
    ]);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. COPY FILES
// ═══════════════════════════════════════════════════════════════════════════
case 'copy_files': {
    $b       = body();
    $owner   = slug($b['owner'] ?? '');
    $repo    = slug($b['repo']  ?? '');
    $files   = $b['files']      ?? [];
    $destDir = safePath($b['dest_dir'] ?? '');

    if (!$owner || !$repo || empty($files)) respond(400, ['error' => 'Missing required fields.']);

    $done = 0; $errors = [];
    foreach ($files as $f) {
        $src  = safePath($f['path'] ?? '');
        $name = basename($src);
        $dst  = $destDir ? "{$destDir}/{$name}" : $name;
        if (!$src || !$name) continue;

        if (($f['type'] ?? 'file') === 'file') {
            $res = ghGet("/repos/{$owner}/{$repo}/contents/{$src}");
            if ($res['status'] !== 200) { $errors[] = "Cannot read: {$src}"; continue; }
            $content  = cleanB64($res['body']['content'] ?? '');
            $existSha = getFileSha($owner, $repo, $dst);
            $payload  = ['message' => "Copy: {$src} → {$dst}", 'content' => $content];
            if ($existSha) $payload['sha'] = $existSha;
            $put = ghPut("/repos/{$owner}/{$repo}/contents/{$dst}", $payload);
            if (in_array($put['status'], [200, 201])) $done++;
            else $errors[] = "Copy failed: {$dst} (" . ($put['body']['message'] ?? '') . ")";
        } else {
            $done += copyMoveDir($owner, $repo, $src, $owner, $repo, $dst, false, $errors);
        }
    }
    respond(200, ['success' => $done > 0, 'done' => $done, 'errors' => $errors, 'message' => "{$done} item(s) copied."]);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. MOVE FILES
// ═══════════════════════════════════════════════════════════════════════════
case 'move_files': {
    $b       = body();
    $owner   = slug($b['owner'] ?? '');
    $repo    = slug($b['repo']  ?? '');
    $files   = $b['files']      ?? [];
    $destDir = safePath($b['dest_dir'] ?? '');

    if (!$owner || !$repo || empty($files)) respond(400, ['error' => 'Missing required fields.']);

    $done = 0; $errors = [];
    foreach ($files as $f) {
        $src  = safePath($f['path'] ?? '');
        $name = basename($src);
        $dst  = $destDir ? "{$destDir}/{$name}" : $name;
        if (!$src || !$name) continue;

        if (($f['type'] ?? 'file') === 'file') {
            $res = ghGet("/repos/{$owner}/{$repo}/contents/{$src}");
            if ($res['status'] !== 200) { $errors[] = "Cannot read: {$src}"; continue; }
            $content  = cleanB64($res['body']['content'] ?? '');
            $srcSha   = $res['body']['sha'] ?? null;
            $existSha = getFileSha($owner, $repo, $dst);
            $payload  = ['message' => "Move: {$src} → {$dst}", 'content' => $content];
            if ($existSha) $payload['sha'] = $existSha;
            $put = ghPut("/repos/{$owner}/{$repo}/contents/{$dst}", $payload);
            if (in_array($put['status'], [200, 201])) {
                $done++;
                if ($srcSha) ghDel("/repos/{$owner}/{$repo}/contents/{$src}",
                    ['message' => "Move: delete {$src}", 'sha' => $srcSha]);
            } else {
                $errors[] = "Move failed: {$dst} (" . ($put['body']['message'] ?? '') . ")";
            }
        } else {
            $done += copyMoveDir($owner, $repo, $src, $owner, $repo, $dst, true, $errors);
        }
    }
    respond(200, ['success' => $done > 0, 'done' => $done, 'errors' => $errors, 'message' => "{$done} item(s) moved."]);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. RENAME
// ═══════════════════════════════════════════════════════════════════════════
case 'rename_item': {
    $b       = body();
    $owner   = slug($b['owner']   ?? '');
    $repo    = slug($b['repo']    ?? '');
    $oldPath = safePath($b['old_path'] ?? '');
    $newName = safeFileName($b['new_name'] ?? '');
    $type    = $b['type'] ?? 'file';

    if (!$owner || !$repo || !$oldPath || !$newName) respond(400, ['error' => 'Missing required fields.']);

    $dir     = dirname($oldPath);
    $newPath = ($dir && $dir !== '.') ? "{$dir}/{$newName}" : $newName;

    if ($type === 'file') {
        $res = ghGet("/repos/{$owner}/{$repo}/contents/{$oldPath}");
        if ($res['status'] !== 200) respond(404, ['error' => "Source not found: {$oldPath}"]);
        $content  = cleanB64($res['body']['content'] ?? '');
        $srcSha   = $res['body']['sha'];
        $existSha = getFileSha($owner, $repo, $newPath);
        $payload  = ['message' => "Rename: {$oldPath} → {$newPath}", 'content' => $content];
        if ($existSha) $payload['sha'] = $existSha;
        $put = ghPut("/repos/{$owner}/{$repo}/contents/{$newPath}", $payload);
        if (!in_array($put['status'], [200, 201]))
            respond(400, ['error' => 'Cannot create renamed file: ' . ($put['body']['message'] ?? '')]);
        ghDel("/repos/{$owner}/{$repo}/contents/{$oldPath}",
            ['message' => "Rename: delete old {$oldPath}", 'sha' => $srcSha]);
        respond(200, ['success' => true, 'new_path' => $newPath]);
    } else {
        $errors = [];
        $done   = copyMoveDir($owner, $repo, $oldPath, $owner, $repo, $newPath, true, $errors);
        respond(200, ['success' => $done > 0, 'done' => $done, 'errors' => $errors, 'new_path' => $newPath]);
    }
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. BULK DELETE
// ═══════════════════════════════════════════════════════════════════════════
case 'bulk_delete': {
    $b     = body();
    $owner = slug($b['owner'] ?? '');
    $repo  = slug($b['repo']  ?? '');
    $items = $b['items']      ?? [];

    if (!$owner || !$repo || empty($items)) respond(400, ['error' => 'Missing required fields.']);

    $done = 0; $errors = [];
    foreach ($items as $item) {
        $path = safePath($item['path'] ?? '');
        $type = $item['type'] ?? 'file';
        $sha  = $item['sha']  ?? null;
        if (!$path) continue;

        if ($type === 'file') {
            if (!$sha) $sha = getFileSha($owner, $repo, $path);
            if (!$sha) { $errors[] = "Cannot get SHA: {$path}"; continue; }
            $del = ghDel("/repos/{$owner}/{$repo}/contents/{$path}",
                ['message' => "Delete: {$path}", 'sha' => $sha]);
            if ($del['status'] === 200) $done++;
            else $errors[] = "Delete failed: {$path}";
        } else {
            $done += deleteDir($owner, $repo, $path, $errors);
        }
    }
    respond(200, ['success' => $done > 0, 'done' => $done, 'errors' => $errors, 'message' => "{$done} item(s) deleted."]);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. COMPRESS — download selected files/folders as ZIP
// ═══════════════════════════════════════════════════════════════════════════
case 'compress': {
    if (!class_exists('ZipArchive')) respond(501, ['error' => 'ZipArchive not available.']);
    $b        = body();
    $owner    = slug($b['owner']    ?? '');
    $repo     = slug($b['repo']     ?? '');
    $items    = $b['items']         ?? [];
    $zipName  = preg_replace('/[^a-zA-Z0-9._\-]/', '', $b['zip_name'] ?? 'archive');
    $basePath = safePath($b['base_path'] ?? '');

    if (!$owner || !$repo || empty($items)) respond(400, ['error' => 'Missing required fields.']);

    $tmpZip = FM_TMP . '/' . uniqid('cmp_', true) . '.zip';
    $zip    = new ZipArchive();
    if ($zip->open($tmpZip, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true)
        respond(500, ['error' => 'Cannot create ZIP archive.']);

    $done = 0; $errors = [];
    foreach ($items as $item) {
        $path = safePath($item['path'] ?? '');
        $type = $item['type'] ?? 'file';
        if (!$path) continue;

        if ($type === 'file') {
            $res = ghGet("/repos/{$owner}/{$repo}/contents/{$path}");
            if ($res['status'] === 200 && isset($res['body']['content'])) {
                $content = base64_decode(cleanB64($res['body']['content']));
                $entry   = $basePath ? ltrim(str_replace($basePath . '/', '', $path), '/') : basename($path);
                $zip->addFromString($entry, $content);
                $done++;
            } else {
                $errors[] = "Cannot fetch: {$path}";
            }
        } else {
            $done += fetchDirForZip($owner, $repo, $path, $zip, $basePath, $errors);
        }
    }
    $zip->close();

    if ($done === 0) { @unlink($tmpZip); respond(400, ['error' => 'No files found to compress.']); }

    $zipContent = file_get_contents($tmpZip);
    @unlink($tmpZip);

    while (ob_get_level() > 0) ob_end_clean();
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $zipName . '.zip"');
    header('Content-Length: ' . strlen($zipContent));
    header('X-Files-Count: ' . $done);
    echo $zipContent;
    exit;
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. CLIPBOARD — session-based
// ═══════════════════════════════════════════════════════════════════════════
case 'clipboard_set': {
    $b = body();
    $_SESSION['fm_clip'] = [
        'action' => in_array($b['action'] ?? '', ['copy','cut']) ? $b['action'] : 'copy',
        'items'  => array_slice($b['items'] ?? [], 0, 100),
        'owner'  => slug($b['owner'] ?? ''),
        'repo'   => slug($b['repo']  ?? ''),
        'ts'     => time(),
    ];
    respond(200, ['success' => true, 'count' => count($_SESSION['fm_clip']['items'])]);
    break;
}

case 'clipboard_get': {
    $clip = $_SESSION['fm_clip'] ?? null;
    // Expire after 1 hour
    if ($clip && (time() - ($clip['ts'] ?? 0)) > 3600) {
        unset($_SESSION['fm_clip']);
        $clip = null;
    }
    respond(200, ['clipboard' => $clip]);
    break;
}

case 'clipboard_clear': {
    unset($_SESSION['fm_clip']);
    respond(200, ['success' => true]);
    break;
}

case 'clipboard_paste': {
    $b       = body();
    $owner   = slug($b['owner']    ?? '');
    $repo    = slug($b['repo']     ?? '');
    $destDir = safePath($b['dest_dir'] ?? '');
    $clip    = $_SESSION['fm_clip'] ?? null;

    if (!$clip || empty($clip['items'])) respond(400, ['error' => 'Clipboard is empty.']);
    if (!$owner || !$repo) respond(400, ['error' => 'Missing owner/repo.']);

    $isMove    = ($clip['action'] === 'cut');
    $srcOwner  = slug($clip['owner'] ?? $owner);
    $srcRepo   = slug($clip['repo']  ?? $repo);
    $done      = 0;
    $errors    = [];

    foreach ($clip['items'] as $item) {
        $srcPath  = safePath($item['path'] ?? '');
        $name     = basename($srcPath);
        $dstPath  = $destDir ? "{$destDir}/{$name}" : $name;
        $type     = $item['type'] ?? 'file';
        if (!$srcPath || !$name) continue;

        if ($type === 'file') {
            $iOwner = slug($item['owner'] ?? $srcOwner);
            $iRepo  = slug($item['repo']  ?? $srcRepo);
            $res = ghGet("/repos/{$iOwner}/{$iRepo}/contents/{$srcPath}");
            if ($res['status'] !== 200) { $errors[] = "Cannot read: {$srcPath}"; continue; }
            $content  = cleanB64($res['body']['content'] ?? '');
            $srcSha   = $res['body']['sha'];
            $existSha = getFileSha($owner, $repo, $dstPath);
            $payload  = ['message' => ($isMove ? 'Move' : 'Copy') . " (paste): {$srcPath} → {$dstPath}", 'content' => $content];
            if ($existSha) $payload['sha'] = $existSha;
            $put = ghPut("/repos/{$owner}/{$repo}/contents/{$dstPath}", $payload);
            if (in_array($put['status'], [200, 201])) {
                $done++;
                if ($isMove) ghDel("/repos/{$iOwner}/{$iRepo}/contents/{$srcPath}",
                    ['message' => "Cut/paste: delete {$srcPath}", 'sha' => $srcSha]);
            } else {
                $errors[] = "Paste failed: {$dstPath}";
            }
        } else {
            $iOwner = slug($item['owner'] ?? $srcOwner);
            $iRepo  = slug($item['repo']  ?? $srcRepo);
            $done  += copyMoveDir($iOwner, $iRepo, $srcPath, $owner, $repo, $dstPath, $isMove, $errors);
        }
    }

    if ($isMove && $done > 0) unset($_SESSION['fm_clip']);
    respond(200, ['success' => $done > 0, 'done' => $done, 'errors' => $errors, 'message' => "Pasted {$done} item(s)."]);
    break;
}

// ═══════════════════════════════════════════════════════════════════════════
//  NEW: FETCH FOR EXTRACT — server-side ZIP download (no 1MB limit)
//  Bypasses GitHub API content limit by fetching via download_url
// ═══════════════════════════════════════════════════════════════════════════
case 'fetch_for_extract': {
    if (!class_exists('ZipArchive')) respond(501, ['error' => 'PHP ZipArchive extension not available on this server.']);
    $b     = body();
    $owner = slug($b['owner'] ?? '');
    $repo  = slug($b['repo']  ?? '');
    $path  = safePath($b['path'] ?? '');
    if (!$owner || !$repo || !$path) respond(400, ['error' => 'Missing owner, repo, or path.']);

    // Get file metadata (includes download_url + sha for all file sizes)
    $info = ghGet("/repos/{$owner}/{$repo}/contents/{$path}");
    if ($info['status'] !== 200) respond(404, ['error' => "File not found: {$path}"]);

    $dlUrl = $info['body']['download_url'] ?? null;
    if (!$dlUrl) respond(400, ['error' => 'No download_url available for this file.']);

    // Download binary content via cURL (no size limit, handles auth)
    $ch = curl_init($dlUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_HTTPHEADER     => [
            'Authorization: token ' . GH_TOKEN,
            'User-Agent: MKX-GitHub-Cloud/2.0',
        ],
    ]);
    $content  = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($curlErr)          respond(500, ['error' => 'Download error: ' . $curlErr]);
    if ($httpCode !== 200) respond(500, ['error' => "Download failed (HTTP {$httpCode}). Check repo permissions."]);
    if (!$content)         respond(400, ['error' => 'Downloaded file is empty.']);

    // ── Auto-decode: handles normal ZIP and double-base64-encoded files ────────
    // Normal ZIP binary  → starts with PK (0x504B)
    // Double-encoded ZIP → base64 text "UEsD..." that decodes to PK binary
    //   (happens when file was uploaded via our Upload button which sends base64
    //    and old PHP did base64_encode() again on it)
    $zipBinary = $content;

    if (substr($zipBinary, 0, 2) !== 'PK') {
        // Attempt one base64-decode pass
        $try1 = base64_decode(preg_replace('/[\s]/', '', $zipBinary), false);
        if ($try1 !== false && substr($try1, 0, 2) === 'PK') {
            $zipBinary = $try1;
        } else {
            // Attempt two passes (triple-encoded edge case)
            $try2 = ($try1 !== false) ? base64_decode(preg_replace('/[\s]/', '', $try1), false) : false;
            if ($try2 !== false && substr($try2, 0, 2) === 'PK') {
                $zipBinary = $try2;
            } else {
                $hex = bin2hex(substr($zipBinary, 0, 6));
                respond(400, ['error' =>
                    "Not a valid ZIP. First bytes (hex): {$hex}. " .
                    "Expected 504b0304. File may be corrupted or not a ZIP archive."
                ]);
            }
        }
    }

    // Write validated binary to temp file
    $tmpKey  = 'z' . preg_replace('/[^a-zA-Z0-9]/', '', uniqid('', true));
    $tmpFile = FM_TMP . '/' . $tmpKey . '.zip';
    if (file_put_contents($tmpFile, $zipBinary) === false)
        respond(500, ['error' => 'Cannot write to temp dir: ' . FM_TMP . ' — check permissions.']);

    // Open and validate with ZipArchive
    $zip = new ZipArchive();
    $ok  = $zip->open($tmpFile);
    if ($ok !== true) {
        @unlink($tmpFile);
        respond(400, ['error' => "ZipArchive failed (code {$ok}). ZIP may be incomplete or corrupted."]);
    }
    $numFiles = $zip->numFiles;
    $zip->close();

    respond(200, [
        'success'   => true,
        'tmp_key'   => $tmpKey,
        'num_files' => $numFiles,
        'file_size' => strlen($zipBinary),
        'message'   => "ZIP ready ({$numFiles} entries). Click Extract.",
    ]);
    break;
}

default:
    respond(400, ['error' => "Unknown action: " . htmlspecialchars($action, ENT_QUOTES)]);
}
