/**
 * MKX GitHub Cloud — Application Core
 * Three.js · GSAP · Monaco Editor · GitHub REST API
 * Fixed: Event delegation, no inline JSON in onclick, proper base64 decode
 */

'use strict';

const MKX = {};

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════

MKX.state = {
  repos:        [],
  filteredRepos:[],
  currentRepo:  null,
  currentPath:  '',
  currentFiles: [],
  editorFile:   null,
  editorSHA:    null,
  monacoEditor: null,
  currentPage:  1,
  perPage:      30,
  sortBy:       'updated',
  filterVis:    'all',
  searchQuery:  '',
  rateLimit:    { remaining: null, limit: 5000 },
};

const CFG = window.MKX_CONFIG || { user: {}, csrfToken: '', apiBase: 'api.php' };

// ═══════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════

MKX.utils = {
  escHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  },
  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },
  formatSize(bytes) {
    if (!bytes) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
  },
  langColor(lang) {
    const map = {
      JavaScript: '#F7DF1E', TypeScript: '#3178C6', Python: '#3572A5', PHP: '#4F5D95',
      HTML: '#E34C26', CSS: '#563D7C', Java: '#B07219', Go: '#00ADD8', Rust: '#DEA584',
      Ruby: '#701516', 'C#': '#178600', 'C++': '#F34B7D', Shell: '#89E051',
      Kotlin: '#F18E33', Swift: '#FA7343', Vue: '#41B883', Dart: '#00B4AB',
    };
    return map[lang] || '#94A3B8';
  },
  fileIconInfo(name, type) {
    if (type === 'dir') return { cls: 'fi-folder', icon: 'fa-folder' };
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
      php:  ['fi-php',   'fa-code'],
      html: ['fi-html',  'fa-html5'],   htm: ['fi-html', 'fa-html5'],
      css:  ['fi-css',   'fa-css3-alt'],
      js:   ['fi-js',    'fa-js'],      ts:  ['fi-js',   'fa-code'],
      json: ['fi-json',  'fa-brackets-curly'],
      py:   ['fi-py',    'fa-python'],
      md:   ['fi-md',    'fa-markdown'],
      txt:  ['fi-txt',   'fa-file-alt'],
      zip:  ['fi-zip',   'fa-file-archive'], gz: ['fi-zip', 'fa-file-archive'],
      png:  ['fi-img',   'fa-file-image'], jpg: ['fi-img', 'fa-file-image'],
      jpeg: ['fi-img',   'fa-file-image'], gif: ['fi-img', 'fa-file-image'],
      svg:  ['fi-img',   'fa-file-image'], webp: ['fi-img', 'fa-file-image'],
      xml:  ['fi-json',  'fa-file-code'],
      yaml: ['fi-json',  'fa-file-code'], yml: ['fi-json', 'fa-file-code'],
      sh:   ['fi-other', 'fa-terminal'],
    };
    const r = map[ext] || ['fi-other', 'fa-file'];
    return { cls: r[0], icon: r[1] };
  },
  monacoLang(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const map = {
      js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
      php: 'php', html: 'html', htm: 'html', css: 'css', less: 'css', scss: 'css',
      json: 'json', md: 'markdown', py: 'python', sh: 'shell',
      xml: 'xml', yaml: 'yaml', yml: 'yaml', sql: 'sql', rs: 'rust', go: 'go',
      java: 'java', cs: 'csharp', cpp: 'cpp', c: 'c', rb: 'ruby', txt: 'plaintext',
    };
    return map[ext] || 'plaintext';
  },
  copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => MKX.notify.success('Copied to clipboard!'));
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
      MKX.notify.success('Copied to clipboard!');
    }
  },
  animateCounter(el, target, duration = 1200) {
    if (!el) return;
    const start = performance.now();
    const from  = parseInt(el.textContent) || 0;
    function step(now) {
      const p    = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (target - from) * ease);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  },
  debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  },
  // Safe base64 decode — handles GitHub API line-wrapped base64 + UTF-8 + binary
  decodeBase64(str) {
    if (!str) return '';
    try {
      // GitHub wraps base64 at 60 chars with \n — strip all whitespace first
      const clean  = str.replace(/\s/g, '');
      if (!clean)  return '';
      const binary = atob(clean);

      // Try proper UTF-8 decode (handles accents, Unicode, etc.)
      try {
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
      } catch (_) {
        // Fallback: return raw binary string (works for ASCII/Latin-1 files)
        return binary;
      }
    } catch (e) {
      console.warn('[MKX] decodeBase64 failed:', e.message);
      return '';
    }
  },
};

// ═══════════════════════════════════════════════════════════
//  API LAYER
// ═══════════════════════════════════════════════════════════

MKX.api = {
  async call(action, params = {}, method = 'GET', body = null) {
    const qs   = new URLSearchParams({ action, ...params }).toString();
    const url  = `${CFG.apiBase}?${qs}`;
    const opts = { method, headers: { 'X-CSRF-Token': CFG.csrfToken } };
    if (body && method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res  = await fetch(url, opts);
    if (res.status === 401) { window.location.href = 'index.php'; return null; }
    const data = await res.json();
    if (data && data.error && !data.message) throw new Error(data.error);
    return data;
  },
  get:   (action, params)       => MKX.api.call(action, params, 'GET'),
  post:  (action, params, body) => MKX.api.call(action, params, 'POST',   body),
  put:   (action, params, body) => MKX.api.call(action, params, 'PUT',    body),
  del:   (action, params, body) => MKX.api.call(action, params, 'DELETE', body),
  patch: (action, params, body) => MKX.api.call(action, params, 'PATCH',  body),

  async refreshRateLimit() {
    try {
      const data = await this.get('rate_limit');
      if (!data) return;
      const r = data.resources?.core || data.rate;
      if (!r) return;
      MKX.state.rateLimit = r;
      const remaining = r.remaining;
      const limit     = r.limit || 5000;
      const pct       = Math.round(remaining / limit * 100);
      const resetTime = new Date(r.reset * 1000).toLocaleTimeString();

      const rateText   = document.getElementById('rate-text');
      const statApi    = document.getElementById('stat-api');
      const rateDetail = document.getElementById('rate-detail');
      const rateReset  = document.getElementById('rate-reset');
      const rateBar    = document.getElementById('rate-bar');
      const pill       = document.getElementById('rate-pill');

      if (rateText)   rateText.textContent   = `${remaining}/${limit}`;
      if (statApi)    MKX.utils.animateCounter(statApi, remaining);
      if (rateDetail) rateDetail.textContent = `${remaining} / ${limit} (${pct}%)`;
      if (rateReset)  rateReset.textContent  = resetTime;
      if (rateBar)    rateBar.style.width    = `${pct}%`;

      if (pill) {
        pill.className = 'rate-pill';
        if (remaining < 100)       pill.classList.add('danger');
        else if (remaining < 1000) pill.classList.add('warn');
      }
      const color = remaining < 100 ? '#EF4444' : remaining < 1000 ? '#F59E0B' : '#10B981';
      if (rateBar) rateBar.style.background = `linear-gradient(90deg, ${color}, ${color}88)`;
    } catch (e) { /* silent */ }
  },
};

// ═══════════════════════════════════════════════════════════
//  ROUTER
// ═══════════════════════════════════════════════════════════

MKX.router = {
  current: 'dashboard',
  go(view) {
    if (view === 'files'  && !MKX.state.currentRepo)  { MKX.notify.warn('Open a repository first.'); return; }
    if (view === 'editor' && !MKX.state.editorFile)   { MKX.notify.warn('Select a file to edit first.'); return; }

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.bnav-item').forEach(n => n.classList.remove('active'));

    const el    = document.getElementById(`view-${view}`);
    const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
    const bnav  = document.getElementById(`bnav-${view}`);

    if (el)    el.classList.add('active');
    if (navEl) navEl.classList.add('active');
    if (bnav)  bnav.classList.add('active');

    this.current = view;
    MKX.ui.closeSidebar();

    if (view === 'repos' && MKX.state.repos.length === 0) MKX.repos.load();
    if (view === 'dashboard' && MKX.state.repos.length === 0) MKX.repos.load();
  },
};

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════

MKX.ui = {
  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('show');
  },
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  },
  setLoading(el, on) {
    if (!el) return;
    if (on) {
      el._orig    = el.innerHTML;
      el.disabled = true;
      el.classList.add('btn-loading');
    } else {
      if (el._orig) el.innerHTML = el._orig;
      el.disabled = false;
      el.classList.remove('btn-loading');
    }
  },
  async refreshAll() {
    const icon = document.getElementById('refresh-icon');
    if (icon) icon.className = 'fas fa-sync-alt animate-spin';
    MKX.state.repos = [];
    await Promise.all([MKX.repos.load(), MKX.api.refreshRateLimit()]);
    if (icon) icon.className = 'fas fa-sync-alt';
    MKX.notify.success('Data refreshed!');
  },
  showRepoWorkspace(show) {
    const navFiles  = document.getElementById('nav-files');
    const navEditor = document.getElementById('nav-editor');
    const bnavFiles = document.getElementById('bnav-files');
    if (navFiles)  navFiles.style.display  = show ? '' : 'none';
    if (navEditor) navEditor.style.display = show ? '' : 'none';
    if (bnavFiles) bnavFiles.style.display = show ? '' : 'none';
  },
};

// ═══════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

MKX.notify = {
  _show(type, msg, duration = 3800) {
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle', warn: 'fa-exclamation-circle' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i class="fas ${icons[type]} toast-icon"></i>
      <span>${MKX.utils.escHtml(msg)}</span>
      <span class="toast-close">✕</span>`;
    toast.querySelector('.toast-close').onclick = () => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    };
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 300); }, duration);
  },
  success: m => MKX.notify._show('success', m),
  error:   m => MKX.notify._show('error',   m, 5000),
  info:    m => MKX.notify._show('info',    m),
  warn:    m => MKX.notify._show('warn',    m),
};

// ═══════════════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════════════

MKX.modals = {
  open(id)  { document.getElementById(id)?.classList.remove('hidden'); },
  close(id) { document.getElementById(id)?.classList.add('hidden'); },

  createRepo() {
    document.getElementById('new-repo-name').value  = '';
    document.getElementById('new-repo-desc').value  = '';
    document.getElementById('new-repo-init').checked = true;
    document.querySelector('input[name="repo-visibility"][value="public"]').checked = true;
    this.open('modal-create-repo');
    setTimeout(() => document.getElementById('new-repo-name').focus(), 100);
  },

  confirmDelete(name, action) {
    document.getElementById('delete-target-name').textContent = name;
    MKX._deleteAction = action;
    this.open('modal-delete');
  },

  rename(currentName, action) {
    document.getElementById('rename-input').value = currentName;
    MKX._renameAction = action;
    this.open('modal-rename');
    setTimeout(() => document.getElementById('rename-input').focus(), 100);
  },

  showRepoDetail(repo) {
    if (!repo) return;
    document.getElementById('rdetail-name').innerHTML =
      `<i class="fas fa-code-branch"></i> ${MKX.utils.escHtml(repo.name)}`;

    const clone = repo.clone_url  || '';
    const http  = repo.html_url   || '';
    const owner = repo.owner?.login || '';
    const name  = repo.name || '';

    document.getElementById('rdetail-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="glass-card" style="padding:12px;border-radius:10px">
          <div style="font-size:0.7rem;color:#64748B;margin-bottom:4px">VISIBILITY</div>
          <div style="font-weight:600;color:${repo.private ? '#7C3AED' : '#10B981'}">${repo.private ? 'Private' : 'Public'}</div>
        </div>
        <div class="glass-card" style="padding:12px;border-radius:10px">
          <div style="font-size:0.7rem;color:#64748B;margin-bottom:4px">STARS</div>
          <div style="font-weight:600;color:#F59E0B">⭐ ${repo.stargazers_count || 0}</div>
        </div>
        <div class="glass-card" style="padding:12px;border-radius:10px">
          <div style="font-size:0.7rem;color:#64748B;margin-bottom:4px">LANGUAGE</div>
          <div style="font-weight:600">${MKX.utils.escHtml(repo.language || 'N/A')}</div>
        </div>
        <div class="glass-card" style="padding:12px;border-radius:10px">
          <div style="font-size:0.7rem;color:#64748B;margin-bottom:4px">FORKS</div>
          <div style="font-weight:600">${repo.forks_count || 0}</div>
        </div>
      </div>
      ${repo.description ? `<div style="color:#94A3B8;font-size:0.85rem;padding:10px;background:rgba(30,41,59,0.4);border-radius:8px">${MKX.utils.escHtml(repo.description)}</div>` : ''}
      <div>
        <div style="font-size:0.7rem;color:#64748B;margin-bottom:6px">CLONE URL</div>
        <div style="display:flex;gap:8px;align-items:center">
          <code style="flex:1;font-family:'JetBrains Mono',monospace;font-size:0.75rem;background:rgba(15,23,42,0.6);padding:8px 10px;border-radius:6px;color:#06B6D4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MKX.utils.escHtml(clone)}</code>
          <button class="btn btn-ghost btn-sm btn-icon" id="rdetail-copy-clone"><i class="fas fa-copy"></i></button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-accent btn-sm"   id="rdetail-btn-files"><i class="fas fa-folder-open"></i> Open Files</button>
        <button class="btn btn-ghost btn-sm"    id="rdetail-btn-gh"><i class="fab fa-github"></i> GitHub</button>
        <button class="btn btn-ghost btn-sm"    id="rdetail-btn-fork"><i class="fas fa-code-branch"></i> Fork</button>
        <button class="btn btn-ghost btn-sm"    id="rdetail-btn-rename"><i class="fas fa-edit"></i> Rename</button>
        <button class="btn btn-danger btn-sm"   id="rdetail-btn-delete"><i class="fas fa-trash"></i> Delete</button>
      </div>`;

    // Attach events using JS (no inline onclick)
    document.getElementById('rdetail-copy-clone').onclick  = () => MKX.utils.copyText(clone);
    document.getElementById('rdetail-btn-files').onclick   = () => { MKX.modals.close('modal-repo-detail'); MKX.files.openRepo(owner, name); };
    document.getElementById('rdetail-btn-gh').onclick      = () => window.open(http, '_blank');
    document.getElementById('rdetail-btn-fork').onclick    = () => MKX.repos.fork(owner, name);
    document.getElementById('rdetail-btn-rename').onclick  = () => { MKX.modals.close('modal-repo-detail'); MKX.repos.promptRename(owner, name); };
    document.getElementById('rdetail-btn-delete').onclick  = () => { MKX.modals.close('modal-repo-detail'); MKX.repos.promptDelete(owner, name); };

    this.open('modal-repo-detail');
  },
};

