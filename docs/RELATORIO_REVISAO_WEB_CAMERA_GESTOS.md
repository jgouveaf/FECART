# Relatório técnico — painel web, câmera, gestos e controle do robô

Data da revisão: 22/08/2026

## Escopo e limite da validação

Esta revisão cobre o painel web, câmera, FaceID, gestos, gerenciamento dos três modos, Web Serial, firmware do Arduino UNO e simuladores. Os testes automatizados usaram câmera e porta serial falsas, além de simulação determinística do robô.

> **REQUER TESTE NO HARDWARE REAL:** Arduino UNO, L298N, motores, HC-SR04, câmera física, cabo USB, alimentação e comportamento mecânico do carrinho. Nenhum resultado deste documento afirma que o robô físico foi testado.

## Causas dos bugs críticos

| Bug | Causa raiz | Correção | Teste | Resultado |
| --- | --- | --- | --- | --- |
| Botão da câmera parecia não funcionar | Câmera, rosto e gestos dependiam de um mesmo bootstrap. Uma exceção em qualquer parte podia impedir a instalação dos listeners. A inicialização assíncrona também não possuía cancelamento forte; cliques rápidos podiam deixar um `getUserMedia()` antigo terminar depois do desligamento. | O controlador da câmera foi isolado em `camera-controller.js`, com máquina de estados `OFF/STARTING/ACTIVE/STOPPING/ERROR`, token de operação, timeout, descarte de streams atrasados, troca/remoção de dispositivo e mensagens específicas. | Ciclos ligar/desligar/religar, clique rápido, início cancelado, permissão negada, retry, câmera ausente, mudança de dispositivo, `pagehide` e smoke test do site completo. | Aprovado em mocks de navegador. |
| Botão Mão & Gestos não iniciava o detector de forma confiável | O detector compartilhava o ciclo da câmera, dependia de recursos remotos e podia criar processamento concorrente ou manter eventos antigos após troca de modo. Um bundle `.mjs` também era entregue por servidores simples com MIME incompatível. | O detector foi separado em `camera-gestures.js`; MediaPipe, WASM e modelo foram empacotados localmente; o bundle passou a `.js`; o modelo é carregado sob demanda; há somente um loop por geração e liberação após inatividade. | Carregamento real do modelo no Chromium, ligar/desligar/religar, perda da mão/câmera, troca de aba/modo, verificação de recursos externos e erros de console. | Aprovado em câmera falsa 1280×720; câmera física pendente. |
| Gesto era detectado, mas não comandava o Arduino | O evento visual não tinha um caminho serial confirmado e o heartbeat podia renovar a própria validade indefinidamente. Eventos atrasados de um modo anterior também podiam sobreviver à troca. | `quantum:gesture-command` agora entra no controlador serial somente no Modo 3, com geração do modo, timestamp, confiança e estabilidade. O watchdog usa a hora da última entrada nova, não a hora do reenvio. Todo comando exige conexão V3 e confirmação do firmware. | Porta serial falsa, modo errado, evento antigo, timeout, heartbeat, confirmação ausente, desconexão e `pagehide`. | Aprovado em 9 cenários dinâmicos Web Serial. |
| Troca de modo podia misturar comportamentos | Estado visual e firmware eram atualizados independentemente e sem confirmação transacional. | Existe uma fonte central de estado e a troca conectada executa `ESTOP → CMD:PARAR → MODE:n → RESET_ESTOP`. O modo só é confirmado após ACK; falha causa rollback e mantém ESTOP. | Todas as combinações Autônomo/Gestos/Seguir, transição rápida, timeout e divergência site/firmware. | Aprovado em testes automatizados. |

## Arquitetura atual

### Fonte central de estado

`web/control-state.js` mantém os estados de modo, robô, câmera, visão, gestos, segurança, comunicação e diagnóstico. Alterações usam `patch`, e a troca de modo usa `requestMode`, `commitMode` e `rejectMode`.

### Câmera

`web/camera-controller.js` é o único proprietário do `MediaStream`. Ele enumera dispositivos, abre uma única captura, publica eventos de ciclo de vida, mede FPS e garante a liberação de todas as tracks.

### Rosto e identificação

`web/face-identities.js` carrega o Human FaceID local uma única vez, executa inferência limitada por intervalo, desenha bounding boxes e IDs no mesmo sistema de coordenadas do vídeo, mantém alvo bloqueado com tolerância temporária e salva cadastro com cinco embeddings e foto no IndexedDB do navegador.

