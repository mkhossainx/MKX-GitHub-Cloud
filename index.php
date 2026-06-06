<?php
/**
 * MKX GitHub Cloud — Login Page
 */

session_start();
if (file_exists(__DIR__ . '/config.php')) require_once __DIR__ . '/config.php';

// Already logged in? Go to dashboard
if (!empty($_SESSION['github_token'])) {
    header('Location: dashboard.php');
    exit;
}

$error   = $_GET['error'] ?? '';
$logout  = $_GET['logout'] ?? '';

// Generate OAuth state token (fresh on each page load)
$_SESSION['oauth_state'] = bin2hex(random_bytes(16));
$oauthState              = $_SESSION['oauth_state'];

// Build OAuth URL — uses explicit OAUTH_CALLBACK_URL from config.php
$oauthEnabled  = defined('GITHUB_CLIENT_ID')     && GITHUB_CLIENT_ID     !== 'YOUR_GITHUB_CLIENT_ID'
              && defined('OAUTH_CALLBACK_URL')    && OAUTH_CALLBACK_URL   !== 'https://YOUR_DOMAIN/YOUR_PATH/oauth.php';

$callbackUrl   = defined('OAUTH_CALLBACK_URL') ? OAUTH_CALLBACK_URL : '';
$oauthUrl      = 'https://github.com/login/oauth/authorize?' . http_build_query([
    'client_id'    => defined('GITHUB_CLIENT_ID')    ? GITHUB_CLIENT_ID    : '',
    'redirect_uri' => $callbackUrl,
    'scope'        => defined('GITHUB_OAUTH_SCOPES') ? GITHUB_OAUTH_SCOPES : 'repo,delete_repo,read:user',
    'state'        => $oauthState,
    'allow_signup' => 'false',
]);