// Wire the delete/rename confirm buttons (set once at init time)
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirm-delete-btn')?.addEventListener('click', async () => {
    if (typeof MKX._deleteAction === 'function') await MKX._deleteAction();
  });
  document.getElementById('rename-input')?.closest('.modal')?.querySelector('.btn-accent')?.addEventListener('click', async () => {
    if (typeof MKX._renameAction === 'function') await MKX._renameAction();
  });
});

// ═══════════════════════════════════════════════════════════
//  REPOSITORY MANAGER
// ═══════════════════════════════════════════════════════════

MKX.repos = {
  // Map: id → repo object, used for event-safe lookups
  _map: {},

  async load() {
    const grid   = document.getElementById('repos-grid');
    const recent = document.getElementById('recent-repos');
    const skeletonHTML = `
      <div class="glass-card" style="padding:20px"><div class="skeleton" style="height:18px;width:60%;margin-bottom:10px"></div><div class="skeleton" style="height:12px;width:40%"></div></div>
      <div class="glass-card" style="padding:20px"><div class="skeleton" style="height:18px;width:55%;margin-bottom:10px"></div><div class="skeleton" style="height:12px;width:35%"></div></div>
      <div class="glass-card" style="padding:20px"><div class="skeleton" style="height:18px;width:65%;margin-bottom:10px"></div><div class="skeleton" style="height:12px;width:45%"></div></div>`;
    if (grid)   grid.innerHTML   = `<div style="text-align:center;padding:60px;color:#475569;grid-column:1/-1"><i class="fas fa-spinner animate-spin" style="font-size:2rem"></i><div style="margin-top:12px">Loading repositories...</div></div>`;
    if (recent) recent.innerHTML = skeletonHTML;

    try {
      const data = await MKX.api.get('repos', { page: MKX.state.currentPage, per_page: MKX.state.perPage, sort: MKX.state.sortBy });
      if (!Array.isArray(data)) throw new Error('Invalid response from GitHub API');

      // Build lookup map
      this._map = {};
      data.forEach(r => { this._map[r.id] = r; });

      MKX.state.repos         = data;
      MKX.state.filteredRepos = [...data];

      this._applyFilter();
      this._renderStats();
      this._renderRecent();
      MKX.api.refreshRateLimit();

      const badge = document.getElementById('repos-count-badge');
      const label = document.getElementById('repos-total-label');
      if (badge) badge.textContent = data.length;
      if (label) label.textContent = `(${data.length})`;

    } catch (e) {
      const errHTML = `<div style="text-align:center;padding:60px;color:#EF4444;grid-column:1/-1"><i class="fas fa-exclamation-triangle" style="font-size:2rem"></i><div style="margin-top:12px">${MKX.utils.escHtml(e.message)}</div></div>`;
      if (grid) grid.innerHTML = errHTML;
      MKX.notify.error('Failed to load repos: ' + e.message);
    }
  },

  _applyFilter() {
    let filtered = [...MKX.state.repos];
    if (MKX.state.filterVis !== 'all') {
      filtered = filtered.filter(r => MKX.state.filterVis === 'private' ? r.private : !r.private);
    }
    if (MKX.state.searchQuery) {
      const q = MKX.state.searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)
      );
    }
    MKX.state.filteredRepos = filtered;
    this._renderGrid(filtered);
  },

  _renderGrid(repos) {
    const grid = document.getElementById('repos-grid');
    if (!grid) return;
    if (repos.length === 0) {
      grid.innerHTML = `<div style="text-align:center;padding:60px;color:#475569;grid-column:1/-1">
        <i class="fas fa-code-branch" style="font-size:2.5rem;opacity:0.3;margin-bottom:12px;display:block"></i>
        <div style="font-size:1rem;margin-bottom:8px">No repositories found</div>
        <button class="btn btn-primary btn-sm" id="no-repo-create-btn"><i class="fas fa-plus"></i> Create your first repo</button>
      </div>`;
      document.getElementById('no-repo-create-btn')?.addEventListener('click', () => MKX.modals.createRepo());
      return;
    }
    grid.innerHTML = repos.map(r => this._cardHTML(r)).join('');
    this._attachCardEvents(grid, repos);
    gsap.fromTo('#repos-grid .repo-card', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: 'power2.out' });
  },

  _cardHTML(r) {
    const lc      = MKX.utils.langColor(r.language);
    const updated = MKX.utils.formatDate(r.updated_at);
    const visBadge = r.private
      ? `<span class="repo-badge priv"><i class="fas fa-lock" style="font-size:0.65rem;margin-right:3px"></i>Private</span>`
      : `<span class="repo-badge pub"><i class="fas fa-globe-americas" style="font-size:0.65rem;margin-right:3px"></i>Public</span>`;

    return `
    <div class="glass-card repo-card" data-repoid="${r.id}">
      <div class="repo-name">
        <i class="fas fa-code-branch" style="font-size:0.8rem;color:#2563EB"></i>
        ${MKX.utils.escHtml(r.name)}
      </div>
      <div class="repo-desc">${MKX.utils.escHtml(r.description || 'No description.')}</div>
      <div class="repo-meta">
        ${visBadge}
        ${r.language ? `<span style="display:flex;align-items:center;gap:5px;font-size:0.75rem;color:#94A3B8"><span class="lang-dot" style="background:${lc}"></span>${MKX.utils.escHtml(r.language)}</span>` : ''}
        ${r.stargazers_count ? `<span style="font-size:0.75rem;color:#94A3B8"><i class="fas fa-star" style="color:#F59E0B;margin-right:3px;font-size:0.65rem"></i>${r.stargazers_count}</span>` : ''}
        <span style="font-size:0.72rem;color:#475569;margin-left:auto"><i class="fas fa-clock" style="margin-right:3px"></i>${updated}</span>
      </div>
      <div class="repo-actions">
        <button class="btn btn-accent btn-sm rc-files"    title="Browse files"><i class="fas fa-folder-open"></i> Files</button>
        <button class="btn btn-ghost btn-sm rc-detail"    title="More options"><i class="fas fa-ellipsis-h"></i></button>
        <button class="btn btn-ghost btn-sm rc-clone"     title="Copy clone URL"><i class="fas fa-copy"></i></button>
        <button class="btn btn-ghost btn-sm rc-github"    title="Open on GitHub"><i class="fab fa-github"></i></button>
      </div>
    </div>`;
  },

  // Attach all events via JS — no inline JSON ever
  _attachCardEvents(container, repos) {
    container.querySelectorAll('.repo-card').forEach(card => {
      const id   = parseInt(card.dataset.repoid);
      const repo = this._map[id];
      if (!repo) return;

      card.addEventListener('contextmenu', e => { e.preventDefault(); MKX.ctx.showRepo(e, repo); });
      card.querySelector('.rc-files')?.addEventListener('click',  e => { e.stopPropagation(); MKX.files.openRepo(repo.owner?.login, repo.name); });
      card.querySelector('.rc-detail')?.addEventListener('click', e => { e.stopPropagation(); MKX.modals.showRepoDetail(repo); });
      card.querySelector('.rc-clone')?.addEventListener('click',  e => { e.stopPropagation(); MKX.utils.copyText(repo.clone_url || ''); });
      card.querySelector('.rc-github')?.addEventListener('click', e => { e.stopPropagation(); window.open(repo.html_url, '_blank'); });
    });
  },

  _renderStats() {
    const repos        = MKX.state.repos;
    const privateCount = repos.filter(r => r.private).length;
    const starsCount   = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
    MKX.utils.animateCounter(document.getElementById('stat-repos'),   repos.length);
    MKX.utils.animateCounter(document.getElementById('stat-private'), privateCount);
    MKX.utils.animateCounter(document.getElementById('stat-stars'),   starsCount);
  },

  _renderRecent() {
    const el = document.getElementById('recent-repos');
    if (!el) return;
    const recent = MKX.state.repos.slice(0, 6);
    el.innerHTML  = recent.map(r => this._cardHTML(r)).join('');
    this._attachCardEvents(el, recent);
  },

  search: null, // set after utils init

  sortRepos(sortBy) {
    MKX.state.sortBy      = sortBy;
    MKX.state.currentPage = 1;
    MKX.state.repos       = [];
    this.load();
  },

  filterRepos(vis) {
    MKX.state.filterVis = vis;
    this._applyFilter();
  },

  nextPage() { MKX.state.currentPage++; this.load(); this._updatePagination(); },
  prevPage() { if (MKX.state.currentPage <= 1) return; MKX.state.currentPage--; this.load(); this._updatePagination(); },
  _updatePagination() {
    const el = document.getElementById('page-current');
    if (el) el.textContent = MKX.state.currentPage;
    const prev = document.getElementById('page-prev');
    if (prev) prev.disabled = MKX.state.currentPage <= 1;
  },

  _creating: false,   // guard against double-submit

  async create() {
    // Guard: prevent double submission (e.g. double-tap on mobile)
    if (this._creating) return;

    const name = document.getElementById('new-repo-name').value.trim();
    const desc = document.getElementById('new-repo-desc').value.trim();
    const priv = document.querySelector('input[name="repo-visibility"]:checked')?.value === 'private';
    const init = document.getElementById('new-repo-init').checked;
    const gi   = document.getElementById('new-repo-gitignore').value;

    if (!name) { MKX.notify.warn('Repository name is required.'); return; }
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      MKX.notify.warn('Name can only contain letters, numbers, hyphens, dots, underscores.');
      return;
    }

    this._creating = true;
    const btn = document.getElementById('create-repo-btn');
    if (btn) btn.disabled = true;   // Immediately disable before async
    MKX.ui.setLoading(btn, true);

    try {
      const data = await MKX.api.post('create_repo', {}, {
        name, description: desc, private: priv, auto_init: init,
        gitignore_template: gi || undefined,
      });

      if (data?.id) {
        MKX.notify.success(`Repository "${name}" created successfully!`);
        MKX.modals.close('modal-create-repo');
        MKX.state.repos = [];
        await this.load();
        setTimeout(() => MKX.files.openRepo(data.owner?.login, data.name), 600);
      } else {
        // Extract the most helpful GitHub error message
        let errMsg = data?.message || 'Creation failed';
        if (Array.isArray(data?.errors) && data.errors.length) {
          const detail = data.errors.map(e => e.message || e.code).join('; ');
          errMsg += ' — ' + detail;
        }
        throw new Error(errMsg);
      }
    } catch (e) {
      MKX.notify.error('Create failed: ' + e.message);
    } finally {
      this._creating = false;
      MKX.ui.setLoading(btn, false);
    }
  },

  promptDelete(owner, name) {
    MKX.modals.close('modal-repo-detail');
    MKX.modals.confirmDelete(`${owner}/${name}`, async () => {
      const btn = document.getElementById('confirm-delete-btn');
      MKX.ui.setLoading(btn, true);
      try {
        await MKX.api.del('delete_repo', { owner, repo: name });
        MKX.notify.success(`"${name}" deleted.`);
        MKX.modals.close('modal-delete');
        MKX.state.repos = [];
        await MKX.repos.load();
      } catch (e) {
        MKX.notify.error('Delete failed: ' + e.message);
      } finally {
        MKX.ui.setLoading(btn, false);
      }
    });
  },

  promptRename(owner, name) {
    MKX.modals.close('modal-repo-detail');
    MKX.modals.rename(name, async () => {
      const newName = document.getElementById('rename-input').value.trim();
      if (!newName || newName === name) return;
      try {
        await MKX.api.patch('rename_repo', {}, { owner, repo: name, new_name: newName });
        MKX.notify.success(`Renamed to "${newName}"`);
        MKX.modals.close('modal-rename');
        MKX.state.repos = [];
        await MKX.repos.load();
      } catch (e) {
        MKX.notify.error('Rename failed: ' + e.message);
      }
    });
  },

  async fork(owner, name) {
    MKX.modals.close('modal-repo-detail');
    try {
      await MKX.api.get('fork', { owner, repo: name });
      MKX.notify.success(`Fork of "${name}" created!`);
    } catch (e) {
      MKX.notify.error('Fork failed: ' + e.message);
    }
  },
};

// Wire search debounce after utils exists
MKX.repos.search = MKX.utils.debounce(q => {
  MKX.state.searchQuery = q;
  MKX.repos._applyFilter();
}, 250);

// ═══════════════════════════════════════════════════════════
//  FILE MANAGER
// ═══════════════════════════════════════════════════════════

