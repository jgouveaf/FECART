/*
  Quantum Tracker - controle integrado com Bluetooth HC-08
  Arduino UNO + L298N + HC-SR04 + USB Serial + HC-08 Bluetooth

  MODOS:
  1 - AUTONOMO: anda sempre e desvia com o HC-SR04.
  2 - SEGUIR: recebe direcao da camera; sensor continua soberano.
  3 - GESTOS: recebe os gestos; sensor continua soberano.

  PROTOCOLO SERIAL (9600 baud, uma linha por comando):
  MODE:1 | MODE:2 | MODE:3
  CMD:FRENTE | CMD:TRAS | CMD:DIREITA | CMD:ESQUERDA | CMD:PARAR | CMD:GIRAR
  HELLO | ESTOP | RESET_ESTOP | PING | STATUS

  Seguranca:
  - PARAR e ESTOP interrompem imediatamente;
  - modos 2 e 3 param se nenhum novo CMD:* chegar por 1,5 s;
  - PING testa o enlace, mas nao renova um comando de movimento antigo;
  - cinco falhas consecutivas travam o sensor; tres leituras validas o recuperam;
  - obstaculo frontal bloqueia frente, curvas e giro (RE e PARAR continuam permitidos);
  - cinco obstaculos em 15 s ativam parada de seguranca.
*/

#include <SoftwareSerial.h>

// Configuração do Bluetooth nos pinos 11 (RX) e 12 (TX)
// O TX do HC-08 vai no pino 11 do Arduino. O RX do HC-08 vai no pino 12.
SoftwareSerial bluetooth(11, 12);

// L298N: mantenha os jumpers ENA e ENB instalados.
const byte IN1 = 7;
const byte IN2 = 6;
const byte IN3 = 5;
const byte IN4 = 4;

// HC-SR04: VCC -> 5V, TRIG -> D3, ECHO -> D2, GND -> GND.
const byte TRIG = 3;
const byte ECHO = 2;

const float DISTANCIA_OBSTACULO_CM = 20.0;
const unsigned long INTERVALO_SENSOR_MS = 80UL;
const unsigned long INTERVALO_TELEMETRIA_MS = 250UL;
const unsigned long TIMEOUT_COMANDO_MS = 1500UL;
const unsigned long JANELA_OBSTACULOS_MS = 15000UL;
// Mantém as rodas paradas logo após o boot para o site enviar ESTOP antes
// que o Modo 1 possa começar. Sem site, o autônomo inicia após esta janela.
const unsigned long JANELA_COMANDO_INICIAL_MS = 750UL;

const unsigned int TEMPO_PAUSA_MS = 200;
const unsigned int TEMPO_RE_MS = 700;
const unsigned int TEMPO_CURVA_MS = 900;
const unsigned int TEMPO_SAIDA_MS = 600;

const byte LIMITE_FALHAS_SENSOR = 5;
const byte LEITURAS_VALIDAS_PARA_RECUPERAR = 3;
const byte LIMITE_OBSTACULOS = 5;

enum ModoRobo { MODO_AUTONOMO = 1, MODO_SEGUIR = 2, MODO_GESTOS = 3 };
enum ComandoMovimento { CMD_PARAR, CMD_FRENTE, CMD_TRAS, CMD_DIREITA, CMD_ESQUERDA, CMD_GIRAR };
enum EstadoDesvio {
  DESVIO_INATIVO,
  DESVIO_PAUSA_INICIAL,
  DESVIO_RE,
  DESVIO_PAUSA_RE,
  DESVIO_CURVA,
  DESVIO_PAUSA_CURVA,
  DESVIO_SAIDA
};

ModoRobo modo = MODO_AUTONOMO;
ComandoMovimento comandoRecebido = CMD_FRENTE;
ComandoMovimento comandoAplicado = CMD_PARAR;
EstadoDesvio estadoDesvio = DESVIO_INATIVO;

