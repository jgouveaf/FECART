# Detector de pessoas local — Modo 2

EfficientDet Lite0, int8, versão 1, incorporado sem alteração em 2026-09-07.
Origem Google/MediaPipe; modelo de detecção COCO, filtrado para `person` em runtime.

- [Download oficial fixado na versão 1](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite)
- [Documentação oficial](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector)
- [Família de modelos TensorFlow e licença Apache 2.0](https://www.kaggle.com/models/tensorflow/efficientdet/tfLite)
- Texto da licença preservado em `../LICENSE.mediapipe.txt`.
- Tamanho: 4.602.795 bytes.
- SHA-256: `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`.

O worker valida esse hash antes de carregar o modelo. Não envia imagens para APIs.
Reutiliza o runtime/WASM já presente no projeto, sem substituir o detector de mãos.
As imagens utilizadas nos testes não são distribuídas nesta pasta nem no site.