MKX.files = {
  pathStack:   [],
  _renderList: [], // tracks currently rendered files (for filter)

  openRepo(owner, repoName) {
    if (!owner || !repoName) { MKX.notify.warn('Invalid repository.'); return; }
    MKX.state.currentRepo = { owner, name: repoName };
    MKX.state.currentPath = '';
    this.pathStack        = [];

    const nameEl   = document.getElementById('fm-repo-name');
    const branchEl = document.getElementById('fm-branch-label');
    if (nameEl)   nameEl.textContent   = `${owner}/${repoName}`;
    if (branchEl) branchEl.textContent = 'Loading...';

    MKX.ui.showRepoWorkspace(true);
    MKX.router.go('files');
    this.loadContents('');
    this._loadBranch(owner, repoName);
  },

  async _loadBranch(owner, name) {
    try {
      const branches = await MKX.api.get('branches', { owner, repo: name });
      const def = Array.isArray(branches) && (branches.find(b => b.name === 'main' || b.name === 'master') || branches[0]);
      const el  = document.getElementById('fm-branch-label');
      if (el) el.textContent = def ? `Branch: ${def.name}` : 'No branches yet';
    } catch (e) {
      const el = document.getElementById('fm-branch-label');
      if (el) el.textContent = 'Branch info unavailable';
    }
  },

  async loadContents(path) {
    MKX.state.currentPath = path;
    this._updateBreadcrumb(path);

    const list = document.getElementById('file-list');
    if (list) list.innerHTML = `<div style="text-align:center;padding:40px;color:#475569"><i class="fas fa-spinner animate-spin" style="font-size:1.5rem;margin-bottom:10px;display:block"></i>Loading files...</div>`;

    const { owner, name: repoName } = MKX.state.currentRepo;

    try {
      const data = await MKX.api.get('contents', { owner, repo: repoName, path: path || '' });

      // Single file returned → open in editor directly
      if (data && !Array.isArray(data) && data.type === 'file') {
        MKX.editor.openFile(data);
        return;
      }

      if (!Array.isArray(data)) throw new Error('Unexpected response from GitHub');

      // Sort: dirs first, then alphabetically
      const sorted = data.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'dir' ? -1 : 1;
      });

      MKX.state.currentFiles = sorted;
      this._renderList       = sorted;
      this._renderFiles(sorted);

    } catch (e) {
      if (list) {
        if (e.message.includes('404') || e.message.toLowerCase().includes('empty')) {
          list.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B">
            <i class="fas fa-box-open" style="font-size:2.5rem;opacity:0.4;margin-bottom:12px;display:block"></i>
            <div style="margin-bottom:12px">Repository is empty</div>
            <button class="btn btn-accent btn-sm" id="empty-create-btn"><i class="fas fa-plus"></i> Create first file</button>
          </div>`;
          document.getElementById('empty-create-btn')?.addEventListener('click', () => MKX.files.createNewFile());
        } else {
          list.innerHTML = `<div style="text-align:center;padding:40px;color:#EF4444"><i class="fas fa-exclamation-triangle" style="font-size:1.5rem;display:block;margin-bottom:8px"></i>${MKX.utils.escHtml(e.message)}</div>`;
          MKX.notify.error('Failed to load: ' + e.message);
        }
      }
    }
  },

  _renderFiles(files) {
    const list = document.getElementById('file-list');
    if (!list) return;

    const countEl = document.getElementById('fm-file-count');
    if (countEl) countEl.textContent = `${files.length} item${files.length !== 1 ? 's' : ''}`;

    if (files.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#475569">No files found.</div>';
      return;
    }

    list.innerHTML = files.map((f, i) => {
      const { cls, icon } = MKX.utils.fileIconInfo(f.name, f.type);
      const size = (f.type === 'file' && f.size) ? MKX.utils.formatSize(f.size) : '';
      return `
      <div class="file-item" data-idx="${i}">
        <div class="file-icon ${cls}"><i class="fas ${icon}"></i></div>
        <div style="flex:1;min-width:0">
          <div class="file-name truncate">${MKX.utils.escHtml(f.name)}</div>
          ${f.type === 'dir' ? '<div class="file-size">Directory</div>' : ''}
        </div>
        ${size ? `<div class="file-size">${size}</div>` : ''}
        <div class="file-actions">
          ${f.type === 'file' ? `<button class="btn btn-ghost btn-icon btn-sm fi-edit" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
          ${f.type === 'file' && f.download_url ? `<button class="btn btn-ghost btn-icon btn-sm fi-dl" title="Download"><i class="fas fa-download"></i></button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm fi-del" style="color:#EF4444" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');

    // ── Attach events via JS (NO inline JSON in HTML) ──────────
    list.querySelectorAll('.file-item').forEach(el => {
      const idx = parseInt(el.dataset.idx);
      const f   = files[idx];
      if (!f) return;

      // Single click → navigate folder or open file
      el.addEventListener('click', e => {
        if (e.target.closest('.file-actions')) return;
        if (f.type === 'dir') {
          this.pathStack.push(MKX.state.currentPath);
          this.loadContents(f.path);
        } else {
          this._fetchAndEdit(f);
        }
      });

      // Double-click on folder → also navigate (mobile/desktop alternative)
      if (f.type === 'dir') {
        el.addEventListener('dblclick', e => {
          e.preventDefault();
          this.loadContents(f.path);
        });
      }

      // Long press on folder (mobile) → context menu with Open option
      if (f.type === 'dir') {
        let lpTimer = null;
        el.addEventListener('touchstart', e => {
          lpTimer = setTimeout(() => {
            lpTimer = null;
            const t = e.touches[0];
            MKX.ctx.showFile({ clientX: t.clientX, clientY: t.clientY, preventDefault: ()=>{} }, f);
          }, 550);
        }, { passive: true });
        el.addEventListener('touchend',  () => { clearTimeout(lpTimer); lpTimer = null; });
        el.addEventListener('touchmove', () => { clearTimeout(lpTimer); lpTimer = null; });
      }

      // Right-click context menu (desktop)
      el.addEventListener('contextmenu', e => { e.preventDefault(); MKX.ctx.showFile(e, f); });

      // Action buttons
      el.querySelector('.fi-edit')?.addEventListener('click', e => { e.stopPropagation(); this._fetchAndEdit(f); });
      el.querySelector('.fi-dl')?.addEventListener('click',   e => { e.stopPropagation(); this.download(f.download_url, f.name); });
      el.querySelector('.fi-del')?.addEventListener('click',  e => { e.stopPropagation(); this.promptDelete(f); });
    });

    // Animate
    gsap.fromTo('#file-list .file-item',
      { opacity: 0, x: -12 },
      { opacity: 1, x: 0, duration: 0.3, stagger: 0.03, ease: 'power2.out' }
    );
  },

  filterFiles(q) {
    const source = MKX.state.currentFiles;
    const filtered = !q ? source : source.filter(f => f.name.toLowerCase().includes(q.toLowerCase()));
    this._renderList = filtered;
    this._renderFiles(filtered);
  },

  // Fetch file with full content from API, then open editor
  async _fetchAndEdit(f) {
    MKX.notify.info(`Opening ${f.name}...`);
    try {
      const { owner, name: repoName } = MKX.state.currentRepo;
      const data = await MKX.api.get('contents', { owner, repo: repoName, path: f.path });
      if (!data || data.error) throw new Error(data?.error || 'Failed to fetch file');
      MKX.editor.openFile(data);
    } catch (e) {
      MKX.notify.error('Cannot open file: ' + e.message);
    }
  },

  _updateBreadcrumb(path) {
    const bc       = document.getElementById('fm-breadcrumb');
    if (!bc) return;
    const repoName = MKX.state.currentRepo?.name || 'root';

    let html = `<span class="breadcrumb-item" id="bc-root"><i class="fas fa-home" style="margin-right:4px"></i>${MKX.utils.escHtml(repoName)}</span>`;
    const parts = path ? path.split('/') : [];

    parts.forEach((part, i) => {
      const partPath = parts.slice(0, i + 1).join('/');
      html += `<span class="breadcrumb-sep">/</span>`;
      if (i === parts.length - 1) {
        html += `<span class="breadcrumb-item current" data-path="">${MKX.utils.escHtml(part)}</span>`;
      } else {
        html += `<span class="breadcrumb-item" data-path="${MKX.utils.escHtml(partPath)}">${MKX.utils.escHtml(part)}</span>`;
      }
    });

    bc.innerHTML = html;

    // Attach nav events
    bc.querySelector('#bc-root')?.addEventListener('click', () => MKX.files.loadContents(''));
    bc.querySelectorAll('.breadcrumb-item[data-path]').forEach(el => {
      const p = el.dataset.path;
      if (p !== undefined && el.textContent) {
        el.addEventListener('click', () => MKX.files.loadContents(p));
      }
    });
  },

  createNewFile() {
    document.getElementById('new-file-name').value    = '';
    document.getElementById('new-file-content').value = '';
    MKX.modals.open('modal-new-file');
    setTimeout(() => document.getElementById('new-file-name').focus(), 100);
  },

  async confirmCreateFile() {
    const name    = document.getElementById('new-file-name').value.trim();
    const content = document.getElementById('new-file-content').value;
    if (!name) { MKX.notify.warn('File name is required.'); return; }

    const currentPath = MKX.state.currentPath;
    const fullPath    = currentPath ? `${currentPath}/${name}` : name;
    const { owner, name: repoName } = MKX.state.currentRepo;

    try {
      await MKX.api.put('create_file', {}, {
        owner, repo: repoName, path: fullPath, content,
        message: `Create ${name} via MKX GitHub Cloud`,
      });
      MKX.notify.success(`"${name}" created!`);
      MKX.modals.close('modal-new-file');
      this.loadContents(currentPath);
    } catch (e) {
      MKX.notify.error('Create file failed: ' + e.message);
    }
  },

  createNewFolder() {
    document.getElementById('new-folder-name').value = '';
    MKX.modals.open('modal-new-folder');
    setTimeout(() => document.getElementById('new-folder-name').focus(), 100);
  },

  async confirmCreateFolder() {
    const name = document.getElementById('new-folder-name').value.trim();
    if (!name) { MKX.notify.warn('Folder name is required.'); return; }

    const currentPath = MKX.state.currentPath;
    const keepPath    = currentPath ? `${currentPath}/${name}/.gitkeep` : `${name}/.gitkeep`;
    const { owner, name: repoName } = MKX.state.currentRepo;

    try {
      await MKX.api.put('create_file', {}, {
        owner, repo: repoName, path: keepPath, content: '',
        message: `Create folder ${name} via MKX GitHub Cloud`,
      });
      MKX.notify.success(`Folder "${name}" created!`);
      MKX.modals.close('modal-new-folder');
      this.loadContents(currentPath);
    } catch (e) {
      MKX.notify.error('Create folder failed: ' + e.message);
    }
  },

  triggerUpload() { document.getElementById('file-upload-input').click(); },

  async handleUpload(files) {
    if (!files?.length) return;
    const fileArr     = Array.from(files);
    const total       = fileArr.length;
    const currentPath = MKX.state.currentPath;
    const { owner, name: repoName } = MKX.state.currentRepo;
    let ok = 0;
    let failed = 0;

    // ── Show progress panel ────────────────────────────────
    MKX.progress.start(
      total === 1 ? `Uploading ${fileArr[0].name}` : `Uploading ${total} files`,
      total
    );

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      MKX.progress.update(i, total, file.name);

      try {
        const b64 = await this._readB64(file);
        const fp  = currentPath ? `${currentPath}/${file.name}` : file.name;
        let sha;
        try {
          const ex = await MKX.api.get('contents', { owner, repo: repoName, path: fp });
          if (ex?.sha) sha = ex.sha;
        } catch (_) {}

        await MKX.api.put('update_file', {}, {
          owner, repo: repoName, path: fp,
          content:        b64,
          content_is_b64: true,
          sha,
          message: `Upload ${file.name} via MKX GitHub Cloud`,
        });
        ok++;
        MKX.progress.addFile(file.name, true);
      } catch (e) {
        failed++;
        MKX.progress.addFile(file.name, false, e.message);
        MKX.notify.error(`Upload "${file.name}" failed: ${e.message}`);
      }
    }

    // ── Final state ────────────────────────────────────────
    if (ok > 0) {
      MKX.progress.done(
        `${ok} file${ok > 1 ? 's' : ''} uploaded` +
        (failed ? `, ${failed} failed` : '')
      );
      this.loadContents(currentPath);
    } else {
      MKX.progress.error('All uploads failed.');
    }

    document.getElementById('file-upload-input').value = '';
  },

  _readB64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result.split(',')[1]);
      r.onerror = () => rej(new Error('File read failed'));
      r.readAsDataURL(file);
    });
  },

  download(url, filename) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove();
  },

  promptDelete(f) {
    MKX.modals.confirmDelete(f.path, async () => {
      const btn = document.getElementById('confirm-delete-btn');
      MKX.ui.setLoading(btn, true);
      try {
        const { owner, name: repoName } = MKX.state.currentRepo;
        await MKX.api.del('delete_file', {}, {
          owner, repo: repoName, path: f.path, sha: f.sha,
          message: `Delete ${f.name} via MKX GitHub Cloud`,
        });
        MKX.notify.success(`"${f.name}" deleted.`);
        MKX.modals.close('modal-delete');
        MKX.files.loadContents(MKX.state.currentPath);
      } catch (e) {
        MKX.notify.error('Delete failed: ' + e.message);
      } finally {
        MKX.ui.setLoading(btn, false);
      }
    });
  },
};

// Drag & drop
document.addEventListener('DOMContentLoaded', () => {
  const dz = document.getElementById('drop-zone');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragging'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) MKX.files.handleUpload(e.dataTransfer.files); });
});

// ═══════════════════════════════════════════════════════════
//  CODE EDITOR (Monaco)
// ═══════════════════════════════════════════════════════════

