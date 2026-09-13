# ONNX Runtime Web 1.22.0

Origem: [pacote oficial npm](https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0.tgz).
Licença MIT preservada em `LICENSE`.

- `ort.wasm.min.js`: SHA-256 `65e09376df69107e881b5c34d2d37aed333a366b6d941073ec518168e269b87d`.
- `ort-wasm-simd-threaded.js`: SHA-256 `30dd851d9c00622940500f71ddd2ff8820c5cb65270816080175b958705385a8`.
  Conteúdo original de `ort-wasm-simd-threaded.mjs`, extensão alterada para que
  servidores estáticos do Windows entreguem um tipo MIME de JavaScript válido.
- `ort-wasm-simd-threaded.wasm`: SHA-256 `71aef04959c5c1b6de461b6538e2058e306610034a85aad2742d0c7fd4533fe4`.

Somente backend WASM; `numThreads=1` para compatibilidade com GitHub Pages sem
isolamento entre origens. O processamento ocorre em um worker dedicado.
Os caminhos de JavaScript e WASM são explícitos e locais. Nenhuma CDN é usada
durante o reconhecimento.
