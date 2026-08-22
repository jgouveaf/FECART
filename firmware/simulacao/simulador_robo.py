"""Simulador deterministico do firmware integrado do Quantum Tracker.

O modelo espelha a maquina de estados, o protocolo serial, a polaridade dos
motores e os tempos do sketch ``quantum_tracker_arduino.ino``. Ele nao tenta
simular a eletrica real (bateria, atrito, ruido ou inercia); seu objetivo e
validar a logica antes de qualquer teste no carrinho.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, IntEnum


class Modo(IntEnum):
    AUTONOMO = 1
    SEGUIR = 2
    GESTOS = 3


class Comando(Enum):
    PARAR = "PARAR"
    FRENTE = "FRENTE"
    TRAS = "TRAS"
    DIREITA = "DIREITA"
    ESQUERDA = "ESQUERDA"
    GIRAR = "GIRAR"


class EstadoDesvio(Enum):
    INATIVO = "INATIVO"
    PAUSA_INICIAL = "PAUSA_INICIAL"
    RE = "RE"
    PAUSA_RE = "PAUSA_RE"
    CURVA = "CURVA"
    PAUSA_CURVA = "PAUSA_CURVA"
    SAIDA = "SAIDA"


class EstadoOperacional(Enum):
    AUTONOMO = "AUTONOMO"
    SEGUIR = "SEGUIR"
    GESTOS = "GESTOS"
    DESVIANDO = "DESVIANDO"
    SENSOR_FAIL = "SENSOR_FAIL"
    ESTOP = "ESTOP"


@dataclass(frozen=True)
class SaidaMotores:
    in1: int
    in2: int
    in3: int
    in4: int


# Polaridades iguais as funcoes aplicarMotores() do sketch.
PARADO = SaidaMotores(0, 0, 0, 0)
FRENTE = SaidaMotores(0, 1, 0, 1)
TRAS = SaidaMotores(1, 0, 1, 0)
CURVA_DIREITA = SaidaMotores(0, 1, 0, 0)
CURVA_ESQUERDA = SaidaMotores(0, 0, 0, 1)
GIRO = SaidaMotores(0, 1, 1, 0)

SAIDAS_POR_COMANDO = {
    Comando.PARAR: PARADO,
    Comando.FRENTE: FRENTE,
    Comando.TRAS: TRAS,
    Comando.DIREITA: CURVA_DIREITA,
    Comando.ESQUERDA: CURVA_ESQUERDA,
    Comando.GIRAR: GIRO,
}


class SimuladorRobo:
    DISTANCIA_OBSTACULO_CM = 20.0
    INTERVALO_SENSOR_MS = 80
    INTERVALO_TELEMETRIA_MS = 250
    TIMEOUT_COMANDO_MS = 1_500
    JANELA_OBSTACULOS_MS = 15_000

    TEMPO_PAUSA_MS = 200
    TEMPO_RE_MS = 700
    TEMPO_PAUSA_RE_MS = 150
    TEMPO_CURVA_MS = 900
    TEMPO_PAUSA_CURVA_MS = 150
    TEMPO_SAIDA_MS = 600

    LIMITE_FALHAS_SENSOR = 5
    LEITURAS_VALIDAS_PARA_RECUPERAR = 3
    LIMITE_OBSTACULOS = 5

    def __init__(self) -> None:
        self.agora_ms = 0
        self.modo = Modo.AUTONOMO
        self.comando_recebido = Comando.FRENTE
        self.comando_aplicado = Comando.PARAR
        self.motores = PARADO

        self.estado_desvio = EstadoDesvio.INATIVO
        self.estado_desvio_desde_ms = 0
        self.ultimo_comando_ms = 0

        self.distancia_atual_cm: float | None = None
        self.falhas_consecutivas_sensor = 0
        self.leituras_validas_recuperacao = 0
        self.sensor_bloqueado = False
        self.obstaculos_consecutivos = 0
        self.tempos_obstaculos_ms: list[int] = []

        self.proxima_curva_direita = True
        self.parada_emergencia = False
        self.saida_serial: list[str] = ["QT:READY:V3", "OK:MODE:1"]
        self.historico: list[
            tuple[int, Modo, EstadoDesvio, Comando, SaidaMotores]
        ] = []
        self._registrar()

    @property
    def sensor_seguro(self) -> bool:
        return (
            not self.sensor_bloqueado
            and self.falhas_consecutivas_sensor < self.LIMITE_FALHAS_SENSOR
        )

    @property
    def obstaculo_confirmado(self) -> bool:
        return (
            self.distancia_atual_cm is not None
            and self.obstaculos_consecutivos >= 2
        )

    @property
    def quantidade_obstaculos(self) -> int:
        return len(self.tempos_obstaculos_ms)

    @property
    def quantidade_desvios(self) -> int:
        """Alias historico: cada desvio iniciado corresponde a um obstaculo."""
        return self.quantidade_obstaculos

    @property
    def estado_operacional(self) -> EstadoOperacional:
        if self.parada_emergencia:
            return EstadoOperacional.ESTOP
        if not self.sensor_seguro:
            return EstadoOperacional.SENSOR_FAIL
        if self.estado_desvio is not EstadoDesvio.INATIVO:
            return EstadoOperacional.DESVIANDO
        return {
            Modo.AUTONOMO: EstadoOperacional.AUTONOMO,
            Modo.SEGUIR: EstadoOperacional.SEGUIR,
            Modo.GESTOS: EstadoOperacional.GESTOS,
        }[self.modo]

    def _emitir(self, linha: str) -> None:
        self.saida_serial.append(linha)

    def _registrar(self) -> None:
        registro = (
            self.agora_ms,
            self.modo,
            self.estado_desvio,
            self.comando_aplicado,
            self.motores,
        )
        if not self.historico or self.historico[-1] != registro:
            self.historico.append(registro)

    def _aplicar_comando(self, comando: Comando) -> None:
        self.comando_aplicado = comando
        self.motores = SAIDAS_POR_COMANDO[comando]
        self._registrar()

    def _parar(self) -> None:
        self._aplicar_comando(Comando.PARAR)

    def _cancelar_desvio(self) -> None:
        self.estado_desvio = EstadoDesvio.INATIVO
        self._parar()

    @staticmethod
    def _comando_exige_frente_livre(comando: Comando) -> bool:
        return comando in {
            Comando.FRENTE,
            Comando.DIREITA,
            Comando.ESQUERDA,
            Comando.GIRAR,
        }

    def _registrar_obstaculo(self) -> bool:
        self.tempos_obstaculos_ms = [
            tempo
            for tempo in self.tempos_obstaculos_ms
            if self.agora_ms - tempo <= self.JANELA_OBSTACULOS_MS
        ]
        if len(self.tempos_obstaculos_ms) < self.LIMITE_OBSTACULOS:
            self.tempos_obstaculos_ms.append(self.agora_ms)
        return len(self.tempos_obstaculos_ms) >= self.LIMITE_OBSTACULOS

    def _iniciar_desvio(self) -> None:
        self._parar()
        self.obstaculos_consecutivos = 0
        if self._registrar_obstaculo():
            self.parada_emergencia = True
            self.estado_desvio = EstadoDesvio.INATIVO
            self._emitir("ALERTA:5_OBSTACULOS")
            return
        self.estado_desvio = EstadoDesvio.PAUSA_INICIAL
        self.estado_desvio_desde_ms = self.agora_ms
        self._emitir("EVENTO:DESVIO_INICIADO")
        self._registrar()

    def ler_sensor(self, distancia_cm: float | int | None) -> None:
        """Injeta uma leitura do HC-SR04 e executa uma iteracao do loop.

        ``None``, zero e valores fora de 2..400 cm representam timeout/erro.
        Assim como no sketch, o obstaculo exige duas leituras proximas seguidas.
        """
        if distancia_cm is None or not 2 <= float(distancia_cm) <= 400:
            self.distancia_atual_cm = None
            self.falhas_consecutivas_sensor = min(
                255, self.falhas_consecutivas_sensor + 1
            )
            self.leituras_validas_recuperacao = 0
            self.obstaculos_consecutivos = 0
            if (
                self.falhas_consecutivas_sensor >= self.LIMITE_FALHAS_SENSOR
                and not self.sensor_bloqueado
            ):
                self.sensor_bloqueado = True
                self.estado_desvio = EstadoDesvio.INATIVO
                self._parar()
                self._emitir("ALERTA:SENSOR_BLOQUEADO")
        else:
            self.distancia_atual_cm = float(distancia_cm)
            self.falhas_consecutivas_sensor = 0
            if self.sensor_bloqueado:
                self.leituras_validas_recuperacao = min(
                    255, self.leituras_validas_recuperacao + 1
                )
                if (
                    self.leituras_validas_recuperacao
                    >= self.LEITURAS_VALIDAS_PARA_RECUPERAR
                ):
                    self.sensor_bloqueado = False
                    self.leituras_validas_recuperacao = 0
                    self._emitir("EVENTO:SENSOR_RECUPERADO")
            else:
                self.leituras_validas_recuperacao = 0

            if self.distancia_atual_cm <= self.DISTANCIA_OBSTACULO_CM:
                self.obstaculos_consecutivos = min(
                    255, self.obstaculos_consecutivos + 1
                )
            else:
                self.obstaculos_consecutivos = 0

        self._executar_controle()

    def _atualizar_desvio(self) -> None:
        if self.obstaculo_confirmado:
            if self.estado_desvio is EstadoDesvio.PAUSA_RE:
                self._aplicar_comando(Comando.TRAS)
                self.estado_desvio = EstadoDesvio.RE
                self.estado_desvio_desde_ms = self.agora_ms
            elif self.estado_desvio in {
                EstadoDesvio.CURVA,
                EstadoDesvio.PAUSA_CURVA,
                EstadoDesvio.SAIDA,
            }:
                self._iniciar_desvio()

        decorrido = self.agora_ms - self.estado_desvio_desde_ms

        if (
            self.estado_desvio is EstadoDesvio.PAUSA_INICIAL
            and decorrido >= self.TEMPO_PAUSA_MS
        ):
            self._aplicar_comando(Comando.TRAS)
            self.estado_desvio = EstadoDesvio.RE
            self.estado_desvio_desde_ms = self.agora_ms
        elif (
            self.estado_desvio is EstadoDesvio.RE
            and decorrido >= self.TEMPO_RE_MS
        ):
            self._parar()
            self.estado_desvio = EstadoDesvio.PAUSA_RE
            self.estado_desvio_desde_ms = self.agora_ms
        elif (
            self.estado_desvio is EstadoDesvio.PAUSA_RE
            and decorrido >= self.TEMPO_PAUSA_RE_MS
        ):
            if self.obstaculo_confirmado:
                self._aplicar_comando(Comando.TRAS)
                self.estado_desvio = EstadoDesvio.RE
            else:
                comando = (
                    Comando.DIREITA
                    if self.proxima_curva_direita
                    else Comando.ESQUERDA
                )
                self._aplicar_comando(comando)
                self.estado_desvio = EstadoDesvio.CURVA
            self.estado_desvio_desde_ms = self.agora_ms
        elif (
            self.estado_desvio is EstadoDesvio.CURVA
            and decorrido >= self.TEMPO_CURVA_MS
        ):
            self._parar()
            self.proxima_curva_direita = not self.proxima_curva_direita
            self.estado_desvio = EstadoDesvio.PAUSA_CURVA
            self.estado_desvio_desde_ms = self.agora_ms
        elif (
            self.estado_desvio is EstadoDesvio.PAUSA_CURVA
            and decorrido >= self.TEMPO_PAUSA_CURVA_MS
        ):
            self._aplicar_comando(Comando.FRENTE)
            self.estado_desvio = EstadoDesvio.SAIDA
            self.estado_desvio_desde_ms = self.agora_ms
        elif (
            self.estado_desvio is EstadoDesvio.SAIDA
            and decorrido >= self.TEMPO_SAIDA_MS
        ):
            self.estado_desvio = EstadoDesvio.INATIVO
            self.obstaculos_consecutivos = 0
            self._registrar()

    def _executar_controle(self) -> None:
        if self.parada_emergencia or not self.sensor_seguro:
            self._parar()
            return

        if (
            self.modo is not Modo.AUTONOMO
            and self.agora_ms - self.ultimo_comando_ms > self.TIMEOUT_COMANDO_MS
        ):
            self.comando_recebido = Comando.PARAR
            self._cancelar_desvio()

        if self.estado_desvio is not EstadoDesvio.INATIVO:
            self._atualizar_desvio()
            return

        desejado = (
            Comando.FRENTE
            if self.modo is Modo.AUTONOMO
            else self.comando_recebido
        )
        if self.obstaculo_confirmado and self._comando_exige_frente_livre(desejado):
            self._iniciar_desvio()
        else:
            self._aplicar_comando(desejado)

    def avancar_tempo(self, milissegundos: int) -> None:
        """Avanca o relogio em passos curtos, como chamadas repetidas de loop()."""
        if milissegundos < 0:
            raise ValueError("o tempo nao pode ser negativo")
        restante = milissegundos
        while restante:
            passo = min(10, restante)
            self.agora_ms += passo
            restante -= passo
            self._executar_controle()

    def selecionar_modo(self, numero: int) -> None:
        if numero not in (1, 2, 3):
            return
        self.modo = Modo(numero)
        self.comando_recebido = (
            Comando.FRENTE if self.modo is Modo.AUTONOMO else Comando.PARAR
        )
        self.ultimo_comando_ms = self.agora_ms
        self._cancelar_desvio()
        self._emitir(f"OK:MODE:{numero}")
        self._executar_controle()

    def receber_comando(self, comando: Comando) -> None:
        self.comando_recebido = comando
        self.ultimo_comando_ms = self.agora_ms
        if comando is Comando.PARAR or (
            self.modo is not Modo.AUTONOMO and comando is Comando.TRAS
        ):
            self._cancelar_desvio()
        self._emitir(f"OK:CMD:{comando.value}")
        self._executar_controle()

    def processar_linha(self, linha: str) -> list[str]:
        """Processa uma linha do protocolo e devolve somente as novas respostas."""
        inicio = len(self.saida_serial)
        linha = linha.strip()
        if linha in {"MODE:1", "MODE:2", "MODE:3"}:
            self.selecionar_modo(int(linha[-1]))
        elif linha.startswith("CMD:"):
            nome = linha[4:]
            try:
                self.receber_comando(Comando(nome))
            except ValueError:
                self._emitir("ERRO:COMANDO_INVALIDO")
        elif linha == "ESTOP":
            self.parada_emergencia = True
            self._cancelar_desvio()
            self._emitir("OK:ESTOP")
        elif linha == "RESET_ESTOP":
            self.parada_emergencia = False
            self.tempos_obstaculos_ms.clear()
            self.comando_recebido = (
                Comando.FRENTE
                if self.modo is Modo.AUTONOMO
                else Comando.PARAR
            )
            self.ultimo_comando_ms = self.agora_ms
            self._cancelar_desvio()
            self._emitir("OK:RESET_ESTOP")
            self._executar_controle()
        elif linha == "HELLO":
            self._emitir("QT:READY:V3")
        elif linha == "PING":
            # Deliberadamente nao altera ultimo_comando_ms.
            self._emitir("PONG")
            self._executar_controle()
        elif linha == "STATUS":
            self._emitir(self.telemetria())
        else:
            self._emitir("ERRO:COMANDO_INVALIDO")
        return self.saida_serial[inicio:]

    def telemetria(self) -> str:
        distancia = (
            "ERR"
            if self.distancia_atual_cm is None
            else f"{self.distancia_atual_cm:.1f}"
        )
        return (
            f"QT|MODE:{int(self.modo)}|DIST:{distancia}"
            f"|CMD:{self.comando_aplicado.value}"
            f"|STATE:{self.estado_operacional.value}"
        )

    def executar_desvio_completo(self, distancia_obstaculo: float = 10.0) -> None:
        """Atalho de teste que percorre exatamente um ciclo de desvio."""
        self.ler_sensor(distancia_obstaculo)
        self.ler_sensor(distancia_obstaculo)
        if self.parada_emergencia:
            return
        self.avancar_tempo(self.TEMPO_PAUSA_MS)
        self.ler_sensor(40)
        self.avancar_tempo(self.TEMPO_RE_MS)
        self.avancar_tempo(self.TEMPO_PAUSA_RE_MS)
        self.avancar_tempo(self.TEMPO_CURVA_MS)
        self.avancar_tempo(self.TEMPO_PAUSA_CURVA_MS)
        self.avancar_tempo(self.TEMPO_SAIDA_MS)


def demonstracao() -> None:
    robo = SimuladorRobo()
    robo.ler_sensor(100)
    robo.executar_desvio_completo(15)
    for tempo, modo, desvio, comando, motores in robo.historico:
        print(
            f"{tempo:5d} ms | M{int(modo)} | {desvio.value:14s} | "
            f"{comando.value:8s} | IN1..IN4="
            f"{motores.in1}{motores.in2}{motores.in3}{motores.in4}"
        )


if __name__ == "__main__":
    demonstracao()