MKX.editor = {
  _ready: false,
  _queue: null,

  init() {
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });
    require(['vs/editor/editor.main'], () => {
      MKX.state.monacoEditor = monaco.editor.create(document.getElementById('monaco-container'), {
        value:                      '',
        language:                   'plaintext',
        theme:                      'vs-dark',
        fontSize:                   14,
        fontFamily:                 "'JetBrains Mono', 'Fira Code', monospace",
        fontLigatures:              true,
        lineNumbers:                'on',
        wordWrap:                   'on',
        minimap:                    { enabled: true },
        scrollBeyondLastLine:       false,
        automaticLayout:            true,
        suggestOnTriggerCharacters: true,
        formatOnPaste:              true,
        padding:                    { top: 12 },
        smoothScrolling:            true,
        cursorBlinking:             'phase',
        cursorSmoothCaretAnimation: true,
      });

      // Ctrl/Cmd + S → save
      MKX.state.monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => MKX.editor.save());

      // Track unsaved changes
      MKX.state.monacoEditor.onDidChangeModelContent(() => {
        const s = document.getElementById('editor-status');
        if (s) { s.textContent = '● Unsaved'; s.style.color = '#F59E0B'; }
      });

      this._ready = true;
      if (this._queue) { this._load(this._queue); this._queue = null; }
    });
  },

  openFile(fileData) {
    if (!fileData) { MKX.notify.error('No file data received.'); return; }

    MKX.state.editorFile = fileData;
    MKX.state.editorSHA  = fileData.sha;

    // Update UI labels
    const titleEl  = document.getElementById('editor-title');
    const pathEl   = document.getElementById('editor-file-path');
    const langEl   = document.getElementById('editor-lang-badge');
    const statusEl = document.getElementById('editor-status');
    const tabsEl   = document.getElementById('editor-tabs');

    if (titleEl)  titleEl.textContent  = fileData.name;
    if (pathEl)   pathEl.textContent   = fileData.path;
    if (langEl)   langEl.textContent   = (fileData.name.split('.').pop() || '').toUpperCase();
    if (statusEl) { statusEl.textContent = 'Loading...'; statusEl.style.color = '#64748B'; }
    if (tabsEl)   tabsEl.innerHTML = `<div class="editor-tab active"><i class="fas fa-file-code" style="font-size:0.75rem;color:#06B6D4"></i> ${MKX.utils.escHtml(fileData.name)}</div>`;

    MKX.router.go('editor');

    if (this._ready) {
      this._load(fileData);
    } else {
      this._queue = fileData;
      this.init();
    }
  },

  _load(fileData) {
    let content = '';

    // GitHub API always returns encoding:"base64" for file content
    if (fileData.content && (fileData.encoding === 'base64' || fileData.encoding === undefined)) {
      content = MKX.utils.decodeBase64(fileData.content);
    } else if (fileData.encoding === 'none') {
      MKX.notify.info('File too large for inline preview. Download to view.');
    }

    const lang = MKX.utils.monacoLang(fileData.name);

    // Always create a FRESH model — prevents blank/stale content bug
    const oldModel = MKX.state.monacoEditor.getModel();
    const newModel = monaco.editor.createModel(content, lang);
    MKX.state.monacoEditor.setModel(newModel);
    if (oldModel) oldModel.dispose();

    MKX.state.monacoEditor.setScrollPosition({ scrollTop: 0 });
    MKX.state.monacoEditor.focus();

    const langEl   = document.getElementById('editor-lang-badge');
    const statusEl = document.getElementById('editor-status');
    if (langEl)   langEl.textContent   = lang.toUpperCase();
    if (statusEl) { statusEl.textContent = 'Ready'; statusEl.style.color = '#10B981'; }
  },

  async save() {
    if (!MKX.state.editorFile) { MKX.notify.warn('No file open.'); return; }
    if (!this._ready || !MKX.state.monacoEditor) { MKX.notify.warn('Editor not ready.'); return; }

    const content = MKX.state.monacoEditor.getValue();
    const { owner, name: repoName } = MKX.state.currentRepo;
    const filePath = MKX.state.editorFile.path;
    const sha      = MKX.state.editorSHA;

    const btn      = document.getElementById('save-btn');
    const statusEl = document.getElementById('editor-status');
    MKX.ui.setLoading(btn, true);
    if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.style.color = '#64748B'; }

    try {
      const data = await MKX.api.put('update_file', {}, {
        owner, repo: repoName, path: filePath, content, sha,
        message: `Update ${MKX.state.editorFile.name} via MKX GitHub Cloud`,
      });

      // Update SHA so subsequent saves work
      const newSHA = data?.content?.sha;
      if (newSHA) { MKX.state.editorSHA = newSHA; MKX.state.editorFile.sha = newSHA; }

      MKX.notify.success(`"${MKX.state.editorFile.name}" saved!`);
      if (statusEl) { statusEl.textContent = 'Saved ✓'; statusEl.style.color = '#10B981'; }
    } catch (e) {
      MKX.notify.error('Save failed: ' + e.message);
      if (statusEl) { statusEl.textContent = 'Save failed!'; statusEl.style.color = '#EF4444'; }
    } finally {
      MKX.ui.setLoading(btn, false);
    }
  },

  toggleFullscreen() {
    const wrap = document.getElementById('editor-wrap');
    if (!document.fullscreenElement) wrap?.requestFullscreen?.();
    else document.exitFullscreen?.();
  },
};

// ═══════════════════════════════════════════════════════════
//  CONTEXT MENU
// ═══════════════════════════════════════════════════════════

MKX.ctx = {
  showRepo(event, repo) {
    const items = ['open', 'copy-url', 'rename', 'delete'];
    this._position(event, items);
    document.getElementById('ctx-open').onclick     = () => { window.open(repo.html_url, '_blank'); this.hide(); };
    document.getElementById('ctx-copy-url').onclick = () => { MKX.utils.copyText(repo.clone_url || ''); this.hide(); };
    document.getElementById('ctx-rename').onclick   = () => { MKX.repos.promptRename(repo.owner?.login, repo.name); this.hide(); };
    document.getElementById('ctx-delete').onclick   = () => { MKX.repos.promptDelete(repo.owner?.login, repo.name); this.hide(); };
  },

  showFile(event, f) {
    const items = f.type === 'dir'
      ? ['open', 'rename', 'delete']
      : ['open', 'edit', 'copy-url', 'download', 'rename', 'delete'];
    this._position(event, items);
    document.getElementById('ctx-open').onclick     = () => {
      if (f.type === 'dir') { MKX.files.pathStack.push(MKX.state.currentPath); MKX.files.loadContents(f.path); }
      else { MKX.files._fetchAndEdit(f); }
      this.hide();
    };
    document.getElementById('ctx-edit').onclick     = () => { MKX.files._fetchAndEdit(f); this.hide(); };
    document.getElementById('ctx-copy-url').onclick = () => { MKX.utils.copyText(f.html_url || f.download_url || ''); this.hide(); };
    document.getElementById('ctx-download').onclick = () => { MKX.files.download(f.download_url, f.name); this.hide(); };
    document.getElementById('ctx-rename').onclick   = () => { MKX.notify.info('Rename: create new file + delete old.'); this.hide(); };
    document.getElementById('ctx-delete').onclick   = () => { MKX.files.promptDelete(f); this.hide(); };
  },

  _position(event, visibleItems) {
    const menu = document.getElementById('ctx-menu');
    if (!menu) return;
    menu.classList.remove('hidden');
    menu.querySelectorAll('.ctx-item[id]').forEach(el => {
      const key = el.id.replace('ctx-', '');
      el.style.display = visibleItems.includes(key) ? '' : 'none';
    });
    const x = Math.min(event.clientX, window.innerWidth  - 200);
    const y = Math.min(event.clientY, window.innerHeight - 200);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
  },

  hide() { document.getElementById('ctx-menu')?.classList.add('hidden'); },
};

document.addEventListener('click',   () => MKX.ctx.hide());
document.addEventListener('keydown', e => { if (e.key === 'Escape') MKX.ctx.hide(); });

// ═══════════════════════════════════════════════════════════
//  COMMAND PALETTE
// ═══════════════════════════════════════════════════════════

MKX.cmd = {
  commands: [
    { label: 'Dashboard',        desc: 'View overview & stats',       icon: 'fa-chart-pie',      action: () => MKX.router.go('dashboard'),          kbd: 'D' },
    { label: 'Repositories',     desc: 'Browse all repositories',     icon: 'fa-code-branch',    action: () => MKX.router.go('repos'),              kbd: 'R' },
    { label: 'File Manager',     desc: 'Open file browser',           icon: 'fa-folder-open',    action: () => MKX.router.go('files'),              kbd: 'F' },
    { label: 'New Repository',   desc: 'Create a new repository',     icon: 'fa-plus',           action: () => MKX.modals.createRepo(),             kbd: 'N' },
    { label: 'Refresh All',      desc: 'Reload repos + API limit',    icon: 'fa-sync-alt',       action: () => MKX.ui.refreshAll(),                 kbd: '' },
    { label: 'Check API Limit',  desc: 'Refresh rate limit counter',  icon: 'fa-tachometer-alt', action: () => MKX.api.refreshRateLimit(),          kbd: '' },
    { label: 'Open GitHub',      desc: 'github.com in new tab',       icon: 'fab fa-github',     action: () => window.open('https://github.com', '_blank'), kbd: '' },
    { label: 'Logout',           desc: 'End session securely',        icon: 'fa-sign-out-alt',   action: () => window.location.href = 'logout.php', kbd: '' },
  ],
  _sel: 0,
  _cur: [],

  open() {
    const el = document.getElementById('cmd-palette');
    const inp = document.getElementById('cmd-input');
    if (!el || !inp) return;
    el.classList.remove('hidden');
    inp.value = '';
    this._cur = [...this.commands];
    this._sel = 0;
    this._render();
    setTimeout(() => inp.focus(), 50);
  },

  close() { document.getElementById('cmd-palette')?.classList.add('hidden'); },

  filter(q) {
    const lq = q.toLowerCase();
    this._cur = !lq ? [...this.commands] : this.commands.filter(c =>
      c.label.toLowerCase().includes(lq) || c.desc.toLowerCase().includes(lq)
    );
    this._sel = 0;
    this._render();
  },

  _render() {
    const el = document.getElementById('cmd-results');
    if (!el) return;
    el.innerHTML = this._cur.length ? this._cur.map((c, i) => `
      <div class="cmd-item${i === this._sel ? ' selected' : ''}" data-ci="${i}">
        <div class="cmd-item-icon"><i class="fas ${c.icon}"></i></div>
        <div>
          <div class="cmd-item-label">${MKX.utils.escHtml(c.label)}</div>
          <div class="cmd-item-desc">${MKX.utils.escHtml(c.desc)}</div>
        </div>
        ${c.kbd ? `<span class="cmd-kbd">${c.kbd}</span>` : ''}
      </div>`).join('')
      : '<div style="text-align:center;padding:24px;color:#475569">No results</div>';

    el.querySelectorAll('.cmd-item').forEach(item => {
      item.addEventListener('click', () => this._exec(parseInt(item.dataset.ci)));
    });
  },

  _exec(i) { const c = this._cur[i]; if (c) { this.close(); c.action(); } },

  keydown(e) {
    if (e.key === 'ArrowDown')  { e.preventDefault(); this._sel = Math.min(this._sel + 1, this._cur.length - 1); this._render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this._sel = Math.max(this._sel - 1, 0); this._render(); }
    else if (e.key === 'Enter') { this._exec(this._sel); }
    else if (e.key === 'Escape') { this.close(); }
  },
};

document.getElementById('cmd-palette')?.addEventListener('click', e => {
  if (e.target === document.getElementById('cmd-palette')) MKX.cmd.close();
});

// ═══════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); MKX.cmd.open(); return; }
  if (e.key === 'Escape') {
    MKX.cmd.close();
    ['modal-create-repo','modal-rename','modal-delete','modal-new-file','modal-new-folder','modal-repo-detail'].forEach(id => MKX.modals.close(id));
    return;
  }
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'd' && !e.ctrlKey && !e.metaKey) MKX.router.go('dashboard');
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey) MKX.router.go('repos');
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey) MKX.modals.createRepo();
});

// ═══════════════════════════════════════════════════════════
//  THREE.JS BACKGROUND
// ═══════════════════════════════════════════════════════════

MKX.three = {
  init() {
    const canvas = document.getElementById('mkx-canvas');
    if (!canvas || typeof THREE === 'undefined') return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x0F172A, 1);

    const scene  = new THREE.Scene();
    scene.fog    = new THREE.FogExp2(0x0F172A, 0.007);
    const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 0, 80);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * 800;
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x334155, size: 0.9, transparent: true, opacity: 0.6 })));

    // Grid
    const grid = new THREE.GridHelper(400, 40, 0x1E293B, 0x1E293B);
    grid.position.y = -60;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    scene.add(grid);

    // Floating orbs
    const orbs = [];
    const oc   = [0x2563EB, 0x7C3AED, 0x06B6D4];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(Math.random() * 3 + 1, 12, 12),
        new THREE.MeshBasicMaterial({ color: oc[i % 3], transparent: true, opacity: 0.05 + Math.random() * 0.07, wireframe: Math.random() > 0.5 })
      );
      m.position.set((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 40);
      m.userData.sx = (Math.random() - 0.5) * 0.003;
      m.userData.sy = (Math.random() - 0.5) * 0.002;
      scene.add(m);
      orbs.push(m);
    }

    let mx = 0, my = 0;
    document.addEventListener('mousemove', e => {
      mx = (e.clientX / window.innerWidth  - 0.5) * 10;
      my = (e.clientY / window.innerHeight - 0.5) * -6;
    });

    let t = 0;
    (function animate() {
      requestAnimationFrame(animate);
      t += 0.005;
      grid.position.z = (t * 8) % 10;
      orbs.forEach(o => {
        o.rotation.x += o.userData.sx;
        o.rotation.y += o.userData.sy;
        o.position.y  += Math.sin(t + o.position.x) * 0.01;
      });
      camera.position.x += (mx - camera.position.x) * 0.01;
      camera.position.y += (my - camera.position.y) * 0.01;
      camera.lookAt(scene.position);
      renderer.render(scene, camera);
    })();

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  },
};