$errorMessages = [
    'invalid_token'              => 'Invalid token format. Use a GitHub Personal Access Token (ghp_... or github_pat_...).',
    'auth_failed'                => 'Authentication failed. Token may be expired or have insufficient permissions.',
    'network_error'              => 'Network error. Could not connect to GitHub API.',
    'github_error'               => 'GitHub API returned an error. Please try again.',
    'invalid_response'           => 'Unexpected response from GitHub. Please try again.',
    'oauth_state_mismatch'       => 'OAuth security check failed (state mismatch). Please try again.',
    'oauth_denied'               => 'GitHub OAuth access was denied: ' . htmlspecialchars($_GET['desc'] ?? 'User cancelled', ENT_QUOTES),
    'oauth_no_code'              => 'OAuth error: No code received from GitHub.',
    'oauth_token_exchange_failed'=> 'OAuth error: Could not exchange code for token. Check your Client Secret.',
    'oauth_no_token'             => 'OAuth error: No access token received. ' . htmlspecialchars($_GET['desc'] ?? '', ENT_QUOTES),
    'oauth_user_fetch_failed'    => 'OAuth error: Could not fetch user profile. Token may lack permissions.',
    'oauth_invalid_user'         => 'OAuth error: Invalid user response from GitHub.',
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>MKX GitHub Cloud — Sign In</title>
  <meta name="description" content="Control GitHub Like Never Before. The most powerful GitHub management panel.">
  <meta name="theme-color" content="#0F172A">
  <link rel="manifest" href="manifest.json">

  <!-- Tailwind -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: {
        colors: { primary:'#2563EB', secondary:'#7C3AED', accent:'#06B6D4', dark:'#0F172A', 'dark-2':'#1E293B', 'dark-3':'#334155', success:'#10B981', danger:'#EF4444' },
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
  <div class="loader-text">INITIALIZING CLOUD CONTROL . . .</div>
</div>

<!-- Login Page -->
<div class="login-page" id="login-wrap" style="opacity:0">

  <div class="login-card">

    <!-- Brand -->
    <div class="login-logo">MKX GITHUB CLOUD</div>
    <div class="login-sub">CONTROL GITHUB LIKE NEVER BEFORE</div>

    <!-- GitHub icon -->
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.25);font-size:2rem;color:#2563EB;box-shadow:0 0 30px rgba(37,99,235,0.25)">
        <i class="fab fa-github"></i>
      </div>
    </div>

    <?php if ($logout): ?>
    <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:12px 16px;color:#6EE7B7;font-size:0.875rem;margin-bottom:16px;display:flex;align-items:center;gap:8px">
      <i class="fas fa-check-circle"></i> Signed out successfully.
    </div>
    <?php endif; ?>

    <?php if ($error && isset($errorMessages[$error])): ?>
    <div class="error-alert">
      <i class="fas fa-exclamation-triangle"></i>
      <?= htmlspecialchars($errorMessages[$error], ENT_QUOTES) ?>
    </div>
    <?php endif; ?>

    <!-- OAuth Button (shown when configured) -->
    <?php if ($oauthEnabled): ?>
    <a href="<?= htmlspecialchars($oauthUrl, ENT_QUOTES) ?>" class="btn" style="width:100%;justify-content:center;padding:13px;font-size:1rem;letter-spacing:1px;font-family:'Rajdhani',sans-serif;font-weight:700;background:linear-gradient(135deg,#24292e,#161b22);border:1px solid rgba(255,255,255,0.1);color:#fff;box-shadow:0 4px 15px rgba(0,0,0,0.4);margin-bottom:14px;text-decoration:none;display:flex" id="oauth-btn">
      <i class="fab fa-github" style="font-size:1.1rem"></i>
      LOGIN WITH GITHUB
    </a>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <div class="divider" style="flex:1;margin:0"></div>
      <span style="font-size:0.7rem;color:#64748B;letter-spacing:1px">OR USE TOKEN</span>
      <div class="divider" style="flex:1;margin:0"></div>
    </div>
    <?php else: ?>
    <div style="background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.2);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:0.75rem;color:#93C5FD;display:flex;align-items:center;gap:8px">
      <i class="fas fa-info-circle" style="color:#2563EB"></i>
      <span>Configure <code style="background:rgba(37,99,235,0.15);padding:1px 5px;border-radius:3px">config.php</code> to enable one-click GitHub Login</span>
    </div>
    <?php endif; ?>

    <!-- Login Form -->
    <form action="auth.php" method="POST" id="login-form">
      <div class="input-group">
        <label for="token"><i class="fas fa-key" style="margin-right:6px;color:#2563EB"></i>GitHub Personal Access Token</label>
        <div style="position:relative">
          <input
            type="password"
            id="token"
            name="token"
            class="input-field"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            autocomplete="off"
            spellcheck="false"
            required
          >
          <span class="input-toggle" onclick="toggleTokenVisibility()" id="token-toggle">
            <i class="fas fa-eye" id="token-eye"></i>
          </span>
        </div>
        <div style="font-size:0.72rem;color:#64748B;margin-top:6px;font-family:'JetBrains Mono',monospace">
          Supported: ghp_ &nbsp;|&nbsp; github_pat_ &nbsp;|&nbsp; gho_ &nbsp;|&nbsp; ghs_
        </div>
      </div>

      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;font-size:1rem;letter-spacing:1px;font-family:'Rajdhani',sans-serif;font-weight:700" id="login-btn">
        <i class="fas fa-rocket"></i>
        LAUNCH CONTROL PANEL
      </button>
    </form>

    <!-- Divider -->
    <div style="display:flex;align-items:center;gap:12px;margin:20px 0">
      <div class="divider" style="flex:1;margin:0"></div>
      <span style="font-size:0.7rem;color:#64748B;letter-spacing:1px">HOW TO GET A TOKEN</span>
      <div class="divider" style="flex:1;margin:0"></div>
    </div>

    <!-- Steps -->
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
      <?php $steps = [
        ['1', '#2563EB', 'GitHub Settings → Developer Settings'],
        ['2', '#7C3AED', 'Personal Access Tokens → Tokens (Classic)'],
        ['3', '#06B6D4', 'Generate new token with repo, delete_repo scopes'],
      ]; foreach ($steps as [$n, $c, $t]): ?>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:22px;height:22px;border-radius:50%;background:<?=$c?>22;border:1px solid <?=$c?>44;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:<?=$c?>;flex-shrink:0"><?=$n?></div>
        <span style="font-size:0.78rem;color:#94A3B8"><?=htmlspecialchars($t,ENT_QUOTES)?></span>
      </div>
      <?php endforeach; ?>
    </div>

    <!-- Feature Badges -->
    <div class="feature-badges">
      <?php foreach(['Three.js','GSAP','Monaco Editor','PWA','File Manager','Code Editor','REST API','Secure Sessions'] as $f): ?>
      <span class="feature-badge"><?=htmlspecialchars($f,ENT_QUOTES)?></span>
      <?php endforeach; ?>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:24px;font-size:0.72rem;color:#475569;font-family:'JetBrains Mono',monospace;letter-spacing:1px">
      MKX GITHUB CLOUD &copy; <?=date('Y')?> &nbsp;·&nbsp; Powered by GitHub REST API
    </div>

  </div><!-- /login-card -->

</div><!-- /login-page -->

<!-- Three.js -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<!-- GSAP -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>

<script>
// ─── Token visibility toggle ─────────────────────────────────────
function toggleTokenVisibility() {
  const inp = document.getElementById('token');
  const eye = document.getElementById('token-eye');
  if (inp.type === 'password') {
    inp.type = 'text';
    eye.className = 'fas fa-eye-slash';
  } else {
    inp.type = 'password';
    eye.className = 'fas fa-eye';
  }
}

// ─── Loading screen ──────────────────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(() => {
    const ls = document.getElementById('loading-screen');
    ls.classList.add('fade-out');
    gsap.to('#login-wrap', { opacity:1, duration:0.6, delay:0.1, ease:'power2.out' });
  }, 1800);
});

