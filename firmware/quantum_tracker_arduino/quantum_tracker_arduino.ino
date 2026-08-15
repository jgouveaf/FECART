/*
  Quantum Tracker - Etapa 1
  Arduino UNO + L298N + HC-SR04

  Comportamento:
  - inicia sozinho;
  - anda para frente;
  - confirma obstaculos com o HC-SR04;
  - para, gira no proprio eixo e continua;
  - para por seguranca apos 5 desvios em 15 segundos.

  Nao usa aplicativo, Bluetooth, gestos ou comandos seriais.
*/

// L298N: ENA e ENB devem ficar com os jumpers instalados.
const byte IN1 = 7;
const byte IN2 = 6;
const byte IN3 = 5;
const byte IN4 = 4;

// HC-SR04: VCC -> 5V, TRIG -> D3, ECHO -> D2, GND -> GND.
const byte TRIG = 3;
const byte ECHO = 2;

const unsigned int DISTANCIA_OBSTACULO_CM = 20;
const unsigned int TEMPO_PARADO_MS = 120;
const unsigned int TEMPO_CURVA_BASE_MS = 800;
const unsigned int AUMENTO_CURVA_MS = 180;
const unsigned long JANELA_DESVIOS_MS = 15000UL;
const byte LIMITE_DESVIOS = 5;

enum Estado {
  FRENTE,
  PAUSA_ANTES_CURVA,
  CURVANDO,
  PARADO_SEGURANCA
};

Estado estado = FRENTE;
unsigned long estadoDesde = 0;
unsigned long temposDesvios[LIMITE_DESVIOS];
byte desviosRegistrados = 0;
bool proximaCurvaDireita = true;

void aplicarMotores(bool in1, bool in2, bool in3, bool in4) {
  digitalWrite(IN1, in1);
  digitalWrite(IN2, in2);
  digitalWrite(IN3, in3);
  digitalWrite(IN4, in4);
}

void pararMotores() {
  aplicarMotores(LOW, LOW, LOW, LOW);
}

void andarParaFrente() {
  aplicarMotores(HIGH, LOW, HIGH, LOW);
}

void girarNoLugar(bool direita) {
  if (direita) {
    aplicarMotores(HIGH, LOW, LOW, HIGH);
  } else {
    aplicarMotores(LOW, HIGH, HIGH, LOW);
  }
}

unsigned int medirDistanciaCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);

  // 25 ms cobre aproximadamente 4,3 metros e impede travamento sem eco.
  const unsigned long duracao = pulseIn(ECHO, HIGH, 25000UL);
  if (duracao == 0) {
    return 999;  // Sem eco: nao inventa obstaculo.
  }
  return (unsigned int)(duracao / 58UL);
}

bool obstaculoConfirmado() {
  byte leiturasPerto = 0;

  // Duas de tres leituras evitam desvios causados por um eco isolado.
  for (byte i = 0; i < 3; i++) {
    const unsigned int distancia = medirDistanciaCm();
    if (distancia >= 2 && distancia <= DISTANCIA_OBSTACULO_CM) {
      leiturasPerto++;
    }
    delay(18);
  }

  return leiturasPerto >= 2;
}

bool atingiuLimiteDeDesvios(unsigned long agora) {
  // Remove da fila os desvios que ja sairam da janela movel.
  byte validos = 0;
  for (byte i = 0; i < desviosRegistrados; i++) {
    if (agora - temposDesvios[i] <= JANELA_DESVIOS_MS) {
      temposDesvios[validos++] = temposDesvios[i];
    }
  }
  desviosRegistrados = validos;

  if (desviosRegistrados < LIMITE_DESVIOS) {
    temposDesvios[desviosRegistrados++] = agora;
  }

  return desviosRegistrados >= LIMITE_DESVIOS;
}

unsigned int tempoDaCurvaMs() {
  // Aumenta a rotacao quando o robo encontra varios bloqueios na mesma janela.
  // O quinto bloqueio para o sistema antes de chegar aqui.
  return TEMPO_CURVA_BASE_MS + (desviosRegistrados - 1) * AUMENTO_CURVA_MS;
}

void mudarEstado(Estado novoEstado, unsigned long agora) {
  estado = novoEstado;
  estadoDesde = agora;
}

void setup() {
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);

  pararMotores();
  digitalWrite(TRIG, LOW);
  delay(1000);  // Tempo para a alimentacao estabilizar.

  estadoDesde = millis();
  andarParaFrente();
}

void loop() {
  const unsigned long agora = millis();

  switch (estado) {
    case FRENTE:
      andarParaFrente();
      if (obstaculoConfirmado()) {
        pararMotores();

        if (atingiuLimiteDeDesvios(agora)) {
          mudarEstado(PARADO_SEGURANCA, agora);
        } else {
          mudarEstado(PAUSA_ANTES_CURVA, agora);
        }
      }
      break;

    case PAUSA_ANTES_CURVA:
      if (agora - estadoDesde >= TEMPO_PARADO_MS) {
        girarNoLugar(proximaCurvaDireita);
        mudarEstado(CURVANDO, agora);
      }
      break;

    case CURVANDO:
      if (agora - estadoDesde >= tempoDaCurvaMs()) {
        proximaCurvaDireita = !proximaCurvaDireita;
        andarParaFrente();
        mudarEstado(FRENTE, agora);
      }
      break;

    case PARADO_SEGURANCA:
      pararMotores();
      break;
  }
}