Falhas persistentes de inferência acionam um disjuntor após três erros consecutivos. O loop fica suspenso, sem tempestade de novas tentativas, e a interface oferece uma tentativa manual segura; uma recuperação bem-sucedida zera o contador.

Estados de tracking: `SEARCHING`, `TARGET_ACQUIRED`, `FOLLOWING`, `TARGET_LOST` e `REACQUIRING`.

### Mãos e gestos

`web/camera-gestures.js` usa MediaPipe Tasks Vision local. O gesto precisa superar 65% de confiança e permanecer por pelo menos quatro frames/180 ms; PARAR confirma em dois frames. Há cooldown de 650 ms, heartbeat de 400 ms e PARAR automático após 500 ms sem mão ou sem gesto estável.

Mapeamento:

- 1 dedo: FRENTE
- 2 dedos: DIREITA
- 3 dedos: ESQUERDA
- 4 dedos: PARAR
- 5 dedos: GIRAR

### Modos exclusivos

- **Modo 1 — Autônomo:** o firmware anda para frente e o HC-SR04 tem prioridade para iniciar o desvio.
- **Modo 2 — Seguir pessoa:** a aba de rosto é selecionada; somente eventos frescos do alvo geram FRENTE/ESQUERDA/DIREITA. Perda do alvo gera PARAR. BLE é apenas telemetria experimental de proximidade por RSSI e não fornece direção através de parede.
- **Modo 3 — Gestos:** a aba da mão e o detector são ativados; somente gestos confirmados e frescos geram movimento. Perda/instabilidade gera PARAR.

Somente um modo fica `ACTIVE`. Eventos de outra geração ou de outro modo são descartados.

### Comunicação e segurança

`web/robot-control.js` usa Web Serial a 9600 baud e considera o Arduino online somente após `QT:READY:V3`. O comando `HELLO` permite repetir o handshake mesmo quando abrir a porta não reinicia o UNO. A conexão termina bloqueada por `ESTOP`; mover o robô requer o clique consciente em **Liberar após conferir**. Comandos de movimento e modos exigem confirmação. Duas falhas consecutivas de confirmação de movimento, divergência de modo, perda serial, timeout ou falha de transição fecham o sistema em segurança.

No firmware:

- `ESTOP` e `PARAR` têm prioridade;
- obstáculo frontal bloqueia frente, curvas e giro; ré continua permitida para criar espaço;
- duas leituras próximas confirmam obstáculo;
- cinco falhas do HC-SR04 bloqueiam os motores;
- o sensor só é recuperado após três leituras válidas;
- `PING` testa o enlace, mas não renova movimento antigo;
- modos 2 e 3 param após 1,5 s sem novo `CMD:*`;
- cinco obstáculos em 15 s ativam parada de segurança.

## Interface e UX

- painel com hierarquia de missão, sidebar e indicadores globais;
- feed 16:9 responsivo, com overlays de rosto/mão no mesmo espaço;
- abas independentes “Rosto & identificação” e “Mão & gestos”;
- estados explícitos `OFFLINE`, `STARTING`, `ONLINE`, `WARNING` e `ERROR`;
- feedback assíncrono nos botões, com bloqueio durante transições;
- diagnóstico de dispositivo, resolução, FPS, modelos, Arduino, TX, RX e último erro;
- logs limitados a 120 eventos;
- navegação por teclado, foco visível e sidebar adaptada a telas menores;
- aba Códigos sincronizada automaticamente com os sketches reais.

## Performance

- câmera aberta uma única vez e compartilhada pelos dois detectores;
- FaceID e MediaPipe carregados sob demanda e sem downloads externos em execução;
- singleton para o carregamento do FaceID;
- inferência de gestos limitada a aproximadamente 12 FPS;
- cancelamento por geração em câmera, rosto, gestos, modo e conexão;
- timers, RAFs, resultados tensoriais e tracks liberados no desligamento;
- renderização de logs apenas quando há mudanças;
- simulador pausado quando está fora de uso ou a página fica oculta.

## Testes executados

### Suíte completa

- `pytest -q`: **138 testes aprovados e 31 subtestes aprovados**.
- Um aviso de depreciação de uma dependência do InsightFace foi emitido; não houve falha.

### Navegador real com hardware falso

