# Relatório — integração do Modo 1 no site

Data: 04/09/2026
Escopo: Arduino UNO, L298N, HC-SR04, Web Serial e painel público.

## Resultado

O Modo 1 aprovado pelo usuário foi incorporado ao firmware oficial V6 sem
substituir os controles dos Modos 2 e 3. O site agora apresenta um único fluxo
oficial de instalação: consulta o código, verifica o HEX compilado, grava no
Arduino UNO e depois conecta o controle pela mesma USB.

O firmware V6 mantém a autonomia no próprio UNO. Depois de iniciado, o Modo 1
não depende de temporizador de missão nem de mensagens periódicas do navegador.
Os Modos 2 e 3 continuam supervisionados e param quando deixam de receber
comandos válidos por 1,5 segundo.

## Decisão de arquitetura

O método mais eficaz para este site estático é distribuir um **HEX oficial
pré-compilado e verificado**, e não tentar compilar qualquer texto `.ino` dentro
do navegador. O processo do Arduino gera o binário/HEX a partir do sketch e das
bibliotecas; reproduzir toda essa cadeia no site aumentaria muito a superfície
de falha. O botão de gravação usa STK500v1, compatível com o bootloader do UNO,
após seleção explícita da porta pelo usuário.

Essa decisão segue:

- [processo oficial de build do Arduino](https://docs.arduino.cc/arduino-cli/sketch-build-process/);
- [comando oficial de compilação do Arduino CLI](https://docs.arduino.cc/arduino-cli/commands-reference/arduino-cli_compile/);
- [regras de segurança e seleção de porta do Web Serial](https://wicg.github.io/serial/);
- [publicação de site estático no GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site);
- [implementação de referência STK500v1 via Web Serial](https://github.com/vielang/webserial-flasher/blob/main/examples/browser/webserial-flash.ts).

## Alterações realizadas

### Firmware

- protocolo atualizado para `QT:READY:V6`;
- pinagem preservada: IN1 D7, IN2 D6, IN3 D5, IN4 D4, TRIG D3 e ECHO D2;
- polaridade de frente, ré, direita e esquerda igual à aprovada fisicamente;
- limite de bancada de 5 cm identificado como provisório para uso suspenso;
- primeira leitura próxima para imediatamente e duas novas confirmam o desvio;
- ré de 400 ms, pausas de 150 ms e curva suave de 650 ms;
- duas leituras livres são exigidas depois da curva;
- caminho ainda bloqueado prolonga apenas a curva, sem repetir a ré às cegas;
- ausência de eco interrompe movimento/manobra e exige duas leituras válidas;
- `ESTOP` continua dominando todos os estados;
- comandos repetidos não desligam e religam a ponte H a cada ciclo;
- leitura serial limitada por ciclo para não sufocar sensor e telemetria.

### Site

- um único firmware oficial e uma única gravação USB;
- SHA-256 do HEX validado antes de solicitar a porta serial;
- editor mantido para consulta, cópia, importação e download;
- texto deixa claro que editar não recompila automaticamente;
- telemetria e mensagens alinhadas ao protocolo V6;
- Modo 1 preservado quando a USB fica silenciosa; Modos 2 e 3 falham fechados;
- painel autônomo isolado removido da página principal;
- removidas seções promocionais redundantes com alegações não comprovadas;
- removidas navegação e CSS dessas seções;
- documentação e adaptador Python atualizados para V6;
- nenhuma chave secreta adicionada ao conteúdo público.

## Bugs encontrados e corrigidos

1. O simulador anunciava V6, mas ainda usava tempos, distância e paradas da
   lógica antiga. Foi sincronizado com a máquina de estados atual.
2. O painel principal oferecia dois firmwares e dois donos possíveis da mesma
   porta USB. O fluxo isolado foi retirado da página principal.
3. A ponte H era chaveada novamente em cada passagem do `loop`, criando
   micropausas e ruído desnecessário. Agora só muda quando a ordem muda.
4. Documentos ainda descreviam V3/V5, 20/35 cm e travas por contagem que não
   pertencem ao Modo 1 aprovado. Foram corrigidos.
5. O adaptador Python ainda se identificava como `ARDUINO_UNO_USB_V5`. Foi
   atualizado para V6.
6. O arquivo HEX poderia divergir silenciosamente do código. Um teste agora
   compara seu hash normalizado com o hash exigido pelo gravador.

## Verificação executada

- compilação real para `arduino:avr:uno`: **7.192 bytes de flash (22%)** e
  **400 bytes de SRAM (19%)**, sem biblioteca externa;
- SHA-256 normalizado do HEX:
  `79f8afdb87be2c489fe45d457d5897a8073fa18f4606df6e6cd493eb3cc70255`;
- **655 testes Python** passaram; 1 teste opcional foi ignorado porque
  `scikit-learn` não está instalado;
- os 655 incluem **500 casos geométricos de gestos**; isso é matriz de casos,
  não 500 ensaios físicos;
- **17 testes do simulador V6** passaram, incluindo 500 ciclos completos de
  obstáculos dentro de um teste de estresse;
- **10 cenários** executaram corpos reais das funções C++ com IO/tempo simulados;
- **21 cenários Web Serial** passaram, incluindo handshake, ACK, timeout,
  desconexão, linha corrompida e parada;
- navegador real em modo headless: carregamento inicial, fluxo completo,
  câmera simulada, gestos, simulador, editor, gravação simulada e layout de
  320/768/1440 px passaram sem erro de página ou requisição externa;
- o teste facial com imagem real não foi executado nesta rodada porque exige a
  variável `QT_FACE_IMAGE`; a ausência dessa fixture foi registrada, não
  convertida em aprovação.

Os testes de software não afirmam que uma roda girou nem medem o ângulo real.

## Autoavaliação adversarial

### Rodada 1 — 9,4/10

Foram encontrados simulador incompatível, documentação obsoleta, dois fluxos
de firmware e chaveamento repetitivo da ponte H. A rodada não foi aceita como
final e esses pontos foram corrigidos.

### Rodada 2 — 9,9/10 para a integração de software

- correção e segurança lógica: 10/10;
- consistência firmware/site/HEX: 10/10;
- testes automatizados e navegador: 10/10;
- clareza e manutenção: 9,8/10;
- prontidão física: ainda pendente e não incluída artificialmente na nota.

A nota de software alcança 9,9. A solução completa não deve ser chamada de 100%
até o V6 integrado passar pelo ensaio físico supervisionado.

## Melhorias e riscos restantes

Prioridade imediata:

1. Gravar o V6 pelo site e testar com as duas rodas suspensas.
2. Validar `ESTOP`, retirada do ECHO e perda USB nos três modos.
3. Calibrar no piso uma distância maior que 5 cm e medir o ângulo de 650 ms.
4. Manter a chave física acessível; o sensor frontal não protege a ré.

Próximas etapas:

- validar fisicamente o Modo 2 antes de confiar no seguimento de pessoa;
- concluir o mapa de gestos desejado, incluindo ré, sem modificar o Modo 1;
- testar a câmera escolhida e iluminação real do local;
- considerar sensor traseiro se a manobra de ré precisar de proteção física;
- manter firmware, HEX, hash e protocolo versionados juntos em cada publicação.
