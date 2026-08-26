# Quantum Tracker — Arduino UNO e controle USB

Firmware integrado para Arduino UNO, L298N, dois motores DC e HC-SR04. Ele
mantém a segurança no próprio Arduino e aceita comandos do site pelo cabo USB.
Bluetooth, câmera e IA executam no computador; o Arduino não depende deles para
detectar o obstáculo à frente.

## Pinagem confirmada

Desligue o USB e as baterias antes de alterar qualquer fio.

| Arduino UNO | Destino |
|---|---|
| D7 | L298N IN1 |
| D6 | L298N IN2 |
| D5 | L298N IN3 |
| D4 | L298N IN4 |
| D3 | HC-SR04 TRIG |
| D2 | HC-SR04 ECHO |
| 5V | HC-SR04 VCC |
| GND | HC-SR04 GND e GND do L298N |

No L298N, mantenha os jumpers ENA e ENB instalados, ligue um motor em
OUT1/OUT2 e o outro em OUT3/OUT4. O negativo da bateria, o GND do L298N e o GND
do Arduino precisam estar unidos. A alimentação dos motores entra no borne
`12V`/`VMS` e `GND`; nunca coloque as pilhas diretamente no pino 5V do Arduino.

## Instalar com Arduino IDE 2.3.10

1. Abra `firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino`.
2. Selecione **Arduino Uno** e a porta COM correta.
3. Feche o Monitor Serial e feche qualquer site/app que esteja usando essa COM.
4. Deixe as rodas suspensas, confira a polaridade da alimentação e clique em
   **Carregar**.
5. A compilação validada usa 7.278 bytes de flash e 418 bytes de RAM. O sketch
   não precisa de biblioteca externa.

O Arduino IDE é necessário somente para instalar ou atualizar o firmware. O
código permanece gravado no UNO depois que o cabo ou a alimentação são
desligados. Depois do envio, feche o Monitor Serial e o Arduino IDE para liberar
a porta COM.

Sem o site conectado, o Modo 1 começa automaticamente. Para usar o painel,
abra-o no Chrome ou Edge para computador, clique em **Conectar Arduino USB** e
escolha o Arduino UNO. O UNO reinicia quando a porta serial é aberta. Após
anunciar `QT:READY:V5`, o firmware mantém as rodas paradas por mais 750 ms para
o painel concluir o handshake e confirmar `ESTOP` antes de qualquer movimento.

## Os três modos

### Modo 1 — autônomo

O Arduino anda continuamente depois da primeira leitura válida do HC-SR04.
Duas leituras consecutivas de até 20 cm iniciam o desvio: parar, recuar uma
única vez, virar, confirmar duas leituras livres na nova direção e continuar.
O lado da curva é alternado. Esse modo continua funcionando mesmo sem site
conectado.

### Modo 2 — seguir pessoa

A câmera do rosto escolhe a maior pessoa detectada e envia `ESQUERDA`, `FRENTE`
ou `DIREITA` conforme a posição dela no quadro. Ao perder o rosto, o comando é
`PARAR`. O HC-SR04 continua tendo prioridade e executa o desvio antes de voltar
ao seguimento.

O painel BLE exibe apenas intensidade/proximidade do sinal. Um único receptor
RSSI não informa se a pessoa está à esquerda ou à direita; portanto o robô não
se movimenta às cegas atrás de uma parede. Para localização direcional real,
são necessários vários receptores fixos ou outro sistema de posicionamento.

### Modo 3 — gestos

A câmera da mão conta os dedos e o site envia:

| Dedos | Comando |
|---:|---|
| 1 | Frente |
| 2 | Direita |
| 3 | Esquerda |
| 4 | Parar imediatamente |
| 5 | Girar |

Sem uma mão válida por cerca de 700 ms, o site manda parar. Sem receber um
comando novo por 1,5 s, o próprio Arduino também para.

## Camadas de segurança

- `PARAR` e `ESTOP` cancelam um desvio em andamento.
- Nenhum motor é liberado antes da primeira leitura válida do HC-SR04.
- O HC-SR04 é verificado nos três modos e sempre vence um comando da câmera.
- Após uma curva, duas leituras livres confirmam o novo caminho antes do avanço.
- Cinco leituras inválidas consecutivas do sensor travam os motores.
- Cinco obstáculos em 15 segundos ativam a parada de emergência.
- Nos Modos 2 e 3, ausência de comandos por 1,5 segundo para os motores.
- O site bloqueia o robô se a comunicação USB ficar silenciosa por 2,2 segundos.
- Linhas seriais corrompidas ou longas são descartadas até o próximo fim de linha.
- Somente `OK:CMD:...` confirma um comando; telemetria antiga nunca vale como ACK.
- O botão de emergência só deve ser liberado depois de conferir o entorno e as
  rodas.

A câmera auxilia no alinhamento com a pessoa; ela não substitui o HC-SR04 como
sensor físico de obstáculo.

## Protocolo serial (9600 baud)

Comandos aceitos, uma linha por vez:

```text
MODE:1
MODE:2
MODE:3
CMD:FRENTE
CMD:TRAS
CMD:DIREITA
CMD:ESQUERDA
CMD:PARAR
CMD:GIRAR
ESTOP
RESET_ESTOP
STATUS
PING
```

Telemetria emitida pelo Arduino:

```text
QT|MODE:3|DIST:42.0|CMD:FRENTE|STATE:GESTOS
```

## Diagnóstico em ordem

1. Com as rodas suspensas, teste alimentação, GND comum e jumpers ENA/ENB.
2. Se nenhum motor girar, carregue `teste_motores/teste_motores.ino`.
3. Se o sensor não variar, carregue `teste_sensor_hcsr04/teste_sensor_hcsr04.ino`
   e leia a distância no Monitor Serial.
4. Recarregue o firmware integrado e teste primeiro o Modo 1.
5. Só depois teste os Modos 2 e 3 pelo site, mantendo o cabo USB conectado.

Quatro pilhas Ni-MH de 1,2 V fornecem aproximadamente 4,8 V antes das perdas do
L298N. Se o motor só vibrar ou não partir, meça a tensão sob carga: alimentação
insuficiente não pode ser corrigida por software.

## Testes sem movimentar o robô

```powershell
cd D:\QUANTUM_TRACKER
.\.venv\Scripts\python.exe -m unittest discover -s tests -q
```

Esses testes verificam firmware, protocolo, segurança, interface, câmera e
persistência. Eles não substituem o teste físico com as rodas suspensas.
