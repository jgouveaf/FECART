"""Modelo determinístico do firmware integrado V6.

Espelha protocolo, temporização e máquina de estados, mas não simula bateria,
atrito, inércia, ruído elétrico nem rotação física do chassi.
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


class EstadoOperacional(Enum):
    AUTONOMO = "AUTONOMO"
    SEGUIR = "SEGUIR"
    GESTOS = "GESTOS"
    DESVIANDO = "DESVIANDO"
    LINK_WAIT = "LINK_WAIT"
    SENSOR_FAIL = "SENSOR_FAIL"
    ESTOP = "ESTOP"


@dataclass(frozen=True)
class SaidaMotores:
    in1: int
    in2: int
    in3: int
    in4: int


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
    DISTANCIA_OBSTACULO_CM = 5.0
    INTERVALO_SENSOR_MS = 80
    INTERVALO_TELEMETRIA_MS = 250
    TIMEOUT_COMANDO_MS = 1_500
    JANELA_COMANDO_INICIAL_MS = 750
    TEMPO_PAUSA_MS = 150
    TEMPO_RE_MS = 400
    TEMPO_CURVA_MS = 650
    LEITURAS_CONFIRMACAO = 2
    TAMANHO_LINHA_SERIAL = 33

    def __init__(self) -> None:
        self.agora_ms = 0
        self.modo = Modo.AUTONOMO
        self.comando_recebido = Comando.PARAR
        self.comando_aplicado = Comando.PARAR
        self.motores = PARADO
        self.estado_desvio = EstadoDesvio.INATIVO
        self.estado_desvio_desde_ms = 0
        self.ultimo_comando_ms = 0
        self.distancia_atual_cm: float | None = None
        self.falhas_consecutivas_sensor = 0
        self.leituras_validas_sensor = 0
        self.leituras_livres_consecutivas = 0
        self.obstaculos_consecutivos = 0
        self.sensor_inicializado = False
        self.confirmando_obstaculo = False
        self.proxima_curva_direita = True
        self.curva_atual_direita = True
        self.parada_emergencia = False
        self.controle_usb_ativo = False
        self.desvios_iniciados = 0
        self._linha_serial = ""
        self._descartando_linha_serial = False
        self.saida_serial: list[str] = ["QT:READY:V6", "OK:MODE:1"]
        self.historico: list[
            tuple[int, Modo, EstadoDesvio, Comando, SaidaMotores]
        ] = []
        self._registrar()

    @property
    def sensor_seguro(self) -> bool:
        return (
            self.sensor_inicializado
            and self.distancia_atual_cm is not None
            and self.leituras_validas_sensor >= self.LEITURAS_CONFIRMACAO
        )

    @property
    def obstaculo_confirmado(self) -> bool:
        return (
            self.distancia_atual_cm is not None
            and self.obstaculos_consecutivos >= self.LEITURAS_CONFIRMACAO
        )

    @property
    def caminho_livre_confirmado(self) -> bool:
        return (
            self.distancia_atual_cm is not None
            and self.distancia_atual_cm > self.DISTANCIA_OBSTACULO_CM
            and self.leituras_livres_consecutivas >= self.LEITURAS_CONFIRMACAO
        )

    @property
    def quantidade_desvios(self) -> int:
        return self.desvios_iniciados

    @property
    def quantidade_obstaculos(self) -> int:
        return self.desvios_iniciados

    @property
    def estado_operacional(self) -> EstadoOperacional:
        if self.parada_emergencia:
            return EstadoOperacional.ESTOP
        if not self.sensor_seguro:
            return EstadoOperacional.SENSOR_FAIL
        if self.modo is not Modo.AUTONOMO and not self.controle_usb_ativo:
            return EstadoOperacional.LINK_WAIT
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
            self.agora_ms, self.modo, self.estado_desvio,
            self.comando_aplicado, self.motores,
        )
        if not self.historico or self.historico[-1] != registro:
            self.historico.append(registro)

    def _aplicar_comando(self, comando: Comando) -> None:
        if comando is self.comando_aplicado:
            return
        self.comando_aplicado = comando
        self.motores = SAIDAS_POR_COMANDO[comando]
        self._registrar()

    def _parar(self) -> None:
        self.comando_aplicado = Comando.PARAR
        self.motores = PARADO
        self._registrar()

    def _cancelar_desvio(self) -> None:
        self.estado_desvio = EstadoDesvio.INATIVO
        self.obstaculos_consecutivos = 0
        self.leituras_livres_consecutivas = 0
        self.confirmando_obstaculo = False
        self._parar()

    @staticmethod
    def _comando_exige_frente_livre(comando: Comando) -> bool:
        return comando in {
            Comando.FRENTE, Comando.DIREITA, Comando.ESQUERDA, Comando.GIRAR,
        }

    def _iniciar_desvio(self) -> None:
        self._parar()
        self.obstaculos_consecutivos = 0
        self.leituras_livres_consecutivas = 0
        self.confirmando_obstaculo = False
        self.curva_atual_direita = self.proxima_curva_direita
        self.proxima_curva_direita = not self.proxima_curva_direita
        self.estado_desvio = EstadoDesvio.PAUSA_INICIAL
        self.estado_desvio_desde_ms = self.agora_ms
        self.desvios_iniciados += 1
        self._emitir("EVENTO:DESVIO_INICIADO")
        self._registrar()

    def ler_sensor(self, distancia_cm: float | int | None) -> None:
        """Injeta uma leitura; ``None``/fora de 2..400 representa sem eco."""
        if distancia_cm is None or not 2 <= float(distancia_cm) <= 400:
            self.distancia_atual_cm = None
            self.falhas_consecutivas_sensor = min(
                255, self.falhas_consecutivas_sensor + 1
            )
            self.leituras_validas_sensor = 0
            self.leituras_livres_consecutivas = 0
            self.obstaculos_consecutivos = 0
        else:
            self.distancia_atual_cm = float(distancia_cm)
            self.sensor_inicializado = True
            self.falhas_consecutivas_sensor = 0
            self.leituras_validas_sensor = min(
                self.LEITURAS_CONFIRMACAO, self.leituras_validas_sensor + 1
            )
            if self.estado_desvio is EstadoDesvio.CURVA:
                self.obstaculos_consecutivos = 0
                self.leituras_livres_consecutivas = 0
            elif self.distancia_atual_cm <= self.DISTANCIA_OBSTACULO_CM:
                self.leituras_livres_consecutivas = 0
                self.obstaculos_consecutivos = min(
                    255, self.obstaculos_consecutivos + 1
                )
            else:
                self.obstaculos_consecutivos = 0
                self.leituras_livres_consecutivas = min(
                    self.LEITURAS_CONFIRMACAO,
                    self.leituras_livres_consecutivas + 1,
                )
        self._executar_controle()

    def _atualizar_desvio(self) -> None:
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
            and decorrido >= self.TEMPO_PAUSA_MS
        ):
            self.obstaculos_consecutivos = 0
            self._aplicar_comando(
                Comando.DIREITA if self.curva_atual_direita else Comando.ESQUERDA
            )
            self.estado_desvio = EstadoDesvio.CURVA
            self.estado_desvio_desde_ms = self.agora_ms
        elif (
            self.estado_desvio is EstadoDesvio.CURVA
            and decorrido >= self.TEMPO_CURVA_MS
        ):
            self._parar()
            self.estado_desvio = EstadoDesvio.PAUSA_CURVA
            self.obstaculos_consecutivos = 0
            self.leituras_livres_consecutivas = 0
            self.estado_desvio_desde_ms = self.agora_ms
        elif self.estado_desvio is EstadoDesvio.PAUSA_CURVA:
            self._parar()
            if self.caminho_livre_confirmado:
                self.estado_desvio = EstadoDesvio.INATIVO
                self.obstaculos_consecutivos = 0
                self.leituras_livres_consecutivas = 0
            elif self.obstaculo_confirmado:
                self.obstaculos_consecutivos = 0
                self.leituras_livres_consecutivas = 0
                self._aplicar_comando(
                    Comando.DIREITA
                    if self.curva_atual_direita
                    else Comando.ESQUERDA
                )
                self.estado_desvio = EstadoDesvio.CURVA
                self.estado_desvio_desde_ms = self.agora_ms
                self._emitir("EVENTO:CURVA_CONTINUA")

    def _executar_controle(self) -> None:
        if self.parada_emergencia:
            self._parar()
            return

        modo_remoto = self.modo in {Modo.SEGUIR, Modo.GESTOS}
        if modo_remoto and (
            not self.controle_usb_ativo
            or self.agora_ms - self.ultimo_comando_ms > self.TIMEOUT_COMANDO_MS
        ):
            self.controle_usb_ativo = False
            self.comando_recebido = Comando.PARAR
            self._cancelar_desvio()
            return

        desejado = (
            Comando.FRENTE if self.modo is Modo.AUTONOMO else self.comando_recebido
        )
        if self.estado_desvio is not EstadoDesvio.INATIVO and not self.sensor_seguro:
            self._cancelar_desvio()
            return
        if self._comando_exige_frente_livre(desejado) and not self.sensor_seguro:
            self._parar()
            return
        if self.estado_desvio is not EstadoDesvio.INATIVO:
            self._atualizar_desvio()
            return

        if self._comando_exige_frente_livre(desejado):
            if self.confirmando_obstaculo:
                self._parar()
                if self.obstaculo_confirmado:
                    self._iniciar_desvio()
                elif self.caminho_livre_confirmado:
                    self.confirmando_obstaculo = False
                    self._aplicar_comando(desejado)
            elif self.distancia_atual_cm <= self.DISTANCIA_OBSTACULO_CM:
                self.confirmando_obstaculo = True
                self.obstaculos_consecutivos = 0
                self.leituras_livres_consecutivas = 0
                self._parar()
            else:
                self._aplicar_comando(desejado)
        else:
            self.confirmando_obstaculo = False
            self._aplicar_comando(desejado)

    def avancar_tempo(self, milissegundos: int) -> None:
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
        self.controle_usb_ativo = False
        self._cancelar_desvio()
        self._emitir(f"OK:MODE:{numero}")

    def receber_comando(self, comando: Comando) -> None:
        self.comando_recebido = comando
        self.ultimo_comando_ms = self.agora_ms
        self.controle_usb_ativo = True
        if comando is Comando.PARAR or (
            self.modo is not Modo.AUTONOMO and comando is Comando.TRAS
        ):
            self._cancelar_desvio()
        self._emitir(f"OK:CMD:{comando.value}")
        self._executar_controle()

    def processar_linha(self, linha: str) -> list[str]:
        inicio = len(self.saida_serial)
        linha = linha.strip()
        if linha in {"MODE:1", "MODE:2", "MODE:3"}:
            self.selecionar_modo(int(linha[-1]))
        elif linha.startswith("CMD:"):
            try:
                self.receber_comando(Comando(linha[4:]))
            except ValueError:
                self._emitir("ERRO:COMANDO_INVALIDO")
        elif linha == "ESTOP":
            self.parada_emergencia = True
            self._cancelar_desvio()
            self._emitir("OK:ESTOP")
        elif linha == "RESET_ESTOP":
            self.parada_emergencia = False
            self.comando_recebido = (
                Comando.FRENTE if self.modo is Modo.AUTONOMO else Comando.PARAR
            )
            self.ultimo_comando_ms = self.agora_ms
            self.controle_usb_ativo = False
            self._cancelar_desvio()
            self._emitir("OK:RESET_ESTOP")
        elif linha == "HELLO":
            self._emitir("QT:READY:V6")
        elif linha == "PING":
            self._emitir("PONG")
        elif linha == "STATUS":
            self._emitir(self.telemetria())
        else:
            self._emitir("ERRO:COMANDO_INVALIDO")
        return self.saida_serial[inicio:]

    def receber_bytes(self, dados: str | bytes) -> list[str]:
        inicio = len(self.saida_serial)
        texto = dados.decode("ascii", errors="ignore") if isinstance(dados, bytes) else dados
        for caractere in texto:
            if caractere in "\r\n":
                if self._descartando_linha_serial:
                    self._descartando_linha_serial = False
                    self._linha_serial = ""
                elif self._linha_serial:
                    linha = self._linha_serial
                    self._linha_serial = ""
                    self.processar_linha(linha)
            elif self._descartando_linha_serial:
                continue
            elif len(self._linha_serial) < self.TAMANHO_LINHA_SERIAL:
                self._linha_serial += caractere
            else:
                self._linha_serial = ""
                self._descartando_linha_serial = True
                self._emitir("ERRO:LINHA_LONGA")
        return self.saida_serial[inicio:]

    def telemetria(self) -> str:
        distancia = (
            "ERR" if self.distancia_atual_cm is None else f"{self.distancia_atual_cm:.1f}"
        )
        return (
            f"QT|MODE:{int(self.modo)}|DIST:{distancia}"
            f"|CMD:{self.comando_aplicado.value}"
            f"|STATE:{self.estado_operacional.value}"
        )

    def executar_desvio_completo(self, distancia_obstaculo: float = 4.0) -> None:
        self.ler_sensor(100)
        self.ler_sensor(100)
        self.ler_sensor(distancia_obstaculo)
        self.ler_sensor(distancia_obstaculo)
        self.ler_sensor(distancia_obstaculo)
        self.avancar_tempo(self.TEMPO_PAUSA_MS)
        self.avancar_tempo(self.TEMPO_RE_MS)
        self.avancar_tempo(self.TEMPO_PAUSA_MS)
        self.avancar_tempo(self.TEMPO_CURVA_MS)
        self.ler_sensor(100)
        self.ler_sensor(100)
        self.avancar_tempo(10)


def demonstracao() -> None:
    robo = SimuladorRobo()
    robo.executar_desvio_completo()
    for tempo, modo, desvio, comando, motores in robo.historico:
        print(
            f"{tempo:5d} ms | M{int(modo)} | {desvio.value:14s} | "
            f"{comando.value:8s} | IN1..IN4="
            f"{motores.in1}{motores.in2}{motores.in3}{motores.in4}"
        )


if __name__ == "__main__":
    demonstracao()
