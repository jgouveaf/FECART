// Captura áudio do microfone e envia somente PCM para o Vosk local na mesma origem.
// Não envia comandos ao robô; a decisão e os limites continuam em voice-control.js.
(() => {
  "use strict";
  // GitHub Pages serves static files; browser speech recognition remains
  // available through voice-control.js without polling nonexistent APIs.
  const hostname = window.location?.hostname;
  if (hostname && !["127.0.0.1", "localhost", "[::1]"].includes(hostname)) return;
  const statusUrl = "/api/voice/status";
  let active = null;
  let generation = 0;

  async function discover(attempt = 0) {
    try {
      const response = await fetch(statusUrl, { cache: "no-store" });
      if (!response.ok) return;
      const state = await response.json();
      if (state.ready) {
        window.QuantumLocalVoice = Object.freeze({ start, stop });
        window.dispatchEvent(new Event("quantum:local-voice-ready"));
      } else if (state.loading && attempt < 20) {
        window.setTimeout(() => discover(attempt + 1), 500);
      }
    } catch { /* Servidor estático antigo: o reconhecimento do navegador permanece disponível. */ }
  }

  function stop() {
    generation++;
    const session = active;
    if (!session) return;
    active = null;
    session.controller.abort();
    session.processor.onaudioprocess = null;
    session.source.disconnect();
    session.processor.disconnect();
    session.mute.disconnect();
    session.stream.getTracks().forEach(track => track.stop());
    session.context.close().catch(() => {});
    fetch("/api/voice/stop", {
      method: "POST", headers: { "X-Voice-Session": session.id }, keepalive: true,
    }).catch(() => {});
  }

  async function start(handlers, deviceId = "") {
    stop();
    const requestedGeneration = generation;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext && !window.webkitAudioContext)
      throw new Error("O navegador não oferece captura de áudio local.");
    const audio = {
      channelCount: 1, echoCancellation: true, noiseSuppression: true,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    handlers.onDevice?.(stream.getAudioTracks()[0]?.label || "Microfone sem nome");
    navigator.mediaDevices.enumerateDevices?.().then(devices => handlers.onDevices?.(devices))
      .catch(() => {});
    if (requestedGeneration !== generation) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let context;
    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      await context.resume();
      if (requestedGeneration !== generation) {
        await context.close();
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const session = {
        id: window.crypto?.randomUUID?.() || Array.from(window.crypto.getRandomValues(new Uint8Array(16)),
          byte => byte.toString(16).padStart(2, "0")).join(""),
        stream, context, source, processor, mute, controller: new AbortController(),
        chain: Promise.resolve(), pending: 0, samples: [], phase: 0, sum: 0, count: 0,
        chunksSent: 0, chunksAccepted: 0, lastUiAt: 0,
        lastSignalAt: performance.now(), windowPeak: 0,
      };
      active = session;
      const send = bytes => {
        session.chunksSent++;
        session.pending++;
        if (session.pending > 4) {
          handlers.onError("Reconhecimento local atrasou; escuta interrompida.");
          stop();
          return;
        }
        session.chain = session.chain.then(async () => {
          if (active !== session) return;
          const response = await fetch("/api/voice/chunk", {
            method: "POST", body: bytes,
            headers: { "Content-Type": "application/octet-stream", "X-Voice-Session": session.id },
            signal: session.controller.signal,
          });
          if (!response.ok) throw new Error(`Reconhecimento local: HTTP ${response.status}`);
          const result = await response.json();
          if (active !== session) return;
          session.chunksAccepted++;
          if (result.partial) handlers.onInterim(result.partial);
          if (result.final) handlers.onFinal(result.final);
        }).catch(error => {
          if (active === session && error.name !== "AbortError") {
            handlers.onError(error.message || "Falha no reconhecimento local.");
            stop();
          }
        }).finally(() => { session.pending--; });
      };
      processor.onaudioprocess = event => {
        if (active !== session) return;
        const input = event.inputBuffer.getChannelData(0);
        let peak = 0;
        for (const sample of input) {
          peak = Math.max(peak, Math.abs(sample));
          session.sum += sample;
          session.count++;
          session.phase += 16000 / context.sampleRate;
          if (session.phase < 1) continue;
          const value = Math.max(-1, Math.min(1, session.sum / session.count));
          session.samples.push(Math.round(value * (value < 0 ? 32768 : 32767)));
          session.phase -= 1;
          session.sum = 0;
          session.count = 0;
        }
        const now = performance.now();
        session.windowPeak = Math.max(session.windowPeak, peak);
        if (peak >= 0.0001) session.lastSignalAt = now;
        if (session.samples.length >= 3200) {
          const pcm = new Int16Array(session.samples.splice(0, 4000));
          // Depois de alguns segundos de silêncio total, não ocupe a CPU com
          // blocos zerados. A escuta continua e retoma quando houver sinal.
          if (now - session.lastSignalAt < 4000) send(pcm.buffer);
        }
        if (now - session.lastUiAt >= 1000) {
          const silence = now - session.lastSignalAt >= 3000 ? " · sem sinal; escolha outra entrada" : "";
          handlers.onAudio(`Microfone local · sinal ${(session.windowPeak * 100).toFixed(2)}% · blocos ${session.chunksAccepted}/${session.chunksSent}${silence}`);
          session.lastUiAt = now;
          session.windowPeak = 0;
        }
      };
      handlers.onAudio("Reconhecimento local ativo · aguardando áudio do microfone…");
    } catch (error) {
      if (context) context.close().catch(() => {});
      stream.getTracks().forEach(track => track.stop());
      throw error;
    }
  }

  discover();
})();
