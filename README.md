# QUANTUM TRACKER

Aplicativo Python para monitoramento inteligente com camera real e simulador.

## Recursos

- App desktop PySide6 com abas Monitoramento, Cadastro, Fotos, Logs, IA e Configuracoes.
- Monitoramento com camera real ou simulador.
- Deteccao de pessoas via YOLOv8 + ByteTrack quando Ultralytics estiver instalado.
- Fallback HOG/OpenCV para tentar detectar pessoas quando YOLO ainda nao estiver disponivel.
- Simulador para testar tracking, HUD, logs, estados LOST/GHOST e relatorios sem carrinho fisico.
- HUD futurista desenhada com OpenCV.
- IDs persistentes, filtro de Kalman e estimativa de incerteza.
- Reconhecimento facial com DeepFace usando `assets/faces/`.
- Cadastro de pessoas com foto, nome, ID e data.
- Aba Fotos com todos os cadastrados.
- Gestos com MediaPipe Hands.
- SQLite para historico de eventos.
- QuantumBrain com Gemini API opcional e fallback local.
- TacticalVoice em thread separada com fila.

## Instalar

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Opcional:

```bash
set GEMINI_API_KEY=sua_chave
```

## Executar

```bash
python main.py
```

Use a aba `Simulador` para demonstrar o sistema sem webcam ou carrinho.

## Registrar identidade

```bash
python -m biometrics.register_identity "Joao"
```

As imagens ficam em `assets/faces/<nome>/`.

## Recriar embeddings faciais

Depois de instalar InsightFace, cadastros antigos podem ganhar embeddings com:

```bash
python -m tools.rebuild_face_embeddings
```

Tambem existe o botao `Recriar Base Facial` na aba `Configuracoes`.

## Galeria

Na aba `Fotos`:

- pesquise por nome ou ID;
- clique em `Historico` para ver identificacoes da pessoa;
- clique em `Excluir` para remover o cadastro, a foto e os embeddings faciais.
