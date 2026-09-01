// Configurações do site que o operador pode editar pela aba "Códigos".
// Guardado só no localStorage deste navegador: recarregue a página (F5)
// depois de salvar para os módulos de câmera/gestos lerem os novos valores.
// Isto NÃO altera o firmware gravado no Arduino: pinos, distância de
// obstáculo e tempos de manobra só mudam editando o .ino e regravando pelo
// Arduino IDE.
(() => {
  "use strict";

  const STORAGE_KEY = "quantumUserConfig:v1";
  const VALID_COMMANDS = Object.freeze(["FRENTE", "TRAS", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"]);

  const DEFAULTS = Object.freeze({
    gestureMap: Object.freeze({ 1: "FRENTE", 2: "DIREITA", 3: "ESQUERDA", 4: "PARAR", 5: "GIRAR" }),
    minConfidence: 0.65,
    commandCooldownMs: 650,
    unstableStopMs: 500,
  });

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function sanitize(raw) {
    const gestureMap = { ...DEFAULTS.gestureMap };
    if (raw && typeof raw === "object" && raw.gestureMap && typeof raw.gestureMap === "object") {
      for (const finger of [1, 2, 3, 4, 5]) {
        const value = raw.gestureMap[finger];
        if (typeof value === "string" && VALID_COMMANDS.includes(value.toUpperCase())) {
          gestureMap[finger] = value.toUpperCase();
        }
      }
    }
    return Object.freeze({
      gestureMap: Object.freeze(gestureMap),
      minConfidence: clampNumber(raw?.minConfidence, 0.3, 0.95, DEFAULTS.minConfidence),
      commandCooldownMs: clampNumber(raw?.commandCooldownMs, 200, 3000, DEFAULTS.commandCooldownMs),
      unstableStopMs: clampNumber(raw?.unstableStopMs, 150, 3000, DEFAULTS.unstableStopMs),
    });
  }

  function readStorage() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  let current = sanitize(readStorage());

  function get() {
    return current;
  }

  function isCustomized() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  function save(partial) {
    const merged = sanitize({
      ...current,
      ...partial,
      gestureMap: { ...current.gestureMap, ...(partial && partial.gestureMap ? partial.gestureMap : {}) },
    });
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Armazenamento indisponível (modo privado, cota cheia): mantém em memória.
    }
    current = merged;
    return current;
  }

  function reset() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignora
    }
    current = sanitize(null);
    return current;
  }

  window.QuantumUserConfig = Object.freeze({
    defaults: DEFAULTS,
    validCommands: VALID_COMMANDS,
    get,
    save,
    reset,
    isCustomized,
  });
})();