unsigned long ultimoSensorEm = 0;
unsigned long ultimaTelemetriaEm = 0;
unsigned long ultimoComandoEm = 0;
unsigned long estadoDesvioDesde = 0;
unsigned long obstaculosEm[LIMITE_OBSTACULOS];

float distanciaAtualCm = -1;
byte falhasConsecutivasSensor = 0;
byte leiturasValidasRecuperacao = 0;
byte obstaculosConsecutivos = 0;
byte quantidadeObstaculos = 0;
bool proximaCurvaDireita = true;
bool paradaEmergencia = false;
bool sensorBloqueado = false;

char linhaSerial[34];
byte tamanhoLinha = 0;
char linhaBluetooth[34];
byte tamanhoLinhaBluetooth = 0;

// Declaração prévia da função de telemetria para uso interno do interpretador
void enviarTelemetria();

void aplicarMotores(bool in1, bool in2, bool in3, bool in4) {
  digitalWrite(IN1, in1);
  digitalWrite(IN2, in2);
  digitalWrite(IN3, in3);
  digitalWrite(IN4, in4);
}

void pararMotores() {
  aplicarMotores(LOW, LOW, LOW, LOW);
  comandoAplicado = CMD_PARAR;
}

void andarParaFrente() {
  aplicarMotores(LOW, HIGH, LOW, HIGH);
  comandoAplicado = CMD_FRENTE;
}

void andarParaTras() {
  aplicarMotores(HIGH, LOW, HIGH, LOW);
  comandoAplicado = CMD_TRAS;
}

void girarDireita() {
  aplicarMotores(LOW, HIGH, LOW, LOW);
  comandoAplicado = CMD_DIREITA;
}

void girarEsquerda() {
  aplicarMotores(LOW, LOW, LOW, HIGH);
  comandoAplicado = CMD_ESQUERDA;
}

void girarNoLugar() {
  aplicarMotores(LOW, HIGH, HIGH, LOW);
  comandoAplicado = CMD_GIRAR;
}

void aplicarComando(ComandoMovimento comando) {
  switch (comando) {
    case CMD_FRENTE: andarParaFrente(); break;
    case CMD_TRAS: andarParaTras(); break;
    case CMD_DIREITA: girarDireita(); break;
    case CMD_ESQUERDA: girarEsquerda(); break;
    case CMD_GIRAR: girarNoLugar(); break;
    default: pararMotores(); break;
  }
}

float medirDistanciaCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(5);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(12);
  digitalWrite(TRIG, LOW);

  const unsigned long duracao = pulseIn(ECHO, HIGH, 30000UL);
  if (duracao == 0) return -1;
  const float distancia = duracao / 58.0;
  if (distancia < 2 || distancia > 400) return -1;
  return distancia;
}

void atualizarSensor(unsigned long agora) {
  if (agora - ultimoSensorEm < INTERVALO_SENSOR_MS) return;
  ultimoSensorEm = agora;
  distanciaAtualCm = medirDistanciaCm();

  if (distanciaAtualCm < 0) {
    if (falhasConsecutivasSensor < 255) falhasConsecutivasSensor++;
    leiturasValidasRecuperacao = 0;
    obstaculosConsecutivos = 0;

    if (falhasConsecutivasSensor >= LIMITE_FALHAS_SENSOR && !sensorBloqueado) {
      sensorBloqueado = true;
      estadoDesvio = DESVIO_INATIVO;
      pararMotores();
      Serial.println(F("ALERTA:SENSOR_BLOQUEADO"));
      bluetooth.println(F("ALERTA:SENSOR_BLOQUEADO"));
    }
    return;
  }

  falhasConsecutivasSensor = 0;
  if (sensorBloqueado) {
    if (leiturasValidasRecuperacao < 255) leiturasValidasRecuperacao++;
    if (leiturasValidasRecuperacao >= LEITURAS_VALIDAS_PARA_RECUPERAR) {
      sensorBloqueado = false;
      leiturasValidasRecuperacao = 0;
      Serial.println(F("EVENTO:SENSOR_RECUPERADO"));
      bluetooth.println(F("EVENTO:SENSOR_RECUPERADO"));
    }
  } else {
    leiturasValidasRecuperacao = 0;
  }

  if (distanciaAtualCm <= DISTANCIA_OBSTACULO_CM) {
    if (obstaculosConsecutivos < 255) obstaculosConsecutivos++;
  } else {
    obstaculosConsecutivos = 0;
  }
}

