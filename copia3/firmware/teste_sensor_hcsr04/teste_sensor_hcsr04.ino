/*
  TESTE 2 - HC-SR04

  Ligacao do sensor, olhando a frente dele, da esquerda para a direita:
  VCC -> 5V | TRIG -> D3 | ECHO -> D2 | GND -> GND

  Abra o Monitor Serial em 115200 baud.
*/

const byte TRIG = 3;
const byte ECHO = 2;

unsigned int medirDistanciaCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  const unsigned long duracao = pulseIn(ECHO, HIGH, 25000UL);
  if (duracao == 0) {
    return 0;
  }
  return (unsigned int)(duracao / 58UL);
}

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  digitalWrite(TRIG, LOW);
  Serial.begin(115200);
  delay(500);
  Serial.println(F("TESTE HC-SR04 INICIADO"));
}

void loop() {
  const unsigned int distancia = medirDistanciaCm();

  if (distancia == 0) {
    Serial.println(F("SEM ECO - revise VCC/TRIG/ECHO/GND"));
  } else {
    Serial.print(F("Distancia: "));
    Serial.print(distancia);
    Serial.println(F(" cm"));
  }

  delay(200);
}
