# Modo 2 — detecção, cadastro e seguimento local

Entrega de software em 2026-09-07. Não representa aprovação em teste físico.

## Uso

1. Abra o site atualizado no Chrome/Edge e vá a **Câmera & gestos → Rosto & identificação**.
2. Ative a câmera USB que ficará na frente do carrinho. Primeiro faça a prévia com o Arduino desconectado.
3. Com uma pessoa de frente, iluminação adequada e autorização dela, digite o nome e clique em **Validar e cadastrar rosto**. As verificações de qualidade/presença continuam obrigatórias.
4. Em **Pessoas cadastradas**, clique em **Seguir** no cadastro escolhido. Clique em **Preparar Modo 2 e câmera**.
5. Confira o retângulo verde, o ID e a direção pedida. Retângulos azuis são outras pessoas; não trocamos automaticamente de alvo.
6. Exporte um backup. O cadastro é local, persiste ao recarregar, mas limpar os dados do navegador, usar modo privado ou trocar de PC não preserva esse banco automaticamente.
7. Para teste físico, só conecte/libere a parada com as rodas suspensas, carrinho firmemente apoiado e um operador perto da chave. Nesta entrega não foi aberta nenhuma porta serial real nem gravado firmware.

O V7 já instalado é reutilizado. Não é necessário regravar o UNO por causa desta alteração do site.

## Alteração e isolamento

Antes, o rosto emitia diretamente comandos de seguimento e não havia detector do corpo integrado ao painel. Agora `face-identities.js` publica observações faciais com horário da imagem; `person-follow.js` associa o cadastro a uma pessoa detectada e é o único produtor dos comandos de visão. O controlador USB existente continua sendo responsável por ACK, watchdog, transição de modo e ESTOP.

O detector EfficientDet Lite0 int8 roda num worker clássico separado, reutilizando o MediaPipe/WASM local. A inicialização verifica o SHA-256 do modelo. Há um único quadro em processamento; respostas de gerações antigas são descartadas. Não há API remota por imagem.

O worker só existe no Modo 2, com câmera facial ativa e página visível. Desligar, pausar, esconder a página ou trocar de modo encerra o worker. Firmware, HEX, transportador Web Serial, detector de dedos e lógica dos Modos 1 e 3 não foram alterados.

O cadastro agora aguarda o commit da transação IndexedDB, exige quadros distintos/recentes, interrompe uma coleta quando a câmera reinicia ou muda de aba, verifica consistência facial entre amostras e rejeita vetores numéricos inválidos na importação. A aplicação pede armazenamento persistente quando disponível, sem prometer que isso substitui backup. Não é um sistema de autenticação de alta segurança.

## Comportamento e limites

- Exige pessoa cadastrada explicitamente selecionada, rosto reconhecido associado a um corpo e duas observações separadas por pelo menos 120 ms para iniciar movimento.
- Centraliza por esquerda/direita e anda para frente quando alinhado, com suavização e faixas de entrada/saída diferentes para evitar alternância rápida.
- Após perder o rosto, pode manter o ID no corpo continuamente observado por até 3 segundos; então pede que o rosto reapareça. Não implementa reidentificação permanente de pessoas de costas ou entre câmeras.
- Perda do corpo, sobreposição ambígua, identidade conflitante, imagem com mais de 600 ms ou sensor conectado sem dado atual pedem PARAR. Previsão de até 500 ms é apenas uma estimativa horizontal na imagem e também pede PARAR. É desativada durante curvas informadas pela telemetria.
- Exclusivamente no Modo 2 web: sensor frontal a 30 cm pede parada; libera a partir de 40 cm. Corpo ocupando muita altura da imagem também impede aproximação. São margens iniciais, não distância de frenagem validada. Não implementamos planejamento de rota ao redor de obstáculos.
- A câmera monocular não fornece posição métrica confiável nem enxerga através de paredes. Não há Bluetooth, SLAM, odometria ou compensação completa do movimento da câmera nesta versão.
- O HC-SR04 frontal não protege a traseira, laterais ou beiradas de mesa. Latência visual/USB e desempenho no PC do usuário ainda precisam ser medidos fisicamente. ACK confirma recepção do comando, não giro das rodas.

## Verificação realizada

- `python -m unittest discover -s tests -q`: 659 testes executados, 657 aprovados e 2 ignorados. Inclui subsistemas legados; não é uma medida de precisão da nova visão.
- `node --test tests/person_follow_math.test.cjs`: 37 casos da nova lógica, incluindo atraso, duplicação de quadros, conflito de ID, oclusão, perda de alvo e histerese de distância.
- Suites existentes: 33 cenários Web Serial, 15 cenários da lógica real do firmware com IO/tempo simulados e 20 casos de gestos. Todos aprovados, sem alterações nesses módulos de produção.
- `tests/browser_mode_two.cjs`: fluxo no Chromium com câmera sintética, inferência/serial simuladas, mas aplicação, IndexedDB e controlador USB reais. Cobre cadastro, recarga, backup/importação/exclusão, comandos USB, ESTOP, pausa, perda/congelamento, falhas/repetição manual, reinício durante cadastro e isolamento de modos.
- `tests/browser_person_detector.cjs`: worker e modelo reais, imagem local `bus.jpg` já instalada no pacote Ultralytics; detectou 3 pessoas. Essa imagem não é distribuída no site. Não demonstra precisão geral nem seguimento físico.
- Verificação adicional do Human real em imagem local `zidane.jpg`: detectou um rosto e produziu embedding com 1024 elementos. Não testa taxa de acerto entre pessoas nem presença ao vivo.
- `tests/browser_full_site_smoke.cjs`: modelos faciais e de mão carregaram localmente, seis comandos do simulador funcionaram, sem erros de página ou requisições externas e sem estouro horizontal em 320/768/1440 px.
- `tests/browser_face_circuit_breaker.cjs` e `tests/browser_serial_recovery.test.cjs`: recuperação facial e quatro cenários de reconexão serial simulada aprovados.

Os scripts de navegador usam `NODE_PATH` apontando para Playwright. Sirva o repositório via HTTP local; use `QT_SITE_URL`. O teste do detector exige `QT_PERSON_IMAGE` apontando para uma imagem local com pessoas. Não utilizar contagens dessas suites para alegar “100%” de acerto físico.

## Referências primárias e decisões

- [MediaPipe Object Detector para Web](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js): detecção produz caixas/categorias; inferência síncrona deve ser isolada para não bloquear a interface. Usamos worker e filtro `person`.
- [Modelos e configuração do detector](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector): modelo Lite0 local, não serviços externos por quadro.
- [Human: exemplos Face ID e reconhecimento](https://github.com/vladmandic/human/wiki): preservamos o motor facial existente e armazenamento local, acrescentando controles de validade temporal e persistência.

Próxima validação necessária: câmera realmente montada no carrinho, iluminação do local, pessoa de frente/de costas, cruzamento de pessoas, distância segura de parada e ação física de cada comando. Não foram acionados motores nesta entrega.
