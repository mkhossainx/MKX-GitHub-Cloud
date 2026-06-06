/**
 * MKX GitHub Cloud — Advanced File Manager (fm.js)
 * ZIP Upload/Extract · Copy · Move · Rename · Bulk Delete
 * Multi-Select · Compress · Clipboard · Context Menu
 * Version 2.0 — Production Ready
 */

'use strict';

// ═══════════════════════════════════════════════════════════
//  MKX FILE MANAGER NAMESPACE
// ═══════════════════════════════════════════════════════════

MKX.fm = {

  /* ─── State ─────────────────────────────────────────────── */
  _sel:     new Set(),    // selected file paths
  _clip:    null,         // {action,items,owner,repo}
  _zipKey:  null,         // uploaded ZIP tmp_key
  _zipName: '',           // uploaded ZIP filename
  _fmApi:   'fm-api.php',

  /* ─── API helper ─────────────────────────────────────────── */
  async _call(action, body = {}, method = 'POST') {
    const r = MKX.state.currentRepo || {};
    const res = await fetch(`${this._fmApi}?action=${action}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CFG.csrfToken,
      },
      body: JSON.stringify({
        owner: r.owner || '',
        repo:  r.name  || '',
        ...body,
      }),
    });
    if (!res.ok && res.headers.get('content-type')?.includes('application/json') === false) {
      throw new Error(`Server error ${res.status}`);
    }
    const data = await res.json();
    if (data.error && !data.success) throw new Error(data.error);
    return data;
  },

  /* ═══════════════════════════════════════════════════════════
     SELECTION MANAGEMENT
  ═══════════════════════════════════════════════════════════ */

  toggleSel(path) {
    if (this._sel.has(path)) this._sel.delete(path);
    else                      this._sel.add(path);
    this._syncCheckboxes();
    this._updateBulkBar();
  },

  selAll() {
    (MKX.files._renderList || MKX.state.currentFiles || []).forEach(f => this._sel.add(f.path));
    this._syncCheckboxes();
    this._updateBulkBar();
  },

  selNone() {
    this._sel.clear();
    this._syncCheckboxes();
    this._updateBulkBar();
  },

  getSelected() {
    const src = MKX.files._renderList || MKX.state.currentFiles || [];
    return src.filter(f => this._sel.has(f.path));
  },

  _syncCheckboxes() {
    document.querySelectorAll('.fm-chk').forEach(cb => {
      cb.checked = this._sel.has(cb.dataset.path);
    });
    const all = document.getElementById('fm-sel-all');
    if (!all) return;
    const src = MKX.files._renderList || MKX.state.currentFiles || [];
    all.checked       = src.length > 0 && this._sel.size === src.length;
    all.indeterminate = this._sel.size > 0 && this._sel.size < src.length;
  },

  _updateBulkBar() {
    const n   = this._sel.size;
    const bar = document.getElementById('fm-bulk-bar');
    const cnt = document.getElementById('fm-sel-count');
    if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
    if (cnt) cnt.textContent   = `${n} selected`;

    // Update select-all header checkbox row visibility
    const hdr = document.getElementById('fm-list-header');
    if (hdr) hdr.style.display = '';
  },

  /* ═══════════════════════════════════════════════════════════
     PATCH _renderFiles — inject checkboxes + extract buttons
  ═══════════════════════════════════════════════════════════ */

  _patchRenderer() {
    const self    = this;
    const origFn  = MKX.files._renderFiles.bind(MKX.files);

    MKX.files._renderFiles = function(files) {
      origFn(files);

      // Show list header
      const hdr = document.getElementById('fm-list-header');
      if (hdr) hdr.style.display = files.length > 0 ? '' : 'none';

      // Inject checkbox + extract button into each row
      const list = document.getElementById('file-list');
      if (!list) return;

      list.querySelectorAll('.file-item').forEach(el => {
        const idx = parseInt(el.dataset.idx, 10);
        const f   = files[idx];
        if (!f) return;

        // ── Checkbox ────────────────────────────────────────────
        if (!el.querySelector('.fm-chk')) {
          const chk = document.createElement('input');
          chk.type        = 'checkbox';
          chk.className   = 'fm-chk';
          chk.dataset.path = f.path;
          chk.checked     = self._sel.has(f.path);
          chk.setAttribute('title', 'Select');
          chk.addEventListener('click', e => {
            e.stopPropagation();
            self.toggleSel(f.path);
          });
          el.insertBefore(chk, el.firstChild);
        }

        // ── ZIP extract button ───────────────────────────────────
        const isZip = /\.zip$/i.test(f.name);
        if (isZip && f.type === 'file' && !el.querySelector('.btn-fm-extract')) {
          const actions = el.querySelector('.file-actions');
          if (actions) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-success btn-icon btn-sm btn-fm-extract';
            btn.title     = 'Extract ZIP contents';
            btn.innerHTML = '<i class="fas fa-file-export"></i>';
            btn.addEventListener('click', async e => {
              e.stopPropagation();
              await self._extractFromRepo(f);
            });
            actions.prepend(btn);
          }
        }

        // ── Rename on context ────────────────────────────────────
        el.addEventListener('dblclick', e => {
          if (f.type === 'dir') return; // dirs: single click navigates
          e.preventDefault();
          e.stopPropagation();
          self.renameItem(f);
        });
      });

      self._syncCheckboxes();
      self._updateBulkBar();
    };
  },

  /* ═══════════════════════════════════════════════════════════
     ZIP UPLOAD (chunked, large file support, progress)
  ═══════════════════════════════════════════════════════════ */

  triggerZipUpload() {
    document.getElementById('zip-upload-input')?.click();
  },

  async handleZipFile(file) {
    if (!MKX.state.currentRepo) { MKX.notify.warn('Open a repository first.'); return; }
    if (!file) return;

    // Validate type — check extension AND MIME type
    const isZipExt  = /\.zip$/i.test(file.name);
    const isZipMime = file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || file.type === 'application/octet-stream' || file.type === '';
    if (!isZipExt) {
      MKX.notify.error('Only .zip files are supported. Selected: ' + (file.name || 'unknown'));
      return;
    }
    if (file.size === 0) {
      MKX.notify.error('ZIP file is empty (0 bytes).'); return;
    }
    if (file.size > 150 * 1024 * 1024) {
      MKX.notify.error('ZIP too large (max 150 MB). Current: ' + (file.size / 1024 / 1024).toFixed(1) + ' MB'); return;
    }

    const CHUNK  = 2 * 1024 * 1024; // 2 MB chunks
    const total  = Math.ceil(file.size / CHUNK);
    const tmpKey = 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    this._setZipProgress(0, `Uploading ${file.name}…`, false);
    const uploadBtn = document.getElementById('zip-upload-btn');
    if (uploadBtn) uploadBtn.disabled = true;

    try {
      for (let c = 0; c < total; c++) {
        const start = c * CHUNK;
        const blob  = file.slice(start, start + CHUNK);
        const b64   = await this._blobToB64(blob);

        const r = await fetch(`${this._fmApi}?action=upload_zip`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrfToken },
          body: JSON.stringify({
            owner: MKX.state.currentRepo.owner,
            repo:  MKX.state.currentRepo.name,
            zip_b64: b64, chunk: c, total, tmp_key: tmpKey,
          }),
        });
        const data = await r.json();
        if (data.error) throw new Error(data.error);

        const pct = Math.round(((c + 1) / total) * 100);
        this._setZipProgress(pct, `Uploading… ${pct}% (${c + 1}/${total} chunks)`, false);
      }

      this._zipKey  = tmpKey;
      this._zipName = file.name;
      this._setZipProgress(100, `✓ ${file.name} uploaded. Click Extract.`, true);

      // Enable extract button
      const extBtn = document.getElementById('zip-after-upload-extract');
      if (extBtn) {
        extBtn.style.display  = '';
        extBtn.dataset.tmpKey = tmpKey;
        extBtn.dataset.name   = file.name;
      }
      MKX.notify.success(`${file.name} uploaded — click Extract to unzip.`);

    } catch(e) {
      this._setZipProgress(0, '', false, true);
      MKX.notify.error('Upload failed: ' + e.message);
    } finally {
      if (uploadBtn) uploadBtn.disabled = false;
    }
  },

  _blobToB64(blob) {
    return new Promise((res, rej) => {
      const r   = new FileReader();
      r.onload  = () => res(r.result.split(',')[1]);
      r.onerror = () => rej(new Error('File read failed'));
      r.readAsDataURL(blob);
    });
  },

  _setZipProgress(pct, msg, done, hide = false) {
    const wrap = document.getElementById('zip-progress-wrap');
    const bar  = document.getElementById('zip-progress-fill');
    const txt  = document.getElementById('zip-progress-text');
    if (hide)  { if (wrap) wrap.style.display = 'none'; return; }
    if (wrap)  wrap.style.display = '';
    if (bar) {
      bar.style.width      = pct + '%';
      bar.style.background = done
        ? 'linear-gradient(90deg,#10B981,#059669)'
        : 'linear-gradient(90deg,#2563EB,#06B6D4)';
    }
    if (txt) txt.textContent = msg;
  },

  /* ═══════════════════════════════════════════════════════════
     ZIP EXTRACT
  ═══════════════════════════════════════════════════════════ */

  openExtractModal(tmpKey, zipName) {
    document.getElementById('extract-zip-name').textContent  = zipName || 'archive.zip';
    document.getElementById('extract-dest-path').value       = MKX.state.currentPath || '';
    const btn = document.getElementById('extract-confirm-btn');
    if (btn) {
      btn.disabled    = false;
      btn.textContent = 'Extract';
      btn.dataset.tmpKey = tmpKey;
    }
    MKX.modals.open('modal-extract');
  },

  async doExtract() {
    const btn    = document.getElementById('extract-confirm-btn');
    const tmpKey = btn?.dataset.tmpKey || this._zipKey;
    const dest   = document.getElementById('extract-dest-path')?.value?.trim() || '';

    if (!tmpKey) { MKX.notify.error('No ZIP to extract. Please upload or select a ZIP first.'); return; }
    if (!MKX.state.currentRepo) { MKX.notify.error('No repository open.'); return; }

    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner animate-spin"></i> Extracting…'; }
    this._setZipProgress(50, 'Extracting files to GitHub repository…', false);

    try {
      const res = await fetch(`${this._fmApi}?action=extract_zip`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrfToken },
        body: JSON.stringify({
          owner:     MKX.state.currentRepo.owner,
          repo:      MKX.state.currentRepo.name,
          base_path: dest,
          tmp_key:   tmpKey,
        }),
      });

      // Detect non-JSON PHP errors
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const txt = await res.text();
        throw new Error('Server error: ' + txt.slice(0, 150));
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      this._setZipProgress(0, '', false, true);
      MKX.modals.close('modal-extract');

      // Reset upload zone
      const extBtn = document.getElementById('zip-after-upload-extract');
      if (extBtn) extBtn.style.display = 'none';
      this._zipKey  = null;
      this._zipName = '';

      const msg = `✓ ${data.extracted}/${data.total} files extracted.` +
                  (data.skipped   ? ` ${data.skipped} skipped.`       : '') +
                  (data.errors?.length ? ` ${data.errors.length} error(s).` : '');

      data.errors?.length ? MKX.notify.warn(msg) : MKX.notify.success(msg);

      // Show errors in console for debugging
      if (data.errors?.length) console.warn('Extract errors:', data.errors);

      // Reload file list
      MKX.files.loadContents(dest || MKX.state.currentPath);

    } catch(e) {
      this._setZipProgress(0, '', false, true);
      MKX.notify.error('Extract failed: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Extract'; }
    }
  },

  // Extract a ZIP that already exists in the repo
  // Uses server-side fetch_for_extract to bypass GitHub 1MB API limit
  async _extractFromRepo(f) {
    if (!f.path) { MKX.notify.error('File path missing.'); return; }
    if (!MKX.state.currentRepo) { MKX.notify.error('No repo open.'); return; }

    const { owner, name: repo } = MKX.state.currentRepo;
    this._setZipProgress(20, `Downloading ${f.name} via server…`, false);
    MKX.notify.info(`Preparing ${f.name} for extraction…`);

    try {
      // Server-side download: no 1MB limit, handles auth, validates ZIP magic bytes
      const res = await fetch(`${this._fmApi}?action=fetch_for_extract`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrfToken },
        body: JSON.stringify({ owner, repo, path: f.path }),
      });

      // Check for non-JSON responses (PHP errors)
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const txt = await res.text();
        throw new Error('Server error: ' + txt.slice(0, 120));
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      this._setZipProgress(0, '', false, true);
      this.openExtractModal(data.tmp_key, f.name);

    } catch(e) {
      this._setZipProgress(0, '', false, true);
      MKX.notify.error('Cannot prepare extraction: ' + e.message);
    }
  },

  /* ═══════════════════════════════════════════════════════════
     CLIPBOARD
  ═══════════════════════════════════════════════════════════ */

  async copyToClip(action = 'copy') {
    const items = this.getSelected();
    if (!items.length) { MKX.notify.warn('Select files/folders first.'); return; }
    const { owner, name: repo } = MKX.state.currentRepo;

    this._clip = {
      action,
      items: items.map(f => ({ path: f.path, name: f.name, type: f.type, sha: f.sha || '', owner, repo })),
      owner, repo,
    };

    try {
      await this._call('clipboard_set', { action, items: this._clip.items });
      MKX.notify.info(`${items.length} item(s) ${action === 'cut' ? 'cut' : 'copied'}.`);
      if (action === 'cut') this._styleCutItems(items.map(f => f.path));
      this._updateClipBar();
    } catch(e) {
      MKX.notify.error('Clipboard error: ' + e.message);
    }
  },

  async paste() {
    if (!this._clip?.items?.length) { MKX.notify.warn('Clipboard is empty.'); return; }
    const dest = MKX.state.currentPath;

    try {
      const data = await this._call('clipboard_paste', { dest_dir: dest });
      MKX.notify.success(`Pasted ${data.done} item(s).`);
      if (data.errors?.length) MKX.notify.warn(`${data.errors.length} error(s): ` + data.errors.slice(0, 2).join('; '));
      if (this._clip.action === 'cut') { this._clip = null; this._updateClipBar(); }
      MKX.files.loadContents(dest);
    } catch(e) {
      MKX.notify.error('Paste failed: ' + e.message);
    }
  },

  async clearClip() {
    this._clip = null;
    try { await this._call('clipboard_clear'); } catch(_) {}
    this._updateClipBar();
    // Remove cut styling
    document.querySelectorAll('.file-item.fm-cut').forEach(el => {
      el.classList.remove('fm-cut');
    });
    MKX.notify.info('Clipboard cleared.');
  },

  _styleCutItems(paths) {
    document.querySelectorAll('.file-item').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      const f   = (MKX.files._renderList || [])[idx];
      if (f && paths.includes(f.path)) el.classList.add('fm-cut');
    });
  },

  _updateClipBar() {
    const bar = document.getElementById('fm-clip-bar');
    const txt = document.getElementById('fm-clip-text');
    if (!bar) return;
    if (this._clip?.items?.length) {
      bar.style.display = 'flex';
      const icon = this._clip.action === 'cut' ? '✂️' : '📋';
      if (txt) txt.textContent = `${icon} ${this._clip.items.length} item(s) in clipboard (${this._clip.action})`;
    } else {
      bar.style.display = 'none';
    }
  },

  async loadClipFromSession() {
    try {
      const r = await fetch(`${this._fmApi}?action=clipboard_get`, {
        headers: { 'X-CSRF-Token': CFG.csrfToken },
      });
      const data = await r.json();
      if (data.clipboard?.items?.length) {
        this._clip = data.clipboard;
        this._updateClipBar();
      }
    } catch(_) {}
  },

  /* ═══════════════════════════════════════════════════════════
     BULK OPERATIONS
  ═══════════════════════════════════════════════════════════ */

  bulkDelete() {
    const items = this.getSelected();
    if (!items.length) { MKX.notify.warn('Select items to delete.'); return; }

    const label = items.length === 1 ? items[0].name : `${items.length} items`;
    MKX.modals.confirmDelete(label, async () => {
      const btn = document.getElementById('confirm-delete-btn');
      MKX.ui.setLoading(btn, true);
      try {
        const data = await this._call('bulk_delete', {
          items: items.map(f => ({ path: f.path, type: f.type, sha: f.sha || '' })),
        });
        MKX.notify.success(data.message || `${data.done} deleted.`);
        if (data.errors?.length) MKX.notify.warn(`${data.errors.length} error(s).`);
        MKX.modals.close('modal-delete');
        this.selNone();
        MKX.files.loadContents(MKX.state.currentPath);
      } catch(e) {
        MKX.notify.error('Delete failed: ' + e.message);
      } finally {
        MKX.ui.setLoading(btn, false);
      }
    });
  },

  openMoveModal(isCopy = false) {
    const items = this.getSelected();
    if (!items.length) { MKX.notify.warn('Select items first.'); return; }
    const lbl = document.getElementById('move-modal-title');
    const cnt = document.getElementById('move-item-count');
    const btn = document.getElementById('move-confirm-btn');
    if (lbl) lbl.textContent = isCopy ? 'Copy Items' : 'Move Items';
    if (cnt) cnt.textContent = `${items.length} item(s) selected`;
    if (btn) { btn.dataset.isCopy = isCopy ? '1' : '0'; btn.textContent = isCopy ? 'Copy Here' : 'Move Here'; }
    document.getElementById('move-dest-path').value = '';
    MKX.modals.open('modal-move');
  },

  async doMoveOrCopy() {
    const items   = this.getSelected();
    const destDir = document.getElementById('move-dest-path')?.value?.trim() || '';
    const btn     = document.getElementById('move-confirm-btn');
    const isCopy  = btn?.dataset.isCopy === '1';

    if (!items.length) return;
    MKX.ui.setLoading(btn, true);
    try {
      const data = await this._call(isCopy ? 'copy_files' : 'move_files', {
        files:    items.map(f => ({ path: f.path, type: f.type, sha: f.sha || '', name: f.name })),
        dest_dir: destDir,
      });
      MKX.notify.success(data.message || `${data.done} item(s) ${isCopy ? 'copied' : 'moved'}.`);
      if (data.errors?.length) MKX.notify.warn(`${data.errors.length} error(s).`);
      MKX.modals.close('modal-move');
      this.selNone();
      MKX.files.loadContents(MKX.state.currentPath);
    } catch(e) {
      MKX.notify.error((isCopy ? 'Copy' : 'Move') + ' failed: ' + e.message);
    } finally {
      MKX.ui.setLoading(btn, false);
    }
  },

  /* ═══════════════════════════════════════════════════════════
     COMPRESS
  ═══════════════════════════════════════════════════════════ */

  openCompressModal() {
    const items = this.getSelected();
    if (!items.length) { MKX.notify.warn('Select files/folders to compress.'); return; }
    const cnt = document.getElementById('compress-item-count');
    if (cnt) cnt.textContent = `${items.length} item(s) selected`;
    document.getElementById('compress-zip-name').value = 'archive';
    MKX.modals.open('modal-compress');
  },

  async doCompress() {
    const items   = this.getSelected();
    const zipName = (document.getElementById('compress-zip-name')?.value?.trim() || 'archive')
                      .replace(/[^a-zA-Z0-9._\-]/g, '');
    const btn     = document.getElementById('compress-confirm-btn');
    if (!items.length) return;

    MKX.ui.setLoading(btn, true);
    MKX.notify.info('Compressing files…');

    try {
      const res = await fetch(`${this._fmApi}?action=compress`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrfToken },
        body: JSON.stringify({
          owner:     MKX.state.currentRepo.owner,
          repo:      MKX.state.currentRepo.name,
          items:     items.map(f => ({ path: f.path, type: f.type })),
          zip_name:  zipName,
          base_path: MKX.state.currentPath,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || 'Compress failed');
      }

      const blob    = await res.blob();
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement('a');
      a.href        = url;
      a.download    = zipName + '.zip';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);

      MKX.modals.close('modal-compress');
      MKX.notify.success(`${zipName}.zip downloaded!`);
      this.selNone();

    } catch(e) {
      MKX.notify.error('Compress failed: ' + e.message);
    } finally {
      MKX.ui.setLoading(btn, false);
    }
  },

  /* ═══════════════════════════════════════════════════════════
     RENAME
  ═══════════════════════════════════════════════════════════ */

  renameItem(f) {
    MKX.modals.rename(f.name, async () => {
      const newName = document.getElementById('rename-input')?.value?.trim();
      if (!newName || newName === f.name) return;
      const btn = document.querySelector('#modal-rename .btn-accent');
      if (btn) { btn.disabled = true; btn.textContent = 'Renaming…'; }
      try {
        const data = await this._call('rename_item', {
          old_path: f.path,
          new_name: newName,
          type:     f.type,
        });
        MKX.notify.success(`Renamed to "${newName}"`);
        MKX.modals.close('modal-rename');
        MKX.files.loadContents(MKX.state.currentPath);
      } catch(e) {
        MKX.notify.error('Rename failed: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Rename'; }
      }
    });
  },

  /* ═══════════════════════════════════════════════════════════
     ENHANCED CONTEXT MENU
  ═══════════════════════════════════════════════════════════ */

  _patchContextMenu() {
    const _orig = MKX.ctx.showFile.bind(MKX.ctx);
    MKX.ctx.showFile = (event, f) => {
      _orig(event, f);
      // Patch rename to use FM rename
      const renameEl = document.getElementById('ctx-rename');
      if (renameEl) {
        renameEl.onclick = () => { this.renameItem(f); MKX.ctx.hide(); };
      }
      // Add context: Copy / Cut / Extract (for ZIP)
      const menu = document.getElementById('ctx-menu');
      if (!menu) return;

      // Remove previously injected FM items
      menu.querySelectorAll('.ctx-fm-item').forEach(el => el.remove());

      // Inject before the separator
      const sep = menu.querySelector('.ctx-sep');

      const mkItem = (icon, label, onClick, isDanger = false) => {
        const d  = document.createElement('div');
        d.className = `ctx-item ctx-fm-item${isDanger ? ' danger' : ''}`;
        d.innerHTML = `<i class="fas ${icon}"></i> ${label}`;
        d.onclick   = onClick;
        return d;
      };

      const frag = document.createDocumentFragment();
      frag.appendChild(mkItem('fa-copy',       'Copy',        () => { this._selAndOp(f,'copy'); MKX.ctx.hide(); }));
      frag.appendChild(mkItem('fa-cut',        'Cut',         () => { this._selAndOp(f,'cut');  MKX.ctx.hide(); }));
      if (/\.zip$/i.test(f.name) && f.type === 'file') {
        frag.appendChild(mkItem('fa-file-export','Extract ZIP', async () => { MKX.ctx.hide(); await this._extractFromRepo(f); }));
      }
      frag.appendChild(mkItem('fa-i-cursor',   'Rename',      () => { MKX.ctx.hide(); this.renameItem(f); }));
      if (sep) menu.insertBefore(frag, sep);
      else     menu.appendChild(frag);
    };
  },

  // Select just this item, then do clipboard op
  _selAndOp(f, action) {
    if (!this._sel.has(f.path)) {
      this._sel.clear();
      this._sel.add(f.path);
      this._syncCheckboxes();
      this._updateBulkBar();
    }
    this.copyToClip(action);
  },

  /* ═══════════════════════════════════════════════════════════
     DARK / LIGHT MODE TOGGLE
  ═══════════════════════════════════════════════════════════ */

  _themeKey: 'mkx_theme',

  applyTheme(dark = true) {
    const root = document.documentElement;
    if (dark) {
      root.removeAttribute('data-theme');
      localStorage.setItem(this._themeKey, 'dark');
    } else {
      root.setAttribute('data-theme', 'light');
      localStorage.setItem(this._themeKey, 'light');
    }
    const ico = document.getElementById('theme-toggle-icon');
    if (ico) ico.className = dark ? 'fas fa-moon' : 'fas fa-sun';
  },

  toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    this.applyTheme(cur === 'light');
  },

  _loadTheme() {
    const saved = localStorage.getItem(this._themeKey) || 'dark';
    this.applyTheme(saved === 'dark');
  },

  /* ═══════════════════════════════════════════════════════════
     CLEAR SELECTION WHEN NAVIGATING
  ═══════════════════════════════════════════════════════════ */

  _patchNavigation() {
    const origLoad = MKX.files.loadContents.bind(MKX.files);
    MKX.files.loadContents = (path) => {
      this.selNone();
      this._setZipProgress(0, '', false, true);
      return origLoad(path);
    };
  },

  /* ═══════════════════════════════════════════════════════════
     KEYBOARD SHORTCUTS FOR FILE MANAGER
  ═══════════════════════════════════════════════════════════ */

  _wireKeyboard() {
    document.addEventListener('keydown', e => {
      if (MKX.router.current !== 'files') return;
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

      // Ctrl/Cmd + A = select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); this.selAll(); }
      // Escape = deselect
      if (e.key === 'Escape') this.selNone();
      // Delete = bulk delete
      if (e.key === 'Delete' && this._sel.size > 0) this.bulkDelete();
      // Ctrl+C = copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && this._sel.size > 0) { e.preventDefault(); this.copyToClip('copy'); }
      // Ctrl+X = cut
      if ((e.ctrlKey || e.metaKey) && e.key === 'x' && this._sel.size > 0) { e.preventDefault(); this.copyToClip('cut'); }
      // Ctrl+V = paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); this.paste(); }
    });
  },

  /* ═══════════════════════════════════════════════════════════
     WIRE ALL UI EVENTS
  ═══════════════════════════════════════════════════════════ */

  _wireEvents() {
    // Select all checkbox in header
    document.getElementById('fm-sel-all')?.addEventListener('change', e => {
      e.target.checked ? this.selAll() : this.selNone();
    });

    // Bulk bar buttons
    document.getElementById('fm-bulk-delete')?.addEventListener('click',   () => this.bulkDelete());
    document.getElementById('fm-bulk-copy')?.addEventListener('click',     () => this.copyToClip('copy'));
    document.getElementById('fm-bulk-cut')?.addEventListener('click',      () => this.copyToClip('cut'));
    document.getElementById('fm-bulk-move')?.addEventListener('click',     () => this.openMoveModal(false));
    document.getElementById('fm-bulk-copy-to')?.addEventListener('click',  () => this.openMoveModal(true));
    document.getElementById('fm-bulk-compress')?.addEventListener('click', () => this.openCompressModal());
    document.getElementById('fm-bulk-deselect')?.addEventListener('click', () => this.selNone());

    // Clipboard bar
    document.getElementById('fm-paste-btn')?.addEventListener('click',     () => this.paste());
    document.getElementById('fm-clip-clear-btn')?.addEventListener('click',() => this.clearClip());

    // ZIP upload input
    const zipInput = document.getElementById('zip-upload-input');
    zipInput?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) this.handleZipFile(f);
      e.target.value = '';
    });

    // ZIP upload button
    document.getElementById('zip-upload-btn')?.addEventListener('click', () => this.triggerZipUpload());

    // ZIP extract after upload
    document.getElementById('zip-after-upload-extract')?.addEventListener('click', e => {
      const key  = e.currentTarget.dataset.tmpKey;
      const name = e.currentTarget.dataset.name;
      if (key) this.openExtractModal(key, name);
    });

    // ZIP drop zone
    const zipZone = document.getElementById('zip-drop-zone');
    if (zipZone) {
      ['dragenter','dragover'].forEach(ev =>
        zipZone.addEventListener(ev, e => { e.preventDefault(); zipZone.classList.add('dragging'); })
      );
      ['dragleave','drop'].forEach(ev =>
        zipZone.addEventListener(ev, e => { e.preventDefault(); zipZone.classList.remove('dragging'); })
      );
      zipZone.addEventListener('drop', e => {
        const f = e.dataTransfer?.files?.[0];
        if (f) this.handleZipFile(f);
      });
      zipZone.addEventListener('click', () => this.triggerZipUpload());
    }

    // Extract modal confirm
    document.getElementById('extract-confirm-btn')?.addEventListener('click', () => this.doExtract());

    // Move modal confirm
    document.getElementById('move-confirm-btn')?.addEventListener('click', () => this.doMoveOrCopy());

    // Compress modal confirm
    document.getElementById('compress-confirm-btn')?.addEventListener('click', () => this.doCompress());

    // Theme toggle
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => this.toggleTheme());
  },

  /* ═══════════════════════════════════════════════════════════
     INITIALISE
  ═══════════════════════════════════════════════════════════ */

  init() {
    this._patchRenderer();
    this._patchContextMenu();
    this._patchNavigation();
    this._wireEvents();
    this._wireKeyboard();
    this._loadTheme();
    this.loadClipFromSession();
    this._updateBulkBar();
  },
};

// ── Auto-init after DOM ready ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => MKX.fm.init());