// ═══════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // Hide loader, reveal app
  setTimeout(() => {
    document.getElementById('loading-screen')?.classList.add('fade-out');
    const shell = document.getElementById('app-shell');
    if (shell) gsap.to(shell, { opacity: 1, duration: 0.5, ease: 'power2.out' });

    gsap.from('#profile-card', { y: 20, opacity: 0, duration: 0.6, ease: 'power3.out', delay: 0.1 });
    gsap.from('.stat-card',    { y: 15, opacity: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out', delay: 0.2 });
  }, 1600);

  // Three.js
  MKX.three.init();

  // Load data
  setTimeout(async () => {
    await MKX.repos.load();
    await MKX.api.refreshRateLimit();

    // Animate profile counters
    const u = window.MKX_CONFIG?.user || {};
    MKX.utils.animateCounter(document.getElementById('prof-followers'), parseInt(u.followers   || 0));
    MKX.utils.animateCounter(document.getElementById('prof-following'), parseInt(u.following   || 0));
    MKX.utils.animateCounter(document.getElementById('prof-repos'),     parseInt(u.public_repos || 0));
  }, 1800);

  // Auto-refresh rate limit every 2 min
  setInterval(() => MKX.api.refreshRateLimit(), 120000);

  // Topbar search
  document.getElementById('topbar-search')?.addEventListener('input', e => MKX.repos.search(e.target.value));

  // Sort & filter dropdowns
  document.getElementById('sort-repos')?.addEventListener('change', e => MKX.repos.sortRepos(e.target.value));
  document.getElementById('filter-visibility')?.addEventListener('change', e => MKX.repos.filterRepos(e.target.value));

  // New file/folder confirm buttons
  document.querySelector('#modal-new-file .btn-success')?.addEventListener('click', () => MKX.files.confirmCreateFile());
  document.querySelector('#modal-new-folder .btn-accent')?.addEventListener('click', () => MKX.files.confirmCreateFolder());

  // Create repo confirm
  document.getElementById('create-repo-btn')?.addEventListener('click', () => MKX.repos.create());

  // Rename confirm (modal footer button)
  document.querySelector('#modal-rename .btn-accent')?.addEventListener('click', async () => {
    if (typeof MKX._renameAction === 'function') await MKX._renameAction();
  });

  // File filter input
  document.getElementById('file-filter')?.addEventListener('input', e => MKX.files.filterFiles(e.target.value));

  // Command palette input
  document.getElementById('cmd-input')?.addEventListener('input',   e => MKX.cmd.filter(e.target.value));
  document.getElementById('cmd-input')?.addEventListener('keydown', e => MKX.cmd.keydown(e));
});

// ═══════════════════════════════════════════════════════════
//  🔍 MULTI-REPO CODE SEARCH
// ═══════════════════════════════════════════════════════════

MKX.search = {
  async run() {
    const q   = document.getElementById('code-search-input')?.value?.trim();
    const res = document.getElementById('code-search-results');
    if (!q) { MKX.notify.warn('Enter a search query.'); return; }
    if (!res) return;

    res.innerHTML = `<div style="text-align:center;padding:40px;color:#475569">
      <i class="fas fa-spinner animate-spin" style="font-size:2rem;margin-bottom:10px;display:block"></i>
      Searching across all your repos...
    </div>`;

    const btn = document.getElementById('code-search-btn');
    MKX.ui.setLoading(btn, true);

    try {
      const data = await MKX.api.get('code_search', { q });
      const items = data?.items || [];

      if (items.length === 0) {
        res.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B">
          <i class="fas fa-search" style="font-size:2.5rem;opacity:0.3;margin-bottom:10px;display:block"></i>
          No results found for <strong style="color:#06B6D4">"${MKX.utils.escHtml(q)}"</strong>
        </div>`;
        return;
      }

      res.innerHTML = `
        <div style="font-size:0.8rem;color:#64748B;margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-check-circle" style="color:#10B981"></i>
          Found <strong style="color:#E2E8F0">${items.length}</strong> results for
          <code style="background:rgba(6,182,212,0.1);color:#06B6D4;padding:2px 8px;border-radius:4px">${MKX.utils.escHtml(q)}</code>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px" id="search-results-list"></div>`;

      const list = document.getElementById('search-results-list');
      list.innerHTML = items.map((item, i) => {
        const repo     = item.repository?.full_name || '';
        const filePath = item.path || '';
        const fileName = filePath.split('/').pop();
        const { cls, icon } = MKX.utils.fileIconInfo(fileName, 'file');
        return `
        <div class="glass-card" style="padding:14px 18px;cursor:pointer;border-left:3px solid rgba(6,182,212,0.4)" data-srci="${i}">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <div class="file-icon ${cls}" style="width:26px;height:26px;font-size:0.75rem;flex-shrink:0"><i class="fas ${icon}"></i></div>
            <div style="flex:1;min-width:0">
              <span style="font-weight:600;color:#06B6D4;font-family:'JetBrains Mono',monospace;font-size:0.85rem">${MKX.utils.escHtml(fileName)}</span>
              <span style="color:#475569;font-size:0.75rem;margin-left:8px">${MKX.utils.escHtml(filePath)}</span>
            </div>
            <span style="font-size:0.72rem;background:rgba(37,99,235,0.12);color:#93C5FD;padding:2px 8px;border-radius:4px;white-space:nowrap;flex-shrink:0">
              <i class="fab fa-github" style="margin-right:4px"></i>${MKX.utils.escHtml(repo)}
            </span>
          </div>
          <div style="font-size:0.72rem;color:#64748B;font-family:'JetBrains Mono',monospace;display:flex;gap:10px">
            <span><i class="fas fa-external-link-alt" style="margin-right:4px;color:#2563EB"></i>Click to open on GitHub</span>
            <span style="color:#10B981"><i class="fas fa-folder-open" style="margin-right:4px"></i>Open in File Manager</span>
          </div>
        </div>`;
      }).join('');

      // Attach click events
      list.querySelectorAll('[data-srci]').forEach(el => {
        const i    = parseInt(el.dataset.srci);
        const item = items[i];
        el.addEventListener('click', () => {
          const [owner, repoName] = (item.repository?.full_name || '/').split('/');
          MKX.files.openRepo(owner, repoName);
        });
      });

      gsap.fromTo('#search-results-list > div',
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.35, stagger: 0.06, ease: 'power2.out' }
      );

    } catch (e) {
      res.innerHTML = `<div style="text-align:center;padding:40px;color:#EF4444">
        <i class="fas fa-exclamation-triangle" style="font-size:2rem;margin-bottom:8px;display:block"></i>
        ${MKX.utils.escHtml(e.message)}
      </div>`;
      MKX.notify.error('Search failed: ' + e.message);
    } finally {
      MKX.ui.setLoading(btn, false);
    }
  },
};

// ═══════════════════════════════════════════════════════════
//  📊 ANALYTICS
// ═══════════════════════════════════════════════════════════

