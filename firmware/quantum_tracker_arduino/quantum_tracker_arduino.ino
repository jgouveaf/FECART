/*
  Quantum Tracker - controle integrado
  Arduino UNO + L298N + HC-SR04 + USB Serial

  MODOS:
  1 - AUTONOMO: anda sempre e desvia com o HC-SR04.
  2 - SEGUIR: recebe direcao da camera; sensor continua soberano.
  3 - GESTOS: recebe os gestos; sensor continua soberano.

  PROTOCOLO SERIAL (9600 baud, uma linha por comando):
  MODE:1 | MODE:2 | MODE:3
  CMD:FRENTE | CMD:TRAS | CMD:DIREITA | CMD:ESQUERDA | CMD:PARAR | CMD:GIRAR
  HELLO | ESTOP | RESET_ESTOP | PING | STATUS

  Seguranca:
  - nenhum motor e liberado antes da primeira leitura valida do HC-SR04;
  - PARAR e ESTOP interrompem imediatamente;
  - modos 2 e 3 param se nenhum novo CMD:* chegar por 1,5 s;
  - PING testa o enlace, mas nao renova um comando de movimento antigo;
  - cinco falhas consecutivas travam o sensor; tres leituras validas o recuperam;
  - obstaculo frontal inicia um desvio completo; a leitura e ignorada somente
    enquanto o chassi esta girando, pois nesse momento o sensor ainda aponta
    por alguns instantes para o obstaculo que originou a manobra;
  - apos a curva, duas leituras livres confirmam a nova direcao antes de avancar;
  - mensagens seriais longas sao descartadas integralmente ate a proxima linha;
  - cinco obstaculos em 15 s ativam parada de seguranca.
*/

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
const byte LEITURAS_CAMINHO_LIVRE = 2;
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
ComandoMovimento comandoRecebido = CMD_PARAR;
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
byte leiturasLivresAposCurva = 0;
byte obstaculosConsecutivos = 0;
byte quantidadeObstaculos = 0;
bool proximaCurvaDireita = true;
bool paradaEmergencia = false;
bool sensorBloqueado = false;
bool sensorInicializado = false;
bool descartandoLinhaSerial = false;

char linhaSerial[34];
byte tamanhoLinha = 0;

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
    leiturasLivresAposCurva = 0;
    obstaculosConsecutivos = 0;

    if (falhasConsecutivasSensor >= LIMITE_FALHAS_SENSOR && !sensorBloqueado) {
      sensorBloqueado = true;
      estadoDesvio = DESVIO_INATIVO;
      pararMotores();
      Serial.println(F("ALERTA:SENSOR_BLOQUEADO"));
    }
    return;
  }

  sensorInicializado = true;
  falhasConsecutivasSensor = 0;
  if (sensorBloqueado) {
    if (leiturasValidasRecuperacao < 255) leiturasValidasRecuperacao++;
    if (leiturasValidasRecuperacao >= LEITURAS_VALIDAS_PARA_RECUPERAR) {
      sensorBloqueado = false;
      leiturasValidasRecuperacao = 0;
      Serial.println(F("EVENTO:SENSOR_RECUPERADO"));
    }
  } else {
    leiturasValidasRecuperacao = 0;
  }

  // Durante a curva o HC-SR04 ainda pode enxergar o obstaculo antigo. Contar
  // essas leituras reiniciaria o desvio antes de o robo conseguir mudar de
  // direcao. Assim que a curva termina, a confirmacao por duas leituras volta
  // a funcionar normalmente antes da saida para frente.
  if (estadoDesvio == DESVIO_CURVA) {
    obstaculosConsecutivos = 0;
    leiturasLivresAposCurva = 0;
  } else if (distanciaAtualCm <= DISTANCIA_OBSTACULO_CM) {
    leiturasLivresAposCurva = 0;
    if (obstaculosConsecutivos < 255) obstaculosConsecutivos++;
  } else {
    obstaculosConsecutivos = 0;
    if (estadoDesvio == DESVIO_PAUSA_CURVA) {
      if (leiturasLivresAposCurva < 255) leiturasLivresAposCurva++;
    } else {
      leiturasLivresAposCurva = 0;
    }
  }
}

bool sensorSeguro() {
  return sensorInicializado
      && !sensorBloqueado
      && falhasConsecutivasSensor < LIMITE_FALHAS_SENSOR;
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
  leiturasLivresAposCurva = 0;
  pararMotores();
}

