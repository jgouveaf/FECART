# Checkpoint — Etapa 1: Modo 1 autônomo

## Status

**Base funcional aprovada em bancada em 04/09/2026.** O usuário confirmou com
as rodas suspensas o novo HC-SR04, a polaridade de frente e ré e a curva suave
com uma roda em movimento e a outra parada. A referência física aprovada é
`firmware/autonomo_ide_5cm/autonomo_ide_5cm.ino`.

O firmware integrado V7 do site incorpora a mesma polaridade e sequência. O
limite de 5 cm continua sendo somente de bancada: distância de operação e tempo
de curva precisam ser calibrados no piso antes de uso livre.

## Comportamento aprovado

- pinagem: IN1 D7, IN2 D6, IN3 D5, IN4 D4, TRIG D3 e ECHO D2;
- frente: `LOW, HIGH, LOW, HIGH`;
- ré: `HIGH, LOW, HIGH, LOW`;
- direita: roda esquerda para frente e roda direita parada;
- esquerda: roda esquerda parada e roda direita para frente;
- primeira leitura próxima para imediatamente;
- duas novas leituras próximas confirmam a manobra;
- sequência: pausa de 150 ms, ré de 400 ms, pausa de 150 ms e curva de 650 ms;
- duas leituras livres liberam o avanço após a curva;
- bloqueio persistente prolonga apenas a curva, sem repetir a ré às cegas;
- sensor sem eco para o movimento e exige duas leituras válidas para recuperar;
- não há temporizador de missão nem limite automático de desvios.

## Integração no site

- firmware oficial identificado por `QT:READY:V7`;
- boot/reset espera liberação explícita; `CMD:PARAR` no Modo 1 fica travado;
- a recuperação do sensor não repete ré para o mesmo obstáculo;
- um único HEX oficial atende aos três modos;
- o Modo 1 executa localmente no UNO e não depende de heartbeat do navegador;
- os Modos 2 e 3 continuam supervisionados por USB e param após 1,5 s sem novo
  comando;
- o site grava o HEX compilado e verifica seu SHA-256 antes de abrir a porta;
- editor de código é para consulta e download, não para compilação arbitrária;
- o painel isolado redundante foi removido da página principal para impedir uso
  simultâneo ou confusão entre dois firmwares.

## Evidência disponível

- teste físico informado pelo usuário: sketch isolado aprovado com rodas
  suspensas;
- compilação do V7 para Arduino UNO: 7.296 bytes de flash e 401 bytes de SRAM;
- testes de máquina de estados extraem corpos das funções C++ e os adaptam a
  JavaScript com tempo e IO simulados; não executam o binário AVR;
- simulador lógico cobre falha do sensor, picos, obstáculos repetidos e parada;
- testes Web Serial cobrem handshake, ACK, timeout, desconexão e ESTOP;
- testes de navegador cobrem carregamento, layout, câmera simulada e fluxo de
  gravação sem abrir hardware automaticamente.

## Limitações honestas

- telemetria confirma a ordem elétrica, não que a roda girou fisicamente;
- simulação não mede bateria, corrente, atrito, inércia, mau contato ou ângulo;
- um HC-SR04 frontal não enxerga a traseira durante a ré;
- 5 cm não oferece margem de frenagem comprovada no piso;
- três cenários da arena 2D colidem com o ajuste de bancada de 5 cm; as
  asserções de ausência de colisão continuam falhando, não foram relaxadas;
- a arena usa cinemática aproximada e ainda não reproduz o arco da curva com
  uma roda parada; ela não certifica segurança ou ângulo no carrinho;
- o firmware integrado V7 ainda deve ser ensaiado fisicamente de forma
  supervisionada antes de considerar a implantação encerrada.

## Próximo ensaio físico

1. Gravar o V7 oficial pelo site com os motores desligados.
2. Conectar novamente, confirmar `Firmware V7` e conferir que nada parte sozinho.
3. Com as rodas suspensas, ativar o Modo 1 e conferir frente, parada, ré, curva e retomada.
4. Testar a parada de emergência. Para mudar fios e preparar um teste sem ECHO,
   desligar antes USB e baterias; não desconectar fios com alimentação ligada.
5. Só então elevar gradualmente o limite de 5 cm e calibrar o uso no piso.
