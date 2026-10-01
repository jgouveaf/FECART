# Reconhecimento facial local — oficial 2.0

Pipeline: SCRFD 500M detecta a caixa e cinco pontos, alinhamento por transformação
de similaridade, SFace produz 128 valores normalizados. MediaPipe Face Landmarker
produz a malha visual de 478 pontos; ela não autoriza movimento. Todo o trabalho
roda no worker, na CPU, com uma imagem em processamento e sem APIs por quadro.

Arquivos e origem:

- `scrfd_500m.onnx`: `det_500m.onnx` do pacote oficial
  [buffalo_sc v0.7](https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip).
  Saídas ajustadas para dimensões dinâmicas em execução a 320 px, sem alterar os
  pesos. 2.524.907 bytes. SHA-256 `320057e8223314633f76f8083025021c0d7540eff9a32fd31b70da9d0feaa97f`.
- `sface_2021dec.onnx`: [OpenCV Zoo SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface),
  `face_recognition_sface_2021dec.onnx`. Pesos preservados; os inicializadores foram
  retirados da lista de entradas públicas do grafo e o IR foi elevado ao mínimo 4,
  permitindo que ONNX Runtime trate os pesos como constantes. 38.688.787 bytes.
  SHA-256 `ae6a6ac44d2bdc87924e75fb23d8212430dd24f037f5e035c21deff99afc8b61`.
  Licença Apache 2.0 preservada em `LICENSE.sface`.
- `../mediapipe/models/face_landmarker.task`: [modelo oficial float16 versão 1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task),
  3.758.596 bytes. SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.
  Runtime e licença já presentes em `../mediapipe/`.

Os três hashes são verificados pelo worker antes de carregar os modelos.
Veja `tools/prepare_web_face_models.py` para reproduzir a preparação do SCRFD e
do SFace.
As licenças do runtime ONNX e do OpenCV estão preservadas no projeto. Os modelos
pré-treinados do InsightFace são oferecidos para pesquisa não comercial,
conforme [documentação do projeto](https://github.com/deepinsight/insightface/tree/master/python-package).
O FECART utiliza este detector no contexto educacional do projeto; uma distribuição
com finalidade comercial precisa de pesos com autorização correspondente.

Não adicionar novamente o detector 10G ou SFace int8: foram avaliados, mas tiveram
latência maior no WASM deste ambiente. Não confundir o desempenho desta combinação
com o benchmark anterior do pacote Python Buffalo L.
