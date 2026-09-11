# Cadastro com presença estável e malha facial

O usuário relatou que o cadastro ficava verificando presença sem avançar, pediu menos restrições e uma malha triangular no rosto. A correção é limitada à identificação/cadastro e ao desenho facial. Firmware, HEX, protocolo USB, emergência, motores e critérios de seguimento permanecem inalterados.

## Causa e decisão

O cadastro exigia que os classificadores `real` e `live` fossem ambos >= 0,50 por cinco leituras consecutivas e novamente durante cada amostra. Uma pontuação baixa persistente bloqueava o cadastro; oscilações interrompiam o progresso. Esse bloqueio foi reproduzido com saídas controladas de inferência. Não temos uma gravação da câmera do usuário que permita atribuir a falha física exclusivamente a esses escores.

O próprio autor do Human descreve as limitações dos classificadores experimentais de presença. Reduzir indiscriminadamente o limiar de identidade ou aprovar após um temporizador foi descartado. Mantemos uma pessoa por quadro, tamanho mínimo, confiança facial, descritor válido, pose para captura e consistência das cinco amostras.

## Comportamento

- Presença automática: duas ou mais observações com ambos os sinais positivos durante pelo menos 180 ms. A confirmação dura até 30 segundos, permitindo digitar o nome e concluir as cinco amostras mesmo se os sinais oscilarem.
- Alternativa disponível por botão: frente → virar levemente para qualquer lado → frente. Cada etapa exige observações distintas por pelo menos 120 ms; o movimento não conclui com uma cabeça parada. O usuário pode reiniciar; após 15 segundos sem concluir há instrução explícita para tentar novamente.
- Não há exigência adicional de piscar. Os escores continuam visíveis como sinais auxiliares, sem declarar um resultado positivo inexistente. O registro salva `presenceMethod` (`AUTO` ou `MOVEMENT`) e os escores originais.
- A confirmação fica vinculada a um descritor fixo do mesmo rosto, usando o limiar de similaridade existente de 0,80 e continuidade espacial. É descartada ao perder o rosto, mudar de pessoa, encontrar mais de um rosto, ficar sem dados recentes por mais de 800 ms, reiniciar câmera, trocar de aba ou ocorrer erro de inferência.
- A malha azul usa os pontos já calculados pelo Human e sua triangulação. Desenha segmentos compartilhados uma única vez, sem modelo adicional, quadrado facial ou rótulo sobre o rosto. O espelhamento acompanha o vídeo. O retângulo corporal do seguimento permanece funcional.

## Verificação

- 24 testes unitários de presença e desenho: oscilação, expiração, cabeça parada, mudança de pessoa, dados inválidos, perda de câmera, espelhamento e ausência de pontos.
- 12 cenários de cadastro no navegador: cinco amostras com escores baixos via movimento, cinco amostras com oscilação após confirmação automática, persistência real em IndexedDB, troca de pessoa, câmera congelada, erro, reinício e troca de aba. Inferência e câmera são controladas, sem câmera física ou USB.
- 39 cenários de regressão do Modo 2 passaram: cadastro, seguimento, perdas, emergência, comandos, persistência e retorno aos Modos 1 e 3, com inferência/USB simulados.
- 21 verificações estáticas de câmera, código e integridade do firmware passaram. Duas expectativas antigas de texto/versão já falhavam no commit anterior; foram atualizadas para o painel existente, sem alterar o firmware para atender ao teste.
- Comparação de identidades preservou os testes existentes.
- Human 3.3.6 real, modelos locais e imagem de aquecimento incluída na biblioteca: 478 pontos e triangulação com 2.640 índices; a malha foi desenhada e inspecionada visualmente. Isso valida integração e desenho, não vivacidade nem funcionamento com uma pessoa em movimento.

## Limites e teste físico pendente

A confirmação por movimento é uma ajuda de cadastro para este projeto, não autenticação biométrica certificada nem proteção garantida contra fotos movidas ou reprodução de vídeo. A malha mostra geometria; sozinha não melhora a identificação. A câmera real pode perder qualidade com pouca luz, rosto pequeno ou oculto. Nessas condições a interface continua pedindo correção, sem escolher outra pessoa automaticamente.

No equipamento real, testar cadastro olhando de frente; caso os sinais automáticos não avancem, usar o botão e seguir os três movimentos. Confirmar persistência após recarregar. Validar seguimento com rodas suspensas antes de testar no piso. Não foi executado teste físico nesta alteração e não é necessário regravar o Arduino.

## Fontes primárias

- [Discussão do autor do Human sobre liveness e antispoof](https://github.com/vladmandic/human/discussions/206).
- [Exemplo oficial FaceID](https://github.com/vladmandic/human/blob/main/demo/faceid/index.ts).
- [Tipos de resultado: mesh, escores e rotação](https://github.com/vladmandic/human/blob/main/src/result.ts).
- [Desenho oficial da malha](https://github.com/vladmandic/human/blob/main/src/draw/face.ts) e [triangulação](https://github.com/vladmandic/human/blob/main/src/face/facemeshcoords.ts).

Para repetir: servir o repositório por HTTP, definir `QT_SITE_URL` e executar `node --test tests/face_presence.test.cjs tests/face_mesh_overlay.test.cjs`, `node tests/browser_face_enrollment.cjs`, `node tests/browser_face_mesh_real.cjs` e `node tests/browser_mode_two.cjs`. Os testes de navegador exigem Playwright.
