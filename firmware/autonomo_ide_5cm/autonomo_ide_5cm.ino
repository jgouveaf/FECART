/*
  MODO 1 APROVADO EM BANCADA - desvio a 5 cm - UNO + L298N + HC-SR04.
  Apenas bancada: rodas suspensas. Nao use o controle USB do site.
  Monitor Serial: 9600 baud e Nova linha. START inicia; STOP para.
  Sem camera, gestos, modos ou dependencia de heartbeat do PC.
  ENA/ENB com jumpers. Mesma polaridade do firmware integrado.
  Serial 9600, comandos terminados por nova linha:
    HELLO, START, STOP (ou ESTOP), STATUS, PING.
  Inicia PARADO. START inicia execucao continua; STOP permanece parado.
  Sensor invalido: para, continua medindo e retoma apos 2 leituras validas.
  Nao existe timeout da missao ou limite de cinco desvios.
  Primeira leitura proxima para; confirma 2 novas medidas parado antes da re.
  Nao suaviza distancia bruta nem transforma ausencia de eco em caminho livre.
  Giro por tempo NAO mede graus. Calibrar com rodas suspensas e depois no chao.
*/
#include <Arduino.h>
#include <string.h>

const byte IN1 = 7, IN2 = 6, IN3 = 5, IN4 = 4;
const byte TRIG = 3, ECHO = 2;
const unsigned long SENSOR_MS = 80UL;
const unsigned long TELEMETRIA_MS = 300UL;
const unsigned long PAUSA_MS = 150UL;
const unsigned long RE_MS = 400UL;
const unsigned long CURVA_MS = 650UL;
const float LIMITE_CM = 5.0; // Apenas teste supervisionado: pouca margem de frenagem.

enum Fase { PARADO, VERIFICAR, FRENTE, PAUSA_RE, RE, PAUSA_CURVA, CURVA, SENSOR };
Fase fase = PARADO;
bool habilitado = false;
bool direita = true;
bool permitirRe = true;
byte leiturasValidas = 0;
byte leiturasPerto = 0;
byte leiturasLivres = 0;
unsigned long faseDesde = 0;
unsigned long sensorDesde = 0;
unsigned long telemetriaDesde = 0;
unsigned long ecoUs = 0;
unsigned long amostra = 0;
float distanciaCm = -1;
const char* motor = "PARAR";
char linha[20];
byte tamanho = 0;
bool descartar = false;

void motores(byte a, byte b, byte c, byte d, const char* comando) {
  // Primeiro desenergiza as entradas; nao inverte a ponte numa unica escrita.
  digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
  digitalWrite(IN1, a); digitalWrite(IN2, b);
  digitalWrite(IN3, c); digitalWrite(IN4, d);
  motor = comando;
}

void entrar(Fase nova, unsigned long agora) {
  fase = nova;
  faseDesde = agora;
  if (nova == VERIFICAR || nova == SENSOR || nova == PARADO) {
    // Medidas obtidas durante movimento nao confirmam o caminho parado.
    leiturasValidas = 0;
    leiturasPerto = 0;
    leiturasLivres = 0;
  }
  switch (fase) {
    case FRENTE: motores(LOW, HIGH, LOW, HIGH, "FRENTE"); break;
    case RE: motores(HIGH, LOW, HIGH, LOW, "RE"); break;
    case CURVA:
      // Curva suave: uma roda avanca e a outra permanece parada.
      if (direita) motores(LOW, HIGH, LOW, LOW, "DIREITA");
      else motores(LOW, LOW, LOW, HIGH, "ESQUERDA");
      break;
    default: motores(LOW, LOW, LOW, LOW, "PARAR"); break;
  }
}

void parar(unsigned long agora) {
  habilitado = false;
  entrar(PARADO, agora);
}

void medir(unsigned long agora) {
  if (agora - sensorDesde < SENSOR_MS) return;
  sensorDesde = agora;
  digitalWrite(TRIG, LOW);
  delayMicroseconds(5);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  ecoUs = pulseIn(ECHO, HIGH, 25000UL); // limita bloqueio a ~25 ms
  amostra++;
  distanciaCm = ecoUs / 58.0;
  if (ecoUs == 0 || distanciaCm < 2 || distanciaCm > 400) {
    distanciaCm = -1; // nunca converte timeout em caminho livre
    leiturasValidas = 0;
    leiturasPerto = 0;
    leiturasLivres = 0;
  } else {
    if (leiturasValidas < 2) leiturasValidas++;
    // Contagem por amostra fisica, nunca por iteracao do loop.
    if (distanciaCm <= LIMITE_CM) {
      leiturasLivres = 0;
      if (leiturasPerto < 2) leiturasPerto++;
    } else {
      leiturasPerto = 0;
      if (leiturasLivres < 2) leiturasLivres++;
    }
  }
}

