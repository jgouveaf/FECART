const assert = require("node:assert/strict");
const editor = require("../web/code-editor-utils.js");

const validSketch = `
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
}
`;

assert.equal(editor.MAX_CODE_FILE_BYTES, 256 * 1024);
assert.equal(editor.validateArduinoCode(validSketch), "");
assert.match(editor.validateArduinoCode(""), /vazio/);
assert.match(editor.validateArduinoCode("void setup() {}"), /setup.*loop/);
assert.match(editor.validateArduinoCode("x".repeat(editor.MAX_CODE_FILE_BYTES + 1)), /256 KB/);
assert.equal(editor.normalizeImportedCode(`\uFEFF${validSketch}`), validSketch);
assert.equal(editor.byteLength("ação"), Buffer.byteLength("ação", "utf8"));

console.log("Code editor utilities: OK");
