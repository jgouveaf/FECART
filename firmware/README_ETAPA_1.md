# Quantum Tracker - Etapa 1

Firmware destinado exclusivamente ao Arduino UNO, L298N, dois motores DC e
HC-SR04. Nesta etapa nao ha aplicativo, Bluetooth, ESP32, camera ou gestos.

## Pinagem obrigatoria

Desligue USB e baterias antes de alterar fios.

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

Regras do L298N:

- os jumpers ENA e ENB precisam estar instalados;
- motor A deve ocupar OUT1 e OUT2;
- motor B deve ocupar OUT3 e OUT4;
- negativo da bateria, GND do L298N e GND do Arduino precisam estar unidos;
- positivo da bateria dos motores entra em `12V`/`VMS` do L298N;
- nao ligue a saida de 5V do L298N no 5V do Arduino com o jumper `5V-EN`
  instalado.

## Problemas visiveis nas fotos recebidas

1. Ha fios ligados em D0/RX e D1/TX, enquanto D6 e D7 aparecem vazios. Para
   esta pinagem, mova os fios de D0 e D1 para D6 e D7. D0 e D1 sao reservados
   para USB/Serial.
2. O borne de alimentacao tem fios entrando por tras, mas os rotulos ficam
   escondidos nas fotos. Confirme na propria placa: positivo da bateria em
   `12V`/`VMS`, negativo em `GND` e GND do Arduino unido a esse mesmo GND.
3. Os quatro fios de controle e os dois jumpers ENA/ENB aparecem presentes no
   segundo angulo. Ainda assim, confira a ordem IN1, IN2, IN3 e IN4 pelos
   rotulos impressos, pois a ordem de cores fotografada nao corresponde a
   D7, D6, D5 e D4 no Arduino.
4. O suporte usa quatro pilhas Ni-MH de 1,2 V, total nominal de 4,8 V. O L298N
   perde parte dessa tensao; sob carga os motores podem nao partir. Isso nao e
   corrigivel por software. Primeiro confirme todo o circuito com as rodas
   suspensas. Se nem o teste minimo girar, meca a tensao e revise a alimentacao.

As constatacoes foram feitas comparando todos os angulos recebidos e precisam
ser confirmadas no hardware real pelos rotulos impressos na placa.

## Politica de testes desta fase

Todos os testes de desenvolvimento da Etapa 1 sao executados sem o robo:

- compilacao local para Arduino UNO;
- simulacao da maquina de estados;
- injecao de distancias falsas do HC-SR04;
- verificacao das saidas logicas IN1, IN2, IN3 e IN4;
- testes automatizados de caminho livre, ruido, desvio e parada de seguranca.

Execute a simulacao com:

```powershell
cd D:\QUANTUM_TRACKER\firmware\simulacao
python -m unittest -v
python simulador_robo.py
```

Os sketches `teste_motores` e `teste_sensor_hcsr04` ficam reservados para a
Etapa 10, quando o projeto for finalmente aplicado no robo. Nao os envie agora.

## Ordem futura de validacao no hardware - somente Etapa 10

### 1. Motores

Abra `teste_motores/teste_motores.ino`, selecione Arduino Uno e a porta correta,
compile e envie. Deixe as rodas suspensas.

Esperado: frente por 3 s, pausa, re por 3 s e parada definitiva.

Se nenhum motor girar, o defeito esta em alimentacao, GND comum, ENA/ENB,
pinagem ou driver. Nao avance para o sensor.

Se somente um girar, teste o motor e o respectivo par OUT/IN.

Se ambos girarem em sentidos opostos, inverta os dois fios de apenas um motor.

### 2. Sensor

Abra `teste_sensor_hcsr04/teste_sensor_hcsr04.ino`, envie e abra o Monitor Serial
em 115200 baud. A distancia deve acompanhar um objeto movido diante do sensor.

### 3. Integracao autonoma

Somente depois dos dois testes anteriores, envie
`quantum_tracker_arduino/quantum_tracker_arduino.ino`.

O robo inicia sozinho apos 1 s, anda, confirma obstaculo em ate 20 cm, para,
gira no proprio eixo, alterna curvas para direita/esquerda e continua. Curvas
repetidas ficam progressivamente maiores. Cinco desvios dentro de 15 s causam
parada de seguranca; reinicie o Arduino para recomecar.

## Compilacao mais rapida no Arduino IDE 2.3.10

- mantenha placa `Arduino Uno` selecionada;
- feche Monitor Serial antes de enviar;
- use `Verificar` apenas uma vez e depois `Enviar`;
- estes sketches nao usam bibliotecas externas;
- a primeira compilacao pode montar o cache; as seguintes devem ser menores.

O codigo compilar e a simulacao passar comprovam apenas o comportamento de
software. A aplicacao fisica fica deliberadamente adiada para a Etapa 10.