void atualizar(unsigned long agora) {
  if (!habilitado) return;
  // Parada imediata diante de leitura invalida. A recuperacao nao libera STOP.
  if (distanciaCm < 0 || agora - sensorDesde > 200UL) {
    if (fase != SENSOR) entrar(SENSOR, agora);
    return;
  }
  if (fase == SENSOR) {
    if (leiturasValidas >= 2) entrar(VERIFICAR, agora);
    return;
  }
  switch (fase) {
    case VERIFICAR:
      if (leiturasLivres >= 2) {
        permitirRe = true;
        entrar(FRENTE, agora);
      } else if (leiturasPerto >= 2) {
        // Uma unica re por encontro: sem sensor traseiro, nao recua sem fim.
        if (permitirRe) direita = !direita;
        entrar(permitirRe ? PAUSA_RE : PAUSA_CURVA, agora);
      }
      break;
    case FRENTE:
      if (distanciaCm <= LIMITE_CM) {
        // Para imediatamente, mas um pico isolado nao inicia uma manobra.
        entrar(VERIFICAR, agora);
      }
      break;
    case PAUSA_RE:
      if (distanciaCm > LIMITE_CM) {
        // O objeto pode ter sido removido antes de comecar a re.
        entrar(VERIFICAR, agora);
      } else if (agora - faseDesde >= PAUSA_MS) {
        permitirRe = false;
        entrar(RE, agora);
      }
      break;
    case RE:
      if (agora - faseDesde >= RE_MS) entrar(PAUSA_CURVA, agora);
      break;
    case PAUSA_CURVA:
      if (agora - faseDesde >= PAUSA_MS) entrar(CURVA, agora);
      break;
    case CURVA:
      if (agora - faseDesde >= CURVA_MS) {
        leiturasValidas = 0; // novas medidas com o chassi ja parado
        entrar(VERIFICAR, agora);
      }
      break;
    default: break;
  }
}

void status() {
  Serial.print(F("IDE5|UP:")); Serial.print(millis());
  Serial.print(F("|LIMITE_CM:")); Serial.print(LIMITE_CM, 1);
  Serial.print(F("|N:")); Serial.print(amostra);
  Serial.print(F("|RUN:")); Serial.print(habilitado ? 1 : 0);
  Serial.print(F("|PHASE:")); Serial.print((byte)fase);
  Serial.print(F("|CMD:")); Serial.print(motor);
  Serial.print(F("|DIST:"));
  if (distanciaCm < 0) Serial.print(F("ERR")); else Serial.print(distanciaCm, 1);
  Serial.print(F("|ECHO_US:")); Serial.print(ecoUs);
  Serial.print(F("|NEAR:")); Serial.print(leiturasPerto);
  Serial.print(F("|CLEAR:")); Serial.println(leiturasLivres);
}

void processar(unsigned long agora) {
  if (strcmp(linha, "STOP") == 0 || strcmp(linha, "ESTOP") == 0) {
    parar(agora); Serial.println(F("OK:STOP"));
  } else if (strcmp(linha, "START") == 0) {
    // START repetido e idempotente: nao reinicia a manobra em andamento.
    if (!habilitado) {
      habilitado = true;
      permitirRe = true;
      leiturasValidas = 0;
      entrar(VERIFICAR, agora);
    }
    Serial.println(F("OK:START"));
  } else if (strcmp(linha, "HELLO") == 0) Serial.println(F("AUTO:IDE:5CM:3"));
  else if (strcmp(linha, "PING") == 0) Serial.println(F("PONG"));
  else if (strcmp(linha, "STATUS") == 0) status();
  else Serial.println(F("ERR:COMMAND"));
}

void lerSerial(unsigned long agora) {
  byte budget = 48; // um fluxo serial continuo nao monopoliza o loop
  while (Serial.available() && budget--) {
    const char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (!descartar && tamanho) {
        linha[tamanho] = 0;
        processar(agora);
      }
      tamanho = 0;
      descartar = false;
    } else if (!descartar) {
      if (tamanho < sizeof(linha) - 1) linha[tamanho++] = c;
      else {
        tamanho = 0;
        descartar = true;
        parar(agora);
        Serial.println(F("ERR:LINE"));
      }
    }
  }
}

void setup() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  digitalWrite(TRIG, LOW);
  parar(millis());
  Serial.begin(9600);
  Serial.println(F("TESTE 5 CM: parado. Monitor 9600 + Nova linha. START inicia; STOP para."));
  Serial.println(F("AUTO:IDE:5CM:3"));
}

void loop() {
  lerSerial(millis());
  medir(millis());
  atualizar(millis());
  if (millis() - telemetriaDesde >= TELEMETRIA_MS) {
    telemetriaDesde = millis();
    status();
  }
}
