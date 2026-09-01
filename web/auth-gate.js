// Tela de acesso simples do painel Quantum Tracker.
// AVISO: isto NÃO é segurança de verdade. O painel é um site estático
// publicado no GitHub Pages; qualquer pessoa pode ler este arquivo (ou o
// histórico do Git) e ver o usuário/senha abaixo. Serve só para afastar
// visitantes casuais, não para proteger o robô de alguém que abra o código.
(() => {
  "use strict";

  const VALID_USER = "joao23";
  const VALID_PASS = "230511";
  const STORAGE_KEY = "quantumAuth:v1";

  function isUnlocked() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "ok";
    } catch {
      return false;
    }
  }

  function unlock() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "ok");
    } catch {
      // Sem storage: a sessão libera mesmo assim, só não persiste ao recarregar.
    }
    document.documentElement.classList.remove("qt-locked");
    const overlay = document.getElementById("authOverlay");
    if (overlay) overlay.hidden = true;
  }

  function buildOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "authOverlay";
    overlay.className = "auth-overlay";
    overlay.innerHTML = `
      <form class="auth-card" id="authForm" autocomplete="off">
        <span class="brand-mark">Q</span>
        <h1>Quantum Tracker</h1>
        <p>Acesso restrito ao painel de controle.</p>
        <label>Usuário<input id="authUser" name="usuario" type="text" autocomplete="username" required></label>
        <label>Senha<input id="authPass" name="senha" type="password" autocomplete="current-password" required></label>
        <button type="submit" class="primary-button">Entrar</button>
        <small id="authError" role="alert" hidden>Usuário ou senha incorretos.</small>
        <small class="auth-note">Este bloqueio é só uma barreira simples do lado do navegador; não protege dados sensíveis.</small>
      </form>`;
    document.body.prepend(overlay);

    const form = overlay.querySelector("#authForm");
    const error = overlay.querySelector("#authError");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const user = overlay.querySelector("#authUser").value.trim();
      const pass = overlay.querySelector("#authPass").value;
      if (user === VALID_USER && pass === VALID_PASS) {
        error.hidden = true;
        unlock();
      } else {
        error.hidden = false;
        overlay.querySelector("#authPass").value = "";
        overlay.querySelector("#authPass").focus();
      }
    });
  }

  function init() {
    if (isUnlocked()) {
      document.documentElement.classList.remove("qt-locked");
      return;
    }
    buildOverlay();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.QuantumAuthGate = Object.freeze({
    isUnlocked,
    lock() {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      window.location.reload();
    },
  });
})();
