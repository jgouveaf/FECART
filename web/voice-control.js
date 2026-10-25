(() => {
  "use strict";

  const startButton = document.getElementById("voiceStart");
  const stopButton = document.getElementById("voiceStop");
  const status = document.getElementById("voiceStatus");
  const audioState = document.getElementById("voiceAudio");
  const interim = document.getElementById("voiceInterim");
  const transcript = document.getElementById("voiceTranscript");
  const commandLabel = document.getElementById("voiceCommand");
  const targetLabel = document.getElementById("voiceTarget");
  const delivery = document.getElementById("voiceDelivery");
  const micSelect = document.getElementById("voiceMicSelect");
  if (!startButton || !stopButton || !status || !audioState || !interim || !transcript || !commandLabel || !targetLabel || !delivery) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const parse = window.QuantumVoiceCommands?.commandFromSpeech;
  const PULSE_MS = 800;
  let recognition = null;
  let armed = false;
  let recognitionRunning = false;
  let pulseTimer = null;
  let restartTimer = null;
  let moving = false;

  function showDevices(devices) {
    if (!micSelect) return;
    const selected = micSelect.value;
    const inputs = devices.filter(device => device.kind === "audioinput" && device.deviceId);
    micSelect.replaceChildren(new Option("Microfone padrão do navegador", ""));
    inputs.forEach((device, index) => micSelect.add(new Option(
      device.label || `Microfone ${index + 1}`, device.deviceId,
    )));
    if (inputs.some(device => device.deviceId === selected)) micSelect.value = selected;
  }

  function refreshDevices() {
    window.navigator?.mediaDevices?.enumerateDevices?.().then(showDevices).catch(() => {});
  }

  const modeFour = () => window.QuantumControl?.state?.mode?.id === 4
    && window.QuantumControl.state.mode.phase === "ACTIVE";
  const simulatorOnly = () => window.QuantumSimulatorVoice?.active === true;
  const voiceReady = () => modeFour() || simulatorOnly();

  function emit(command) {
    const virtual = simulatorOnly();
    targetLabel.textContent = virtual ? "Simulador" : "Arduino real";
    delivery.textContent = virtual ? `${command} aplicado ao simulador.` : `${command}: aguardando envio ao Arduino…`;
    window.dispatchEvent(new CustomEvent("quantum:voice-command", { detail: {
      command, emittedAt: performance.now(), modeGeneration: window.quantumRobot?.modeGeneration,
      simulatorOnly: virtual,
    } }));
  }

  function stopMotion() {
    if (pulseTimer) window.clearTimeout(pulseTimer);
    pulseTimer = null;
    if (moving && voiceReady()) emit("PARAR");
    moving = false;
    commandLabel.textContent = "PARAR";
  }

  function disarm(message) {
    armed = false;
    if (restartTimer) window.clearTimeout(restartTimer);
    restartTimer = null;
    stopMotion();
    if (recognitionRunning) {
      try { recognition?.abort(); } catch { /* serviço já encerrado */ }
    }
    window.QuantumLocalVoice?.stop();
    recognitionRunning = false;
    audioState.textContent = "Microfone desligado.";
    interim.textContent = "—";
    status.textContent = message;
    syncButtons();
  }

  function syncButtons() {
    startButton.disabled = (!Recognition && !window.QuantumLocalVoice) || !parse || armed;
    stopButton.disabled = !armed && !moving;
    targetLabel.textContent = simulatorOnly() ? "Simulador" : modeFour() ? "Arduino real" : "—";
    if ((!Recognition && !window.QuantumLocalVoice) || !parse)
      status.textContent = "Reconhecimento de fala indisponível. Abra pelo servidor da terceira cópia e aguarde o modelo local, ou use Chrome/Edge.";
  }

  function listen() {
    if (!armed || document.hidden || recognitionRunning) return;
    try {
      recognition.start();
      recognitionRunning = true;
      audioState.textContent = "Solicitando acesso ao microfone…";
      status.textContent = voiceReady()
        ? "Ouvindo e pronto para comandos · diga frente, trás, direita, esquerda, girar ou parar."
        : "Ouvindo para diagnóstico · escolha o Modo 4 para enviar comandos.";
    } catch (error) {
      disarm(`Não foi possível iniciar o microfone: ${error.message || error}`);
    }
  }

  function handleCommand(command) {
    if (!armed) return;
    stopMotion();
    if (!voiceReady()) {
      commandLabel.textContent = command;
      delivery.textContent = "Fala reconhecida; Modo 4 não ativo. Nenhum comando enviado.";
      return;
    }
    if (command === "PARAR") {
      emit("PARAR");
      status.textContent = "PARAR reconhecido.";
      return;
    }
    moving = true;
    commandLabel.textContent = command;
    emit(command);
    status.textContent = `${command} reconhecido · pulso limitado a ${PULSE_MS / 1000} s.`;
    pulseTimer = window.setTimeout(stopMotion, PULSE_MS);
  }

  startButton.addEventListener("click", () => {
    if (armed || !parse) return;
    const local = window.QuantumLocalVoice;
    if (local) {
      armed = true;
      syncButtons();
      status.textContent = "Abrindo microfone para reconhecimento local…";
      audioState.textContent = "Solicitando acesso ao microfone…";
      local.start({
        onDevice: name => { if (armed) audioState.textContent = `Entrada ativa: ${name}`; },
        onDevices: showDevices,
        onAudio: text => { if (armed) audioState.textContent = text; },
        onInterim: text => { if (armed) interim.textContent = text || "—"; },
        onFinal: text => {
          if (!armed || !text?.trim()) return;
          transcript.textContent = text;
          interim.textContent = "—";
          const command = parse(text);
          if (command) handleCommand(command);
          else {
            stopMotion();
            commandLabel.textContent = "NÃO RECONHECIDO";
            delivery.textContent = "Frase completa sem comando válido; nada enviado.";
            status.textContent = "Frase não reconhecida como comando; motores parados.";
          }
        },
        onError: text => { if (armed) disarm(text); },
      }, micSelect?.value || "").then(() => {
        if (!armed) local.stop();
        else status.textContent = voiceReady()
          ? "Ouvindo localmente · diga frente, trás, direita, esquerda, girar ou parar."
          : "Ouvindo localmente para diagnóstico · escolha o Modo 4 para enviar comandos.";
      }).catch(error => {
        if (armed) disarm(`Falha ao abrir microfone local: ${error.message || error}`);
      });
      return;
    }
    if (!Recognition) return;
    try { recognition = new Recognition(); }
    catch (error) {
      status.textContent = `Falha ao abrir reconhecimento de fala: ${error.message || error}`;
      return;
    }
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onaudiostart = () => { if (armed) audioState.textContent = "Microfone recebendo áudio."; };
    recognition.onsoundstart = () => { if (armed) audioState.textContent = "Som detectado."; };
    recognition.onspeechstart = () => { if (armed) audioState.textContent = "Voz detectada; aguardando texto."; };
    recognition.onnomatch = () => {
      if (armed) status.textContent = "Voz ouvida, mas o serviço não reconheceu palavras.";
    };
    recognition.onresult = (event) => {
      if (!armed) return;
      let selected = null;
      let heardFinal = false;
      const partial = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const spoken = result[0]?.transcript || "";
        if (!result.isFinal) { if (spoken.trim()) partial.push(spoken.trim()); continue; }
        if (!spoken.trim()) continue;
        heardFinal = true;
        transcript.textContent = spoken || "—";
        const command = parse(spoken);
        if (command === "PARAR") { selected = "PARAR"; break; }
        if (command) selected = command;
      }
      interim.textContent = partial.join(" ") || "—";
      if (selected) handleCommand(selected);
      else if (heardFinal) {
        stopMotion();
        commandLabel.textContent = "NÃO RECONHECIDO";
        delivery.textContent = "Frase completa sem comando válido; nada enviado.";
        status.textContent = "Frase não reconhecida como comando; motores parados.";
      }
    };
    recognition.onerror = (event) => {
      if (!armed || event.error === "aborted") return;
      if (event.error === "no-speech") {
        audioState.textContent = "Nenhuma fala detectada; tentando novamente.";
        return;
      }
      const guidance = {
        "not-allowed": "Permita o microfone nas configurações do navegador.",
        "audio-capture": "Nenhum microfone disponível para o navegador.",
        "network": "O serviço de fala do navegador falhou. Abra a terceira cópia pelo servidor com reconhecimento local.",
        "service-not-allowed": "Este navegador bloqueou o serviço de fala. Use o reconhecimento local da terceira cópia.",
      }[event.error] || "Confira o microfone e tente novamente.";
      disarm(`Escuta interrompida (${event.error || "erro"}). ${guidance}`);
    };
    recognition.onend = () => {
      recognitionRunning = false;
      interim.textContent = "—";
      if (armed) audioState.textContent = "Escuta pausou; reiniciando.";
      if (armed && !document.hidden) {
        restartTimer = window.setTimeout(listen, 220);
      }
    };
    armed = true;
    syncButtons();
    listen();
  });

  stopButton.addEventListener("click", () => disarm("Escuta desligada; comando PARAR solicitado."));
  micSelect?.addEventListener("change", () => {
    if (armed) disarm("Microfone alterado; clique em Iniciar escuta para testar a nova entrada.");
  });
  window.navigator?.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
  refreshDevices();
  window.addEventListener("quantum:mode-will-change", (event) => {
    if (armed) disarm("Modo alterado; escuta desligada por segurança. Inicie novamente se desejar.");
  });
  window.addEventListener("quantum:mode-changed", syncButtons);
  window.addEventListener("quantum:local-voice-ready", () => {
    syncButtons();
    if (!armed) status.textContent = "Reconhecimento local pronto. Clique em Iniciar escuta.";
  });
  window.addEventListener("quantum:voice-delivery", (event) => {
    if (simulatorOnly()) return;
    if (event.detail?.command !== commandLabel.textContent) return;
    delivery.textContent = event.detail?.text || "Estado de envio desconhecido.";
  });
  window.addEventListener("quantum:simulator-mode-changed", () => {
    if (armed) disarm("Destino ou modo do simulador alterado; escuta desligada por segurança.");
    else syncButtons();
  });
  window.addEventListener("quantum:state-changed", (event) => {
    if (event.detail?.section === "robot" && !event.detail.current.robot.connected && moving)
      disarm("Arduino desconectado; escuta desligada.");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && armed) disarm("Aba oculta; escuta desligada por segurança.");
  });
  window.addEventListener("pagehide", () => disarm("Página encerrada."));
  syncButtons();
})();