MKX.analytics = {
  render() {
    const repos = MKX.state.repos;
    if (!repos.length) { MKX.notify.info('Loading repos first...'); MKX.repos.load().then(() => this.render()); return; }

    // Stats
    const pub    = repos.filter(r => !r.private).length;
    const priv   = repos.filter(r => r.private).length;
    const stars  = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
    const forks  = repos.reduce((s, r) => s + (r.forks_count || 0), 0);

    MKX.utils.animateCounter(document.getElementById('an-public'),  pub);
    MKX.utils.animateCounter(document.getElementById('an-private'), priv);
    MKX.utils.animateCounter(document.getElementById('an-stars'),   stars);
    MKX.utils.animateCounter(document.getElementById('an-forks'),   forks);

    this._renderLanguageChart(repos);
    this._renderStarsLeaderboard(repos);
    this._renderVisibilityDonut(pub, priv);
    this._renderRecentActivity(repos);
    this._renderPins(repos);
  },

  _renderLanguageChart(repos) {
    const el = document.getElementById('lang-chart');
    if (!el) return;

    // Aggregate language counts
    const langMap = {};
    repos.forEach(r => { if (r.language) langMap[r.language] = (langMap[r.language] || 0) + 1; });
    const sorted = Object.entries(langMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const total  = sorted.reduce((s, [, c]) => s + c, 0);

    if (!sorted.length) { el.innerHTML = '<div style="color:#475569;font-size:0.85rem">No language data available</div>'; return; }

    el.innerHTML = sorted.map(([lang, count]) => {
      const pct   = Math.round(count / total * 100);
      const color = MKX.utils.langColor(lang);
      return `
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:0.8rem;display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
            ${MKX.utils.escHtml(lang)}
          </span>
          <span style="font-size:0.75rem;color:#64748B;font-family:'JetBrains Mono',monospace">${count} repo${count > 1 ? 's' : ''} · ${pct}%</span>
        </div>
        <div style="height:6px;background:rgba(148,163,184,0.1);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:0%;background:${color};border-radius:99px;transition:width 0.8s ease;box-shadow:0 0 6px ${color}55" data-w="${pct}%"></div>
        </div>
      </div>`;
    }).join('');

    // Animate bars
    requestAnimationFrame(() => {
      el.querySelectorAll('[data-w]').forEach(bar => {
        setTimeout(() => { bar.style.width = bar.dataset.w; }, 100);
      });
    });
  },

  _renderStarsLeaderboard(repos) {
    const el = document.getElementById('stars-leaderboard');
    if (!el) return;
    const top = [...repos].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)).slice(0, 6);
    const max = top[0]?.stargazers_count || 1;

    el.innerHTML = top.map((r, i) => {
      const pct   = Math.round((r.stargazers_count || 0) / max * 100);
      const medal = ['🥇','🥈','🥉'][i] || `#${i+1}`;
      return `
      <div style="display:flex;align-items:center;gap:10px;cursor:pointer" class="lb-item" data-repo='${JSON.stringify({owner: r.owner?.login, name: r.name}).replace(/'/g,"&apos;")}'>
        <span style="font-size:0.9rem;width:20px;text-align:center;flex-shrink:0">${medal}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.8rem;font-weight:600;truncate:true;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MKX.utils.escHtml(r.name)}</div>
          <div style="height:4px;background:rgba(148,163,184,0.1);border-radius:99px;margin-top:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#F59E0B,#EF4444);border-radius:99px"></div>
          </div>
        </div>
        <span style="font-size:0.75rem;color:#F59E0B;font-family:'JetBrains Mono',monospace;flex-shrink:0">⭐ ${r.stargazers_count || 0}</span>
      </div>`;
    }).join('') || '<div style="color:#475569;font-size:0.85rem">No starred repos found</div>';

    el.querySelectorAll('.lb-item').forEach(item => {
      item.addEventListener('click', () => {
        const d = JSON.parse(item.dataset.repo);
        MKX.files.openRepo(d.owner, d.name);
      });
    });
  },

  _renderVisibilityDonut(pub, priv) {
    const el = document.getElementById('visibility-chart');
    if (!el) return;
    const total  = pub + priv || 1;
    const pubPct = Math.round(pub / total * 100);
    const privPct = 100 - pubPct;
    const pubDeg = Math.round(pub / total * 360);

    el.innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;justify-content:center">
      <div style="width:110px;height:110px;border-radius:50%;background:conic-gradient(#10B981 0deg ${pubDeg}deg, #7C3AED ${pubDeg}deg 360deg);position:relative;box-shadow:0 0 20px rgba(16,185,129,0.2)">
        <div style="position:absolute;inset:18px;border-radius:50%;background:rgba(15,23,42,0.95);display:flex;align-items:center;justify-content:center;flex-direction:column">
          <div style="font-family:'Rajdhani',sans-serif;font-size:1.3rem;font-weight:700;color:#E2E8F0">${total}</div>
          <div style="font-size:0.55rem;color:#64748B;letter-spacing:1px">REPOS</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:10px;height:10px;border-radius:50%;background:#10B981"></div>
          <span style="font-size:0.82rem">Public <strong style="color:#10B981">${pub}</strong> (${pubPct}%)</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:10px;height:10px;border-radius:50%;background:#7C3AED"></div>
          <span style="font-size:0.82rem">Private <strong style="color:#7C3AED">${priv}</strong> (${privPct}%)</span>
        </div>
      </div>
    </div>`;
  },

  _renderRecentActivity(repos) {
    const el = document.getElementById('recent-activity');
    if (!el) return;
    const recent = [...repos].sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at)).slice(0, 6);

    el.innerHTML = recent.map(r => `
    <div style="display:flex;align-items:center;gap:10px;padding:5px 0;cursor:pointer" class="ra-item" data-owner="${MKX.utils.escHtml(r.owner?.login||'')}" data-repo="${MKX.utils.escHtml(r.name)}">
      <i class="fas fa-circle" style="font-size:0.4rem;color:${r.private ? '#7C3AED' : '#10B981'};flex-shrink:0"></i>
      <span style="flex:1;font-size:0.82rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${MKX.utils.escHtml(r.name)}</span>
      <span style="font-size:0.7rem;color:#475569;flex-shrink:0">${MKX.utils.formatDate(r.pushed_at)}</span>
    </div>`).join('');

    el.querySelectorAll('.ra-item').forEach(item => {
      item.addEventListener('click', () => MKX.files.openRepo(item.dataset.owner, item.dataset.repo));
    });
  },

  _renderPins(repos) {
    const el    = document.getElementById('pinned-repos-list');
    if (!el) return;
    const pins  = MKX.pins.list();
    const pinned = repos.filter(r => pins.includes(r.full_name));

    if (!pinned.length) {
      el.innerHTML = '<div style="color:#475569;font-size:0.85rem;padding:8px">No pinned repos yet. Click 📌 on any repo card to pin it.</div>';
      return;
    }
    el.innerHTML = pinned.map(r => `
    <div class="glass-card" style="padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;min-width:180px" data-owner="${MKX.utils.escHtml(r.owner?.login||'')}" data-repo="${MKX.utils.escHtml(r.name)}">
      <i class="fas fa-thumbtack" style="color:#F59E0B;font-size:0.8rem"></i>
      <span style="font-size:0.85rem;font-weight:600;color:#06B6D4">${MKX.utils.escHtml(r.name)}</span>
      <span style="font-size:0.7rem;color:#64748B">${r.private ? '🔒' : '🌐'}</span>
    </div>`).join('');

    el.querySelectorAll('[data-repo]').forEach(item => {
      item.addEventListener('click', () => MKX.files.openRepo(item.dataset.owner, item.dataset.repo));
    });
  },
};

// ═══════════════════════════════════════════════════════════
//  📌 PINNED REPOS
// ═══════════════════════════════════════════════════════════

MKX.pins = {
  _pins: [],

  list() { return this._pins; },

  async toggle(fullName) {
    try {
      const data = await MKX.api.post('toggle_pin', {}, { full_name: fullName });
      this._pins = data.pins || [];
      MKX.notify.success(data.action === 'pinned' ? `📌 Pinned!` : `Unpinned.`);
      this._updateAllPinButtons();
    } catch (e) {
      MKX.notify.error('Pin failed: ' + e.message);
    }
  },

  async load() {
    try {
      const data = await MKX.api.get('get_pins');
      this._pins  = (data.pins || []).map(p => p.replace(/_/g, '/'));
    } catch (_) {}
  },

  isPinned(fullName) { return this._pins.includes(fullName); },

  _updateAllPinButtons() {
    document.querySelectorAll('[data-pin-full]').forEach(btn => {
      const fn = btn.dataset.pinFull;
      const pinned = this.isPinned(fn);
      btn.style.color = pinned ? '#F59E0B' : '';
      btn.title = pinned ? 'Unpin repo' : 'Pin repo';
    });
  },
};

// ═══════════════════════════════════════════════════════════
//  📋 CODE TEMPLATES
// ═══════════════════════════════════════════════════════════

MKX.templates = {
  _map: {
    html5: {
      name: 'index.html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Document</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n\n  <h1>Hello World</h1>\n\n  <script src="script.js"><\/script>\n</body>\n</html>`,
    },
    tailwind: {
      name: 'index.html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>App</title>\n  <script src="https://cdn.tailwindcss.com"><\/script>\n</head>\n<body class="bg-gray-900 text-white min-h-screen">\n\n  <div class="container mx-auto px-4 py-8">\n    <h1 class="text-3xl font-bold text-blue-400">Hello World</h1>\n  </div>\n\n</body>\n</html>`,
    },
    cssreset: {
      name: 'style.css',
      content: `/* CSS Reset + Custom Variables */\n*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n\n:root {\n  --color-primary: #2563EB;\n  --color-secondary: #7C3AED;\n  --color-accent: #06B6D4;\n  --color-bg: #0F172A;\n  --color-text: #E2E8F0;\n  --font-body: 'Segoe UI', sans-serif;\n  --radius: 8px;\n  --transition: all 0.25s ease;\n}\n\nhtml { scroll-behavior: smooth; }\nbody { font-family: var(--font-body); background: var(--color-bg); color: var(--color-text); line-height: 1.6; }`,
    },
    jsmodule: {
      name: 'module.js',
      content: `/**\n * Module: Description here\n * Author: \n */\n\n'use strict';\n\nconst MyModule = {\n  state: {},\n\n  init() {\n    console.log('Module initialized');\n  },\n\n  async fetchData(url) {\n    try {\n      const res  = await fetch(url);\n      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);\n      return await res.json();\n    } catch (err) {\n      console.error('Fetch error:', err);\n      throw err;\n    }\n  },\n};\n\nexport default MyModule;`,
    },
    jsfetch: {
      name: 'api.js',
      content: `// Fetch API Template\n\nconst API_BASE = 'https://api.example.com';\n\nasync function apiCall(endpoint, method = 'GET', body = null) {\n  const opts = {\n    method,\n    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${getToken()}\` },\n  };\n  if (body) opts.body = JSON.stringify(body);\n\n  const res  = await fetch(API_BASE + endpoint, opts);\n  const data = await res.json();\n  if (!res.ok) throw new Error(data.message || 'API Error');\n  return data;\n}\n\nfunction getToken() { return localStorage.getItem('token') || ''; }\n\nexport { apiCall };`,
    },
    react: {
      name: 'Component.jsx',
      content: `import { useState, useEffect } from 'react';\n\nfunction Component({ title = 'Component' }) {\n  const [data, setData]   = useState(null);\n  const [loading, setLoading] = useState(true);\n\n  useEffect(() => {\n    // Fetch data on mount\n    async function load() {\n      try {\n        // const result = await fetch('/api/data').then(r => r.json());\n        // setData(result);\n      } catch (err) {\n        console.error(err);\n      } finally {\n        setLoading(false);\n      }\n    }\n    load();\n  }, []);\n\n  if (loading) return <div>Loading...</div>;\n\n  return (\n    <div className="p-4">\n      <h1 className="text-2xl font-bold">{title}</h1>\n      <pre>{JSON.stringify(data, null, 2)}</pre>\n    </div>\n  );\n}\n\nexport default Component;`,
    },
    phpclass: {
      name: 'MyClass.php',
      content: `<?php\n\ndeclare(strict_types=1);\n\nnamespace App;\n\n/**\n * Class MyClass\n */\nclass MyClass\n{\n    private string $name;\n    private array  $data = [];\n\n    public function __construct(string $name)\n    {\n        $this->name = $name;\n    }\n\n    public function getName(): string\n    {\n        return $this->name;\n    }\n\n    public function setData(array $data): self\n    {\n        $this->data = $data;\n        return $this;\n    }\n\n    public function getData(): array\n    {\n        return $this->data;\n    }\n}`,
    },
    phpapi: {
      name: 'endpoint.php',
      content: `<?php\n\nheader('Content-Type: application/json');\nheader('X-Content-Type-Options: nosniff');\n\n// CORS (adjust as needed)\nheader('Access-Control-Allow-Origin: *');\nheader('Access-Control-Allow-Methods: GET, POST, PUT, DELETE');\n\n$method = $_SERVER['REQUEST_METHOD'];\n$body   = json_decode(file_get_contents('php://input'), true) ?? [];\n\nfunction respond(int $code, mixed $data): void {\n    http_response_code($code);\n    echo json_encode($data);\n    exit;\n}\n\nswitch ($method) {\n    case 'GET':\n        respond(200, ['message' => 'OK', 'data' => []]);\n    case 'POST':\n        respond(201, ['message' => 'Created']);\n    default:\n        respond(405, ['error' => 'Method not allowed']);\n}`,
    },
    phpconfig: {
      name: 'config.php',
      content: `<?php\n\ndeclare(strict_types=1);\n\nreturn [\n    'app' => [\n        'name'    => 'My App',\n        'version' => '1.0.0',\n        'debug'   => false,\n        'url'     => 'https://example.com',\n    ],\n    'db' => [\n        'host'     => getenv('DB_HOST') ?: 'localhost',\n        'port'     => (int)(getenv('DB_PORT') ?: 3306),\n        'name'     => getenv('DB_NAME') ?: 'myapp',\n        'user'     => getenv('DB_USER') ?: 'root',\n        'password' => getenv('DB_PASS') ?: '',\n    ],\n    'security' => [\n        'secret_key'  => getenv('SECRET_KEY') ?: 'change-this-in-production',\n        'token_expiry'=> 3600,\n    ],\n];`,
    },
    python: {
      name: 'script.py',
      content: `#!/usr/bin/env python3\n"""Script description here."""\n\nimport sys\nimport json\nimport argparse\n\n\ndef parse_args():\n    parser = argparse.ArgumentParser(description=__doc__)\n    parser.add_argument('--input',  '-i', required=True, help='Input file')\n    parser.add_argument('--output', '-o', default='output.json', help='Output file')\n    parser.add_argument('--verbose','-v', action='store_true')\n    return parser.parse_args()\n\n\ndef main():\n    args = parse_args()\n    if args.verbose:\n        print(f'Processing: {args.input}', file=sys.stderr)\n\n    # Your logic here\n    result = {}\n\n    with open(args.output, 'w') as f:\n        json.dump(result, f, indent=2)\n    print(f'Done: {args.output}')\n\n\nif __name__ == '__main__':\n    main()`,
    },
    readme: {
      name: 'README.md',
      content: `# Project Name\n\n> Short description of the project.\n\n## Features\n\n- Feature one\n- Feature two\n- Feature three\n\n## Installation\n\n\`\`\`bash\ngit clone https://github.com/username/repo.git\ncd repo\nnpm install\n\`\`\`\n\n## Usage\n\n\`\`\`bash\nnpm start\n\`\`\`\n\n## API\n\n| Endpoint | Method | Description |\n|---|---|---|\n| \`/api/v1/users\` | GET | List users |\n| \`/api/v1/users\` | POST | Create user |\n\n## License\n\nMIT © [Your Name](https://github.com/username)`,
    },
    gitignore: {
      name: '.gitignore',
      content: `# Node\nnode_modules/\ndist/\nbuild/\n.npm\nnpm-debug.log*\n\n# PHP / Composer\nvendor/\ncomposer.lock\n\n# Environment\n.env\n.env.local\n.env.*.local\n\n# IDE\n.vscode/\n.idea/\n*.swp\n*.swo\n\n# OS\n.DS_Store\nThumbs.db\n\n# Logs\nlogs/\n*.log\n\n# Cache\n.cache/\n*.cache`,
    },
    envexample: {
      name: '.env.example',
      content: `# Application\nAPP_NAME=MyApp\nAPP_ENV=development\nAPP_DEBUG=true\nAPP_URL=http://localhost:8000\nSECRET_KEY=your-secret-key-here\n\n# Database\nDB_HOST=localhost\nDB_PORT=3306\nDB_NAME=myapp\nDB_USER=root\nDB_PASS=\n\n# API Keys (replace with real values)\nGITHUB_TOKEN=\nOPENAI_KEY=\nSTRIPE_KEY=\n\n# Mail\nMAIL_HOST=smtp.mailtrap.io\nMAIL_PORT=587\nMAIL_USER=\nMAIL_PASS=`,
    },
  },

  apply(key) {
    const tpl = this._map[key];
    if (!tpl) return;
    const nameEl    = document.getElementById('new-file-name');
    const contentEl = document.getElementById('new-file-content');
    if (nameEl && !nameEl.value) nameEl.value = tpl.name;
    if (contentEl) contentEl.value = tpl.content;
  },
};

// ═══════════════════════════════════════════════════════════
//  👁️ LIVE HTML PREVIEW
// ═══════════════════════════════════════════════════════════

