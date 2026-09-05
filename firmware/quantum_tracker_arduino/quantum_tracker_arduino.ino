/*
  Quantum Tracker - controle integrado
  Arduino UNO + L298N + HC-SR04 + USB Serial

  MODOS:
  1 - AUTONOMO: anda sempre e desvia com o HC-SR04.
  2 - SEGUIR: recebe direcao da camera e desvia quando houver leitura valida.
  3 - GESTOS: recebe os gestos e desvia quando houver leitura valida.

  PROTOCOLO SERIAL (9600 baud, uma linha por comando):
  MODE:1 | MODE:2 | MODE:3
  CMD:FRENTE | CMD:TRAS | CMD:DIREITA | CMD:ESQUERDA | CMD:PARAR | CMD:GIRAR
  HELLO | ESTOP | RESET_ESTOP | PING | STATUS

  Comportamento:
  - PARAR e ESTOP continuam disponiveis para o operador;
  - AUTONOMO funciona localmente, mesmo sem site ou cabo USB;
  - SEGUIR e GESTOS param se nenhum novo CMD:* chegar por 1,5 s;
  - PING testa o enlace, mas nao renova um comando de movimento antigo;
  - Modo 1 usa a sequencia aprovada em bancada: parar, re e curva suave;
  - curvas de desvio mantem uma roda para frente e a outra parada;
  - falha do sensor para o movimento que exige caminho frontal e aguarda duas
    leituras validas; ausencia de eco nunca e tratada como caminho livre;
  - a primeira leitura proxima para; duas novas leituras confirmam o desvio;
  - apos a curva, duas leituras livres confirmam a nova direcao antes de avancar;
  - mensagens seriais longas sao descartadas integralmente ate a proxima linha;
  - um obstaculo inicia uma unica re e curvas adicionais ate liberar o caminho.
*/

// L298N: mantenha os jumpers ENA e ENB instalados.
const byte IN1 = 7;
const byte IN2 = 6;
const byte IN3 = 5;
const byte IN4 = 4;

// HC-SR04: VCC -> 5V, TRIG -> D3, ECHO -> D2, GND -> GND.
const byte TRIG = 3;
const byte ECHO = 2;

// Limite aprovado no ensaio de bancada. Nao e distancia final de uso no chao.
const float DISTANCIA_OBSTACULO_CM = 5.0;
const unsigned long INTERVALO_SENSOR_MS = 80UL;
const unsigned long INTERVALO_TELEMETRIA_MS = 250UL;
const unsigned long TIMEOUT_COMANDO_MS = 1500UL;
// Mantém as rodas paradas logo após o boot para estabilizar a alimentação e
// permitir que um site já aberto faça o handshake. Depois, o AUTONOMO é local.
const unsigned long JANELA_COMANDO_INICIAL_MS = 750UL;

const unsigned int TEMPO_PAUSA_MS = 150;
const unsigned int TEMPO_RE_MS = 400;
const unsigned int TEMPO_CURVA_MS = 650;
const byte LEITURAS_CONFIRMACAO = 2;

enum ModoRobo { MODO_AUTONOMO = 1, MODO_SEGUIR = 2, MODO_GESTOS = 3 };
enum ComandoMovimento { CMD_PARAR, CMD_FRENTE, CMD_TRAS, CMD_DIREITA, CMD_ESQUERDA, CMD_GIRAR };
enum EstadoDesvio {
  DESVIO_INATIVO,
  DESVIO_PAUSA_INICIAL,
  DESVIO_RE,
  DESVIO_PAUSA_RE,
  DESVIO_CURVA,
  DESVIO_PAUSA_CURVA
};

ModoRobo modo = MODO_AUTONOMO;
ComandoMovimento comandoRecebido = CMD_PARAR;
ComandoMovimento comandoAplicado = CMD_PARAR;
EstadoDesvio estadoDesvio = DESVIO_INATIVO;

unsigned long ultimoSensorEm = 0;
unsigned long ultimaTelemetriaEm = 0;
unsigned long ultimoComandoEm = 0;
unsigned long estadoDesvioDesde = 0;

float distanciaAtualCm = -1;
byte falhasConsecutivasSensor = 0;
byte leiturasValidasSensor = 0;
byte leiturasLivresConsecutivas = 0;
byte obstaculosConsecutivos = 0;
bool proximaCurvaDireita = true;
bool curvaAtualDireita = true;
bool confirmandoObstaculo = false;
bool paradaEmergencia = false;
bool sensorInicializado = false;
bool descartandoLinhaSerial = false;
bool controleUsbAtivo = false;

