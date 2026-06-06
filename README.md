# 🚀 MKX GitHub Cloud

> **Control GitHub Like Never Before.**

A premium, futuristic GitHub repository management platform built with PHP 8.3, Three.js, GSAP, Monaco Editor, and the GitHub REST API. Glassmorphism design, neon aesthetics, full-featured file manager and VS Code–style code editor.

---

## ✨ Features

| Category | Features |
|---|---|
| **Auth** | GitHub PAT login, secure sessions, CSRF protection, token validation |
| **Dashboard** | Profile card, stats counters, API usage bar, recent repos |
| **Repositories** | List, search, sort, filter, create, delete, rename, fork, clone URL |
| **File Manager** | Browse, create, edit, delete, upload (drag & drop), download, breadcrumb nav |
| **Code Editor** | Monaco (VS Code engine), syntax highlighting, auto-save, 15+ languages |
| **Animations** | Three.js particle network (login), neon orb background (dashboard), GSAP |
| **UX** | Command palette (⌘K), context menus, toast notifications, keyboard shortcuts |
| **Mobile** | Bottom navigation, touch optimized, responsive, PWA-ready |
| **Security** | CSRF tokens, XSS protection, input sanitisation, session timeout |

---

## 📁 File Structure

```
mkx-github-cloud/
├── index.php          ← Login page (Three.js particle background)
├── dashboard.php      ← Main SPA shell (requires auth)
├── auth.php           ← Token validation + session creation
├── api.php            ← GitHub REST API proxy (CSRF-protected)
├── logout.php         ← Session destroyer
├── manifest.json      ← PWA manifest
├── assets/
│   ├── css/
│   │   └── style.css  ← Complete design system (glassmorphism + neon)
│   └── js/
│       └── app.js     ← Full application logic
└── README.md
```

---

## ⚙️ Requirements

| Requirement | Version |
|---|---|
| PHP | 8.0+ (8.3 recommended) |
| Extensions | `curl`, `openssl`, `json`, `session` |
| Server | Apache / Nginx / LiteSpeed |
| HTTPS | Strongly recommended (required for PWA) |
| GitHub Token | PAT with `repo`, `delete_repo` scopes |

---

## 🛠 Installation

### 1. Upload files

Upload all files to your web server's document root or a subdirectory:

```bash
# Via FTP or your hosting file manager
public_html/
└── mkx-github-cloud/   ← upload here
```

### 2. Set permissions

```bash
chmod 755 mkx-github-cloud/
chmod 644 mkx-github-cloud/*.php
chmod -R 644 mkx-github-cloud/assets/
```

### 3. PHP session config (recommended)

Add to your `.htaccess` or `php.ini`:

```
php_value session.cookie_httponly 1
php_value session.cookie_secure 1
php_value session.use_strict_mode 1
php_value session.gc_maxlifetime 28800
```

### 4. Apache `.htaccess` (optional hardening)

Create `mkx-github-cloud/.htaccess`:

```apache
Options -Indexes
Header always set X-Frame-Options "DENY"
Header always set X-Content-Type-Options "nosniff"
Header always set X-XSS-Protection "1; mode=block"
Header always set Referrer-Policy "strict-origin-when-cross-origin"

# Protect sensitive files
<FilesMatch "^(auth|api|logout)\.php$">
  # These are fine to access normally
</FilesMatch>

# Deny direct access to nothing extra needed
```

### 5. GitHub Token Setup

1. Go to **GitHub → Settings → Developer Settings**
2. Click **Personal Access Tokens → Tokens (Classic)**
3. Click **Generate new token (classic)**
4. Select scopes:
   - ✅ `repo` (full control of private repos)
   - ✅ `delete_repo` (to delete repositories)
   - ✅ `read:user` (to read profile data)
5. Copy the generated token (`ghp_...`)
6. Paste into MKX GitHub Cloud login screen

---

## 🔐 Security Notes

- **Token storage**: GitHub tokens are stored server-side in PHP sessions only. Never exposed to the client.
- **CSRF**: All mutating API calls require an `X-CSRF-Token` header matched against the server session.
- **Input sanitisation**: All user inputs are sanitised before use in API paths.
- **Session timeout**: Sessions expire after 8 hours of inactivity.
- **Rate limiting**: Local rate limiting of 300 API calls per minute per session.
- **XSS protection**: All output is `htmlspecialchars`-encoded.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open Command Palette |
| `D` | Go to Dashboard |
| `R` | Go to Repositories |
| `N` | Create New Repository |
| `Esc` | Close modals / palette |
| `⌘S` (in editor) | Save current file |

---

## 🌐 API Actions Reference (`api.php`)

| Action | Method | Description |
|---|---|---|
| `user` | GET | Fetch authenticated user profile |
| `repos` | GET | List repositories (page, sort, per_page) |
| `repo` | GET | Get single repo details |
| `create_repo` | POST | Create new repository |
| `delete_repo` | DELETE | Delete a repository |
| `rename_repo` | PATCH | Rename a repository |
| `fork` | GET | Fork a repository |
| `contents` | GET | List or get file contents |
| `create_file` | PUT | Create a new file |
| `update_file` | PUT | Update existing file (requires SHA) |
| `delete_file` | DELETE | Delete a file (requires SHA) |
| `commits` | GET | Get recent commits |
| `branches` | GET | List branches |
| `rate_limit` | GET | Check API rate limit |
| `csrf` | GET | Get CSRF token |

---

## 🎨 Design System

```
Colors:
  Primary:   #2563EB  (Blue)
  Secondary: #7C3AED  (Purple)
  Accent:    #06B6D4  (Cyan)
  Dark:      #0F172A  (Background)
  Success:   #10B981  (Green)
  Danger:    #EF4444  (Red)

Fonts:
  Headings:  Rajdhani (700)
  Body:      Exo 2 (400/600)
  Code/Mono: JetBrains Mono (400/500)
```

---

## 🚀 Supported File Upload Types

`ZIP · HTML · CSS · JS · PHP · TXT · JSON · PNG · JPG · GIF · SVG · WEBP · PY · MD · XML · YAML`

---

## 📱 PWA Installation

On mobile, tap the browser's **"Add to Home Screen"** option to install MKX GitHub Cloud as a native-like app with:
- Standalone display (no browser UI)
- Dark themed splash screen
- App icon

---

## ⚡ Tech Stack

| Layer | Technology |
|---|---|
| Backend | PHP 8.3, cURL, Sessions |
| Frontend | HTML5, Tailwind CSS (CDN), Vanilla JS |
| 3D / Animation | Three.js r128, GSAP 3.12 |
| Code Editor | Monaco Editor 0.44 |
| Icons | Font Awesome 6.5 |
| API | GitHub REST API v3 |

---

## 🐛 Troubleshooting

**Login fails with "auth_failed"**
→ Token may be expired or missing `repo` scope. Generate a new one.

**"cURL error" on login**
→ Your server may be blocking outbound HTTPS to `api.github.com`. Contact hosting support.

**Files not showing / 404 on contents**
→ Repository may be empty. Use "Create File" to add the first file.

**Monaco editor not loading**
→ Check CDN accessibility from your server. Some restricted networks block `cdnjs.cloudflare.com`.

**Session expires too quickly**
→ Increase `session.gc_maxlifetime` in your PHP config.

---

## 📄 License

Built by **BIZ FACTORY** (@bizft) — MKX GitHub Cloud  
For personal or commercial use. Do not redistribute as your own product.

---

*MKX GitHub Cloud © 2025 BIZ FACTORY — @mk_hossain*