MKX.preview = {
  _active:   false,
  _debounce: null,

  toggle() {
    this._active = !this._active;
    const pane = document.getElementById('preview-pane');
    const btn  = document.getElementById('preview-toggle-btn');
    if (!pane) return;

    if (this._active) {
      pane.style.display = '';
      if (btn) { btn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide'; btn.style.background = 'rgba(6,182,212,0.15)'; }
      this.update();
      // Live update on editor change
      MKX.state.monacoEditor?.onDidChangeModelContent(() => {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this.update(), 600);
      });
    } else {
      pane.style.display = 'none';
      if (btn) { btn.innerHTML = '<i class="fas fa-eye"></i> Preview'; btn.style.background = ''; }
    }
  },

  update() {
    if (!this._active || !MKX.state.monacoEditor) return;
    const content = MKX.state.monacoEditor.getValue();
    const iframe  = document.getElementById('preview-iframe');
    if (!iframe) return;
    const blob = new Blob([content], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    iframe.src = url;
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  showButtonIfHTML(filename) {
    const btn = document.getElementById('preview-toggle-btn');
    if (!btn) return;
    const ext = (filename.split('.').pop() || '').toLowerCase();
    btn.style.display = ['html','htm','svg'].includes(ext) ? '' : 'none';
    // Auto-hide preview pane if switching to non-HTML file
    if (!['html','htm','svg'].includes(ext) && this._active) this.toggle();
  },
};

// ═══════════════════════════════════════════════════════════
//  📦 ONE-CLICK ZIP DOWNLOAD
// ═══════════════════════════════════════════════════════════

MKX.download = {
  async repoZip(owner, repoName) {
    MKX.notify.info(`Preparing ZIP download for ${repoName}...`);
    try {
      const data = await MKX.api.get('zip_url', { owner, repo: repoName });
      if (!data?.url) throw new Error('Could not get download URL');
      const a = document.createElement('a');
      a.href = data.url;
      a.download = `${repoName}.zip`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
      MKX.notify.success(`Downloading ${repoName}.zip...`);
    } catch (e) {
      // Fallback: direct GitHub link
      window.open(`https://github.com/${owner}/${repoName}/archive/refs/heads/main.zip`, '_blank');
      MKX.notify.info('Opening GitHub ZIP download...');
    }
  },
};

// ═══════════════════════════════════════════════════════════
//  PATCH EXISTING FUNCTIONS — Add Pin + ZIP to repo cards
// ═══════════════════════════════════════════════════════════

(function patchRepoCard() {
  const _orig = MKX.repos._cardHTML.bind(MKX.repos);
  MKX.repos._cardHTML = function(r) {
    const base = _orig(r);
    // Inject pin + zip buttons into repo-actions div
    return base.replace(
      '<button class="btn btn-ghost btn-sm rc-github"',
      `<button class="btn btn-ghost btn-sm rc-pin" data-pin-full="${MKX.utils.escHtml(r.full_name)}" title="Pin repo">
        <i class="fas fa-thumbtack" style="font-size:0.85rem"></i>
      </button>
      <button class="btn btn-ghost btn-sm rc-zip" title="Download ZIP">
        <i class="fas fa-file-archive" style="font-size:0.85rem"></i>
      </button>
      <button class="btn btn-ghost btn-sm rc-github"`
    );
  };

  const _origAttach = MKX.repos._attachCardEvents.bind(MKX.repos);
  MKX.repos._attachCardEvents = function(container, repos) {
    _origAttach(container, repos);
    container.querySelectorAll('.repo-card').forEach(card => {
      const id   = parseInt(card.dataset.repoid);
      const repo = this._map[id];
      if (!repo) return;
      card.querySelector('.rc-pin')?.addEventListener('click', e => {
        e.stopPropagation();
        MKX.pins.toggle(repo.full_name);
      });
      card.querySelector('.rc-zip')?.addEventListener('click', e => {
        e.stopPropagation();
        MKX.download.repoZip(repo.owner?.login, repo.name);
      });
    });
    // Update pin button states
    setTimeout(() => MKX.pins._updateAllPinButtons(), 100);
  };
})();

// ═══════════════════════════════════════════════════════════
//  PATCH ROUTER — add search + analytics views
// ═══════════════════════════════════════════════════════════

(function patchRouter() {
  const _origGo = MKX.router.go.bind(MKX.router);
  MKX.router.go = function(view) {
    if (view === 'search' || view === 'analytics') {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.bnav-item').forEach(n => n.classList.remove('active'));

      document.getElementById(`view-${view}`)?.classList.add('active');
      document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
      document.getElementById(`bnav-${view}`)?.classList.add('active');

      this.current = view;
      MKX.ui.closeSidebar();

      if (view === 'analytics') {
        setTimeout(() => MKX.analytics.render(), 100);
      }
      return;
    }
    _origGo(view);
  };
})();

// ═══════════════════════════════════════════════════════════
//  PATCH EDITOR openFile — show preview button + format btn
// ═══════════════════════════════════════════════════════════

(function patchEditor() {
  const _origOpen = MKX.editor.openFile.bind(MKX.editor);
  MKX.editor.openFile = function(fileData) {
    _origOpen(fileData);
    // Show/hide preview button based on file type
    setTimeout(() => MKX.preview.showButtonIfHTML(fileData.name), 200);
  };
})();

// ═══════════════════════════════════════════════════════════
//  PATCH CMD PALETTE — add new commands
// ═══════════════════════════════════════════════════════════

MKX.cmd.commands.splice(2, 0,
  { label: 'Code Search',    desc: 'Search code across all repos', icon: 'fa-search',    action: () => MKX.router.go('search'),    kbd: 'S' },
  { label: 'Analytics',      desc: 'View repo analytics & charts', icon: 'fa-chart-bar', action: () => MKX.router.go('analytics'), kbd: 'A' }
);

// ═══════════════════════════════════════════════════════════
//  BOOT ADDITIONS — wire new UI elements after DOMContentLoaded
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // Code Search
  const codeSearchBtn   = document.getElementById('code-search-btn');
  const codeSearchInput = document.getElementById('code-search-input');
  codeSearchBtn?.addEventListener('click', () => MKX.search.run());
  codeSearchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') MKX.search.run(); });

  // Template selector
  document.getElementById('file-template-select')?.addEventListener('change', e => {
    MKX.templates.apply(e.target.value);
    e.target.value = ''; // reset so user can pick again
  });

  // Create file button (updated modal)
  document.getElementById('create-file-btn')?.addEventListener('click', () => MKX.files.confirmCreateFile());

  // Preview toggle
  document.getElementById('preview-toggle-btn')?.addEventListener('click', () => MKX.preview.toggle());
  document.getElementById('preview-close-btn')?.addEventListener('click',  () => MKX.preview.toggle());

  // Format/Beautify button
  document.getElementById('beautify-btn')?.addEventListener('click', () => {
    if (MKX.state.monacoEditor) {
      MKX.state.monacoEditor.getAction('editor.action.formatDocument')?.run();
      MKX.notify.info('Code formatted!');
    }
  });

  // Load pins on startup
  MKX.pins.load();

  // Keyboard: S = search, A = analytics
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.key === 's' && !e.ctrlKey && !e.metaKey) MKX.router.go('search');
    if (e.key === 'a' && !e.ctrlKey && !e.metaKey) MKX.router.go('analytics');
  });
});

// ═══════════════════════════════════════════════════════════
//  🖥️  SSH TERMINAL MODULE
// ═══════════════════════════════════════════════════════════

MKX.terminal = {

  /* ── state ──────────────────────────────────────────────── */
  _term:      null,
  _fitAddon:  null,
  _connected: false,
  _host:      '',
  _user:      '',
  _cwd:       '~',
  _history:   [],
  _histIdx:   -1,
  _inputBuf:  '',
  _busy:      false,

  /* quick commands list */
  _quickCmds: [
    { label:'ls -la',        icon:'fa-list',          cmd:'ls -la' },
    { label:'pwd',           icon:'fa-map-marker-alt',cmd:'pwd' },
    { label:'df -h',         icon:'fa-hdd',           cmd:'df -h' },
    { label:'free -h',       icon:'fa-memory',        cmd:'free -h' },
    { label:'top -bn1',      icon:'fa-microchip',     cmd:'top -bn1 | head -20' },
    { label:'ps aux',        icon:'fa-tasks',         cmd:'ps aux --sort=-%cpu | head -15' },
    { label:'who',           icon:'fa-users',         cmd:'who' },
    { label:'ifconfig / ip', icon:'fa-network-wired', cmd:'ip addr 2>/dev/null || ifconfig' },
    { label:'cat /etc/os-release', icon:'fa-info-circle', cmd:'cat /etc/os-release' },
    { label:'uptime',        icon:'fa-clock',         cmd:'uptime' },
    { label:'git status',    icon:'fab fa-git-alt',   cmd:'git status 2>/dev/null || echo "Not a git repo"' },
    { label:'git pull',      icon:'fab fa-git-alt',   cmd:'git pull 2>&1' },
    { label:'composer install', icon:'fa-box',        cmd:'composer install 2>&1' },
    { label:'npm install',   icon:'fab fa-node-js',   cmd:'npm install 2>&1' },
    { label:'php -v',        icon:'fab fa-php',       cmd:'php -v' },
    { label:'nginx restart', icon:'fa-server',        cmd:'sudo service nginx restart 2>&1 || sudo systemctl restart nginx 2>&1' },
  ],

  /* ── init: load xterm if needed, setup terminal ─────────── */
  init() {
    if (this._term) return; // already initialised

    // xterm is already loaded via CDN in dashboard.php
    if (typeof Terminal === 'undefined') {
      this._showConnectError('xterm.js failed to load. Check CDN connectivity.');
      return;
    }
    this._setup();
    this._renderQuickCmds();
    this._checkSshExt();
    this._wireButtons();
  },

  _setup() {
    const container = document.getElementById('terminal-container');
    if (!container) return;

    this._term = new Terminal({
      theme: {
        background:          '#0D1117',
        foreground:          '#E6EDF3',
        cursor:              '#58A6FF',
        cursorAccent:        '#0D1117',
        selectionBackground: 'rgba(56,139,253,0.3)',
        black:   '#484F58', brightBlack:   '#6E7681',
        red:     '#FF7B72', brightRed:     '#FFA198',
        green:   '#3FB950', brightGreen:   '#56D364',
        yellow:  '#D29922', brightYellow:  '#E3B341',
        blue:    '#58A6FF', brightBlue:    '#79C0FF',
        magenta: '#BC8CFF', brightMagenta: '#D2A8FF',
        cyan:    '#39C5CF', brightCyan:    '#56D4DD',
        white:   '#B1BAC4', brightWhite:   '#F0F6FC',
      },
      fontFamily:   "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      fontSize:     14,
      lineHeight:   1.5,
      cursorBlink:  true,
      cursorStyle:  'block',
      allowTransparency: true,
      scrollback:   3000,
      convertEol:   true,
    });

    this._fitAddon = new FitAddon.FitAddon();
    this._term.loadAddon(this._fitAddon);
    this._term.open(container);
    this._fitAddon.fit();

    window.addEventListener('resize', () => {
      try { this._fitAddon.fit(); } catch (_) {}
    });

    this._printWelcome();
    this._term.onData(data => this._onData(data));
  },

  _printWelcome() {
    this._term.writeln('\x1b[1;32m╔═══════════════════════════════════════════╗\x1b[0m');
    this._term.writeln('\x1b[1;32m║    MKX GitHub Cloud — SSH Terminal  v1.0  ║\x1b[0m');
    this._term.writeln('\x1b[1;32m╚═══════════════════════════════════════════╝\x1b[0m');
    this._term.writeln('');
    this._term.writeln('\x1b[36m  Enter your server credentials above and click Connect.\x1b[0m');
    this._term.writeln('\x1b[90m  Supports: any Linux/Unix server with SSH access.\x1b[0m');
    this._term.writeln('\x1b[90m  Note: Interactive programs (vim, nano, htop) not supported.\x1b[0m');
    this._term.writeln('');
  },

  /* ── keyboard input handler ─────────────────────────────── */
  _onData(data) {
    if (!this._connected) return;
    if (this._busy) { this._term.write('\x07'); return; } // bell — busy

    const code = data.charCodeAt(0);

    // Enter → send command
    if (data === '\r') {
      const cmd = this._inputBuf.trim();
      this._term.writeln('');
      this._inputBuf = '';
      this._histIdx  = -1;
      if (cmd) {
        this._history.unshift(cmd);
        if (this._history.length > 100) this._history.pop();
        this._execCommand(cmd);
      } else {
        this._printPrompt();
      }
      return;
    }

    // Backspace
    if (data === '\x7f') {
      if (this._inputBuf.length > 0) {
        this._inputBuf = this._inputBuf.slice(0, -1);
        this._term.write('\b \b');
      }
      return;
    }

    // Ctrl+C
    if (data === '\x03') {
      this._inputBuf = '';
      this._term.writeln('^C');
      this._printPrompt();
      return;
    }

    // Ctrl+L → clear
    if (data === '\x0c') { this.clear(); return; }

    // Up arrow → history prev
    if (data === '\x1b[A') {
      if (this._history.length === 0) return;
      this._histIdx = Math.min(this._histIdx + 1, this._history.length - 1);
      this._replaceInput(this._history[this._histIdx] || '');
      return;
    }

    // Down arrow → history next
    if (data === '\x1b[B') {
      this._histIdx = Math.max(this._histIdx - 1, -1);
      this._replaceInput(this._histIdx >= 0 ? (this._history[this._histIdx] || '') : '');
      return;
    }

    // Ignore other escape sequences
    if (data.startsWith('\x1b')) return;

    // Regular printable character
    if (code >= 32) {
      this._inputBuf += data;
      this._term.write(data);
    }
  },

  _replaceInput(newVal) {
    // Clear current input from terminal
    this._term.write('\r\x1b[K');
    this._printPromptInline();
    this._inputBuf = newVal;
    this._term.write(newVal);
  },

  /* ── execute command via PHP API ────────────────────────── */
  async _execCommand(cmd) {
    this._busy = true;

    // Local built-ins
    if (cmd === 'clear' || cmd === 'cls') { this.clear(); this._busy = false; return; }
    if (cmd === 'history') {
      this._history.forEach((h, i) => this._term.writeln(`  ${String(i+1).padStart(3)} ${h}`));
      this._printPrompt(); this._busy = false; return;
    }
    if (cmd === 'help') { this._printHelp(); this._printPrompt(); this._busy = false; return; }
    if (cmd === 'exit' || cmd === 'logout') { this.disconnect(); this._busy = false; return; }

    // Show spinner
    this._term.write('\x1b[90m⟳ running...\x1b[0m\r');

    try {
      const res = await fetch(`${CFG.apiBase}?action=ssh_exec`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrfToken },
        body:    JSON.stringify({ command: cmd, cwd: this._cwd }),
      });
      const data = await res.json();

      // Clear spinner line
      this._term.write('\x1b[2K\r');

      if (data.reconnect) {
        this._setConnected(false);
        this._term.writeln('\x1b[31m✗ Connection lost. Please reconnect.\x1b[0m');
        this._busy = false;
        return;
      }

      const output = data.output || '';
      if (output) this._term.writeln(output);

      // Update cwd if returned
      if (data.cwd) this._cwd = data.cwd;

    } catch (e) {
      this._term.write('\x1b[2K\r');
      this._term.writeln(`\x1b[31m✗ Network error: ${e.message}\x1b[0m`);
    }

    this._busy = false;
    this._printPrompt();
  },

  _printPrompt() {
    const dir = this._cwd.replace(/^\/home\/[^/]+/, '~').replace(/^\/root/, '~');
    this._term.write(`\r\n\x1b[1;32m${this._user}@${this._host}\x1b[0m:\x1b[1;34m${dir}\x1b[0m\x1b[1;32m$\x1b[0m `);
  },

  _printPromptInline() {
    const dir = this._cwd.replace(/^\/home\/[^/]+/, '~').replace(/^\/root/, '~');
    this._term.write(`\x1b[1;32m${this._user}@${this._host}\x1b[0m:\x1b[1;34m${dir}\x1b[0m\x1b[1;32m$\x1b[0m `);
  },

  _printHelp() {
    const lines = [
      '', '\x1b[1;36m  MKX SSH Terminal — Built-in commands:\x1b[0m',
      '  \x1b[33mclear\x1b[0m      — Clear terminal screen',
      '  \x1b[33mhistory\x1b[0m    — Show command history',
      '  \x1b[33mexit\x1b[0m       — Disconnect from server',
      '  \x1b[33m↑ / ↓\x1b[0m      — Navigate command history',
      '  \x1b[33mCtrl+C\x1b[0m     — Cancel current input',
      '  \x1b[33mCtrl+L\x1b[0m     — Clear screen',
      '', '  \x1b[90mAll other commands are executed on the remote server.\x1b[0m',
      '  \x1b[90mInteractive programs (vim, nano, htop) are not supported.\x1b[0m', '',
    ];
    lines.forEach(l => this._term.writeln(l));
  },

  /* ── connect to server ──────────────────────────────────── */
  async connect() {
    const host = document.getElementById('ssh-host')?.value?.trim();
    const port = parseInt(document.getElementById('ssh-port')?.value || '22');
    const user = document.getElementById('ssh-user')?.value?.trim();
    const pass = document.getElementById('ssh-pass')?.value;

    if (!host || !user) { MKX.notify.warn('Host and Username are required.'); return; }

    if (!this._term) this.init();

    const btn = document.getElementById('ssh-connect-btn');
    MKX.ui.setLoading(btn, true);

    this._term.writeln('');
    this._term.writeln(`\x1b[36m  Connecting to \x1b[1m${user}@${host}:${port}\x1b[0m\x1b[36m...\x1b[0m`);

    try {
      const res = await fetch(`${CFG.apiBase}?action=ssh_connect`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrfToken },
        body:    JSON.stringify({ host, port, username: user, password: pass }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        this._term.writeln(`\x1b[31m  ✗ ${data.error || 'Connection failed'}\x1b[0m\r\n`);
        MKX.notify.error(data.error || 'SSH connection failed');
        return;
      }

      // Connected!
      this._host = host;
      this._user = user;
      this._cwd  = '~';
      this._setConnected(true);

      if (data.info) {
        data.info.split('\n').forEach(l => {
          if (l.trim()) this._term.writeln(`  \x1b[90m${l.trim()}\x1b[0m`);
        });
      }
      this._term.writeln('');
      this._term.writeln(`\x1b[32m  ✓ Connected! Type \x1b[1mhelp\x1b[0m\x1b[32m to see built-in commands.\x1b[0m`);

      // Update title
      const titleEl = document.getElementById('term-title');
      if (titleEl) titleEl.textContent = `ssh — ${user}@${host}`;

      this._printPrompt();
      this._term.focus();

    } catch (e) {
      this._term.writeln(`\x1b[31m  ✗ Network error: ${e.message}\x1b[0m`);
      MKX.notify.error('Network error: ' + e.message);
    } finally {
      MKX.ui.setLoading(btn, false);
    }
  },

  /* ── disconnect ─────────────────────────────────────────── */
  async disconnect() {
    try { await MKX.api.post('ssh_disconnect', {}, {}); } catch (_) {}
    this._setConnected(false);
    this._cwd = '~';
    this._term.writeln('\r\n\x1b[33m  Connection closed.\x1b[0m\r\n');
    const titleEl = document.getElementById('term-title');
    if (titleEl) titleEl.textContent = 'ssh — not connected';
    MKX.notify.info('SSH disconnected.');
  },

  /* ── send a quick command ───────────────────────────────── */
  runQuick(cmd) {
    if (!this._connected) { MKX.notify.warn('Connect to a server first.'); return; }
    if (this._busy) { MKX.notify.warn('Terminal busy — wait for current command.'); return; }
    // Simulate typing the command
    this._printPrompt();
    this._term.write(cmd);
    this._term.writeln('');
    this._inputBuf = '';
    this._execCommand(cmd);
    this._term.focus();
  },

  /* ── clear terminal ─────────────────────────────────────── */
  clear() {
    this._term.clear();
    if (this._connected) this._printPrompt();
    this._term.focus();
  },

  /* ── fullscreen toggle ──────────────────────────────────── */
  toggleFullscreen() {
    const view = document.getElementById('view-terminal');
    if (!view) return;
    view.classList.toggle('term-fullscreen');
    const btn = document.getElementById('term-fullscreen-btn');
    if (btn) btn.innerHTML = view.classList.contains('term-fullscreen')
      ? '<i class="fas fa-compress"></i>'
      : '<i class="fas fa-expand"></i>';
    setTimeout(() => { try { this._fitAddon?.fit(); } catch (_) {} }, 100);
  },

  /* ── update connected state ─────────────────────────────── */
  _setConnected(yes) {
    this._connected = yes;
    this._busy      = false;
    const dot    = document.getElementById('ssh-dot');
    const text   = document.getElementById('ssh-status-text');
    const pill   = document.getElementById('ssh-status-pill');
    const panel  = document.getElementById('ssh-connect-panel');
    const disBtn = document.getElementById('ssh-disconnect-btn');

    if (dot)   dot.style.background   = yes ? '#10B981' : '#475569';
    if (text)  text.textContent        = yes ? `${this._user}@${this._host}` : 'Disconnected';
    if (pill)  { yes ? pill.classList.add('ssh-connected') : pill.classList.remove('ssh-connected'); }
    if (panel) panel.style.display    = yes ? 'none' : '';
    if (disBtn) disBtn.classList.toggle('hidden', !yes);
  },

  /* ── check if php-ssh2 is available ─────────────────────── */
  async _checkSshExt() {
    try {
      const data = await MKX.api.get('ssh_check');
      const warn = document.getElementById('ssh-ext-warning');
      if (warn) warn.style.display = data.available ? 'none' : 'flex';
    } catch (_) {}
  },

  /* ── render quick command chips ─────────────────────────── */
  _renderQuickCmds() {
    const el = document.getElementById('quick-cmds');
    if (!el) return;
    el.innerHTML = this._quickCmds.map((q, i) =>
      `<div class="quick-cmd-chip" data-qi="${i}"><i class="fas ${q.icon}"></i>${MKX.utils.escHtml(q.label)}</div>`
    ).join('');
    el.querySelectorAll('.quick-cmd-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = this._quickCmds[parseInt(chip.dataset.qi)];
        if (q) this.runQuick(q.cmd);
      });
    });
  },

  /* ── wire all button event listeners ───────────────────── */
  _wireButtons() {
    // Connect button
    document.getElementById('ssh-connect-btn')?.addEventListener('click', () => this.connect());

    // Disconnect button
    document.getElementById('ssh-disconnect-btn')?.addEventListener('click', () => this.disconnect());

    // Clear button
    document.getElementById('term-clear-btn')?.addEventListener('click', () => this.clear());

    // Fullscreen button
    document.getElementById('term-fullscreen-btn')?.addEventListener('click', () => this.toggleFullscreen());
    document.getElementById('term-fullscreen-dot')?.addEventListener('click', () => this.toggleFullscreen());

    // Close dot → disconnect
    document.getElementById('term-close-dot')?.addEventListener('click', () => {
      if (this._connected) this.disconnect();
    });

    // Password show/hide toggle
    document.getElementById('ssh-pass-toggle')?.addEventListener('click', () => {
      const inp = document.getElementById('ssh-pass');
      const ico = document.querySelector('#ssh-pass-toggle i');
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      if (ico) ico.className = inp.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    // Press Enter in any ssh form field → connect
    ['ssh-host','ssh-port','ssh-user','ssh-pass'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.connect();
      });
    });

    // Escape to exit fullscreen
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const view = document.getElementById('view-terminal');
        if (view?.classList.contains('term-fullscreen')) this.toggleFullscreen();
      }
    });
  },

  _showConnectError(msg) {
    const warn = document.getElementById('ssh-ext-warning');
    if (warn) { warn.textContent = msg; warn.style.display = 'flex'; }
  },
};