bool sensorSeguro() {
  return !sensorBloqueado && falhasConsecutivasSensor < LIMITE_FALHAS_SENSOR;
}

bool obstaculoConfirmado() {
  return distanciaAtualCm > 0 && obstaculosConsecutivos >= 2;
}

bool comandoExigeFrenteLivre(ComandoMovimento comando) {
  return comando == CMD_FRENTE
      || comando == CMD_DIREITA
      || comando == CMD_ESQUERDA
      || comando == CMD_GIRAR;
}

bool registrarObstaculo(unsigned long agora) {
  byte validos = 0;
  for (byte i = 0; i < quantidadeObstaculos; i++) {
    if (agora - obstaculosEm[i] <= JANELA_OBSTACULOS_MS) {
      obstaculosEm[validos++] = obstaculosEm[i];
    }
  }
  quantidadeObstaculos = validos;
  if (quantidadeObstaculos < LIMITE_OBSTACULOS) {
    obstaculosEm[quantidadeObstaculos++] = agora;
  }
  return quantidadeObstaculos >= LIMITE_OBSTACULOS;
}

void cancelarDesvio() {
  estadoDesvio = DESVIO_INATIVO;
  pararMotores();
}

void iniciarDesvio(unsigned long agora) {
  pararMotores();
  obstaculosConsecutivos = 0;
  if (registrarObstaculo(agora)) {
    paradaEmergencia = true;
    estadoDesvio = DESVIO_INATIVO;
    Serial.println(F("ALERTA:5_OBSTACULOS"));
    bluetooth.println(F("ALERTA:5_OBSTACULOS"));
    return;
  }
  estadoDesvio = DESVIO_PAUSA_INICIAL;
  estadoDesvioDesde = agora;
  Serial.println(F("EVENTO:DESVIO_INICIADO"));
  bluetooth.println(F("EVENTO:DESVIO_INICIADO"));
}