char linhaSerial[34];
byte tamanhoLinha = 0;

void aplicarMotores(bool in1, bool in2, bool in3, bool in4) {
  // Evita inverter a ponte H diretamente entre duas escritas.
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
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
  // Curva aprovada: roda esquerda para frente, roda direita parada.
  aplicarMotores(LOW, HIGH, LOW, LOW);
  comandoAplicado = CMD_DIREITA;
}

void girarEsquerda() {
  // Curva aprovada: roda esquerda parada, roda direita para frente.
  aplicarMotores(LOW, LOW, LOW, HIGH);
  comandoAplicado = CMD_ESQUERDA;
}

void girarNoLugar() {
  // Comando remoto separado da curva suave usada no desvio autonomo.
  aplicarMotores(LOW, HIGH, HIGH, LOW);
  comandoAplicado = CMD_GIRAR;
}

void aplicarComando(ComandoMovimento comando) {
  // Nao chaveia a ponte H novamente quando a ordem nao mudou. Isso evita
  // micropausas e ruido eletrico causados por desligar/ligar a cada loop.
  if (comando == comandoAplicado) return;
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

  // Sem eco nao significa caminho livre. Zera todas as confirmacoes para que
  // o movimento frontal so volte depois de duas leituras validas novas.
  if (distanciaAtualCm < 0) {
    if (falhasConsecutivasSensor < 255) falhasConsecutivasSensor++;
    leiturasValidasSensor = 0;
    leiturasLivresConsecutivas = 0;
    obstaculosConsecutivos = 0;
    return;
  }

  sensorInicializado = true;
  falhasConsecutivasSensor = 0;
  if (leiturasValidasSensor < LEITURAS_CONFIRMACAO) leiturasValidasSensor++;

  // Durante a curva o HC-SR04 ainda pode enxergar o obstaculo antigo.
  if (estadoDesvio == DESVIO_CURVA) {
    obstaculosConsecutivos = 0;
    leiturasLivresConsecutivas = 0;
  } else if (distanciaAtualCm <= DISTANCIA_OBSTACULO_CM) {
    leiturasLivresConsecutivas = 0;
    if (obstaculosConsecutivos < 255) obstaculosConsecutivos++;
  } else {
    obstaculosConsecutivos = 0;
    if (leiturasLivresConsecutivas < LEITURAS_CONFIRMACAO) {
      leiturasLivresConsecutivas++;
    }
  }
}

bool obstaculoConfirmado() {
  return distanciaAtualCm > 0
      && obstaculosConsecutivos >= LEITURAS_CONFIRMACAO;
}

bool caminhoLivreConfirmado() {
  return distanciaAtualCm > DISTANCIA_OBSTACULO_CM
      && leiturasLivresConsecutivas >= LEITURAS_CONFIRMACAO;
}

bool sensorPronto() {
  return sensorInicializado
      && distanciaAtualCm > 0
      && leiturasValidasSensor >= LEITURAS_CONFIRMACAO;
}

bool comandoExigeFrenteLivre(ComandoMovimento comando) {
  return comando == CMD_FRENTE
      || comando == CMD_DIREITA
      || comando == CMD_ESQUERDA
      || comando == CMD_GIRAR;
}

void cancelarDesvio() {
  estadoDesvio = DESVIO_INATIVO;
  obstaculosConsecutivos = 0;
  leiturasLivresConsecutivas = 0;
  confirmandoObstaculo = false;
  pararMotores();
}

