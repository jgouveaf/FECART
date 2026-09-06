// Configurações do site que o operador pode editar pela aba "Códigos".
// Guardado só no localStorage deste navegador. Uma notificação local aplica
// os novos valores aos módulos de câmera/gestos assim que o operador salva.
// Isto NÃO altera o firmware gravado no Arduino: pinos, distância de
// obstáculo e tempos de manobra só mudam editando o .ino e regravando pelo
// Arduino IDE.
(() => {
  "use strict";

  const STORAGE_KEY = "quantumUserConfig:v1";
  const VALID_COMMANDS = Object.freeze(["FRENTE", "TRAS", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"]);

  const DEFAULTS = Object.freeze({
    gestureMap: Object.freeze({ 1: "FRENTE", 2: "DIREITA", 3: "ESQUERDA", 4: "TRAS", 5: "GIRAR" }),
    minConfidence: 0.65,
    commandCooldownMs: 300,
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
      mappingVersion: 2,
      gestureMap: Object.freeze(gestureMap),
      minConfidence: clampNumber(raw?.minConfidence, 0.3, 0.95, DEFAULTS.minConfidence),
      commandCooldownMs: clampNumber(raw?.commandCooldownMs, 200, 3000, DEFAULTS.commandCooldownMs),
      unstableStopMs: clampNumber(raw?.unstableStopMs, 150, 500, DEFAULTS.unstableStopMs),
    });
  }

  function readStorage() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      // Migrar apenas o antigo 4=PARAR. Preservar outros comandos/ajustes e
      // respeitar remapeamentos feitos explicitamente depois desta versao.
      if (raw && !raw.mappingVersion && raw.gestureMap?.[4]?.toUpperCase?.() === "PARAR") {
        return { ...raw, gestureMap: { ...raw.gestureMap, 4: "TRAS" } };
      }
      return raw;
    } catch {
      return null;
    }
  }

  let current = sanitize(readStorage());
  let lastSavePersistent = true;

  function notifyChanged(source) {
    window.dispatchEvent(new CustomEvent("quantum:user-config-changed", {
      detail: { config: current, persistent: lastSavePersistent, source },
    }));
  }

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
      const serialized = JSON.stringify(merged);
      window.localStorage.setItem(STORAGE_KEY, serialized);
      lastSavePersistent = window.localStorage.getItem(STORAGE_KEY) === serialized;
    } catch {
      lastSavePersistent = false;
    }
    current = merged;
    notifyChanged("save");
    return current;
  }

  function reset() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      lastSavePersistent = window.localStorage.getItem(STORAGE_KEY) === null;
    } catch {
      lastSavePersistent = false;
    }
    current = sanitize(null);
    notifyChanged("reset");
    return current;
  }

  window.QuantumUserConfig = Object.freeze({
    defaults: DEFAULTS,
    validCommands: VALID_COMMANDS,
    get,
    save,
    reset,
    isCustomized,
    wasLastSavePersistent() { return lastSavePersistent; },
  });
})();