void atualizarDesvio(unsigned long agora) {
  const unsigned long decorrido = agora - estadoDesvioDesde;
  switch (estadoDesvio) {
    case DESVIO_PAUSA_INICIAL:
      pararMotores();
      if (decorrido >= TEMPO_PAUSA_MS) {
        andarParaTras();
        estadoDesvio = DESVIO_RE;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_RE:
      if (decorrido >= TEMPO_RE_MS) {
        pararMotores();
        estadoDesvio = DESVIO_PAUSA_RE;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_PAUSA_RE:
      if (decorrido >= 150UL) {
        if (obstaculoConfirmado()) {
          andarParaTras();
          estadoDesvio = DESVIO_RE;
        } else {
          if (proximaCurvaDireita) girarDireita(); else girarEsquerda();
          estadoDesvio = DESVIO_CURVA;
        }
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_CURVA:
      if (decorrido >= TEMPO_CURVA_MS) {
        pararMotores();
        proximaCurvaDireita = !proximaCurvaDireita;
        estadoDesvio = DESVIO_PAUSA_CURVA;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_PAUSA_CURVA:
      if (decorrido >= 150UL) {
        andarParaFrente();
        estadoDesvio = DESVIO_SAIDA;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_SAIDA:
      if (decorrido >= TEMPO_SAIDA_MS) {
        estadoDesvio = DESVIO_INATIVO;
      }
      break;
  }
}

// Processa o comando recebido em formato de string (seja por USB ou Bluetooth)
void interpretarComando(char* comandoStr, unsigned long agora) {
  if (strcmp(comandoStr, "HELLO") == 0) {
    Serial.println(F("QT:READY:V3"));
    bluetooth.println(F("QT:READY:V3"));
  }
  else if (strcmp(comandoStr, "ESTOP") == 0) {
    paradaEmergencia = true;
    cancelarDesvio();
    Serial.println(F("OK:ESTOP"));
    bluetooth.println(F("OK:ESTOP"));
  }
  else if (strcmp(comandoStr, "RESET_ESTOP") == 0) {
    paradaEmergencia = false;
    quantidadeObstaculos = 0;
    comandoRecebido = modo == MODO_AUTONOMO ? CMD_FRENTE : CMD_PARAR;
    ultimoComandoEm = agora;
    Serial.println(F("OK:RESET_ESTOP"));
    bluetooth.println(F("OK:RESET_ESTOP"));
  }
  else if (strcmp(comandoStr, "PING") == 0) {
    Serial.println(F("PONG"));
    bluetooth.println(F("PONG"));
  }
  else if (strcmp(comandoStr, "STATUS") == 0) {
    enviarTelemetria();
  }
  else if (strncmp(comandoStr, "MODE:", 5) == 0) {
    int novoModo = atoi(&comandoStr[5]);
    if (novoModo >= 1 && novoModo <= 3) {
      modo = (ModoRobo)novoModo;
      cancelarDesvio();
      comandoRecebido = modo == MODO_AUTONOMO ? CMD_FRENTE : CMD_PARAR;
      ultimoComandoEm = agora;
      Serial.print(F("OK:MODE:"));
      Serial.println(novoModo);
      bluetooth.print(F("OK:MODE:"));
      bluetooth.println(novoModo);
    }
  }
  else if (strncmp(comandoStr, "CMD:", 4) == 0) {
    char* cmd = &comandoStr[4];
    bool comandoValido = true;
    if (strcmp(cmd, "FRENTE") == 0) comandoRecebido = CMD_FRENTE;
    else if (strcmp(cmd, "TRAS") == 0) comandoRecebido = CMD_TRAS;
    else if (strcmp(cmd, "DIREITA") == 0) comandoRecebido = CMD_DIREITA;
    else if (strcmp(cmd, "ESQUERDA") == 0) comandoRecebido = CMD_ESQUERDA;
    else if (strcmp(cmd, "PARAR") == 0) comandoRecebido = CMD_PARAR;
    else if (strcmp(cmd, "GIRAR") == 0) comandoRecebido = CMD_GIRAR;
    else comandoValido = false;

    if (comandoValido) {
      ultimoComandoEm = agora;
      if (comandoRecebido == CMD_PARAR) cancelarDesvio();
      Serial.print(F("OK:CMD:"));
      Serial.println(cmd);
      bluetooth.print(F("OK:CMD:"));
      bluetooth.println(cmd);
    } else {
      Serial.println(F("ERRO:COMANDO_INVALIDO"));
      bluetooth.println(F("ERRO:COMANDO_INVALIDO"));
    }
  }
}

void lerEntrada(Stream& entrada, char* buffer, byte& tamanho, unsigned long agora) {
  while (entrada.available() > 0) {
    char c = entrada.read();
    if (c == '\n' || c == '\r') {
      if (tamanho > 0) {
        buffer[tamanho] = '\0';
        interpretarComando(buffer, agora);
        tamanho = 0;
      }
    } else if (tamanho < sizeof(linhaSerial) - 1) {
      buffer[tamanho++] = c;
    } else {
      tamanho = 0;
      Serial.println(F("ERRO:LINHA_LONGA"));
      bluetooth.println(F("ERRO:LINHA_LONGA"));
    }
  }
}

void checarEntradasSeriais(unsigned long agora) {
  lerEntrada(Serial, linhaSerial, tamanhoLinha, agora);
  lerEntrada(bluetooth, linhaBluetooth, tamanhoLinhaBluetooth, agora);
}

const __FlashStringHelper* nomeComando(ComandoMovimento comando) {
  switch (comando) {
    case CMD_FRENTE: return F("FRENTE");
    case CMD_TRAS: return F("TRAS");
    case CMD_DIREITA: return F("DIREITA");
    case CMD_ESQUERDA: return F("ESQUERDA");
    case CMD_GIRAR: return F("GIRAR");
    default: return F("PARAR");
  }
}

void escreverTelemetria(Stream& destino) {
  destino.print(F("QT|MODE:"));
  destino.print((byte)modo);
  destino.print(F("|DIST:"));
  if (distanciaAtualCm < 0) destino.print(F("ERR"));
  else destino.print(distanciaAtualCm, 1);
  destino.print(F("|CMD:"));
  destino.print(nomeComando(comandoAplicado));
  destino.print(F("|STATE:"));
  if (paradaEmergencia) destino.print(F("ESTOP"));
  else if (!sensorSeguro()) destino.print(F("SENSOR_FAIL"));
  else if (estadoDesvio != DESVIO_INATIVO) destino.print(F("DESVIANDO"));
  else if (modo == MODO_AUTONOMO) destino.print(F("AUTONOMO"));
  else if (modo == MODO_SEGUIR) destino.print(F("SEGUIR"));
  else destino.print(F("GESTOS"));
  destino.println();
}

void enviarTelemetria() {
  escreverTelemetria(Serial);
  escreverTelemetria(bluetooth);
}
void setup() {
Serial.begin(9600);
delay(500);
Serial.println(F("QT:READY:V3"));
Serial.flush();
bluetooth.begin(9600); // Velocidade padrão do módulo HC-08
pinMode(IN1, OUTPUT);
pinMode(IN2, OUTPUT);
pinMode(IN3, OUTPUT);
pinMode(IN4, OUTPUT);
pararMotores();
pinMode(TRIG, OUTPUT);
pinMode(ECHO, INPUT);
digitalWrite(TRIG, LOW);
// Toda inicializacao comeca em autonomia, sem depender do modo anterior.
modo = MODO_AUTONOMO;
comandoRecebido = CMD_FRENTE;
estadoDesvio = DESVIO_INATIVO;
paradaEmergencia = false;
ultimoComandoEm = millis();
Serial.println(F("QT:READY:V3"));
bluetooth.println(F("QT:READY:V3"));
Serial.println(F("OK:MODE:1"));
bluetooth.println(F("OK:MODE:1"));
}
void loop() {
unsigned long agora = millis();
atualizarSensor(agora);
checarEntradasSeriais(agora);
if (agora - ultimaTelemetriaEm >= INTERVALO_TELEMETRIA_MS) {
ultimaTelemetriaEm = agora;
enviarTelemetria();
}
if (paradaEmergencia || !sensorSeguro()) {
pararMotores();
return;
}
if (modo == MODO_AUTONOMO) {
if (agora < JANELA_COMANDO_INICIAL_MS) {
pararMotores();
return;
}
if (estadoDesvio != DESVIO_INATIVO) {
atualizarDesvio(agora);
} else {
if (sensorSeguro() && obstaculoConfirmado()) {
iniciarDesvio(agora);
} else {
andarParaFrente();
}
}
}
else { // MODOS 2 (SEGUIR) ou 3 (GESTOS)
cancelarDesvio();
// Timeout de segurança: para motores se sumir o sinal por 1.5 segundos
if (agora - ultimoComandoEm > TIMEOUT_COMANDO_MS) {
comandoRecebido = CMD_PARAR;
}
// Validação de obstáculos com o sensor soberano
if (comandoExigeFrenteLivre(comandoRecebido) && sensorSeguro() && obstaculoConfirmado()) {
pararMotores();
} else {
aplicarComando(comandoRecebido);
}
}
}

    