void iniciarDesvio(unsigned long agora) {
  pararMotores();
  obstaculosConsecutivos = 0;
  leiturasLivresConsecutivas = 0;
  confirmandoObstaculo = false;
  curvaAtualDireita = proximaCurvaDireita;
  proximaCurvaDireita = !proximaCurvaDireita;
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
      if (decorrido >= TEMPO_PAUSA_MS) {
        // O robo possui sensor apenas na frente. Recuar repetidamente sem um
        // sensor traseiro seria inseguro; depois de uma unica re, ele executa
        // a curva completa e volta a avaliar a nova direcao.
        obstaculosConsecutivos = 0;
        if (curvaAtualDireita) girarDireita(); else girarEsquerda();
        estadoDesvio = DESVIO_CURVA;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_CURVA:
      if (decorrido >= TEMPO_CURVA_MS) {
        pararMotores();
        estadoDesvio = DESVIO_PAUSA_CURVA;
        obstaculosConsecutivos = 0;
        leiturasLivresConsecutivas = 0;
        estadoDesvioDesde = agora;
      }
      break;
    case DESVIO_PAUSA_CURVA:
      // Aguarda duas leituras da nova direcao. Caminho livre encerra a
      // manobra; se continuar bloqueado, prolonga somente a curva.
      pararMotores();
      if (caminhoLivreConfirmado()) {
        estadoDesvio = DESVIO_INATIVO;
        obstaculosConsecutivos = 0;
        leiturasLivresConsecutivas = 0;
      } else if (obstaculoConfirmado()) {
        obstaculosConsecutivos = 0;
        leiturasLivresConsecutivas = 0;
        if (curvaAtualDireita) girarDireita(); else girarEsquerda();
        estadoDesvio = DESVIO_CURVA;
        estadoDesvioDesde = agora;
        Serial.println(F("EVENTO:CURVA_CONTINUA"));
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
  else if (!sensorPronto()) Serial.print(F("SENSOR_FAIL"));
  else if (modo != MODO_AUTONOMO && !controleUsbAtivo) Serial.print(F("LINK_WAIT"));
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
  // localmente. Apenas SEGUIR e GESTOS exigem concessão viva pela porta USB.
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
  controleUsbAtivo = true;
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
    comandoRecebido = modo == MODO_AUTONOMO ? CMD_FRENTE : CMD_PARAR;
    ultimoComandoEm = agora;
    controleUsbAtivo = false;
    cancelarDesvio();
    Serial.println(F("OK:RESET_ESTOP"));
  } else if (strcmp(linha, "HELLO") == 0) {
    // Permite identificar o firmware mesmo quando abrir a porta nao reinicia o UNO.
    Serial.println(F("QT:READY:V6"));
  } else if (strcmp(linha, "PING") == 0) {
    // PING confirma apenas o enlace. So CMD:* renova a validade do movimento.
    Serial.println(F("PONG"));
  } else if (strcmp(linha, "STATUS") == 0) enviarStatus(agora, true);
  else Serial.println(F("ERRO:COMANDO_INVALIDO"));
}

void lerSerial(unsigned long agora) {
  // Limita o trabalho por ciclo para telemetria/sensor nunca ficarem famintos
  // se o navegador ou um cabo defeituoso inundar a UART.
  byte bytesProcessados = 0;
  while (Serial.available() > 0 && bytesProcessados < 48) {
    bytesProcessados++;
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
  Serial.println(F("QT:READY:V6"));
  Serial.println(F("OK:MODE:1"));
  aguardarComandoInicial();
}

void loop() {
  const unsigned long agora = millis();
  lerSerial(agora);
  atualizarSensor(agora);

  if (paradaEmergencia) {
    pararMotores();
    enviarStatus(agora);
    return;
  }

  const bool modoRemoto = modo == MODO_SEGUIR || modo == MODO_GESTOS;
  if (modoRemoto && (!controleUsbAtivo || agora - ultimoComandoEm > TIMEOUT_COMANDO_MS)) {
    controleUsbAtivo = false;
    comandoRecebido = CMD_PARAR;
    cancelarDesvio();
    enviarStatus(agora);
    return;
  }

  const ComandoMovimento desejado = comandoDesejadoPeloModo();

  // Qualquer perda de eco durante uma manobra interrompe os motores. A
  // sequencia so podera recomecar depois que o sensor recuperar duas leituras.
  if (estadoDesvio != DESVIO_INATIVO && !sensorPronto()) {
    cancelarDesvio();
    enviarStatus(agora);
    return;
  }

  if (comandoExigeFrenteLivre(desejado) && !sensorPronto()) {
    pararMotores();
    enviarStatus(agora);
    return;
  }

  if (estadoDesvio != DESVIO_INATIVO) {
    atualizarDesvio(agora);
    enviarStatus(agora);
    return;
  }

  if (comandoExigeFrenteLivre(desejado)) {
    if (confirmandoObstaculo) {
      pararMotores();
      if (obstaculoConfirmado()) {
        iniciarDesvio(agora);
      } else if (caminhoLivreConfirmado()) {
        confirmandoObstaculo = false;
        aplicarComando(desejado);
      }
    } else if (distanciaAtualCm <= DISTANCIA_OBSTACULO_CM) {
      // A primeira leitura ja para. As proximas duas decidem se era ruido ou
      // um obstaculo real, evitando tanto colisao quanto falso desvio.
      confirmandoObstaculo = true;
      obstaculosConsecutivos = 0;
      leiturasLivresConsecutivas = 0;
      pararMotores();
    } else {
      aplicarComando(desejado);
    }
  } else {
    confirmandoObstaculo = false;
    aplicarComando(desejado);
  }

  enviarStatus(agora);
}
