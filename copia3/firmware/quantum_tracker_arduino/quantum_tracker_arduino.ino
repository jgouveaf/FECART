/*
  Quantum Tracker - controle integrado
  Arduino UNO + L298N + HC-SR04 + USB Serial
  TESTE TEMPORARIO: PWM por Timer1 nos pinos existentes, sem mudar a ligacao.
  Potencia base 200/200 nos quatro modos.
  ENA/ENB continuam com jumpers.

  MODOS:
  1 - AUTONOMO: anda sempre e desvia com o HC-SR04.
  2 - SEGUIR: recebe direcao da camera; nesta revisão de teste não usa HC-SR04.
  3 - GESTOS: recebe os gestos; nesta revisão de teste não usa HC-SR04.
  4 - VOZ: recebe comandos curtos de fala pelo site; não usa HC-SR04.

  PROTOCOLO SERIAL (9600 baud, uma linha por comando):
  MODE:1 | MODE:2 | MODE:3 | MODE:4
  CMD:FRENTE | CMD:TRAS | CMD:DIREITA | CMD:ESQUERDA | CMD:PARAR | CMD:GIRAR
  HELLO | ESTOP | RESET_ESTOP | PING | STATUS

  Comportamento:
  - boot/reset fica em ESTOP ate RESET_ESTOP explicito;
  - PARAR no AUTONOMO permanece parado ate RESET_ESTOP;
  - depois de liberado, AUTONOMO funciona localmente, mesmo sem site ou cabo USB;
  - SEGUIR, GESTOS e VOZ param se nenhum novo CMD:* chegar por 1,5 s;
  - PING testa o enlace, mas nao renova um comando de movimento antigo;
  - Modo 1 usa a sequencia aprovada em bancada: parar, re e curva suave;
  - curvas de desvio mantem uma roda para frente e a outra parada;
  - no Modo 1, falha do sensor para o movimento que exige caminho frontal e aguarda duas
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

// Somente Arduino UNO/ATmega328P: D4..D7 pertencem ao PORTD.
// Timer1 gera PWM nesses pinos por interrupcoes; nao usa D9/D10 nem altera ENA/ENB.
// Nao combinar este teste com Servo ou outra biblioteca que use o Timer1.
#if !defined(__AVR_ATmega328P__)
#error "Este teste PWM requer Arduino UNO com ATmega328P."
#endif
const byte POTENCIA_MOTOR_ESQUERDO = 200;
const byte POTENCIA_MOTOR_DIREITO = 200;
const byte MASCARA_ESQUERDA = _BV(IN1) | _BV(IN2);
const byte MASCARA_DIREITA = _BV(IN3) | _BV(IN4);
volatile byte direcaoPwmEsquerda = 0;
volatile byte direcaoPwmDireita = 0;

// HC-SR04: VCC -> 5V, TRIG -> D3, ECHO -> D2, GND -> GND.
const byte TRIG = 3;
const byte ECHO = 2;

// Inicia o desvio antes de o chassi alcancar o obstaculo.
const float DISTANCIA_OBSTACULO_CM = 20.0;
const unsigned long INTERVALO_SENSOR_MS = 80UL;
const unsigned long INTERVALO_TELEMETRIA_MS = 250UL;
const unsigned long TIMEOUT_COMANDO_MS = 1500UL;
// Mantém as rodas paradas logo após o boot para estabilizar a alimentação e
// permitir que um site ja aberto faca o handshake. Isso nao libera o ESTOP.
const unsigned long JANELA_COMANDO_INICIAL_MS = 750UL;

const unsigned int TEMPO_PAUSA_MS = 150;
const unsigned int TEMPO_RE_MS = 400;
const unsigned int TEMPO_CURVA_MS = 650;
const byte LEITURAS_CONFIRMACAO = 2;

enum ModoRobo { MODO_AUTONOMO = 1, MODO_SEGUIR = 2, MODO_GESTOS = 3, MODO_VOZ = 4 };
enum ComandoMovimento { CMD_PARAR, CMD_FRENTE, CMD_TRAS, CMD_DIREITA, CMD_ESQUERDA, CMD_GIRAR,
  CMD_FRENTE_DIREITA, CMD_FRENTE_ESQUERDA };
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
bool paradaEmergencia = true;
// Preserva uma unica re por encontro, inclusive se o sensor falhar na curva.
bool permitirRe = true;
bool sensorInicializado = false;
bool descartandoLinhaSerial = false;
bool controleUsbAtivo = false;

char linhaSerial[34];
byte tamanhoLinha = 0;

// Valor inicial desconhecido obriga setup() a escrever LOW nos quatro pinos.
byte saidaIn1 = 255, saidaIn2 = 255, saidaIn3 = 255, saidaIn4 = 255;

// Fast PWM de 8 bits: 16 MHz / 64 / 256 = aproximadamente 977 Hz.
// Somente os quatro bits dos motores sao escritos. Sensor e Serial preservados.
ISR(TIMER1_OVF_vect) {
  PORTD = (PORTD & ~(MASCARA_ESQUERDA | MASCARA_DIREITA))
      | (OCR1A ? direcaoPwmEsquerda : 0)
      | (OCR1B ? direcaoPwmDireita : 0);
}

ISR(TIMER1_COMPA_vect) {
  if (OCR1A < 255) PORTD &= ~MASCARA_ESQUERDA;
}

ISR(TIMER1_COMPB_vect) {
  if (OCR1B < 255) PORTD &= ~MASCARA_DIREITA;
}

void iniciarControlePotencia() {
  const byte interrupcoes = SREG;
  cli();
  TCCR1A = 0;
  TCCR1B = 0;
  TIMSK1 = 0;
  TCNT1 = 0;
  OCR1A = POTENCIA_MOTOR_ESQUERDO;
  OCR1B = POTENCIA_MOTOR_DIREITO;
  TIFR1 = _BV(TOV1) | _BV(OCF1A) | _BV(OCF1B);
  TCCR1A = _BV(WGM10);
  TCCR1B = _BV(WGM12) | _BV(CS11) | _BV(CS10);
  TIMSK1 = _BV(TOIE1) | _BV(OCIE1A) | _BV(OCIE1B);
  SREG = interrupcoes;
}

void atualizarPotenciasMotores() {
  // Chamada com interrupcoes suspensas ao mudar a direcao: inicia na fase
  // corrente sem reiniciar o PWM da roda que ja estava andando.
  const byte fase = TCNT1;
  byte ativos = 0;
  if (fase < OCR1A) ativos |= direcaoPwmEsquerda;
  if (fase < OCR1B) ativos |= direcaoPwmDireita;
  PORTD = (PORTD & ~(MASCARA_ESQUERDA | MASCARA_DIREITA)) | ativos;
}

void aplicarMotoresComPotencia(bool in1, bool in2, bool in3, bool in4,
    byte potenciaEsquerda, byte potenciaDireita) {
  if (modo == MODO_SEGUIR) {
    // Apenas no Modo 2: virar sem avancar quando o alvo sai do centro.
    // As rodas giram em sentidos opostos; Modos 1 e 3 preservam a curva
    // original com uma roda parada.
    if (!in1 && in2 && !in3 && !in4) in3 = HIGH;       // direita
    else if (!in1 && !in2 && !in3 && in4) in1 = HIGH;  // esquerda
  }
  if (saidaIn1 == in1 && saidaIn2 == in2 && saidaIn3 == in3 && saidaIn4 == in4
      && OCR1A == potenciaEsquerda && OCR1B == potenciaDireita) return;
  const byte interrupcoes = SREG;
  cli();
  // Desliga primeiro somente as saidas que mudaram. Ao passar de uma curva
  // para FRENTE, a roda que ja avanca nao recebe um pulso de desligamento.
  // Na inversao, LOW acontece antes de HIGH; PARAR continua desligando ambas.
  if (!in1 && saidaIn1 != LOW) digitalWrite(IN1, LOW);
  if (!in2 && saidaIn2 != LOW) digitalWrite(IN2, LOW);
  if (!in3 && saidaIn3 != LOW) digitalWrite(IN3, LOW);
  if (!in4 && saidaIn4 != LOW) digitalWrite(IN4, LOW);
  if (in1 && saidaIn1 != HIGH) digitalWrite(IN1, HIGH);
  if (in2 && saidaIn2 != HIGH) digitalWrite(IN2, HIGH);
  if (in3 && saidaIn3 != HIGH) digitalWrite(IN3, HIGH);
  if (in4 && saidaIn4 != HIGH) digitalWrite(IN4, HIGH);
  saidaIn1 = in1; saidaIn2 = in2; saidaIn3 = in3; saidaIn4 = in4;
  OCR1A = potenciaEsquerda;
  OCR1B = potenciaDireita;
  direcaoPwmEsquerda = (in1 ? _BV(IN1) : 0) | (in2 ? _BV(IN2) : 0);
  direcaoPwmDireita = (in3 ? _BV(IN3) : 0) | (in4 ? _BV(IN4) : 0);
  atualizarPotenciasMotores();
  SREG = interrupcoes;
}

void aplicarMotores(bool in1, bool in2, bool in3, bool in4) {
  aplicarMotoresComPotencia(in1, in2, in3, in4,
    POTENCIA_MOTOR_ESQUERDO, POTENCIA_MOTOR_DIREITO);
}

void pararMotores() {
  aplicarMotores(LOW, LOW, LOW, LOW);
  comandoAplicado = CMD_PARAR;
}

void andarParaFrente() {
  aplicarMotores(LOW, HIGH, LOW, HIGH);
  comandoAplicado = CMD_FRENTE;
}

void avancarEmCurvaDireita() {
  // Modo 2: as duas rodas avancam; a roda interna recebe 75% da potencia.
  aplicarMotoresComPotencia(LOW, HIGH, LOW, HIGH, POTENCIA_MOTOR_ESQUERDO, 150);
  comandoAplicado = CMD_FRENTE_DIREITA;
}

void avancarEmCurvaEsquerda() {
  aplicarMotoresComPotencia(LOW, HIGH, LOW, HIGH, 150, POTENCIA_MOTOR_DIREITO);
  comandoAplicado = CMD_FRENTE_ESQUERDA;
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
    case CMD_FRENTE_DIREITA: avancarEmCurvaDireita(); break;
    case CMD_FRENTE_ESQUERDA: avancarEmCurvaEsquerda(); break;
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
      || comando == CMD_FRENTE_DIREITA
      || comando == CMD_FRENTE_ESQUERDA
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
  if (permitirRe) {
    curvaAtualDireita = proximaCurvaDireita;
    proximaCurvaDireita = !proximaCurvaDireita;
  }
  estadoDesvio = permitirRe ? DESVIO_PAUSA_INICIAL : DESVIO_PAUSA_RE;
  estadoDesvioDesde = agora;
  Serial.println(F("EVENTO:DESVIO_INICIADO"));
}

void atualizarDesvio(unsigned long agora) {
  const unsigned long decorrido = agora - estadoDesvioDesde;
  switch (estadoDesvio) {
    case DESVIO_PAUSA_INICIAL:
      pararMotores();
      if (distanciaAtualCm > DISTANCIA_OBSTACULO_CM) {
        // O objeto saiu antes da re. Exige duas medidas novas parado.
        cancelarDesvio();
        confirmandoObstaculo = true;
      } else if (decorrido >= TEMPO_PAUSA_MS) {
        permitirRe = false;
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
        permitirRe = true;
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
  if (modo == MODO_VOZ) return F("VOZ");
  return F("GESTOS");
}

const __FlashStringHelper* nomeComando(ComandoMovimento comando) {
  switch (comando) {
    case CMD_FRENTE: return F("FRENTE");
    case CMD_FRENTE_DIREITA: return F("FRENTE_DIREITA");
    case CMD_FRENTE_ESQUERDA: return F("FRENTE_ESQUERDA");
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
  else if (modo == MODO_AUTONOMO && !sensorPronto()) Serial.print(F("SENSOR_FAIL"));
  else if (modo != MODO_AUTONOMO && !controleUsbAtivo) Serial.print(F("LINK_WAIT"));
  else if (estadoDesvio != DESVIO_INATIVO) Serial.print(F("DESVIANDO"));
  else Serial.print(nomeModo());
  Serial.println();
}

// Leitura sob demanda; nao libera emergencia nem renova comando de movimento.
void enviarDiagnosticoMotores() {
  const byte interrupcoes = SREG;
  cli();
  const byte timerA = TCCR1A, timerB = TCCR1B, timerIrq = TIMSK1;
  const byte fase = TCNT1, portas = DDRD, niveis = PIND;
  const byte direcaoE = direcaoPwmEsquerda, direcaoD = direcaoPwmDireita;
  const unsigned int pwmE = OCR1A, pwmD = OCR1B;
  SREG = interrupcoes;
  Serial.print(F("QT:DRIVE:1|MODE:")); Serial.print((byte)modo);
  Serial.print(F("|CMD:")); Serial.print(nomeComando(comandoAplicado));
  Serial.print(F("|ESTOP:")); Serial.println(paradaEmergencia ? 1 : 0);
  Serial.print(F("QT:PWM|L:")); Serial.print(pwmE);
  Serial.print(F("|R:")); Serial.print(pwmD);
  Serial.print(F("|DIRL:")); Serial.print(direcaoE);
  Serial.print(F("|DIRR:")); Serial.println(direcaoD);
  Serial.print(F("QT:TIMER|A:")); Serial.print(timerA);
  Serial.print(F("|B:")); Serial.print(timerB);
  Serial.print(F("|IRQ:")); Serial.print(timerIrq);
  Serial.print(F("|COUNT:")); Serial.println(fase);
  Serial.print(F("QT:PINS|DDR:")); Serial.print(portas);
  Serial.print(F("|LEVEL:")); Serial.println(niveis);
}

void selecionarModo(byte numero, unsigned long agora) {
  if (numero < 1 || numero > 4) return;
  modo = (ModoRobo)numero;
  comandoRecebido = modo == MODO_AUTONOMO ? CMD_FRENTE : CMD_PARAR;
  ultimoComandoEm = agora;
  cancelarDesvio();
  Serial.print(F("OK:MODE:"));
  Serial.println(numero);
}

ComandoMovimento comandoDesejadoPeloModo() {
  // Um unico sketch executa os tres modos. O Arduino sempre resolve o modo
  // localmente. Os modos 2, 3 e 4 exigem concessao viva pela porta USB.
  switch (modo) {
    case MODO_AUTONOMO:
      return CMD_FRENTE;
    case MODO_SEGUIR:
    case MODO_GESTOS:
    case MODO_VOZ:
    default:
      return comandoRecebido;
  }
}

void receberComando(ComandoMovimento comando, unsigned long agora) {
  if (modo != MODO_SEGUIR && (comando == CMD_FRENTE_DIREITA || comando == CMD_FRENTE_ESQUERDA)) {
    Serial.println(F("ERRO:CURVA_EXCLUSIVA_MODO_2"));
    return;
  }
  comandoRecebido = comando;
  ultimoComandoEm = agora;
  controleUsbAtivo = true;
  if (comando == CMD_PARAR && modo == MODO_AUTONOMO) {
    // O modo local nao pode sobrescrever uma parada no proximo loop.
    paradaEmergencia = true;
  }
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
  else if (strcmp(linha, "MODE:4") == 0) selecionarModo(4, agora);
  else if (strcmp(linha, "CMD:FRENTE") == 0) receberComando(CMD_FRENTE, agora);
  else if (strcmp(linha, "CMD:FRENTE_DIREITA") == 0) receberComando(CMD_FRENTE_DIREITA, agora);
  else if (strcmp(linha, "CMD:FRENTE_ESQUERDA") == 0) receberComando(CMD_FRENTE_ESQUERDA, agora);
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
    permitirRe = true;
    leiturasValidasSensor = 0;
    cancelarDesvio();
    Serial.println(F("OK:RESET_ESTOP"));
  } else if (strcmp(linha, "HELLO") == 0) {
    // Permite identificar o firmware mesmo quando abrir a porta nao reinicia o UNO.
    Serial.println(F("QT:READY:V7"));
  } else if (strcmp(linha, "PING") == 0) {
    // PING confirma apenas o enlace. So CMD:* renova a validade do movimento.
    Serial.println(F("PONG"));
  } else if (strcmp(linha, "STATUS") == 0) enviarStatus(agora, true);
  else if (strcmp(linha, "DIAG") == 0) enviarDiagnosticoMotores();
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
  iniciarControlePotencia();

  Serial.begin(9600);
  delay(2000);
  ultimoComandoEm = millis();
  Serial.println(F("QT:READY:V7"));
  Serial.println(F("OK:MODE:1"));
  aguardarComandoInicial();
}

void loop() {
  const unsigned long agora = millis();
  lerSerial(agora);
  // A leitura pode aguardar até 30 ms por eco. Ela é necessária somente para
  // o Modo 1; nos modos remotos não pode atrasar nem bloquear um comando
  // confirmado da câmera.
  if (modo == MODO_AUTONOMO) atualizarSensor(agora);

  if (paradaEmergencia) {
    pararMotores();
    enviarStatus(agora);
    return;
  }

  const bool modoRemoto = modo == MODO_SEGUIR || modo == MODO_GESTOS || modo == MODO_VOZ;
  if (modoRemoto && (!controleUsbAtivo || agora - ultimoComandoEm > TIMEOUT_COMANDO_MS)) {
    controleUsbAtivo = false;
    comandoRecebido = CMD_PARAR;
    cancelarDesvio();
    enviarStatus(agora);
    return;
  }

  const ComandoMovimento desejado = comandoDesejadoPeloModo();

  // Nos Modos 2, 3 e 4, o site é a origem do comando. O HC-SR04 só protege o
  // Modo 1 autônomo e não pode bloquear nem atrasar a condução remota.
  const bool usarSensorNoModo = modo == MODO_AUTONOMO;
  if (usarSensorNoModo && estadoDesvio != DESVIO_INATIVO && !sensorPronto()) {
    cancelarDesvio();
    enviarStatus(agora);
    return;
  }

  if (usarSensorNoModo && comandoExigeFrenteLivre(desejado) && !sensorPronto()) {
    pararMotores();
    enviarStatus(agora);
    return;
  }

  if (usarSensorNoModo && estadoDesvio != DESVIO_INATIVO) {
    atualizarDesvio(agora);
    enviarStatus(agora);
    return;
  }

  if (usarSensorNoModo && comandoExigeFrenteLivre(desejado)) {
    if (confirmandoObstaculo) {
      pararMotores();
      if (obstaculoConfirmado()) {
        iniciarDesvio(agora);
      } else if (caminhoLivreConfirmado()) {
        confirmandoObstaculo = false;
        permitirRe = true;
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
      if (caminhoLivreConfirmado()) permitirRe = true;
      aplicarComando(desejado);
    }
  } else {
    confirmandoObstaculo = false;
    aplicarComando(desejado);
  }

  enviarStatus(agora);
}