// ── Patch router to handle 'terminal' view ────────────────
(function patchRouterForTerminal() {
  const _prev = MKX.router.go.bind(MKX.router);
  MKX.router.go = function(view) {
    if (view === 'terminal') {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.bnav-item').forEach(n => n.classList.remove('active'));

      document.getElementById('view-terminal')?.classList.add('active');
      document.querySelector('.nav-item[data-view="terminal"]')?.classList.add('active');
      document.getElementById('bnav-terminal')?.classList.add('active');

      this.current = 'terminal';
      MKX.ui.closeSidebar();

      // Init terminal on first open
      setTimeout(() => MKX.terminal.init(), 60);
      return;
    }
    _prev(view);
  };
})();

// ── Add SSH Terminal to command palette ───────────────────
MKX.cmd.commands.push({
  label: 'SSH Terminal',
  desc:  'Connect to server via SSH',
  icon:  'fa-terminal',
  action: () => MKX.router.go('terminal'),
  kbd:   'T',
});

// ── Keyboard shortcut: T = SSH Terminal ──────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.key === 't' && !e.ctrlKey && !e.metaKey) MKX.router.go('terminal');
  });
});

// ═══════════════════════════════════════════════════════════
//  PROGRESS PANEL MODULE
// ═══════════════════════════════════════════════════════════

MKX.progress = {

  _panel:    null,
  _bar:      null,
  _title:    null,
  _filename: null,
  _count:    null,
  _status:   null,
  _pct:      null,
  _spinner:  null,
  _spinIcon: null,
  _fileList: null,
  _chips:    [],
  _animTimer:null,
  _ready:    false,

  /* ── Init (lazy) ─────────────────────────────────────── */
  _init() {
    if (this._ready) return;
    this._panel    = document.getElementById('progress-panel');
    this._bar      = document.getElementById('prog-bar');
    this._title    = document.getElementById('prog-title');
    this._filename = document.getElementById('prog-filename');
    this._count    = document.getElementById('prog-count');
    this._status   = document.getElementById('prog-status');
    this._pct      = document.getElementById('prog-pct');
    this._spinner  = document.getElementById('prog-spinner');
    this._spinIcon = document.getElementById('prog-spin-icon');
    this._fileList = document.getElementById('prog-file-list');

    // Minimize toggle
    document.getElementById('prog-minimize-btn')?.addEventListener('click', () => {
      this._panel?.classList.toggle('minimized');
      const btn = document.getElementById('prog-minimize-btn');
      if (btn) btn.textContent = this._panel?.classList.contains('minimized') ? '□' : '─';
    });

    this._ready = true;
  },

  /* ── Start a new operation ──────────────────────────── */
  start(title, total = 0) {
    this._init();
    this._chips = [];
    if (!this._panel) return;

    this._panel.classList.remove('hidden', 'minimized');

    // Reset styles
    if (this._bar)    { this._bar.style.width = '0%'; this._bar.style.background = 'linear-gradient(90deg,#2563EB,#06B6D4)'; this._bar.classList.remove('success'); }
    if (this._spinner) { this._spinner.className = 'prog-spinner'; }
    if (this._spinIcon){ this._spinIcon.className = 'fas fa-circle-notch animate-spin'; }
    if (this._title)   this._title.textContent   = title;
    if (this._filename)this._filename.textContent = 'Preparing…';
    if (this._count)   this._count.textContent    = total > 1 ? `0 / ${total}` : '';
    if (this._status)  this._status.textContent   = '';
    if (this._pct)     this._pct.textContent       = '0%';
    if (this._fileList)this._fileList.innerHTML    = '';
  },

  /* ── Update current file ────────────────────────────── */
  update(done, total, filename) {
    if (!this._ready) return;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (this._bar)     this._bar.style.width      = pct + '%';
    if (this._pct)     this._pct.textContent       = pct + '%';
    if (this._filename)this._filename.textContent  = filename ? `↑ ${filename}` : '…';
    if (this._count)   this._count.textContent     = total > 1 ? `${done} / ${total} files` : '';
  },

  /* ── Add a completed file chip ──────────────────────── */
  addFile(name, success, errMsg = '') {
    if (!this._fileList) return;
    const chip = document.createElement('div');
    chip.className = `prog-file-chip ${success ? 'done' : 'error'}`;
    chip.innerHTML = `<i class="fas ${success ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                      <span style="overflow:hidden;text-overflow:ellipsis">${MKX.utils.escHtml(name)}</span>
                      ${errMsg ? `<span style="color:#EF4444;margin-left:auto;flex-shrink:0"> — ${MKX.utils.escHtml(errMsg.slice(0,30))}</span>` : ''}`;
    this._fileList.insertBefore(chip, this._fileList.firstChild);
    // Keep only last 4
    while (this._fileList.children.length > 4) {
      this._fileList.removeChild(this._fileList.lastChild);
    }
  },

  /* ── Done successfully ──────────────────────────────── */
  done(msg) {
    if (!this._ready) return;
    if (this._bar)     { this._bar.style.width = '100%'; this._bar.style.background = 'linear-gradient(90deg,#10B981,#059669)'; this._bar.classList.add('success'); }
    if (this._pct)     this._pct.textContent    = '100%';
    if (this._spinner) this._spinner.className   = 'prog-spinner success';
    if (this._spinIcon)this._spinIcon.className  = 'fas fa-check';
    if (this._title)   this._title.textContent   = 'Done!';
    if (this._filename)this._filename.textContent = msg;
    if (this._count)   this._count.textContent   = '';
    setTimeout(() => this.hide(), 4000);
  },

  /* ── Error state ────────────────────────────────────── */
  error(msg) {
    if (!this._ready) return;
    if (this._bar)     this._bar.style.background = 'linear-gradient(90deg,#EF4444,#DC2626)';
    if (this._spinner) this._spinner.className     = 'prog-spinner error';
    if (this._spinIcon)this._spinIcon.className    = 'fas fa-exclamation-circle';
    if (this._title)   this._title.textContent     = 'Failed';
    if (this._filename)this._filename.textContent  = msg;
    setTimeout(() => this.hide(), 5000);
  },

  /* ── Hide panel ─────────────────────────────────────── */
  hide() {
    if (this._panel) this._panel.classList.add('hidden');
    this._stopAnim();
  },

  /* ── Animated indeterminate progress (for server ops) ── */
  startAnim(title, hint = '') {
    this.start(title, 0);
    if (this._filename) this._filename.textContent = hint || 'Processing on server…';
    if (this._count)    this._count.textContent    = '';
    let pct = 0;
    this._stopAnim();
    this._animTimer = setInterval(() => {
      // Ease-out toward 85% — never reaches 100% until done
      pct += (85 - pct) * 0.018;
      if (this._bar)  this._bar.style.width = pct.toFixed(1) + '%';
      if (this._pct)  this._pct.textContent  = Math.floor(pct) + '%';
    }, 250);
  },

  _stopAnim() {
    if (this._animTimer) { clearInterval(this._animTimer); this._animTimer = null; }
  },

  /* ── Complete an animated operation ────────────────────── */
  animDone(msg) {
    this._stopAnim();
    this.done(msg);
  },

  animError(msg) {
    this._stopAnim();
    this.error(msg);
  },
};
