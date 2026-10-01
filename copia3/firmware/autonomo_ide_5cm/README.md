# Teste no Arduino IDE: desvio a 5 cm

## Versao aprovada do Modo 1

**Aprovada pelo usuario em teste fisico supervisionado em 04/09/2026.** O
HC-SR04 substituto mediu corretamente; frente e re foram validadas conforme a
orientacao real do chassi; e a curva aprovada mantem uma roda para frente e a
outra parada. Este arquivo passa a ser a referencia funcional do Modo 1.

O limite de 5 cm continua sendo apenas de bancada. Antes de colocar o carrinho
no chao, sera necessario aumentar a distancia e calibrar `TEMPO_RE_MS` e
`TEMPO_CURVA_MS` no ambiente real, sem alterar a sequencia aprovada.

Sketch separado para comparar o comportamento do sensor e da curva. O firmware
do site agora incorpora esta sequência aprovada e também usa 5 cm enquanto a
calibração no piso não for concluída. Este teste usa a mesma lógica
de confirmacao da versao isolada v2 e a mesma polaridade dos motores.

## Como usar

1. Pare e desconecte a USB pelo site. Feche outras abas/programas usando a porta.
2. Desligue a alimentacao dos motores. Mantenha o UNO no USB.
3. No Arduino IDE, abra `autonomo_ide_5cm.ino` dentro desta pasta.
4. Selecione Arduino Uno e a porta da sua placa. Clique na seta Carregar (Upload).
   Compilar/Verificar sozinho nao transfere o programa para o Arduino.
5. Abra o Monitor Serial em **9600 baud**, final de linha **Nova linha**.
   A placa inicia parada e ja mostra as leituras. Confirme `LIMITE_CM:5.0`.
6. Confira o sensor com os motores desligados. Antes de testar movimento,
   apoie o chassi com firmeza e as DUAS rodas suspensas, livres, longe de dedos.
   Ligue os motores e envie `START` em maiusculas. Envie `STOP` para parar.
7. Para terminar, envie STOP e desligue a alimentacao dos motores antes de
   fechar o Monitor Serial ou desconectar o USB. Sem o computador, apos START,
   o autonomo pode continuar na placa: mantenha a chave fisica acessivel.

## Comportamento e limites

- Distancia valida **acima de 5 cm**, confirmada: anda.
- Distancia **menor ou igual a 5 cm**: para e exige duas novas leituras proximas
  antes de dar re e girar. Um pico isolado pode causar pausa, mas nao manobra.
- Sensor invalido/sem eco: para e continua medindo. Recuperacao nao libera STOP.
- Re: 400 ms; curva: 650 ms; angulo real nao medido. Nao ha limite de ciclos.
- **5 cm tem pouca margem de frenagem; nao garante evitar colisao.** E um ensaio
  de bancada, nao uma configuracao validada para o carrinho no chao.
- Uma leitura falsa persistente em 5 cm ou menos ainda vai provocar curvas.
  Reduzir o limite nao conserta sensor, alimentacao, reflexos ou motor sem giro.
- A telemetria mostra a ordem eletrica, nao confirma o movimento das rodas.

Pinagem preservada: IN1=D7, IN2=D6, IN3=D5, IN4=D4, TRIG=D3, ECHO=D2;
ENA e ENB com jumpers. Nenhum ESP32, camera, gesto ou site e necessario.

Identidade serial: `AUTO:IDE:5CM:3`. O site recusa este firmware de teste.
Para voltar ao site, pare/desligue os motores, feche o Monitor Serial e grave
novamente o firmware oficial pelo painel Codigos.

Teste de logica: `node tests/autonomous_ide_5cm.test.cjs`.
Compilacao: `arduino-cli compile --fqbn arduino:avr:uno firmware/autonomo_ide_5cm`.
Testes de software nao comprovam funcionamento fisico.
