# TensorFlow.js WebAssembly 4.22.0

Local runtime for the TensorFlow.js 4.22.0 already bundled in Human 3.3.6.
Files copied from the official npm package `@tensorflow/tfjs-backend-wasm@4.22.0/dist/`
via `https://cdn.jsdelivr.net/npm/`. Apache-2.0 license: `LICENSE.tensorflow.txt`.
No frames or biometric descriptors are sent to that service at runtime.

SHA-256:

- `tfjs-backend-wasm.wasm`: `70a5d516060464e5269f01c74bac1772d6b8ab6cb612acf16b5cdaf61f78d892`
- `tfjs-backend-wasm-simd.wasm`: `77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b`
- `tfjs-backend-wasm-threaded-simd.wasm`: `c052228d4bef185c27bbe59a9e029570c78bbb9f08b3cb46b597851650373de2`

The backend chooses the supported binary. GitHub Pages does not require threads
or cross-origin isolation; the SIMD and baseline binaries support that case.
