(() => {
  "use strict";

  const MAX_CODE_FILE_BYTES = 256 * 1024;

  function byteLength(value) {
    const text = String(value ?? "");
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer !== "undefined") return Buffer.byteLength(text, "utf8");
    return unescape(encodeURIComponent(text)).length;
  }

  function normalizeImportedCode(value) {
    return String(value ?? "").replace(/^\uFEFF/, "");
  }

  function validateArduinoCode(value) {
    const code = String(value ?? "");
    if (!code.trim()) return "O arquivo está vazio.";
    if (byteLength(code) > MAX_CODE_FILE_BYTES) return "O código ultrapassa o limite de 256 KB.";
    if (!/\bvoid\s+setup\s*\(/.test(code) || !/\bvoid\s+loop\s*\(/.test(code)) {
      return "O sketch precisa conter void setup() e void loop().";
    }
    return "";
  }

  const api = Object.freeze({
    MAX_CODE_FILE_BYTES,
    byteLength,
    normalizeImportedCode,
    validateArduinoCode,
  });

  if (typeof window !== "undefined") window.QuantumCodeEditorUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
