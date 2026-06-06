<?php
/**
 * MKX GitHub Cloud — Dashboard
 * Main application shell
 */

session_start();
if (file_exists(__DIR__ . '/config.php')) require_once __DIR__ . '/config.php';

// Auth guard
if (empty($_SESSION['github_token'])) {
    header('Location: index.php');
    exit;
}

// Session timeout (8 hours)
if (isset($_SESSION['login_time']) && (time() - $_SESSION['login_time']) > 28800) {
    session_destroy();
    header('Location: index.php?error=session_expired');
    exit;
}

$user   = json_decode($_SESSION['github_data'] ?? '{}', true);
$csrf   = $_SESSION['csrf_token'] ?? '';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>MKX GitHub Cloud — <?= htmlspecialchars($user['login'] ?? 'Dashboard', ENT_QUOTES) ?></title>
  <meta name="theme-color" content="#0F172A">
  <link rel="manifest" href="manifest.json">

  <!-- Tailwind -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: {
        colors: { primary:'#2563EB', secondary:'#7C3AED', accent:'#06B6D4', dark:'#0F172A', 'dark-2':'#1E293B', 'dark-3':'#334155', success:'#10B981', danger:'#EF4444', warning:'#F59E0B' },
        fontFamily: { heading:['Rajdhani','sans-serif'], body:['Exo 2','sans-serif'], mono:['JetBrains Mono','monospace'] }
      }}
    }
  </script>

  <!-- Font Awesome -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <!-- App CSS -->
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<!-- Three.js Canvas -->
<canvas id="mkx-canvas"></canvas>

<!-- Loading Screen -->
<div id="loading-screen">
  <div class="loader-brand">MKX</div>
  <div class="loader-bar-wrap"><div class="loader-bar"></div></div>
  <div class="loader-text">LOADING DASHBOARD . . .</div>
</div>

