# Quantum Tracker 2.1.0 — motores, seguimento e laboratório 3D

Revisão de 15/09/2026. Firmware compilado em 14/09/2026, protocolo V7 preservado.

## Motores e Modo 1

O firmware principal desligava os quatro pinos antes de aplicar qualquer mudança
de direção. Ao passar de uma curva para FRENTE, isso interrompia também a roda
que deveria continuar avançando. A função agora escreve somente as saídas que
mudaram, desligando a direção antiga antes de ligar a nova. A inicialização
força LOW nos quatro pinos. Polaridades, pinagem e comandos permanecem iguais.

Os testes executam as funções reais do sketch com um registrador de GPIO:
FRENTE mantém as duas saídas corretas, mil repetições não geram pulsos, e todas
as 36 transições respeitam a ordem de comutação. Os testes da máquina de estados
cobrem obstáculo, ruído, ausência de eco, recuperação, ESTOP e watchdog remoto.

Isso demonstra uma correção no acionamento por software; não prova que esse
pulso era a única causa da roda travar no carrinho. O circuito e o movimento não
foram medidos fisicamente nesta revisão. O Modo 1 mantém seu algoritmo de desvio,
com confirmação de leituras e uma ré por encontro com obstáculo persistente.

Compilação real para `arduino:avr:uno`: 7.414 bytes de flash e 405 bytes de SRAM.
O código exibido no site e o HEX oficial foram gerados a partir desse sketch.
SHA-256 do HEX, normalizado para LF:
`9eddf2b4e9e6eee6e5bf39ce1b4dfc54d22416343eb5afb6347dfd1bb55cbab3`.

**A correção dos motores só chega ao carrinho ao gravar o novo firmware.**
Atualizar a página não atualiza o Arduino. O botão de gravação existente no site
instala a revisão. Nenhuma gravação ou movimentação física foi feita automaticamente.

## Modo 2

Havia duas fontes de interrupção: inferências concorrentes consumiam o prazo das
imagens, e o temporizador do corpo podia parar uma decisão facial atual mesmo
quando só a cabeça estava visível. A implementação mantém SCRFD/SFace e
EfficientDet locais e muda a organização do trabalho:

- Os detectores compartilham uma fila de processamento. A captura ocorre ao
  obter a vez, evitando enfileirar imagens antigas. Erros, cancelamento e
  encerramento liberam a vez; o watchdog de movimento continua independente.
- O corpo recebe imagens com até 640 pixels no lado maior. A frequência é menor
  quando só a cabeça sustenta o seguimento (300 ms). Com corpo completo e rosto,
  mantém 200 ms; sem esse rosto, volta a 100 ms. Isso preserva a janela de 500 ms
  usada para tolerar pequenas oscilações de confiança do corpo.
- Uma sessão já confirmada atualiza a posição por detecção facial. Só reutiliza
  o descritor por até 450 ms, com sobreposição geométrica e comparação dos pixels
  faciais alinhados contra a última amostra realmente descrita. Mudança relevante,
  expiração, desaparecimento ou mais de um rosto exigem nova inferência SFace.
  Essa reutilização não cadastra pessoas, não confirma uma nova sessão e não
  atualiza a referência de identidade.
- A malha completa cede processamento à identificação lenta. Entre atualizações,
  sua posição acompanha os cinco pontos faciais medidos. A malha é apenas visual.
- Um rosto identificado e atual pode sustentar o comando sem um tronco detectado.
  Um detector atrasado não substitui essa evidência por uma falsa perda de alvo.
  Corpos concorrentes, erros do detector e seu timeout continuam bloqueando.
- A validade de uma captura de movimento continua em 600 ms; a leitura do sensor
  continua em 700 ms. ESTOP, perda de vídeo, troca de modo e ausência do alvo
  continuam levando a PARAR. Nenhuma previsão autoriza movimento.

Teste com os modelos reais, vídeo controlado e USB simulada: 30 segundos com
60 pedidos FRENTE e zero pedidos PARAR no trecho estável. O mesmo fluxo verificou
curvas nos dois sentidos, parada por obstáculo e parada ao retirar a pessoa.
Isso é evidência de software nessa carga e nesse vídeo, não uma taxa de acerto
para rostos desconhecidos ou uma garantia de latência em qualquer computador.

A comparação visual curta ainda pode aceitar mudanças muito sutis até a próxima
descrição completa. Por isso, o teste com pessoas reais, iluminação variada,
cruzamentos e oclusões continua necessário. Carga excessiva pode ultrapassar o
prazo da câmera e deve provocar parada segura.

Não foi adicionada API por quadro. A documentação oficial do
[Gemini Live](https://ai.google.dev/gemini-api/docs/live-api) informa envio de
imagens de vídeo a até 1 FPS. A escolha de manter o controle local também evita
incluir a latência de rede na decisão de movimento.

## Laboratório 3D

Aplicação integrada ao site com primeira pessoa, terceira pessoa, giro da câmera,
zoom e tela cheia. O laboratório tem geometria fixa, materiais, iluminação,
sombras, bancadas, armários, plantas e pessoas animadas com trajetos definidos.
É uma cena 3D estilizada com materiais físicos; não pretende ser fotorealista.

Os três modos operam no cenário: desvio autônomo, seguimento da pessoa virtual
selecionada e controle por gestos/comandos. Há duas velocidades de roda,
colisões, sensor frontal e distância de seguimento com histerese. As pessoas
podem ser pausadas, ocultadas e adicionadas até o limite de cinco.

A física usa centímetros e tempo de simulação. A pose dos atores virtuais nunca
vira entrada da identificação real e não envia comandos para USB. A opção
preexistente de teste manual no Arduino continua explícita e usa os bloqueios
do controlador real. O modelo físico é aproximado e não substitui ensaio real.

O WebGL carrega quando a área entra na tela e deixa de animar fora dela. Sem
WebGL, permanece a visão superior. Three.js r180 é distribuído localmente com
[licença MIT](https://github.com/mrdoob/three.js/blob/r180/LICENSE) e manifesto
de integridade em `web/vendor/three/manifest.json`.

## Verificação reproduzível

Verificação final aprovada: 220 testes na suíte Node, 67 verificações Python,
53 cenários de integração do Modo 2, cadastro/backup, três identidades com os
modelos reais, carregamento inicial, site completo e simulador 3D. O teste 3D
cobre as duas vistas, pessoas, três modos, teclado, ausência de acesso físico à
USB, adaptação de layout e suspensão da animação quando sai da tela.

Com o site servido localmente e Playwright disponível no Node:

```powershell
$env:QT_SITE_URL='http://127.0.0.1:9877/'
node --test tests/*.test.cjs
node tests/browser_mode_two.cjs
node tests/browser_face_official.cjs
node tests/browser_simulator_3d.cjs
$env:QT_TEST_USB='1'
$env:QT_REQUIRE_CONTINUOUS='1'
$env:QT_STEADY_MS='30000'
node tests/browser_face_follow_real.cjs
```

O teste de continuidade é sensível à carga real do computador e mantém a
exigência de zero paradas no trecho estável; não esconde uma falha aumentando
o prazo de validade das imagens. Todos esses testes substituem a câmera e a USB.