- Chromium headless com câmera falsa 1280×720.
- FaceID: `ONLINE`, modelo carregado uma vez, estado `SEARCHING` sem rosto sintético.
- Gestos: modelo `READY`, detector `ONLINE`.
- Câmera: `ACTIVE` e depois `OFF`, sem stream anexado após desligar.
- Layout: sem overflow horizontal em 320, 768 e 1440 px; feed preservou 16:9 nas três larguras.
- Zero erros de página, zero erros de console, zero requisições com falha e zero recursos externos.

### Web Serial

- handshake correto e versão incompatível;
- `HELLO` e conexão inicial mantida em ESTOP até liberação explícita do operador;
- ACK de comando e modo;
- duas falhas consecutivas de confirmação de movimento com ESTOP automático;
- troca de modo e descarte de evento antigo;
- watchdog de entrada nova;
- split-brain site/firmware;
- timeout com rollback/ESTOP;
- falha e recuperação do sensor;
- desconexão e `pagehide` com ESTOP.

Resultado: **9/9 cenários dinâmicos aprovados**.

### Disjuntor do FaceID

- três falhas consecutivas de inferência acionaram a suspensão;
- nenhuma nova inferência ocorreu enquanto o circuito permaneceu aberto;
- a tentativa manual recuperou o detector;
- zero erros inesperados de página, console ou rede.

### Firmware e simulação

- 26 testes e 8 subtestes de firmware/simulador aprovados;
- cenários 2D repetidos sem colisão no modelo simulado;
- compilação para Arduino UNO aprovada: 7.034 bytes de flash e 415 bytes de RAM.

### Qualidade de código

- `node --check` aprovado nos módulos web e testes JavaScript alterados;
- bundle de sketches regenerado pelo gerador oficial;
- `git diff --check` sem erro de whitespace.

## Testes físicos pendentes

1. Gravar `firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino` no UNO pelo Arduino IDE 2.3.10.
2. Confirmar pinagem real: IN1 D7, IN2 D6, IN3 D5, IN4 D4, TRIG D3 e ECHO D2.
3. Confirmar jumpers ENA/ENB, GND comum e alimentação dos motores independente/adequada.
4. Validar sentido de cada motor com as rodas suspensas.
5. Calibrar 20 cm e tempos de ré/curva no piso real.
6. Testar cinco falhas do HC-SR04 e recuperação por três leituras.
7. Testar conexão USB, handshake V3, ESTOP, cabo removido e troca dos três modos.
8. Testar câmera física, iluminação, oclusão, cadastro, reconhecimento e falso positivo.
9. Testar gestos reais em distâncias, mãos e fundos diferentes.
10. Validar seguir pessoa com um observador pronto para cortar a alimentação.

## Limitações e bugs conhecidos

- Web Serial requer navegador Chromium compatível e contexto seguro (HTTPS ou localhost).
- O cadastro facial permanece no IndexedDB do navegador/dispositivo usado; não é sincronizado entre PCs.
- Uma câmera falsa valida o pipeline, mas não valida precisão com pessoas reais.
- RSSI Bluetooth indica proximidade aproximada, não direção nem posição através de parede. O sistema para quando perde o rosto; ele não navega às cegas usando BLE.
- O aviso de depreciação do `SimilarityTransform.estimate` vem de uma dependência do InsightFace e deve ser acompanhado em atualização futura.

## Arquivos principais modificados/criados

- `index.html`
- `web/styles.css`
- `web/app.js`
- `web/control-state.js`
- `web/camera-controller.js`
- `web/camera-gestures.js`
- `web/face-identities.js`
- `web/robot-control.js`
- `web/arduino-codes.js`
- `web/vendor/mediapipe/*`
- `firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino`
- `firmware/simulacao/simulador_robo.py`
- `firmware/simulacao/arena_2d.py`
- `firmware/simulacao/test_simulador_robo.py`
- `tests/test_web_camera_and_codes_offline.py`
- `tests/test_web_camera_lifecycle_browser.py`
- `tests/test_web_robot_control_offline.py`
- `tests/robot_control_runtime.test.cjs`
- `tests/browser_full_site_smoke.cjs`
- `tests/browser_face_circuit_breaker.cjs`

## Referências técnicas consultadas

- MediaPipe Tasks Vision / Hand Landmarker: <https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker>
- Web Serial API e contexto seguro: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API>
- Referência da linguagem Arduino (`pulseIn`, Serial, `millis`): <https://docs.arduino.cc/language-reference/>