void iniciarDesvio(unsigned long agora) {
  pararMotores();
  obstaculosConsecutivos = 0;
  leiturasLivresAposCurva = 0;
  if (registrarObstaculo(agora)) {
    paradaEmergencia = true;
    estadoDesvio = DESVIO_INATIVO;
    Serial.println(F("ALERTA:5_OBSTACULOS"));
    return;
  }
  estadoDesvio = DESVIO_PAUSA_INICIAL;
  estadoDesvioDesde = agora;
  Serial.println(F("EVENTO:DESVIO_INICIADO"));
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
        // O robo possui sensor apenas na frente. Recuar repetidamente sem um
        // sensor traseiro seria inseguro; depois de uma unica re, ele executa
        // a curva completa e volta a avaliar a nova direcao.
        obstaculosConsecutivos = 0;
        if (proximaCurvaDireita) girarDireita(); else girarEsquerda();
        estadoDesvio = DESVIO_CURVA;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_CURVA:
      if (decorrido >= TEMPO_CURVA_MS) {
        pararMotores();
        proximaCurvaDireita = !proximaCurvaDireita;
        estadoDesvio = DESVIO_PAUSA_CURVA;
        leiturasLivresAposCurva = 0;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_PAUSA_CURVA:
      if (decorrido >= 150UL && leiturasLivresAposCurva >= LEITURAS_CAMINHO_LIVRE) {
        andarParaFrente();
        estadoDesvio = DESVIO_SAIDA;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_SAIDA:
      if (decorrido >= TEMPO_SAIDA_MS) {
        estadoDesvio = DESVIO_INATIVO;
        obstaculosConsecutivos = 0;
      }
      break;
    default: break;
  }
}

const __FlashStringHelper* nomeModo() {
  if (modo == MODO_AUTONOMO) return F("AUTONOMO");
  if (modo == MODO_SEGUIR) return F("SEGUIR");
  return F("GESTOS");
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

void enviarStatus(unsigned long agora, bool forcar = false) {
  if (!forcar && agora - ultimaTelemetriaEm < INTERVALO_TELEMETRIA_MS) return;
  ultimaTelemetriaEm = agora;
  Serial.print(F("QT|MODE:"));
  Serial.print((byte)modo);
  Serial.print(F("|DIST:"));
  if (distanciaAtualCm < 0) Serial.print(F("ERR")); else Serial.print(distanciaAtualCm, 1);
  Serial.print(F("|CMD:"));
  Serial.print(nomeComando(comandoAplicado));
  Serial.print(F("|STATE:"));
  if (paradaEmergencia) Serial.print(F("ESTOP"));
  else if (sensorBloqueado || falhasConsecutivasSensor >= LIMITE_FALHAS_SENSOR) {
    Serial.print(F("SENSOR_FAIL"));
  }
  else if (!sensorInicializado) Serial.print(F("SENSOR_INIT"));
  else if (!sensorSeguro()) Serial.print(F("SENSOR_FAIL"));
  else if (estadoDesvio != DESVIO_INATIVO) Serial.print(F("DESVIANDO"));
  else Serial.print(nomeModo());
  Serial.println();
}

void selecionarModo(byte numero, unsigned long agora) {
  if (numero < 1 || numero > 3) return;
  modo = (ModoRobo)numero;
  comandoRecebido = modo == MODO_AUTONOMO ? CMD_FRENTE : CMD_PARAR;
  ultimoComandoEm = agora;
  cancelarDesvio();
  Serial.print(F("OK:MODE:"));
  Serial.println(numero);
}

ComandoMovimento comandoDesejadoPeloModo() {
  // Um unico sketch executa os tres modos. O Arduino sempre resolve o modo
  // localmente; o site apenas seleciona o estado e renova os comandos dos
  // modos 2 e 3 pela porta USB.
  switch (modo) {
    case MODO_AUTONOMO:
      return CMD_FRENTE;
    case MODO_SEGUIR:
    case MODO_GESTOS:
    default:
      return comandoRecebido;
  }
}

void receberComando(ComandoMovimento comando, unsigned long agora) {
  comandoRecebido = comando;
  ultimoComandoEm = agora;
  if (comando == CMD_PARAR || (modo != MODO_AUTONOMO && comando == CMD_TRAS)) {
    cancelarDesvio();
  }
  Serial.print(F("OK:CMD:"));
  Serial.println(nomeComando(comando));
}

void processarLinha(char* linha, unsigned long agora) {
  if (strcmp(linha, "MODE:1") == 0) selecionarModo(1, agora);
  else if (strcmp(linha, "MODE:2") == 0) selecionarModo(2, agora);
  else if (strcmp(linha, "MODE:3") == 0) selecionarModo(3, agora);
  else if (strcmp(linha, "CMD:FRENTE") == 0) receberComando(CMD_FRENTE, agora);
  else if (strcmp(linha, "CMD:TRAS") == 0) receberComando(CMD_TRAS, agora);
  else if (strcmp(linha, "CMD:DIREITA") == 0) receberComando(CMD_DIREITA, agora);
  else if (strcmp(linha, "CMD:ESQUERDA") == 0) receberComando(CMD_ESQUERDA, agora);
  else if (strcmp(linha, "CMD:PARAR") == 0) receberComando(CMD_PARAR, agora);
  else if (strcmp(linha, "CMD:GIRAR") == 0) receberComando(CMD_GIRAR, agora);
  else if (strcmp(linha, "ESTOP") == 0) {
    paradaEmergencia = true;
    cancelarDesvio();
    Serial.println(F("OK:ESTOP"));
  } else if (strcmp(linha, "RESET_ESTOP") == 0) {
    paradaEmergencia = false;
    quantidadeObstaculos = 0;
    comandoRecebido = modo == MODO_AUTONOMO ? CMD_FRENTE : CMD_PARAR;
    ultimoComandoEm = agora;
    cancelarDesvio();
    Serial.println(F("OK:RESET_ESTOP"));
  } else if (strcmp(linha, "HELLO") == 0) {
    // Permite identificar o firmware mesmo quando abrir a porta nao reinicia o UNO.
    Serial.println(F("QT:READY:V5"));
  } else if (strcmp(linha, "PING") == 0) {
    // PING confirma apenas o enlace. So CMD:* renova a validade do movimento.
    Serial.println(F("PONG"));
  } else if (strcmp(linha, "STATUS") == 0) enviarStatus(agora, true);
  else Serial.println(F("ERRO:COMANDO_INVALIDO"));
}

void lerSerial(unsigned long agora) {
  while (Serial.available() > 0) {
    const char recebido = (char)Serial.read();
    if (recebido == '\n' || recebido == '\r') {
      if (descartandoLinhaSerial) {
        descartandoLinhaSerial = false;
        tamanhoLinha = 0;
      } else if (tamanhoLinha > 0) {
        linhaSerial[tamanhoLinha] = '\0';
        processarLinha(linhaSerial, agora);
        tamanhoLinha = 0;
      }
    } else if (descartandoLinhaSerial) {
      // Um sufixo valido de uma linha corrompida nunca pode virar comando.
      continue;
    } else if (tamanhoLinha < sizeof(linhaSerial) - 1) {
      linhaSerial[tamanhoLinha++] = recebido;
    } else {
      tamanhoLinha = 0;
      descartandoLinhaSerial = true;
      Serial.println(F("ERRO:LINHA_LONGA"));
    }
  }
}

void aguardarComandoInicial() {
  const unsigned long inicio = millis();
  while (millis() - inicio < JANELA_COMANDO_INICIAL_MS) {
    pararMotores();
    lerSerial(millis());
    delay(1);
  }
}

void setup() {
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  digitalWrite(TRIG, LOW);
  pararMotores();

  Serial.begin(9600);
  delay(2000);
  ultimoComandoEm = millis();
  Serial.println(F("QT:READY:V5"));
  Serial.println(F("OK:MODE:1"));
  aguardarComandoInicial();
}

void loop() {
  const unsigned long agora = millis();
  lerSerial(agora);
  atualizarSensor(agora);

  if (paradaEmergencia || !sensorSeguro()) {
    pararMotores();
    enviarStatus(agora);
    return;
  }

  if (modo != MODO_AUTONOMO && agora - ultimoComandoEm > TIMEOUT_COMANDO_MS) {
    comandoRecebido = CMD_PARAR;
    cancelarDesvio();
  }

  if (estadoDesvio != DESVIO_INATIVO) {
    if (obstaculoConfirmado()
        && (estadoDesvio == DESVIO_PAUSA_CURVA || estadoDesvio == DESVIO_SAIDA)) {
      // A curva terminou e a nova frente continua bloqueada: inicia outra
      // tentativa antes de manter o avanco.
      iniciarDesvio(agora);
    }
    atualizarDesvio(agora);
    enviarStatus(agora);
    return;
  }

  const ComandoMovimento desejado = comandoDesejadoPeloModo();
  if (comandoExigeFrenteLivre(desejado) && obstaculoConfirmado()) {
    iniciarDesvio(agora);
  } else {
    aplicarComando(desejado);
  }

  enviarStatus(agora);
}
