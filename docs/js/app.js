// ═══════════════════════════════════════════════════
//  Quantum Store — Main JS (shared across pages)
// ═══════════════════════════════════════════════════

// ─── SIDEBAR TOGGLE ──────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar) return;
  sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active');
}

// ─── SEARCH ──────────────────────────────────────────────
function handleSearch(e) {
  if (e.key === 'Enter') {
    const q = document.getElementById('search-input')?.value?.trim();
    if (q) {
      // Redirect to app page if "quantum" anywhere in query
      if (q.toLowerCase().includes('quantum') || q.toLowerCase().includes('tracker')) {
        location.href = 'app.html';
      }
    }
  }
}

// ─── APP GRID FILTER ─────────────────────────────────────
function filterApps(tag, btn) {
  const cards = document.querySelectorAll('#app-grid .app-card');
  cards.forEach(card => {
    const tags = card.getAttribute('data-tags') || '';
    card.style.display = (tag === 'all' || tags.includes(tag)) ? '' : 'none';
  });
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ─── DETAIL PAGE TABS ─────────────────────────────────────
function showTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.dtab').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('tab-content-' + id);
  if (el) el.classList.add('active');
  if (btn) btn.classList.add('active');
}

// ─── SCROLL SCREENSHOTS ──────────────────────────────────
function scrollScreenshots(dir) {
  const track = document.getElementById('screenshots-track');
  if (!track) return;
  track.scrollBy({ left: dir * 380, behavior: 'smooth' });
}

// ─── INSTALL MODAL ────────────────────────────────────────
function startInstall() {
  const modal = document.getElementById('install-modal');
  if (modal) modal.classList.add('active');
}

function closeModal() {
  const modal = document.getElementById('install-modal');
  if (modal) modal.classList.remove('active');
}

function confirmInstall() {
  const actions = document.getElementById('modal-actions');
  const progressWrap = document.getElementById('modal-progress');
  const fill = document.getElementById('progress-fill');
  const text = document.getElementById('progress-text');
  if (!actions || !progressWrap) return;

  actions.style.display = 'none';
  progressWrap.style.display = 'block';

  const steps = [
    [10, 'Verificando requisitos...'],
    [30, 'Baixando pacote...'],
    [55, 'Extraindo arquivos...'],
    [80, 'Configurando...'],
    [100, 'Concluído! Redirecionando para instruções...']
  ];

  let i = 0;
  const advance = () => {
    if (i >= steps.length) {
      setTimeout(() => {
        closeModal();
        showTab('instalacao', document.getElementById('tab-instalacao'));
        actions.style.display = '';
        progressWrap.style.display = 'none';
        if (fill) fill.style.width = '0%';
        i = 0;
      }, 800);
      return;
    }
    const [pct, msg] = steps[i++];
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = msg;
    setTimeout(advance, 600);
  };
  advance();
}

// ─── DOWNLOAD APP ─────────────────────────────────────────
function downloadApp() {
  window.open('https://github.com/jgouveaf/FECART/archive/refs/heads/main.zip', '_blank');
}

// ─── WISHLIST ─────────────────────────────────────────────
function toggleWishlist(btn) {
  btn.classList.toggle('wishlisted');
  const isWish = btn.classList.contains('wishlisted');
  btn.title = isWish ? 'Remover da lista de desejos' : 'Adicionar à lista de desejos';
  showToast(isWish ? '❤️ Adicionado à lista de desejos' : 'Removido da lista de desejos');
}

// ─── SHARE ────────────────────────────────────────────────
function shareApp() {
  if (navigator.share) {
    navigator.share({ title: 'Quantum Tracker', text: 'Sistema de rastreamento com IA!', url: location.href });
  } else {
    navigator.clipboard?.writeText(location.href).then(() => showToast('🔗 Link copiado!'));
  }
}

// ─── COPY CODE ────────────────────────────────────────────
function copyCode(text) {
  navigator.clipboard?.writeText(text).then(() => showToast('✅ Código copiado!'));
}

// ─── TOAST ────────────────────────────────────────────────
function showToast(msg) {
  const existing = document.querySelector('.qs-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'qs-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px);
    background:#2a2a2a; color:#e8eaed; border:1px solid #444; border-radius:24px;
    padding:10px 20px; font-size:.88rem; z-index:9999;
    box-shadow:0 8px 24px rgba(0,0,0,.5);
    transition: all .25s cubic-bezier(.4,0,.2,1); opacity:0;
  `;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    document.getElementById('search-input')?.focus();
  }
});
