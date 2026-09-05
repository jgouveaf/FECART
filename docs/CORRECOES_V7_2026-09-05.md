# V7 — correções para o próximo teste de bancada

Data: 05/09/2026. Arduino UNO, USB, L298N e HC-SR04. Sem ESP32.

## O que mudou e por quê

- **Partida involuntária:** a V6 saía da janela de boot e podia avançar sem
  comando. A V7 nasce em ESTOP e só libera após `RESET_ESTOP` e duas novas
  leituras válidas. Abrir a USB ou reiniciar não autoriza movimento.
- **Parada substituída pelo autônomo:** `CMD:PARAR` era sobrescrito pelo próximo
  ciclo local. Agora fica travado no Modo 1 até liberação explícita. Nos modos
  remotos, PARAR continua substituível por outro comando; ESTOP nunca é.
- **Ré repetida depois de falha do sensor:** o cancelamento da manobra esquecia
  que já havia recuado. A V7 preserva essa informação e só permite nova ré
  depois de confirmar caminho livre, ou de uma nova liberação do operador.
- **Obstáculo removido antes da ré:** a pausa inicial agora cancela a manobra
  quando a leitura fica livre e exige confirmação antes de avançar.
- **Emergência durante troca de modo/teste:** o botão deixava de responder
  durante a transição. Agora cancela a operação pendente e envia ESTOP.
- **Atualização sem parar:** a desconexão normal do Modo 1 mantém a autonomia;
  o gravador usava essa mesma operação. Agora a atualização exige `OK:ESTOP`
  antes de liberar a porta. Sem ACK, cancela a gravação e avisa para desligar
  a alimentação. A confirmação inicial também exige motores desligados.
- **Seleção de porta depois de rede lenta:** a V6 esperava download e hash antes
  de pedir a porta, podendo perder a ativação transitória do clique. Na V7 a
  seleção ocorre primeiro, sem abrir a porta; cancelar preserva a conexão
  existente. O HEX ainda é validado antes de abrir/gravar.
- **Telemetria enganosa:** confirmar início do programa não preenche mais
  FRENTE artificialmente; a direção mostrada vem da resposta do firmware.

Não foram alterados a polaridade aprovada, a curva com uma roda parada, o
limite de bancada de 5 cm, ré de 400 ms, pausas de 150 ms e curva de 650 ms.
O sketch isolado aprovado foi preservado. Depois de iniciado, o Modo 1 segue
localmente, sem temporizador de missão. Sensor inválido continua parando.

## Verificação executada — sem hardware

- Compilação real com Arduino CLI para `arduino:avr:uno`: 7.296 bytes de flash
  e 401 bytes de SRAM. Isso não comprova funcionamento físico.
- `python -m unittest discover -s tests -q`: 658 testes, 656 aprovados e 2
  ignorados. Esta descoberta não inclui a pasta `firmware/simulacao`.
- `firmware.simulacao.test_simulador_robo`: 20 testes aprovados, incluindo
  500 ciclos de obstáculo. Ciclos sintéticos não são ensaios físicos.
- Harness do firmware: 14 cenários aprovados. Extrai corpos C++ e os adapta
  para JavaScript com relógio e IO simulados; não executa o HEX no AVR.
- Web Serial: 25 cenários aprovados, incluindo ACK ausente, falha de conexão,
  emergência durante transição e parada antes da atualização.
- Gravador: 11 cenários aprovados com rede/USB/STK500 simulados e SHA-256 real.
  Rodar os mesmos testes contra o gravador anterior reproduziu 5 falhas.
- Navegador Chromium sem câmera/USB reais: carregamento, câmera sintética,
  inicialização dos modelos locais, interface, comandos no simulador e
  larguras de 320/768/1440 px passaram, sem erros de página/rede ou requisições
  externas. Não mede acurácia em mãos/rostos reais.

Os 14 cenários de firmware e os 11 do gravador também são invocados por wrappers
da bateria Python; os números não devem ser somados como testes independentes.

HEX normalizado para LF, SHA-256:
`209502ace25deb4220434295e2f6703d5bf559f496a1a98ebd51a3f53bcdf614`.
Firmware, HEX, hash, pacote de códigos e identificação V7 foram sincronizados.

## Falha aberta: qualificação para o piso

`python -m unittest firmware.simulacao.test_arena_2d -q` **não passou**:
9 métodos, 23 falhas de subteste (3 cenários e 20 repetições do mesmo cenário).
Com inicialização explícita, parede frontal, múltiplos obstáculos e corredor
com barreira registram colisão; objeto pequeno completa 30 s sem colisão.
Os testes passaram a exigir movimento e desvios para não aceitar um robô parado
como evidência de navegação. As asserções de ausência de colisão foram mantidas.

A arena aproxima a curva como rotação no centro, não como arco com uma roda
parada, e não representa inércia/bateria/atrito. Portanto, não atribuímos a causa
física só ao limite de 5 cm nem usamos o resultado como certificação. Precisamos
alinhar a cinemática do simulador e calibrar margem de frenagem e curva no
carrinho antes de liberar o piso. A interface informa essa pendência.

## Próximo passo e riscos

1. Desligar a alimentação dos motores; manter rodas suspensas e USB para gravar.
2. Gravar V7 em Códigos; reconectar e conferir identificação e estado parado.
3. Somente com supervisão, ligar motores e ativar Modo 1 para um ensaio curto.
4. Conferir parada, ré, curva e retomada; testar Parada e exigir nova liberação.

Nenhuma porta física foi aberta, nenhum firmware foi gravado no carrinho e
nenhum motor foi acionado nesta revisão. Falha de sensor não deve ser contornada
fazendo avançar sem leitura. Para mexer em fios, desligar USB e baterias.
Um sensor frontal não protege a ré nem detecta bordas de mesa. Perder USB no
Modo 1 mantém a autonomia local, mas impede usar o botão remoto: usar a chave.

Não há nota 9,9/10 ou garantia de 100% nesta entrega: há correções verificadas
em software, três cenários de piso reprovados e validação física pendente.

## Referências usadas nesta correção

- [Web Serial — requisitos de ativação de requestPort](https://wicg.github.io/serial/).
- [Chrome — conexão serial a partir da interação do usuário](https://developer.chrome.com/docs/capabilities/serial).
- [Arduino — reset de placas por DTR/RTS durante upload](https://docs.arduino.cc/arduino-cli/platform-specification/).