// ─── Login form submit ────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', function() {
  const btn = document.getElementById('login-btn');
  btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px"><i class="fas fa-circle-notch animate-spin"></i> CONNECTING TO GITHUB...</span>';
  btn.disabled = true;
});

// ─── Three.js Particle Network ────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('mkx-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0F172A, 1);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 120;

  // Fog
  scene.fog = new THREE.Fog(0x0F172A, 100, 300);

  const PARTICLE_COUNT = 180;
  const positions   = [];
  const velocities  = [];
  const colors      = [0x2563EB, 0x7C3AED, 0x06B6D4, 0x1D4ED8];

  // Particle geometry
  const geo  = new THREE.BufferGeometry();
  const pts  = new Float32Array(PARTICLE_COUNT * 3);
  const cols = new Float32Array(PARTICLE_COUNT * 3);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const x = (Math.random() - 0.5) * 260;
    const y = (Math.random() - 0.5) * 200;
    const z = (Math.random() - 0.5) * 80;
    pts[i*3]   = x; pts[i*3+1] = y; pts[i*3+2] = z;
    positions.push(new THREE.Vector3(x, y, z));
    velocities.push(new THREE.Vector3(
      (Math.random() - 0.5) * 0.08,
      (Math.random() - 0.5) * 0.08,
      (Math.random() - 0.5) * 0.02
    ));
    const c = new THREE.Color(colors[Math.floor(Math.random() * colors.length)]);
    cols[i*3] = c.r; cols[i*3+1] = c.g; cols[i*3+2] = c.b;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

  const mat = new THREE.PointsMaterial({
    size: 2.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
  });

  const particles = new THREE.Points(geo, mat);
  scene.add(particles);

  // Connection lines
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.18 });
  let linesMesh = null;
  const CONNECTION_DIST = 45;

  function buildLines() {
    const linePositions = [];
    const lineColors    = [];
    const colA = new THREE.Color(0x2563EB);
    const colB = new THREE.Color(0x06B6D4);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      for (let j = i+1; j < PARTICLE_COUNT; j++) {
        const d = positions[i].distanceTo(positions[j]);
        if (d < CONNECTION_DIST) {
          linePositions.push(positions[i].x, positions[i].y, positions[i].z);
          linePositions.push(positions[j].x, positions[j].y, positions[j].z);
          const t = 1 - d / CONNECTION_DIST;
          const col = colA.clone().lerp(colB, t);
          lineColors.push(col.r, col.g, col.b, col.r, col.g, col.b);
        }
      }
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    lgeo.setAttribute('color',    new THREE.Float32BufferAttribute(lineColors, 3));
    if (linesMesh) scene.remove(linesMesh);
    linesMesh = new THREE.LineSegments(lgeo, lineMat);
    scene.add(linesMesh);
  }

  buildLines();

  // Mouse interaction
  let mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', e => {
    mouseX = (e.clientX / window.innerWidth  - 0.5) * 60;
    mouseY = (e.clientY / window.innerHeight - 0.5) * -40;
  });

  // Animation
  let frameCount = 0;
  function animate() {
    requestAnimationFrame(animate);
    frameCount++;

    const posArr = geo.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i].add(velocities[i]);
      if (positions[i].x >  130 || positions[i].x < -130) velocities[i].x *= -1;
      if (positions[i].y >  100 || positions[i].y < -100) velocities[i].y *= -1;
      if (positions[i].z >   40 || positions[i].z <  -40) velocities[i].z *= -1;
      posArr[i*3]   = positions[i].x;
      posArr[i*3+1] = positions[i].y;
      posArr[i*3+2] = positions[i].z;
    }
    geo.attributes.position.needsUpdate = true;

    // Rebuild lines every 3 frames
    if (frameCount % 3 === 0) buildLines();

    // Camera follows mouse gently
    camera.position.x += (mouseX - camera.position.x) * 0.02;
    camera.position.y += (mouseY - camera.position.y) * 0.02;
    camera.lookAt(scene.position);

    particles.rotation.y += 0.0005;
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})();
</script>

</body>
</html>
