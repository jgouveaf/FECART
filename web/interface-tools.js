/* Presentation only: no camera, serial, robot commands or copied live DOM. */
(() => {
  'use strict';
  const root = document.documentElement;
  const zoomContent = document.getElementById('zoomContent');
  const bar = document.createElement('div');
  bar.className = 'interface-tools';
  bar.innerHTML = '<button type="button" id="uiZoom" aria-pressed="false">Q · Zoom</button><button type="button" id="uiHelp" aria-pressed="false">P · Explicar</button><button type="button" id="uiTheme">Tema escuro</button><span id="uiHint" role="status">Q amplia · P explica · Esc fecha</span>';
  document.body.append(bar);
  const help = document.createElement('div');
  help.className = 'interface-help';
  help.hidden = true;
  help.innerHTML = '<section role="dialog" aria-modal="false" aria-labelledby="uiHelpTitle"><h2 id="uiHelpTitle"></h2><p id="uiHelpText"></p><button type="button" id="uiHelpClose">Fechar · Esc</button></section>';
  document.body.append(help);
  const zoomButton = document.getElementById('uiZoom');
  const helpButton = document.getElementById('uiHelp');
  const themeButton = document.getElementById('uiTheme');
  let zoom = false, picking = false, frame = 0;
  let point = { x: innerWidth / 2, y: innerHeight / 2 };
  let zoomOrigin = { x: 0, y: 0 };
  let target = null, previousFocus = null;
  function theme(value) {
    root.dataset.theme = value;
    themeButton.textContent = value === 'dark' ? 'Tema claro' : 'Tema escuro';
    themeButton.setAttribute('aria-label', `Ativar ${themeButton.textContent.toLowerCase()}`);
    try { localStorage.setItem('quantumTheme:v1', value); } catch (_) { /* Optional preference. */ }
  }
  let saved = 'light';
  try { saved = localStorage.getItem('quantumTheme:v1') || 'light'; } catch (_) {}
  theme(saved === 'dark' ? 'dark' : 'light');
  themeButton.onclick = () => theme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  function renderZoom() {
    frame = 0;
    if (!zoom) return;
    zoomContent.style.transformOrigin = `${point.x + scrollX - zoomOrigin.x}px ${point.y + scrollY - zoomOrigin.y}px`;
    zoomContent.style.transform = 'scale(1.75)';
  }
  function setZoom(value) {
    if (value && !zoom) {
      // Measure before transforming. Sidebar and sticky header remain outside.
      const rect = zoomContent.getBoundingClientRect();
      zoomOrigin = { x: rect.left + scrollX, y: rect.top + scrollY };
    }
    zoom = value;
    zoomButton.setAttribute('aria-pressed', String(value));
    root.classList.toggle('ui-zooming', value);
    if (value) renderZoom();
    else { cancelAnimationFrame(frame); frame = 0; zoomContent.style.removeProperty('transform'); zoomContent.style.removeProperty('transform-origin'); }
  }
  zoomButton.onclick = () => setZoom(!zoom);
  document.addEventListener('pointermove', event => {
    point = { x: event.clientX, y: event.clientY };
    if (!event.target.closest('.interface-tools, .interface-help')) target = event.target;
    if (zoom && !frame) frame = requestAnimationFrame(renderZoom);
  }, { passive: true });
  // Restore the normal layout before scrolling, resizing or leaving the page.
  addEventListener('scroll', () => setZoom(false), { passive: true });
  addEventListener('resize', () => setZoom(false));
  addEventListener('blur', () => { setZoom(false); closeHelp(); });
  const descriptions = {
    toggleCamera: 'Ativa ou desliga a câmera escolhida para a prévia e o processamento local.',
    toggleSimulation: 'Pausa ou retoma a animação da simulação virtual.',
    resetSimulation: 'Reinicia o cenário da simulação virtual.',
    testTargetSimulator: 'Seleciona o simulador como destino dos comandos de teste.',
    testTargetArduino: 'Seleciona o Arduino real como destino. Os comandos dependem da conexão e das condições de liberação existentes.',
    toggleGestures: 'Ativa ou desliga a leitura dos dedos: 1 frente, 2 direita, 3 esquerda, 4 ré e 5 girar. Sem mão ou mão fechada solicita parada.',
    preparePersonFollow: 'Prepara a câmera e o Modo 2 para acompanhar a pessoa selecionada. Não substitui a liberação de segurança do Arduino.',
    pausePersonFollow: 'Pausa o acompanhamento da pessoa e solicita parada.',
    registerPerson: 'Valida as amostras do rosto e salva o cadastro neste navegador, com o nome informado.',
    exportIdentities: 'Baixa um backup dos cadastros locais para guardar ou transferir para outro navegador.',
    importIdentities: 'Permite escolher um arquivo de backup para recuperar cadastros de pessoas.',
    flashOfficialFirmware: 'Grava o firmware oficial pré-compilado no Arduino UNO. Editar o texto do código não altera esse arquivo compilado.',
    copyCode: 'Copia o texto do editor para a área de transferência.',
    downloadCode: 'Baixa o texto do sketch selecionado como arquivo.',
    clearEventLog: 'Limpa a lista de eventos exibida no painel.',
    emergencyStop: 'Envia a parada de emergência ao Arduino conectado. A liberação precisa ser feita explicitamente pelo operador.',
    personFollowPanel: 'Modo 2: selecione uma pessoa cadastrada para acompanhamento por rosto e corpo. A perda do alvo solicita parada. Ainda requer validação física.',
    robotCanvas: 'Prévia virtual do movimento e dos obstáculos. A simulação não comprova o comportamento do carrinho físico.',
    cameraStage: 'Prévia da câmera e das detecções locais. A câmera envia imagens ao navegador; o Arduino recebe somente comandos.',
    uiTheme: 'Alterna entre aparência clara e escura. Sua preferência fica salva neste navegador.'
  };
  function explain(element) {
    if (!element || element.closest('.interface-tools, .interface-help')) return;
    const item = element.closest('button, a, input, select, textarea, canvas, [data-help], .metric-card, .diagnostic-card, .robot-mode, article, .telemetry, .person-follow-panel, .camera-stage, section') || element;
    const context = item.closest('section, article, .panel');
    const title = item.getAttribute('aria-label') || item.querySelector('h2,h3,strong')?.textContent || item.textContent.trim().slice(0, 90) || 'Informação do painel';
    const described = (item.getAttribute('aria-describedby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    const paragraph = context?.querySelector('p')?.textContent;
    const mode = item.dataset.robotMode;
    const command = item.dataset.simulatorCommand || item.dataset.motorTest;
    const action = mode ? `Seleciona o Modo ${mode}: ${{1: 'andar de forma autônoma e desviar pelo sensor frontal', 2: 'acompanhar a pessoa selecionada pela câmera', 3: 'receber movimentos reconhecidos pelos gestos da mão'}[mode]}.` : command ? `Comando ${command.toLowerCase()} para ${item.dataset.motorTest ? 'o teste físico supervisionado por USB' : 'o destino de teste selecionado'}.` : '';
    const text = descriptions[item.id] || item.dataset.help || action || item.getAttribute('title') || described || (item.matches('button,a') ? `Controle “${title}”. ${item.disabled ? 'Está indisponível no estado atual.' : 'Feche a explicação para utilizá-lo.'}${paragraph ? ` ${paragraph}` : ''}` : paragraph || item.textContent.trim().slice(0, 350));
    document.getElementById('uiHelpTitle').textContent = title.trim();
    document.getElementById('uiHelpText').textContent = text;
    setZoom(false);
    picking = false;
    helpButton.setAttribute('aria-pressed', 'false');
    previousFocus = document.activeElement;
    help.hidden = false;
    document.getElementById('uiHelpClose').focus({ preventScroll: true });
  }
  function closeHelp() {
    const restore = help.contains(document.activeElement);
    help.hidden = true; picking = false; helpButton.setAttribute('aria-pressed', 'false');
    document.getElementById('uiHint').textContent = 'Q amplia · P explica · Esc fecha';
    if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  helpButton.onclick = () => {
    closeHelp(); picking = true; helpButton.setAttribute('aria-pressed', 'true');
    document.getElementById('uiHint').textContent = 'Clique no elemento que deseja entender · Esc cancela';
  };
  document.getElementById('uiHelpClose').onclick = closeHelp;
  document.addEventListener('click', event => {
    if (!help.hidden && !event.target.closest('.interface-tools, .interface-help')) {
      closeHelp();
      if (!event.target.closest('#emergencyStop')) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if (picking && !event.target.closest('.interface-tools')) {
      // Emergency always keeps its original action, including in help mode.
      if (event.target.closest('#emergencyStop')) { closeHelp(); return; }
      event.preventDefault(); event.stopImmediatePropagation(); explain(event.target);
    }
  }, true);
  // The original emergency button bypasses explanation and dismissal handling.
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { setZoom(false); closeHelp(); return; }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || root.classList.contains('qt-locked') || event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'q') { event.preventDefault(); closeHelp(); setZoom(!zoom); }
    if (key === 'p') { event.preventDefault(); if (!help.hidden) closeHelp(); else explain(target || document.activeElement); }
  });
})();
