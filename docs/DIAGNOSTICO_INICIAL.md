# Diagnostico inicial do projeto Quantum Tracker

Data: 12/08/2026

## Repositorio analisado

O projeto ativo esta em `D:\QUANTUM_TRACKER`, branch `main`, com remoto
`https://github.com/jgouveaf/FECART.git`.

Ha alteracoes locais anteriores em modulos do aplicativo, IA, gestos e robo.
Elas foram preservadas. Nesta rodada foram alterados somente `firmware/` e a
documentacao da Etapa 1.

## Tecnologias encontradas

- Python e PySide6 para o aplicativo desktop;
- OpenCV, Ultralytics/YOLOv8 e ByteTrack para visao e tracking;
- InsightFace e ONNX Runtime para reconhecimento;
- MediaPipe para gestos;
- SQLite para dados persistentes;
- pyserial para comunicacao USB;
- Arduino C++ para o Arduino UNO;
- simulador proprio em Python.

## Estado por etapa

### Etapa 1 - Robo autonomo basico

PARCIAL. Existia um sketch que compilava, mas o hardware nao se movimentava.
Foram criados testes isolados e firmware novo. Falta validacao fisica.

### Etapa 2 - Visao e identificacao

CODIGO EXISTENTE, NAO VALIDADO NESTA RODADA. Ha detector YOLO, tracker, HUD e
servicos de reconhecimento, mas isso nao significa que os criterios da Etapa 2
estejam atendidos.

### Etapa 3 - Cadastro persistente

CODIGO EXISTENTE, NAO VALIDADO. Ha pastas de biometria, banco SQLite e dados de
faces. A persistencia precisa do roteiro de teste completo antes de conclusao.

### Etapas 4 a 10

PARCIAIS OU PENDENTES. Existem componentes de controle, simulacao, gestos e
comunicacao serial, mas a integracao nao deve avancar enquanto a Etapa 1 estiver
fisicamente instavel.

## Diagnostico do robo fisico

- hardware declarado: Arduino UNO, L298N, dois motores DC e HC-SR04;
- pinagem de projeto: IN1 D7, IN2 D6, IN3 D5, IN4 D4, TRIG D3, ECHO D2;
- a foto do Arduino mostra seis fios em D0 ate D5 e D6/D7 vazios;
- D0/D1 sao os pinos UART usados pela comunicacao USB e nao fazem parte da
  pinagem definida;
- as quatro pilhas Ni-MH fornecem 4,8 V nominais, valor que ainda sofre a queda
  de tensao do L298N e pode nao partir os motores;
- o estado do GND comum e a posicao exata de positivo/GND no borne precisam ser
  confirmados fisicamente pelos rotulos da placa.

## Plano de execucao imediato

1. validar a logica em simulacao sem o robo;
2. testar caminho livre, ruido e ausencia de eco;
3. testar desvio, alternancia de curvas e parada de seguranca;
4. compilar o firmware para Arduino UNO sem enviar;
5. aprimorar e repetir a bateria de testes;
6. reservar correcao de fios, envio e teste fisico para a Etapa 10.

## Seguranca de credenciais

Chaves de API nao devem permanecer em codigo, conversa compartilhada ou
repositorio. Qualquer chave exposta deve ser revogada e substituida por variavel
de ambiente antes de voltar ao desenvolvimento do aplicativo.
