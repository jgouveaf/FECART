(() => {
  "use strict";
  const button = document.getElementById("jarvisConnect");
  const frame = document.getElementById("jarvisFrame");
  const external = document.getElementById("jarvisExternal");
  const hint = document.getElementById("jarvisHint");
  const status = document.getElementById("jarvisStatus");
  const url = "http://127.0.0.1:8002/login";
  if (!button || !frame || !external || !hint || !status) return;

  const hostname = window.location?.hostname;
  if (hostname && !["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    button.hidden = true;
    frame.hidden = true;
    external.hidden = false;
    external.href = "http://127.0.0.1:8766/#jarvis";
    external.textContent = "Abrir JARVIS na cópia local";
    status.textContent = "O JARVIS depende do aplicativo instalado no seu computador.";
    hint.textContent = "No PC do projeto, execute ABRIR_ESTA_VERSAO.bat e use o link acima. O site online e a apresentação funcionam sem esse aplicativo.";
    return;
  }

  let state = "offline";
  let timer = null;
  let polls = 0;

  function render(data) {
    const previousState = state;
    state = data.state || "offline";
    button.disabled = false;
    frame.hidden = state !== "ready";
    external.hidden = state !== "ready";
    if (state === "ready") {
      button.textContent = "Recarregar painel do JARVIS";
      status.textContent = "JARVIS local disponível. Entre com a chave de Remote Control.";
      hint.textContent = "No aplicativo, abra Remote Control e digite aqui a chave exibida. Autorize o microfone para conversar.";
      // An iframe that previously showed ERR_CONNECTION_REFUSED keeps that
      // error page until explicitly navigated after the service returns.
      if (previousState !== "ready") {
        frame.src = "about:blank";
        frame.src = url;
      }
    } else if (state === "starting") {
      button.textContent = "Verificar JARVIS";
      status.textContent = "JARVIS iniciado; aguardando o painel local abrir…";
      hint.textContent = "Veja a janela do aplicativo. Se ela pedir configuração, conclua-a; depois clique em Verificar JARVIS.";
    } else {
      if (previousState === "ready") frame.src = "about:blank";
      button.textContent = "Iniciar JARVIS no computador";
      status.textContent = data.error || (state === "unavailable"
        ? "Instalação local do JARVIS não encontrada."
        : "JARVIS está fechado. Inicie-o aqui para conversar no site.");
      hint.textContent = "A conversa do JARVIS não envia comandos de movimento ao robô.";
    }
  }

  async function request(path, options) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(path, { cache: "no-store", signal: controller.signal, ...options });
      if (!response.ok) throw new Error("Serviço local indisponível");
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function check() {
    try {
      render(await request("/api/jarvis/status"));
    } catch {
      render({ state: "unavailable", error: "Abra esta cópia pelo servidor local na porta 8766 para iniciar o JARVIS." });
    }
  }

  function stopPolling() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  async function poll() {
    await check();
    polls += 1;
    if (state === "ready" || state === "failed" || state === "unavailable" || polls >= 30) {
      stopPolling();
      if (state === "starting") {
        status.textContent = "JARVIS está aberto, mas o painel ainda não respondeu.";
        hint.textContent = "Confira a janela do aplicativo e clique em Verificar JARVIS depois de resolver qualquer aviso.";
      }
    }
  }

  button.addEventListener("click", async () => {
    if (state === "ready") {
      frame.src = "about:blank";
      frame.src = url;
      return;
    }
    if (state === "starting") {
      await poll();
      return;
    }
    button.disabled = true;
    status.textContent = "Iniciando JARVIS…";
    try {
      render(await request("/api/jarvis/start", { method: "POST" }));
      if (state === "starting") {
        stopPolling();
        polls = 0;
        timer = window.setInterval(poll, 1000);
      }
    } catch {
      render({ state: "unavailable", error: "Não foi possível pedir a abertura do JARVIS ao servidor local." });
    }
  });

  check();
  window.setInterval(check, 5000);
})();