<!-- App Shell -->
<div class="app-wrapper" id="app-shell" style="opacity:0">

  <!-- ─── Sidebar ────────────────────────────────────────────────── -->
  <aside class="sidebar" id="sidebar">

    <div class="sidebar-brand">
      <div class="sidebar-logo"><i class="fab fa-github" style="margin-right:8px;font-size:1.1rem"></i>MKX CLOUD</div>
      <div class="sidebar-tagline">CONTROL GITHUB LIKE NEVER BEFORE</div>
    </div>

    <div class="sidebar-user">
      <img class="sidebar-avatar" id="sb-avatar" src="<?= htmlspecialchars($user['avatar_url'] ?? '', ENT_QUOTES) ?>" alt="avatar" onerror="this.src='data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 40 40\'><rect fill=\'%231E293B\' width=\'40\' height=\'40\' rx=\'20\'/><text x=\'50%\' y=\'55%\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-size=\'16\' fill=\'%232563EB\'>M</text></svg>'">
      <div>
        <div class="sidebar-username"><?= htmlspecialchars($user['name'] ?? $user['login'] ?? '', ENT_QUOTES) ?></div>
        <div class="sidebar-role">
          @<?= htmlspecialchars($user['login'] ?? '', ENT_QUOTES) ?>
          <?php if (($_SESSION['login_method'] ?? '') === 'oauth'): ?>
            <span style="font-size:0.6rem;background:rgba(16,185,129,0.15);color:#10B981;padding:1px 5px;border-radius:3px;margin-left:4px;vertical-align:middle">OAuth</span>
          <?php endif; ?>
        </div>
      </div>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section-label">MAIN</div>
      <div class="nav-item active" data-view="dashboard" onclick="MKX.router.go('dashboard')">
        <span class="nav-icon"><i class="fas fa-chart-pie"></i></span>
        <span>Dashboard</span>
      </div>
      <div class="nav-item" data-view="repos" onclick="MKX.router.go('repos')">
        <span class="nav-icon"><i class="fas fa-code-branch"></i></span>
        <span>Repositories</span>
        <span class="nav-badge" id="repos-count-badge">—</span>
      </div>

      <div class="nav-section-label" style="margin-top:8px">WORKSPACE</div>
      <div class="nav-item" id="nav-files" style="display:none" data-view="files" onclick="MKX.router.go('files')">
        <span class="nav-icon"><i class="fas fa-folder-open"></i></span>
        <span>File Manager</span>
      </div>
      <div class="nav-item" id="nav-editor" style="display:none" data-view="editor" onclick="MKX.router.go('editor')">
        <span class="nav-icon"><i class="fas fa-code"></i></span>
        <span>Code Editor</span>
      </div>

      <div class="nav-section-label" style="margin-top:8px">DISCOVER</div>
      <div class="nav-item" data-view="search" onclick="MKX.router.go('search')">
        <span class="nav-icon"><i class="fas fa-search"></i></span>
        <span>Code Search</span>
        <span class="nav-badge" style="background:rgba(6,182,212,0.15);color:#06B6D4;font-size:0.6rem">NEW</span>
      </div>
      <div class="nav-item" data-view="analytics" onclick="MKX.router.go('analytics')">
        <span class="nav-icon"><i class="fas fa-chart-bar"></i></span>
        <span>Analytics</span>
        <span class="nav-badge" style="background:rgba(6,182,212,0.15);color:#06B6D4;font-size:0.6rem">NEW</span>
      </div>

      <div class="nav-section-label" style="margin-top:8px">TOOLS</div>
      <div class="nav-item" data-view="terminal" onclick="MKX.router.go('terminal')">
        <span class="nav-icon"><i class="fas fa-terminal"></i></span>
        <span>SSH Terminal</span>
        <span class="nav-badge" style="background:rgba(16,185,129,0.15);color:#10B981;font-size:0.6rem">SSH</span>
      </div>
      <div class="nav-item" onclick="MKX.cmd.open()">
        <span class="nav-icon"><i class="fas fa-terminal"></i></span>
        <span>Command Palette</span>
        <span class="nav-badge" style="background:rgba(148,163,184,0.15);color:#64748B">⌘K</span>
      </div>
      <div class="nav-item" onclick="window.open('https://github.com/<?= htmlspecialchars($user['login'] ?? '', ENT_QUOTES) ?>', '_blank')">
        <span class="nav-icon"><i class="fab fa-github"></i></span>
        <span>Open GitHub</span>
      </div>
    </nav>

    <div class="sidebar-footer">
      <div style="display:flex;gap:8px">
        <a href="logout.php" class="btn btn-ghost btn-sm" style="flex:1;justify-content:center;color:#EF4444;border-color:rgba(239,68,68,0.2)">
          <i class="fas fa-sign-out-alt"></i> Logout
        </a>
        <button class="btn btn-ghost btn-icon" onclick="MKX.ui.refreshAll()" title="Refresh data">
          <i class="fas fa-sync-alt" id="refresh-icon"></i>
        </button>
      </div>
      <div style="text-align:center;font-size:0.65rem;color:#334155;margin-top:10px;font-family:'JetBrains Mono',monospace">
        MKX GitHub Cloud v1.0
      </div>
    </div>

  </aside><!-- /sidebar -->

  <!-- Sidebar overlay (mobile) -->
  <div id="sidebar-overlay" onclick="MKX.ui.closeSidebar()"></div>

  <!-- ─── Main Content ───────────────────────────────────────────── -->
  <main class="main-content">

    <!-- Topbar -->
    <header class="topbar">
      <button id="sidebar-toggle" onclick="MKX.ui.toggleSidebar()">
        <i class="fas fa-bars"></i>
      </button>

      <div class="topbar-search">
        <i class="fas fa-search topbar-search-icon"></i>
        <input type="text" class="topbar-search-input" id="topbar-search" placeholder="Search repositories..." oninput="MKX.repos.search(this.value)">
      </div>

      <div style="flex:1"></div>

      <!-- Rate limit -->
      <div class="rate-pill" id="rate-pill" onclick="MKX.api.refreshRateLimit()" title="GitHub API Rate Limit — Click to refresh">
        <i class="fas fa-tachometer-alt"></i>
        <span id="rate-text">—/5000</span>
      </div>

      <!-- New repo button -->
      <button class="btn btn-primary btn-sm" onclick="MKX.modals.createRepo()" style="display:flex;align-items:center;gap:6px">
        <i class="fas fa-plus"></i>
        <span class="hidden sm:inline">New Repo</span>
      </button>

      <!-- User avatar -->
      <img style="width:34px;height:34px;border-radius:50%;border:2px solid rgba(37,99,235,0.4);cursor:pointer;object-fit:cover" src="<?= htmlspecialchars($user['avatar_url'] ?? '', ENT_QUOTES) ?>" alt="" onclick="MKX.router.go('dashboard')">
    </header>

    <!-- Page body -->
    <div class="page-body">

      <!-- ── View: Dashboard ───────────────────────────────────── -->
      <div class="view active" id="view-dashboard">

        <!-- Profile Card -->
        <div class="profile-card glass-card" id="profile-card">
          <img class="profile-avatar-lg" id="prof-avatar" src="<?= htmlspecialchars($user['avatar_url'] ?? '', ENT_QUOTES) ?>" alt="">
          <div class="profile-info">
            <div class="profile-name grad-text" id="prof-name"><?= htmlspecialchars($user['name'] ?? $user['login'] ?? '', ENT_QUOTES) ?></div>
            <div class="profile-login">@<span id="prof-login"><?= htmlspecialchars($user['login'] ?? '', ENT_QUOTES) ?></span></div>
            <div class="profile-bio" id="prof-bio"><?= htmlspecialchars($user['bio'] ?? 'No bio set.', ENT_QUOTES) ?></div>
            <div class="profile-stats">
              <div class="profile-stat"><div class="profile-stat-n" id="prof-followers"><?= (int)($user['followers'] ?? 0) ?></div><div class="profile-stat-l">Followers</div></div>
              <div class="profile-stat"><div class="profile-stat-n" id="prof-following"><?= (int)($user['following'] ?? 0) ?></div><div class="profile-stat-l">Following</div></div>
              <div class="profile-stat"><div class="profile-stat-n" id="prof-repos"><?= (int)($user['public_repos'] ?? 0) ?></div><div class="profile-stat-l">Repos</div></div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;align-self:flex-start">
            <a href="<?= htmlspecialchars($user['html_url'] ?? '#', ENT_QUOTES) ?>" target="_blank" class="btn btn-ghost btn-sm">
              <i class="fab fa-github"></i> View Profile
            </a>
            <button class="btn btn-accent btn-sm" onclick="MKX.router.go('repos')">
              <i class="fas fa-code-branch"></i> Repositories
            </button>
          </div>
        </div>

        <!-- Stats Grid -->
        <div class="stats-grid">
          <div class="glass-card stat-card blue">
            <div class="stat-icon blue"><i class="fas fa-code-branch"></i></div>
            <div class="stat-number grad-text" id="stat-repos">0</div>
            <div class="stat-label">Total Repositories</div>
          </div>
          <div class="glass-card stat-card purple">
            <div class="stat-icon purple"><i class="fas fa-lock"></i></div>
            <div class="stat-number" style="color:#7C3AED" id="stat-private">0</div>
            <div class="stat-label">Private Repos</div>
          </div>
          <div class="glass-card stat-card cyan">
            <div class="stat-icon cyan"><i class="fas fa-star"></i></div>
            <div class="stat-number" style="color:#06B6D4" id="stat-stars">0</div>
            <div class="stat-label">Total Stars</div>
          </div>
          <div class="glass-card stat-card green">
            <div class="stat-icon green"><i class="fas fa-tachometer-alt"></i></div>
            <div class="stat-number" style="color:#10B981" id="stat-api">—</div>
            <div class="stat-label">API Remaining</div>
          </div>
        </div>

        <!-- API Usage Bar -->
        <div class="glass-card" style="padding:20px;margin-bottom:24px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-family:'Rajdhani',sans-serif;font-weight:600;font-size:1rem;display:flex;align-items:center;gap:8px">
              <i class="fas fa-chart-bar" style="color:#06B6D4"></i> GitHub API Usage
            </div>
            <span style="font-size:0.75rem;color:#94A3B8;font-family:'JetBrains Mono',monospace" id="rate-detail">Loading...</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" id="rate-bar" style="width:0%;background:linear-gradient(90deg,#2563EB,#06B6D4)"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:0.7rem;color:#475569">
            <span>0</span><span>Reset: <span id="rate-reset">—</span></span><span>5000</span>
          </div>
        </div>

        <!-- Recent Repos -->
        <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
          <h2 style="font-family:'Rajdhani',sans-serif;font-size:1.2rem;font-weight:700;display:flex;align-items:center;gap:8px">
            <i class="fas fa-history" style="color:#2563EB"></i> Recent Repositories
          </h2>
          <button class="btn btn-ghost btn-sm" onclick="MKX.router.go('repos')">View All <i class="fas fa-arrow-right"></i></button>
        </div>
        <div class="repos-grid" id="recent-repos">
          <!-- Populated by JS -->
          <div class="glass-card" style="padding:20px"><div class="skeleton" style="height:18px;width:60%;margin-bottom:10px"></div><div class="skeleton" style="height:12px;width:40%"></div></div>
          <div class="glass-card" style="padding:20px"><div class="skeleton" style="height:18px;width:55%;margin-bottom:10px"></div><div class="skeleton" style="height:12px;width:35%"></div></div>
          <div class="glass-card" style="padding:20px"><div class="skeleton" style="height:18px;width:65%;margin-bottom:10px"></div><div class="skeleton" style="height:12px;width:45%"></div></div>
        </div>

      </div><!-- /view-dashboard -->

      <!-- ── View: Repositories ─────────────────────────────────── -->
      <div class="view" id="view-repos">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <h1 style="font-family:'Rajdhani',sans-serif;font-size:1.5rem;font-weight:700;display:flex;align-items:center;gap:10px">
            <i class="fas fa-code-branch grad-text"></i>
            <span>Repositories</span>
            <span style="font-size:0.85rem;font-weight:400;color:#64748B;font-family:'JetBrains Mono',monospace" id="repos-total-label"></span>
          </h1>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <select id="sort-repos" class="input-field" style="width:auto;padding:8px 12px" onchange="MKX.repos.sortRepos(this.value)">
              <option value="updated">Last Updated</option>
              <option value="created">Newest</option>
              <option value="full_name">Name A-Z</option>
              <option value="pushed">Last Push</option>
            </select>
            <select id="filter-visibility" class="input-field" style="width:auto;padding:8px 12px" onchange="MKX.repos.filterRepos(this.value)">
              <option value="all">All</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
            <button class="btn btn-primary btn-sm" onclick="MKX.modals.createRepo()">
              <i class="fas fa-plus"></i> New Repo
            </button>
          </div>
        </div>
        <div class="repos-grid" id="repos-grid">
          <!-- Populated by JS -->
        </div>
        <!-- Pagination -->
        <div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:24px" id="pagination-wrap">
          <button class="btn btn-ghost btn-sm" id="page-prev" onclick="MKX.repos.prevPage()" disabled>
            <i class="fas fa-chevron-left"></i> Prev
          </button>
          <span style="font-size:0.85rem;color:#64748B;font-family:'JetBrains Mono',monospace">
            Page <span id="page-current">1</span>
          </span>
          <button class="btn btn-ghost btn-sm" id="page-next" onclick="MKX.repos.nextPage()">
            Next <i class="fas fa-chevron-right"></i>
          </button>
        </div>
      </div><!-- /view-repos -->

      <!-- ── View: File Manager ──────────────────────────────────── -->
      <div class="view" id="view-files">

        <!-- FM Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div>
            <h1 style="font-family:'Rajdhani',sans-serif;font-size:1.3rem;font-weight:700;display:flex;align-items:center;gap:8px">
              <i class="fas fa-folder-open" style="color:#F59E0B"></i>
              <span id="fm-repo-name">File Manager</span>
            </h1>
            <div style="font-size:0.75rem;color:#64748B;font-family:'JetBrains Mono',monospace;margin-top:2px">
              <span id="fm-branch-label">Loading...</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <button class="btn btn-ghost btn-sm" onclick="MKX.router.go('repos')"><i class="fas fa-arrow-left"></i> Back</button>
            <button class="btn btn-ghost btn-sm" onclick="MKX.files.createNewFile()"><i class="fas fa-file-plus"></i> New File</button>
            <button class="btn btn-ghost btn-sm" onclick="MKX.files.createNewFolder()"><i class="fas fa-folder-plus"></i> New Folder</button>
            <button class="btn btn-primary btn-sm" onclick="MKX.files.triggerUpload()"><i class="fas fa-upload"></i> Upload</button>
            <button class="btn btn-secondary btn-sm" id="zip-upload-btn"><i class="fas fa-file-archive"></i> Upload ZIP</button>
            <button class="btn btn-ghost btn-sm" id="theme-toggle-btn" title="Toggle Dark/Light Mode"><i class="fas fa-moon" id="theme-toggle-icon"></i></button>
          </div>
        </div>

        <!-- Breadcrumb -->
        <div class="breadcrumb" id="fm-breadcrumb">
          <span class="breadcrumb-item current"><i class="fas fa-home" style="margin-right:4px"></i> root</span>
        </div>

        <!-- Clipboard Bar -->
        <div id="fm-clip-bar" style="display:none;align-items:center;gap:10px;padding:10px 14px;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.2);border-radius:10px;margin-bottom:10px;flex-wrap:wrap">
          <i class="fas fa-clipboard" style="color:#2563EB"></i>
          <span id="fm-clip-text" style="flex:1;font-size:0.82rem;color:#93C5FD;font-family:'JetBrains Mono',monospace"></span>
          <button class="btn btn-accent btn-sm" id="fm-paste-btn"><i class="fas fa-paste"></i> Paste Here</button>
          <button class="btn btn-ghost btn-sm" id="fm-clip-clear-btn"><i class="fas fa-times"></i> Clear</button>
        </div>

        <!-- ZIP Upload Zone -->
        <div class="fm-zip-zone glass-card" id="zip-drop-zone">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="font-size:2rem;color:#7C3AED;opacity:0.8"><i class="fas fa-file-archive"></i></div>
            <div style="flex:1">
              <div style="font-weight:600;font-size:0.9rem;margin-bottom:2px">ZIP Upload &amp; Extract</div>
              <div style="font-size:0.75rem;color:#64748B">Drop ZIP here or click Upload ZIP &mdash; then one-click extract to this folder</div>
            </div>
            <button class="btn btn-success btn-sm" id="zip-after-upload-extract" style="display:none">
              <i class="fas fa-file-export"></i> Extract
            </button>
          </div>
          <div id="zip-progress-wrap" style="display:none;margin-top:12px">
            <div style="height:6px;background:rgba(148,163,184,0.1);border-radius:99px;overflow:hidden;margin-bottom:6px">
              <div id="zip-progress-fill" style="height:100%;width:0%;border-radius:99px;transition:width 0.3s ease"></div>
            </div>
            <div id="zip-progress-text" style="font-size:0.75rem;color:#94A3B8;font-family:'JetBrains Mono',monospace"></div>
          </div>
        </div>
        <input type="file" id="zip-upload-input" accept=".zip" style="display:none">
        <input type="file" id="file-upload-input" multiple accept=".html,.css,.js,.php,.txt,.json,.png,.jpg,.jpeg,.gif,.svg,.py,.md,.xml,.yaml,.yml" style="display:none" onchange="MKX.files.handleUpload(this.files)">

        <!-- Bulk Action Bar -->
        <div id="fm-bulk-bar" style="display:none;align-items:center;gap:6px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:10px;margin-bottom:10px;flex-wrap:wrap">
          <span id="fm-sel-count" style="font-size:0.8rem;font-weight:600;color:#A78BFA;font-family:'JetBrains Mono',monospace;margin-right:4px"></span>
          <button class="btn btn-ghost btn-sm" id="fm-bulk-copy"><i class="fas fa-copy"></i> Copy</button>
          <button class="btn btn-ghost btn-sm" id="fm-bulk-cut"><i class="fas fa-cut"></i> Cut</button>
          <button class="btn btn-ghost btn-sm" id="fm-bulk-move"><i class="fas fa-arrows-alt"></i> Move</button>
          <button class="btn btn-ghost btn-sm" id="fm-bulk-copy-to"><i class="fas fa-copy"></i> Copy To</button>
          <button class="btn btn-accent btn-sm" id="fm-bulk-compress"><i class="fas fa-file-archive"></i> Compress</button>
          <button class="btn btn-danger btn-sm" id="fm-bulk-delete"><i class="fas fa-trash"></i> Delete</button>
          <button class="btn btn-ghost btn-sm" id="fm-bulk-deselect" style="margin-left:auto"><i class="fas fa-times"></i></button>
        </div>

        <!-- File List Card -->
        <div class="glass-card" style="padding:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
            <div id="fm-list-header" style="display:none;align-items:center;gap:8px">
              <input type="checkbox" id="fm-sel-all" title="Select all" style="width:16px;height:16px;accent-color:#2563EB;cursor:pointer">
              <span style="font-size:0.72rem;color:#64748B">All</span>
            </div>
            <input type="text" class="input-field" id="file-filter" placeholder="Filter files..." style="flex:1;min-width:150px;padding:7px 12px;font-size:0.82rem" oninput="MKX.files.filterFiles(this.value)">
            <div style="font-size:0.75rem;color:#64748B;font-family:'JetBrains Mono',monospace;white-space:nowrap" id="fm-file-count">0 items</div>
          </div>
          <div class="file-list" id="file-list">
            <div style="text-align:center;padding:40px;color:#475569">
              <i class="fas fa-spinner animate-spin" style="font-size:1.5rem;margin-bottom:10px;display:block"></i>Loading files...
            </div>
          </div>
        </div>

      </div><!-- /view-files -->

      <!-- ── View: Code Editor ───────────────────────────────────── -->
      <div class="view" id="view-editor">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <h1 style="font-family:'Rajdhani',sans-serif;font-size:1.3rem;font-weight:700;display:flex;align-items:center;gap:8px">
            <i class="fas fa-code" style="color:#2563EB"></i>
            <span id="editor-title">Code Editor</span>
          </h1>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="MKX.router.go('files')">
              <i class="fas fa-arrow-left"></i> Back to Files
            </button>
            <button class="btn btn-success btn-sm" id="save-btn" onclick="MKX.editor.save()">
              <i class="fas fa-save"></i> Save File
            </button>
            <button class="btn btn-ghost btn-sm" id="beautify-btn" title="Auto-format / Beautify code">
              <i class="fas fa-magic"></i> Format
            </button>
            <button class="btn btn-ghost btn-sm" onclick="MKX.editor.toggleFullscreen()">
              <i class="fas fa-expand"></i>
            </button>
          </div>
        </div>

        <!-- Editor tabs -->
        <div class="editor-wrap glass-card" id="editor-wrap">
          <div class="editor-tabs" id="editor-tabs"></div>
          <div class="editor-toolbar">
            <span class="editor-filename" id="editor-file-path"></span>
            <div style="display:flex;gap:6px;align-items:center">
              <span id="editor-lang-badge" style="font-size:0.72rem;padding:2px 8px;background:rgba(37,99,235,0.15);border-radius:4px;color:#93C5FD;font-family:'JetBrains Mono',monospace"></span>
              <span id="editor-status" style="font-size:0.72rem;color:#64748B;font-family:'JetBrains Mono',monospace">Ready</span>
              <button id="preview-toggle-btn" class="btn btn-ghost btn-sm" style="display:none;font-size:0.72rem;padding:3px 10px" title="Live HTML Preview">
                <i class="fas fa-eye"></i> Preview
              </button>
            </div>
          </div>
          <div style="display:flex;height:calc(100vh - 280px);min-height:400px">
            <div id="monaco-container" style="flex:1;min-width:0"></div>
            <div id="preview-pane" style="display:none;flex:1;border-left:1px solid rgba(148,163,184,0.1);background:#fff;position:relative">
              <div style="position:absolute;top:8px;right:10px;z-index:10;display:flex;gap:6px">
                <span style="font-size:0.65rem;background:rgba(16,185,129,0.15);color:#10B981;padding:2px 8px;border-radius:4px;font-family:'JetBrains Mono',monospace">LIVE PREVIEW</span>
                <button id="preview-close-btn" style="background:rgba(239,68,68,0.15);border:none;color:#EF4444;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.7rem">✕</button>
              </div>
              <iframe id="preview-iframe" style="width:100%;height:100%;border:none" sandbox="allow-scripts allow-same-origin"></iframe>
            </div>
          </div>
        </div>
      </div><!-- /view-editor -->


      <!-- ── View: Code Search ──────────────────────────────────── -->
      <div class="view" id="view-search">
        <div style="margin-bottom:20px">
          <h1 style="font-family:'Rajdhani',sans-serif;font-size:1.5rem;font-weight:700;display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <i class="fas fa-search" style="color:#06B6D4"></i> Multi-Repo Code Search
          </h1>
          <p style="color:#64748B;font-size:0.82rem">Search code across ALL your repositories at once — GitHub ki ye feature dhundhne mein bahut time lagta hai</p>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
          <div style="flex:1;position:relative;min-width:220px">
            <i class="fas fa-search" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#475569;font-size:0.85rem"></i>
            <input type="text" class="input-field" id="code-search-input" placeholder="Search code: e.g. api_key, function, class..." style="padding-left:38px;font-family:'JetBrains Mono',monospace">
          </div>
          <button class="btn btn-accent" id="code-search-btn"><i class="fas fa-search"></i> Search Code</button>
        </div>
        <div id="code-search-results">
          <div style="text-align:center;padding:60px;color:#334155">
            <i class="fas fa-code" style="font-size:3rem;opacity:0.2;margin-bottom:12px;display:block"></i>
            <div style="font-size:1rem;margin-bottom:6px;color:#475569">Search your codebase</div>
            <div style="font-size:0.8rem;color:#334155">Results will show file name, repo, and matching code snippet</div>
          </div>
        </div>
      </div><!-- /view-search -->

      <!-- ── View: Analytics ────────────────────────────────────── -->
      <div class="view" id="view-analytics">
        <div style="margin-bottom:20px">
          <h1 style="font-family:'Rajdhani',sans-serif;font-size:1.5rem;font-weight:700;display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <i class="fas fa-chart-bar" style="color:#7C3AED"></i> Repository Analytics
          </h1>
          <p style="color:#64748B;font-size:0.82rem">Visual breakdown of your GitHub profile — kuch aisa jo GitHub khud nahi dikhata</p>
        </div>

        <!-- Analytics Stats Row -->
        <div class="stats-grid" id="analytics-stats" style="margin-bottom:24px">
          <div class="glass-card stat-card blue">
            <div class="stat-icon blue"><i class="fas fa-globe"></i></div>
            <div class="stat-number grad-text" id="an-public">0</div>
            <div class="stat-label">Public Repos</div>
          </div>
          <div class="glass-card stat-card purple">
            <div class="stat-icon purple"><i class="fas fa-lock"></i></div>
            <div class="stat-number" style="color:#7C3AED" id="an-private">0</div>
            <div class="stat-label">Private Repos</div>
          </div>
          <div class="glass-card stat-card cyan">
            <div class="stat-icon cyan"><i class="fas fa-star"></i></div>
            <div class="stat-number" style="color:#06B6D4" id="an-stars">0</div>
            <div class="stat-label">Total Stars</div>
          </div>
          <div class="glass-card stat-card green">
            <div class="stat-icon green"><i class="fas fa-code-branch"></i></div>
            <div class="stat-number" style="color:#10B981" id="an-forks">0</div>
            <div class="stat-label">Total Forks</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px" id="analytics-grid">

          <!-- Language Chart -->
          <div class="glass-card" style="padding:20px">
            <h3 style="font-family:'Rajdhani',sans-serif;font-size:1.05rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px">
              <i class="fas fa-code" style="color:#06B6D4"></i> Language Breakdown
            </h3>
            <div id="lang-chart" style="display:flex;flex-direction:column;gap:8px">
              <div class="skeleton" style="height:16px;border-radius:6px"></div>
              <div class="skeleton" style="height:16px;border-radius:6px;width:80%"></div>
              <div class="skeleton" style="height:16px;border-radius:6px;width:60%"></div>
            </div>
          </div>

          <!-- Stars Leaderboard -->
          <div class="glass-card" style="padding:20px">
            <h3 style="font-family:'Rajdhani',sans-serif;font-size:1.05rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px">
              <i class="fas fa-trophy" style="color:#F59E0B"></i> Stars Leaderboard
            </h3>
            <div id="stars-leaderboard" style="display:flex;flex-direction:column;gap:8px">
              <div class="skeleton" style="height:36px;border-radius:8px"></div>
              <div class="skeleton" style="height:36px;border-radius:8px"></div>
              <div class="skeleton" style="height:36px;border-radius:8px"></div>
            </div>
          </div>

          <!-- Repo Size Distribution -->
          <div class="glass-card" style="padding:20px">
            <h3 style="font-family:'Rajdhani',sans-serif;font-size:1.05rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px">
              <i class="fas fa-layer-group" style="color:#7C3AED"></i> Public vs Private
            </h3>
            <div id="visibility-chart" style="display:flex;align-items:center;justify-content:center;min-height:120px">
              <div class="skeleton" style="width:120px;height:120px;border-radius:50%"></div>
            </div>
          </div>

          <!-- Most Recently Active -->
          <div class="glass-card" style="padding:20px">
            <h3 style="font-family:'Rajdhani',sans-serif;font-size:1.05rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px">
              <i class="fas fa-bolt" style="color:#10B981"></i> Recently Active
            </h3>
            <div id="recent-activity" style="display:flex;flex-direction:column;gap:8px">
              <div class="skeleton" style="height:30px;border-radius:6px"></div>
              <div class="skeleton" style="height:30px;border-radius:6px"></div>
              <div class="skeleton" style="height:30px;border-radius:6px"></div>
            </div>
          </div>
        </div>

        <!-- Pinned Repos Section -->
        <div class="glass-card" style="padding:20px">
          <h3 style="font-family:'Rajdhani',sans-serif;font-size:1.05rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px">
            <i class="fas fa-thumbtack" style="color:#F59E0B"></i> Pinned Repositories
            <span style="font-size:0.72rem;color:#64748B;font-weight:400;margin-left:4px">Pin from repo card</span>
          </h3>
          <div id="pinned-repos-list" style="display:flex;flex-wrap:wrap;gap:10px">
            <div style="color:#475569;font-size:0.85rem;padding:8px">No pinned repos yet. Click 📌 on any repo card to pin it.</div>
          </div>
        </div>
      </div><!-- /view-analytics -->


      <!-- ── View: SSH Terminal ─────────────────────────────────── -->
      <div class="view" id="view-terminal">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <div>
            <h1 style="font-family:'Rajdhani',sans-serif;font-size:1.5rem;font-weight:700;display:flex;align-items:center;gap:10px">
              <i class="fas fa-terminal" style="color:#10B981"></i> SSH Terminal
            </h1>
            <p style="color:#64748B;font-size:0.78rem;margin-top:2px">Connect to any server — run real Linux commands from your browser</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div id="ssh-status-pill" style="display:flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.15);border-radius:20px;font-size:0.75rem;color:#64748B;font-family:'JetBrains Mono',monospace">
              <span style="width:7px;height:7px;border-radius:50%;background:#475569;display:inline-block" id="ssh-dot"></span>
              <span id="ssh-status-text">Disconnected</span>
            </div>
            <button class="btn btn-danger btn-sm hidden" id="ssh-disconnect-btn"><i class="fas fa-power-off"></i> Disconnect</button>
          </div>
        </div>

        <!-- Connection Panel -->
        <div class="glass-card" id="ssh-connect-panel" style="padding:20px;margin-bottom:16px">
          <div style="font-family:'Rajdhani',sans-serif;font-size:1rem;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:8px;color:#10B981">
            <i class="fas fa-plug"></i> New Connection
          </div>
          <div style="display:grid;grid-template-columns:2fr 0.6fr 1fr 1fr;gap:10px;align-items:end;flex-wrap:wrap" id="ssh-form-grid">
            <div>
              <label style="font-size:0.72rem;color:#64748B;font-weight:600;letter-spacing:1px;display:block;margin-bottom:6px">HOSTNAME / IP</label>
              <input type="text" class="input-field" id="ssh-host" placeholder="192.168.1.1 or example.com" autocomplete="off" spellcheck="false">
            </div>
            <div>
              <label style="font-size:0.72rem;color:#64748B;font-weight:600;letter-spacing:1px;display:block;margin-bottom:6px">PORT</label>
              <input type="number" class="input-field" id="ssh-port" value="22" min="1" max="65535">
            </div>
            <div>
              <label style="font-size:0.72rem;color:#64748B;font-weight:600;letter-spacing:1px;display:block;margin-bottom:6px">USERNAME</label>
              <input type="text" class="input-field" id="ssh-user" placeholder="root" autocomplete="off" spellcheck="false">
            </div>
            <div style="position:relative">
              <label style="font-size:0.72rem;color:#64748B;font-weight:600;letter-spacing:1px;display:block;margin-bottom:6px">PASSWORD</label>
              <input type="password" class="input-field" id="ssh-pass" placeholder="••••••••" style="padding-right:40px">
              <span style="position:absolute;right:12px;bottom:11px;cursor:pointer;color:#64748B;font-size:0.8rem" id="ssh-pass-toggle"><i class="fas fa-eye"></i></span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap">
            <button class="btn btn-success" id="ssh-connect-btn" style="min-width:140px">
              <i class="fas fa-plug"></i> Connect
            </button>
            <div id="ssh-ext-warning" style="display:none;font-size:0.78rem;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);border-radius:8px;padding:8px 14px;color:#FCD34D;display:flex;align-items:center;gap:8px">
              <i class="fas fa-exclamation-triangle"></i>
              <span>PHP <code style="background:rgba(245,158,11,0.15);padding:1px 6px;border-radius:3px">ssh2</code> extension not found on this server. Ask your host to install <strong>php-ssh2</strong>.</span>
            </div>
          </div>
        </div>

        <!-- Terminal Window -->
        <div class="glass-card" style="padding:0;overflow:hidden;border-radius:16px">
          <!-- Terminal titlebar -->
          <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(13,17,23,0.9);border-bottom:1px solid rgba(255,255,255,0.06)">
            <div style="display:flex;gap:6px">
              <div style="width:12px;height:12px;border-radius:50%;background:#EF4444;cursor:pointer" id="term-close-dot" title="Disconnect"></div>
              <div style="width:12px;height:12px;border-radius:50%;background:#F59E0B"></div>
              <div style="width:12px;height:12px;border-radius:50%;background:#10B981;cursor:pointer" id="term-fullscreen-dot" title="Fullscreen"></div>
            </div>
            <span style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:#475569;flex:1;text-align:center" id="term-title">ssh — not connected</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" id="term-clear-btn" style="padding:3px 8px;font-size:0.7rem"><i class="fas fa-eraser"></i> Clear</button>
              <button class="btn btn-ghost btn-sm" id="term-fullscreen-btn" style="padding:3px 8px;font-size:0.7rem"><i class="fas fa-expand"></i></button>
            </div>
          </div>
          <!-- xterm container -->
          <div id="terminal-container" style="background:#0D1117;padding:8px;min-height:380px;height:420px"></div>
        </div>

        <!-- Quick Commands -->
        <div class="glass-card" style="padding:16px;margin-top:14px">
          <div style="font-size:0.78rem;font-weight:600;color:#64748B;letter-spacing:1px;margin-bottom:10px">⚡ QUICK COMMANDS</div>
          <div style="display:flex;flex-wrap:wrap;gap:7px" id="quick-cmds">
            <!-- Populated by JS -->
          </div>
        </div>

      </div><!-- /view-terminal -->

    </div><!-- /page-body -->
  </main><!-- /main-content -->

</div><!-- /app-shell -->

<!-- ─── Bottom Navigation (Mobile) ──────────────────────────────── -->
<nav class="bottom-nav">
  <div class="bottom-nav-items">
    <div class="bnav-item active" id="bnav-dashboard" onclick="MKX.router.go('dashboard')">
      <i class="fas fa-chart-pie"></i><span>Dashboard</span>
    </div>
    <div class="bnav-item" id="bnav-repos" onclick="MKX.router.go('repos')">
      <i class="fas fa-code-branch"></i><span>Repos</span>
    </div>
    <div class="bnav-item" id="bnav-files" onclick="MKX.router.go('files')" style="display:none">
      <i class="fas fa-folder-open"></i><span>Files</span>
    </div>
    <div class="bnav-item" id="bnav-search" onclick="MKX.router.go('search')">
      <i class="fas fa-search"></i><span>Search</span>
    </div>
    <div class="bnav-item" id="bnav-analytics" onclick="MKX.router.go('analytics')">
      <i class="fas fa-chart-bar"></i><span>Analytics</span>
    </div>
    <div class="bnav-item" id="bnav-terminal" onclick="MKX.router.go('terminal')">
      <i class="fas fa-terminal"></i><span>Terminal</span>
    </div>
    <div class="bnav-item" onclick="MKX.modals.createRepo()">
      <i class="fas fa-plus-circle"></i><span>Create</span>
    </div>
  </div>
</nav>

<!-- FAB -->
<button id="fab" onclick="MKX.modals.createRepo()" title="Create new repository">
  <i class="fas fa-plus"></i>
</button>

<!-- ─── Toast Container ──────────────────────────────────────────── -->
<div id="toast-container"></div>

<!-- ─── Command Palette ──────────────────────────────────────────── -->
<div id="cmd-palette" class="hidden">
  <div class="cmd-box">
    <div class="cmd-input-wrap">
      <span class="cmd-prompt">⌘</span>
      <input type="text" class="cmd-input" id="cmd-input" placeholder="Type a command..." oninput="MKX.cmd.filter(this.value)" onkeydown="MKX.cmd.keydown(event)">
    </div>
    <div class="cmd-results" id="cmd-results"></div>
  </div>
</div>

<!-- ─── Context Menu ─────────────────────────────────────────────── -->
<div class="ctx-menu hidden" id="ctx-menu">
  <div class="ctx-item" id="ctx-open"><i class="fas fa-external-link-alt"></i> Open</div>
  <div class="ctx-item" id="ctx-edit"><i class="fas fa-edit"></i> Edit File</div>
  <div class="ctx-item" id="ctx-extract"><i class="fas fa-file-export"></i> Extract ZIP</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" id="ctx-copy"><i class="fas fa-copy"></i> Copy</div>
  <div class="ctx-item" id="ctx-cut"><i class="fas fa-cut"></i> Cut</div>
  <div class="ctx-item" id="ctx-paste"><i class="fas fa-paste"></i> Paste Here</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" id="ctx-move"><i class="fas fa-arrows-alt"></i> Move To...</div>
  <div class="ctx-item" id="ctx-compress"><i class="fas fa-file-archive"></i> Add to ZIP</div>
  <div class="ctx-item" id="ctx-rename"><i class="fas fa-i-cursor"></i> Rename</div>
  <div class="ctx-item" id="ctx-copy-url"><i class="fas fa-link"></i> Copy URL</div>
  <div class="ctx-item" id="ctx-download"><i class="fas fa-download"></i> Download</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item danger" id="ctx-delete"><i class="fas fa-trash"></i> Delete</div>
</div>

<!-- ─── Modals ───────────────────────────────────────────────────── -->

<!-- Create Repo Modal -->
<div class="modal-backdrop hidden" id="modal-create-repo">
  <div class="modal">
    <div class="modal-title grad-text"><i class="fas fa-code-branch"></i> Create Repository</div>
    <div class="input-group">
      <label>Repository Name *</label>
      <input type="text" class="input-field" id="new-repo-name" placeholder="my-awesome-project">
    </div>
    <div class="input-group">
      <label>Description</label>
      <input type="text" class="input-field" id="new-repo-desc" placeholder="Optional description...">
    </div>
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1">
        <input type="radio" name="repo-visibility" value="public" checked> <span style="font-size:0.875rem">Public</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1">
        <input type="radio" name="repo-visibility" value="private"> <span style="font-size:0.875rem">Private</span>
      </label>
    </div>
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="new-repo-init"> <span style="font-size:0.875rem">Initialize with README</span>
      </label>
    </div>
    <div class="input-group">
      <label>Add .gitignore</label>
      <select class="input-field" id="new-repo-gitignore" style="padding:10px 12px">
        <option value="">None</option>
        <option value="Node">Node.js</option>
        <option value="Python">Python</option>
        <option value="PHP">PHP</option>
        <option value="Java">Java</option>
        <option value="Go">Go</option>
        <option value="Rust">Rust</option>
        <option value="VisualStudio">Visual Studio</option>
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-create-repo')">Cancel</button>
      <button class="btn btn-primary" id="create-repo-btn">
        <i class="fas fa-plus"></i> Create Repository
      </button>
    </div>
  </div>
</div>

<!-- Rename Modal -->
<div class="modal-backdrop hidden" id="modal-rename">
  <div class="modal">
    <div class="modal-title" style="color:#06B6D4"><i class="fas fa-i-cursor"></i> Rename</div>
    <div class="input-group">
      <label>New Name</label>
      <input type="text" class="input-field" id="rename-input" placeholder="new-name">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-rename')">Cancel</button>
      <button class="btn btn-accent" onclick="MKX.currentAction.rename()"><i class="fas fa-check"></i> Rename</button>
    </div>
  </div>
</div>

<!-- Delete Confirm Modal -->
<div class="modal-backdrop hidden" id="modal-delete">
  <div class="modal">
    <div class="modal-title" style="color:#EF4444"><i class="fas fa-exclamation-triangle"></i> Confirm Delete</div>
    <p style="color:#94A3B8;font-size:0.9rem;margin-bottom:8px">Are you sure you want to delete:</p>
    <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:12px;font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:#FCA5A5;word-break:break-all" id="delete-target-name">—</div>
    <p style="color:#64748B;font-size:0.8rem;margin-top:8px;margin-bottom:0">This action cannot be undone.</p>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-delete')">Cancel</button>
      <button class="btn btn-danger" id="confirm-delete-btn" onclick="MKX.currentAction.confirmDelete()">
        <i class="fas fa-trash"></i> Delete
      </button>
    </div>
  </div>
</div>

<!-- New File Modal -->
<div class="modal-backdrop hidden" id="modal-new-file">
  <div class="modal" style="max-width:520px">
    <div class="modal-title" style="color:#10B981"><i class="fas fa-file-plus"></i> Create New File</div>
    <div class="input-group">
      <label>File Name (including path)</label>
      <input type="text" class="input-field text-mono" id="new-file-name" placeholder="src/index.js">
    </div>
    <div class="input-group">
      <label><i class="fas fa-magic" style="color:#7C3AED;margin-right:5px"></i> Quick Template <span style="color:#475569;font-weight:400;font-size:0.75rem">(optional)</span></label>
      <select class="input-field" id="file-template-select" style="padding:9px 12px">
        <option value="">— Blank file —</option>
        <optgroup label="Web">
          <option value="html5">HTML5 Boilerplate</option>
          <option value="tailwind">HTML + Tailwind CSS</option>
          <option value="cssreset">CSS Reset + Variables</option>
        </optgroup>
        <optgroup label="JavaScript">
          <option value="jsmodule">JS Module (ESM)</option>
          <option value="jsfetch">JS Fetch API Template</option>
          <option value="react">React Component</option>
        </optgroup>
        <optgroup label="PHP">
          <option value="phpclass">PHP Class Template</option>
          <option value="phpapi">PHP REST Endpoint</option>
          <option value="phpconfig">PHP Config File</option>
        </optgroup>
        <optgroup label="Other">
          <option value="python">Python Script</option>
          <option value="readme">README.md Template</option>
          <option value="gitignore">.gitignore (Node+PHP)</option>
          <option value="envexample">.env.example</option>
        </optgroup>
      </select>
    </div>
    <div class="input-group">
      <label>Content</label>
      <textarea class="input-field text-mono" id="new-file-content" rows="7" placeholder="// Write your code here..." style="resize:vertical;min-height:100px;font-size:0.8rem"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-new-file')">Cancel</button>
      <button class="btn btn-success" id="create-file-btn">
        <i class="fas fa-check"></i> Create File
      </button>
    </div>
  </div>
</div>

<!-- New Folder Modal -->
<div class="modal-backdrop hidden" id="modal-new-folder">
  <div class="modal">
    <div class="modal-title" style="color:#F59E0B"><i class="fas fa-folder-plus"></i> Create Folder</div>
    <p style="color:#94A3B8;font-size:0.8rem;margin-bottom:16px">GitHub stores folders via files. A <code style="color:#06B6D4;background:rgba(6,182,212,0.1);padding:2px 5px;border-radius:4px">.gitkeep</code> file will be created inside the folder.</p>
    <div class="input-group">
      <label>Folder Name</label>
      <input type="text" class="input-field text-mono" id="new-folder-name" placeholder="my-folder">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-new-folder')">Cancel</button>
      <button class="btn btn-accent" onclick="MKX.files.confirmCreateFolder()">
        <i class="fas fa-check"></i> Create Folder
      </button>
    </div>
  </div>
</div>


<!-- ─── Extract ZIP Modal ───────────────────────────────────────────────── -->
<div class="modal-backdrop hidden" id="modal-extract">
  <div class="modal" style="max-width:480px">
    <div class="modal-title" style="color:#10B981"><i class="fas fa-file-export"></i> Extract ZIP</div>
    <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:0.82rem">
      <i class="fas fa-file-archive" style="color:#F59E0B;margin-right:6px"></i>
      <span id="extract-zip-name" style="font-family:'JetBrains Mono',monospace;color:#E2E8F0">archive.zip</span>
    </div>
    <div class="input-group">
      <label>Extract to path <span style="color:#475569;font-weight:400">(leave blank for current folder)</span></label>
      <input type="text" class="input-field text-mono" id="extract-dest-path" placeholder="e.g. src/new-folder">
      <div style="font-size:0.72rem;color:#64748B;margin-top:4px;font-family:'JetBrains Mono',monospace" id="extract-dest-preview">→ Repository root</div>
    </div>
    <div style="font-size:0.75rem;color:#475569;background:rgba(245,158,11,0.08);border-radius:6px;padding:8px 12px;margin-top:4px">
      <i class="fas fa-shield-alt" style="color:#F59E0B;margin-right:5px"></i>
      ZIP Slip protected · Dangerous extensions blocked · Folder structure preserved
    </div>
    <!-- Extract progress -->
    <div id="extract-progress-wrap" style="display:none;margin-top:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span id="extract-progress-text" style="font-size:0.78rem;color:#94A3B8">Extracting...</span>
      </div>
      <div class="progress-bar-wrap"><div id="extract-progress-bar" class="progress-bar-fill" style="width:0%;background:linear-gradient(90deg,#10B981,#059669);transition:width 0.5s ease"></div></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="modal-extract-cancel">Cancel</button>
      <button class="btn btn-success" id="modal-extract-confirm"><i class="fas fa-file-export"></i> Extract Now</button>
    </div>
  </div>
</div>

<!-- ─── Compress Modal ──────────────────────────────────────────────────── -->
<div class="modal-backdrop hidden" id="modal-compress">
  <div class="modal" style="max-width:420px">
    <div class="modal-title" style="color:#F59E0B"><i class="fas fa-file-archive"></i> Compress to ZIP</div>
    <div style="font-size:0.82rem;color:#94A3B8;margin-bottom:14px" id="compress-item-count">0 items selected</div>
    <div class="input-group">
      <label>ZIP filename</label>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="text" class="input-field text-mono" id="compress-zip-name" placeholder="archive" style="flex:1">
        <span style="font-size:0.82rem;color:#475569;white-space:nowrap">.zip</span>
      </div>
    </div>
    <div style="font-size:0.75rem;color:#64748B;background:rgba(37,99,235,0.06);border-radius:6px;padding:8px 12px">
      <i class="fas fa-info-circle" style="color:#2563EB;margin-right:5px"></i>
      Files will be fetched from GitHub and compressed server-side. Large repos may take a moment.
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-compress')">Cancel</button>
      <button class="btn btn-accent" id="modal-compress-confirm"><i class="fas fa-download"></i> Compress & Download</button>
    </div>
  </div>
</div>

<!-- ─── Move / Copy To Modal ────────────────────────────────────────────── -->
<div class="modal-backdrop hidden" id="modal-move">
  <div class="modal" style="max-width:440px">
    <div class="modal-title" style="color:#06B6D4" id="move-modal-title"><i class="fas fa-arrows-alt"></i> Move To</div>
    <div style="font-size:0.82rem;color:#94A3B8;margin-bottom:14px" id="move-item-count">0 items</div>
    <div class="input-group">
      <label>Destination path in repository</label>
      <input type="text" class="input-field text-mono" id="move-dest-path" placeholder="e.g. src/components (blank = root)">
      <div style="font-size:0.72rem;color:#64748B;margin-top:4px;font-family:'JetBrains Mono',monospace" id="move-dest-preview">→ Repository root</div>
    </div>
    <div style="font-size:0.75rem;color:#475569;background:rgba(239,68,68,0.06);border-radius:6px;padding:8px 12px">
      <i class="fas fa-exclamation-triangle" style="color:#EF4444;margin-right:5px"></i>
      Each file requires individual GitHub API calls. Large folders take time.
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-move')">Cancel</button>
      <button class="btn btn-primary" id="modal-move-confirm"><i class="fas fa-arrows-alt"></i> Move</button>
    </div>
  </div>
</div>

<!-- Repo Detail / Actions Modal -->
<div class="modal-backdrop hidden" id="modal-repo-detail">
  <div class="modal" style="max-width:520px">
    <div class="modal-title" id="rdetail-name" style="color:#06B6D4;word-break:break-all"><i class="fas fa-code-branch"></i> Repository</div>
    <div id="rdetail-body" style="display:flex;flex-direction:column;gap:10px">
      <!-- Populated by JS -->
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-repo-detail')">Close</button>
    </div>
  </div>
</div>

<!-- ─── FM: Extract ZIP Modal ──────────────────────────────── -->
<div class="modal-backdrop hidden" id="modal-extract">
  <div class="modal">
    <div class="modal-title" style="color:#10B981"><i class="fas fa-file-export"></i> Extract ZIP</div>
    <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <i class="fas fa-file-archive" style="color:#10B981;font-size:1.2rem"></i>
      <span id="extract-zip-name" style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:#6EE7B7;word-break:break-all">archive.zip</span>
    </div>
    <div class="input-group">
      <label>Extract To (leave empty for current directory)</label>
      <input type="text" class="input-field text-mono" id="extract-dest-path" placeholder="e.g. src/components (optional)">
    </div>
    <div style="font-size:0.75rem;color:#64748B;margin-top:-8px;margin-bottom:16px">
      <i class="fas fa-info-circle" style="margin-right:4px;color:#2563EB"></i>
      Folder structure inside ZIP will be preserved. Dangerous file types are blocked.
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-extract')">Cancel</button>
      <button class="btn btn-success" id="extract-confirm-btn"><i class="fas fa-file-export"></i> Extract</button>
    </div>
  </div>
</div>

<!-- ─── FM: Compress Modal ─────────────────────────────────── -->
<div class="modal-backdrop hidden" id="modal-compress">
  <div class="modal">
    <div class="modal-title" style="color:#7C3AED"><i class="fas fa-file-archive"></i> Compress to ZIP</div>
    <div style="font-size:0.82rem;color:#94A3B8;margin-bottom:16px">
      <i class="fas fa-layer-group" style="margin-right:6px;color:#7C3AED"></i>
      <span id="compress-item-count">0 items selected</span>
    </div>
    <div class="input-group">
      <label>ZIP File Name</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" class="input-field text-mono" id="compress-zip-name" placeholder="archive" style="flex:1">
        <span style="color:#64748B;font-size:0.85rem;white-space:nowrap">.zip</span>
      </div>
    </div>
    <div style="font-size:0.75rem;color:#64748B;margin-top:-8px;margin-bottom:16px">
      <i class="fas fa-download" style="margin-right:4px;color:#7C3AED"></i>
      ZIP will be downloaded directly to your device.
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-compress')">Cancel</button>
      <button class="btn btn-secondary" id="compress-confirm-btn"><i class="fas fa-file-archive"></i> Compress &amp; Download</button>
    </div>
  </div>
</div>

<!-- ─── FM: Move / Copy Modal ──────────────────────────────── -->
<div class="modal-backdrop hidden" id="modal-move">
  <div class="modal">
    <div class="modal-title" style="color:#06B6D4" id="move-modal-title"><i class="fas fa-arrows-alt"></i> Move Items</div>
    <div style="font-size:0.82rem;color:#94A3B8;margin-bottom:16px">
      <i class="fas fa-folder" style="margin-right:6px;color:#F59E0B"></i>
      <span id="move-item-count">0 items</span>
    </div>
    <div class="input-group">
      <label>Destination Path (relative to repo root)</label>
      <input type="text" class="input-field text-mono" id="move-dest-path" placeholder="e.g. src/components or leave empty for root">
    </div>
    <div style="font-size:0.75rem;color:#64748B;margin-top:-8px;margin-bottom:16px">
      <i class="fas fa-info-circle" style="margin-right:4px;color:#2563EB"></i>
      Destination folder will be created automatically if it does not exist.
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="MKX.modals.close('modal-move')">Cancel</button>
      <button class="btn btn-accent" id="move-confirm-btn">Move Here</button>
    </div>
  </div>
</div>

<!-- Inline PHP data for JS -->
<script>
  window.MKX_CONFIG = {
    user:      <?= json_encode($user) ?>,
    csrfToken: <?= json_encode($csrf) ?>,
    apiBase:   'api.php',
  };
</script>

<!-- xterm.js for SSH Terminal -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
<!-- Three.js -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<!-- GSAP -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<!-- Monaco Loader -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js"></script>
<!-- App JS -->
<script src="assets/js/app.js"></script>
<!-- File Manager Extension -->
<script src="assets/js/fm.js"></script>

</body>
</html>
