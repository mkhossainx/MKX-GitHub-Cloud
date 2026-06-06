<?php
/**
 * MKX GitHub Cloud — Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * GitHub OAuth App Setup:
 *  1. Go to: https://github.com/settings/applications/new
 *  2. Application name:   MKX GitHub Cloud (or anything you like)
 *  3. Homepage URL:       https://yourdomain.com/
 *  4. Callback URL:       https://yourdomain.com/mkx-github-cloud/oauth.php
 *  5. Copy Client ID and Client Secret below
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── OAuth Credentials ─────────────────────────────────────────────────────────
define('GITHUB_CLIENT_ID',     'Ov23lirnpeHGfTsWvSLC');      // ← Replace this
define('GITHUB_CLIENT_SECRET', '9e6cf2785de47f30a3a5eb678fd717c3687f74ef');  // ← Replace this

// ── IMPORTANT: Callback URL ───────────────────────────────────────────────────
// This MUST exactly match the "Authorization callback URL" in your GitHub
// OAuth App settings. No trailing slash. Must be HTTPS in production.
// Example: 'https://hideme.eu.org/chu8/d/oauth.php'
define('OAUTH_CALLBACK_URL', 'https://hideme.eu.org/mkxcloud/oauth.php'); // ← Replace this

// ── OAuth Scopes ──────────────────────────────────────────────────────────────
// repo        = full repo access (read/write/delete private repos)
// delete_repo = allows deleting repos
// read:user   = read profile info
define('GITHUB_OAUTH_SCOPES', 'repo,delete_repo,read:user');

// ── App Settings ──────────────────────────────────────────────────────────────
define('APP_NAME',    'MKX GitHub Cloud');
define('APP_VERSION', '2.0');

// ── Session Timeout (seconds) ─────────────────────────────────────────────────
define('SESSION_TIMEOUT', 28800); // 8 hours
