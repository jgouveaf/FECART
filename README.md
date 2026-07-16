# FECART — Quantum Tracker

Sistema de rastreamento de pessoas com Inteligência Artificial, desenvolvido para a FECART.

**Autores:** João · Gustavo · Renato

---

## Estrutura do Projeto

```
FECART/
├── main.py                  # Ponto de entrada do app
├── requirements.txt         # Dependências Python
├── build_exe.py             # Gera o executável .exe portátil
├── yolov8n.pt               # Modelo YOLOv8 nano
│
├── app/                     # Interface gráfica (PySide6)
│   ├── quantum_app.py       # Janela principal e loop do sistema
│   └── splash_screen.py     # Tela de abertura animada
│
├── tracker/                 # Rastreamento de alvos
│   ├── tracker_wrapper.py   # ByteTrack + Re-ID por histograma (Stable IDs)
│   ├── track_manager.py     # Gerenciamento de estados dos alvos
│   ├── yolo_tracker.py      # Detector YOLOv8 otimizado (threading + FP16)
│   └── kalman_tracker.py    # Filtro de Kalman para predição
│
├── core/                    # Modelos de dados centrais
│   └── models.py
│
├── hud/                     # HUD tático sobreposto ao vídeo
│   └── tactical_hud.py
│
├── recognition/             # Reconhecimento facial (InsightFace)
│   ├── insightface_service.py
│   └── identity_resolver.py
│
├── biometrics/              # Cadastro e leitura de faces
│   └── face_recognition.py
│
├── brain/                   # IA (Gemini), voz e comandos por fala
│   ├── quantum_brain.py
│   ├── tactical_voice.py
│   └── speech_listener.py
│
├── vision/                  # Reconhecimento de gestos das mãos
│   ├── gesture_recognizer.py
│   └── gesture_trainer.py
│
├── robot/                   # Controle do robô (ESP32 / simulador)
│   ├── robot_controller.py
│   ├── robot_state_machine.py
│   └── esp32_adapter.py
│
├── simulator/               # Simulador visual (sem hardware)
│   └── synthetic_world.py
│
├── database/                # Banco de dados SQLite local
│   └── database_manager.py
│
├── utils/                   # Configuração e utilitários
│   └── config.py
│
├── assets/                  # Ícones, logos, modelos InsightFace
├── docs/                    # Documentação técnica
├── scripts/                 # Scripts de instalação e execução (.bat)
└── data/                    # Dados do usuário (gerado ao rodar)
    ├── faces/               # Fotos cadastradas
    ├── database/            # Banco SQLite
    └── logs/
```

---

## Como Rodar (Desenvolvimento)

```bash
# 1. Clonar
git clone https://github.com/jgouveaf/FECART.git
cd FECART

# 2. Instalar dependências
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# 3. Abrir o app
python main.py
```

## Como Gerar o .exe Portátil

```bash
.venv\Scripts\pip install pyinstaller
python build_exe.py
# Resultado: dist/QuantumTracker_Portatil.zip
```

## Como Colaborar

```bash
git pull                          # pegar mudanças do colega
# ... faz suas mudanças ...
git add .
git commit -m "o que eu fiz"
git push
```
