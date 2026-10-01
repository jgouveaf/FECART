(() => {
  "use strict";

  function normalize(text) {
    return String(text || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
      .replace(/^(robo|robot|quantum tracker)\s+/, "");
  }

  function commandFromSpeech(text) {
    const phrase = normalize(text);
    if (/^(pare|parar|para|stop|freia|frear|fique parado|fica parado|emergencia)$/.test(phrase)) return "PARAR";
    if (/^(frente|avanca|avance|andar para frente|anda para frente|ir para frente|vai para frente|siga em frente)$/.test(phrase)) return "FRENTE";
    if (/^(re|tras|para tras|andar para tras|anda para tras|volta|volte)$/.test(phrase)) return "TRAS";
    if (/^(direita|vire a direita|vira a direita|gire a direita|gira a direita)$/.test(phrase)) return "DIREITA";
    if (/^(esquerda|vire a esquerda|vira a esquerda|gire a esquerda|gira a esquerda)$/.test(phrase)) return "ESQUERDA";
    if (/^(gira|gire|girar|gira no lugar|gire no lugar)$/.test(phrase)) return "GIRAR";
    return null;
  }

  const api = Object.freeze({ normalize, commandFromSpeech });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.QuantumVoiceCommands = api;
})();
