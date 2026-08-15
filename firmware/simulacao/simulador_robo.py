"""Simulador deterministico da Etapa 1 do Quantum Tracker.

Este modulo reproduz a maquina de estados do sketch Arduino sem acessar portas
seriais, motores, sensor ou qualquer outro hardware.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum, auto


class Estado(Enum):
    FRENTE = auto()
    PAUSA_ANTES_CURVA = auto()
    CURVANDO = auto()
    PARADO_SEGURANCA = auto()


@dataclass(frozen=True)
class SaidaMotores:
    in1: int
    in2: int
    in3: int
    in4: int


PARADO = SaidaMotores(0, 0, 0, 0)
FRENTE = SaidaMotores(1, 0, 1, 0)
CURVA_DIREITA = SaidaMotores(1, 0, 0, 1)
CURVA_ESQUERDA = SaidaMotores(0, 1, 1, 0)


class SimuladorRobo:
    DISTANCIA_OBSTACULO_CM = 20
    TEMPO_PARADO_MS = 120
    TEMPO_CURVA_BASE_MS = 800
    AUMENTO_CURVA_MS = 180
    JANELA_DESVIOS_MS = 15_000
    LIMITE_DESVIOS = 5

    def __init__(self) -> None:
        self.agora_ms = 0
        self.estado_desde_ms = 0
        self.tempos_desvios_ms: list[int] = []
        self.proxima_curva_direita = True
        self.estado = Estado.FRENTE
        self.motores = FRENTE
        self.historico: list[tuple[int, Estado, SaidaMotores]] = []
        self._registrar()

    @classmethod
    def obstaculo_confirmado(cls, leituras_cm: list[int]) -> bool:
        """Aceita obstaculo somente quando 2 de 3 leituras estao entre 2 e 20 cm."""
        if len(leituras_cm) != 3:
            raise ValueError("sao necessarias exatamente tres leituras")
        perto = sum(2 <= valor <= cls.DISTANCIA_OBSTACULO_CM for valor in leituras_cm)
        return perto >= 2

    def _registrar(self) -> None:
        registro = (self.agora_ms, self.estado, self.motores)
        if not self.historico or self.historico[-1] != registro:
            self.historico.append(registro)

    def _mudar(self, estado: Estado, motores: SaidaMotores) -> None:
        self.estado = estado
        self.motores = motores
        self.estado_desde_ms = self.agora_ms
        self._registrar()

    def _registrar_desvio(self) -> bool:
        self.tempos_desvios_ms = [
            tempo
            for tempo in self.tempos_desvios_ms
            if self.agora_ms - tempo <= self.JANELA_DESVIOS_MS
        ]
        self.tempos_desvios_ms.append(self.agora_ms)
        return len(self.tempos_desvios_ms) >= self.LIMITE_DESVIOS

    def ler_sensor(self, leituras_cm: list[int]) -> None:
        """Injeta tres leituras simuladas do HC-SR04 no estado atual."""
        if self.estado != Estado.FRENTE:
            return
        self.motores = FRENTE
        if self.obstaculo_confirmado(leituras_cm):
            if self._registrar_desvio():
                self._mudar(Estado.PARADO_SEGURANCA, PARADO)
            else:
                self._mudar(Estado.PAUSA_ANTES_CURVA, PARADO)

    def tempo_da_curva_ms(self) -> int:
        return self.TEMPO_CURVA_BASE_MS + (len(self.tempos_desvios_ms) - 1) * self.AUMENTO_CURVA_MS

    @property
    def quantidade_desvios(self) -> int:
        return len(self.tempos_desvios_ms)

    def avancar_tempo(self, milissegundos: int) -> None:
        """Avanca o relogio e executa todas as transicoes temporizadas vencidas."""
        if milissegundos < 0:
            raise ValueError("o tempo nao pode ser negativo")
        self.agora_ms += milissegundos

        mudou = True
        while mudou:
            mudou = False
            decorrido = self.agora_ms - self.estado_desde_ms

            if self.estado == Estado.PAUSA_ANTES_CURVA and decorrido >= self.TEMPO_PARADO_MS:
                curva = CURVA_DIREITA if self.proxima_curva_direita else CURVA_ESQUERDA
                self._mudar(Estado.CURVANDO, curva)
                mudou = True
            elif self.estado == Estado.CURVANDO and decorrido >= self.tempo_da_curva_ms():
                self.proxima_curva_direita = not self.proxima_curva_direita
                self._mudar(Estado.FRENTE, FRENTE)
                mudou = True

    def executar_desvio_completo(self, leituras_cm: list[int] | None = None) -> None:
        leituras = leituras_cm or [10, 12, 11]
        self.ler_sensor(leituras)
        if self.estado == Estado.PARADO_SEGURANCA:
            return
        self.avancar_tempo(self.TEMPO_PARADO_MS)
        self.avancar_tempo(self.tempo_da_curva_ms())


def demonstracao() -> None:
    robo = SimuladorRobo()
    robo.ler_sensor([100, 100, 100])
    robo.executar_desvio_completo([15, 14, 16])

    for tempo, estado, motores in robo.historico:
        print(
            f"{tempo:5d} ms | {estado.name:18s} | "
            f"IN1..IN4={motores.in1}{motores.in2}{motores.in3}{motores.in4}"
        )


if __name__ == "__main__":
    demonstracao()
