(() => {
  "use strict";

  const VALID_COMMANDS = new Set(["FRENTE", "DIREITA", "ESQUERDA", "PARAR", "GIRAR"]);

  class SimulatorCommandController {
    constructor(timeoutMs = 900) {
      this.timeoutMs = timeoutMs;
      this.mode = "AUTONOMO";
      this.command = "FRENTE";
      this.source = "AUTONOMO";
      this.lastInputAt = 0;
    }

    setMode(mode, now = performance.now()) {
      this.mode = mode === "GESTOS" ? "GESTOS" : "AUTONOMO";
      this.command = this.mode === "AUTONOMO" ? "FRENTE" : "PARAR";
      this.source = this.mode;
      this.lastInputAt = now;
      return this.snapshot(now);
    }

    setCommand(command, source = "TESTE", now = performance.now()) {
      const normalized = String(command || "").toUpperCase();
      if (!VALID_COMMANDS.has(normalized)) return false;
      this.mode = "GESTOS";
      this.command = normalized;
      this.source = source;
      this.lastInputAt = now;
      return true;
    }

    current(now = performance.now()) {
      if (this.mode === "AUTONOMO") return "FRENTE";
      if (now - this.lastInputAt > this.timeoutMs) return "PARAR";
      return this.command;
    }

    snapshot(now = performance.now()) {
      return Object.freeze({
        mode: this.mode,
        command: this.current(now),
        source: this.source,
        ageMs: Math.max(0, now - this.lastInputAt),
      });
    }
  }

  window.QuantumSimulatorController = Object.freeze({ SimulatorCommandController, VALID_COMMANDS });
})();
