/*
  TESTE 1 - L298N e dois motores

  IMPORTANTE:
  1. Levante as rodas do chao.
  2. ENA e ENB devem estar com os jumpers instalados no L298N.
  3. Nao usa sensor, Serial, Bluetooth ou aplicativo.

  Resultado esperado:
  - 2 s parado;
  - 3 s com os dois motores para frente;
  - 2 s parado;
  - 3 s com os dois motores para tras;
  - para definitivamente.
*/

const byte IN1 = 7;
const byte IN2 = 6;
const byte IN3 = 5;
const byte IN4 = 4;

void motores(bool in1, bool in2, bool in3, bool in4) {
  digitalWrite(IN1, in1);
  digitalWrite(IN2, in2);
  digitalWrite(IN3, in3);
  digitalWrite(IN4, in4);
}

void setup() {
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  motores(LOW, LOW, LOW, LOW);
  delay(2000);

  motores(HIGH, LOW, HIGH, LOW);
  delay(3000);

  motores(LOW, LOW, LOW, LOW);
  delay(2000);

  motores(LOW, HIGH, LOW, HIGH);
  delay(3000);

  motores(LOW, LOW, LOW, LOW);
}

void loop() {
  // O teste termina parado. Aperte RESET para repetir.
}
