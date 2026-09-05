"""Arena 2D exploratoria; nao certifica o desvio fisico da Etapa 1.

Limitacao conhecida: curvas ainda rotacionam o centro do modelo, enquanto a
montagem aprovada faz arco com uma roda parada. Os cenarios com colisao sao
mantidos como falhas de qualificacao, nao como aprovacao para uso no piso.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import cos, hypot, inf, radians, sin

from .simulador_robo import (
    CURVA_DIREITA,
    CURVA_ESQUERDA,
    FRENTE,
    GIRO,
    PARADO,
    TRAS,
    SimuladorRobo,
)


@dataclass(frozen=True)
class Retangulo:
    x: float
    y: float
    largura: float
    altura: float

    @property
    def esquerda(self) -> float:
        return self.x

    @property
    def direita(self) -> float:
        return self.x + self.largura

    @property
    def topo(self) -> float:
        return self.y

    @property
    def base(self) -> float:
        return self.y + self.altura


@dataclass
class Arena:
    largura: float = 400.0
    altura: float = 300.0
    obstaculos: list[Retangulo] = field(default_factory=list)


@dataclass
class ResultadoArena:
    duracao_s: float
    distancia_percorrida_cm: float
    menor_distancia_cm: float
    desvios: int
    colisoes: int
    terminou_em_seguranca: bool
    posicao_final: tuple[float, float]
    angulo_final_graus: float


def _distancia_raio_retangulo(
    origem_x: float,
    origem_y: float,
    direcao_x: float,
    direcao_y: float,
    retangulo: Retangulo,
) -> float:
    """Distancia do raio ate um retangulo usando intersecao slab."""
    minimo = -inf
    maximo = inf

    for origem, direcao, baixo, alto in (
        (origem_x, direcao_x, retangulo.esquerda, retangulo.direita),
        (origem_y, direcao_y, retangulo.topo, retangulo.base),
    ):
        if abs(direcao) < 1e-9:
            if origem < baixo or origem > alto:
                return inf
            continue
        t1 = (baixo - origem) / direcao
        t2 = (alto - origem) / direcao
        minimo = max(minimo, min(t1, t2))
        maximo = min(maximo, max(t1, t2))
        if maximo < minimo:
            return inf

    if maximo < 0:
        return inf
    return max(0.0, minimo)


def _circulo_intersecta_retangulo(
    centro_x: float,
    centro_y: float,
    raio: float,
    retangulo: Retangulo,
) -> bool:
    proximo_x = min(max(centro_x, retangulo.esquerda), retangulo.direita)
    proximo_y = min(max(centro_y, retangulo.topo), retangulo.base)
    return hypot(centro_x - proximo_x, centro_y - proximo_y) <= raio


class RoboNaArena:
    """Modelo cinematico simples; nao representa eletrica, atrito ou bateria."""

    RAIO_CM = 9.0
    VELOCIDADE_CM_S = 24.0
    VELOCIDADE_ANGULAR_GRAUS_S = 105.0
    ALCANCE_SENSOR_CM = 400.0
    ANGULOS_FEIXE_GRAUS = (-15.0, -7.5, 0.0, 7.5, 15.0)

    def __init__(
        self,
        arena: Arena,
        x: float = 50.0,
        y: float = 150.0,
        angulo_graus: float = 0.0,
    ) -> None:
        self.arena = arena
        self.x = x
        self.y = y
        self.angulo_graus = angulo_graus
        self.controle = SimuladorRobo()
        self.distancia_percorrida_cm = 0.0
        self.menor_distancia_cm = self.ALCANCE_SENSOR_CM
        self.colisoes = 0
        self.proxima_leitura_sensor_ms = 0

    def iniciar_autonomo(self) -> None:
        """Representa a escolha/liberacao explicita do Modo 1 pelo operador."""
        self.controle.processar_linha("MODE:1")
        self.controle.processar_linha("RESET_ESTOP")

    def parar(self) -> None:
        self.controle.processar_linha("ESTOP")

    def _paredes_como_retangulos(self) -> tuple[Retangulo, ...]:
        espessura = 1.0
        return (
            Retangulo(-espessura, -espessura, self.arena.largura + 2 * espessura, espessura),
            Retangulo(-espessura, self.arena.altura, self.arena.largura + 2 * espessura, espessura),
            Retangulo(-espessura, 0.0, espessura, self.arena.altura),
            Retangulo(self.arena.largura, 0.0, espessura, self.arena.altura),
        )

    def medir_distancia_cm(self) -> float:
        """Simula o menor retorno dentro de um cone frontal de 30 graus."""
        cabecalho = radians(self.angulo_graus)
        nariz_x = self.x + cos(cabecalho) * self.RAIO_CM
        nariz_y = self.y + sin(cabecalho) * self.RAIO_CM
        menor = self.ALCANCE_SENSOR_CM
        alvos = [*self.arena.obstaculos, *self._paredes_como_retangulos()]

        for deslocamento in self.ANGULOS_FEIXE_GRAUS:
            angulo = radians(self.angulo_graus + deslocamento)
            direcao_x = cos(angulo)
            direcao_y = sin(angulo)
            for alvo in alvos:
                distancia = _distancia_raio_retangulo(
                    nariz_x, nariz_y, direcao_x, direcao_y, alvo
                )
                if 0.0 <= distancia < menor:
                    menor = distancia

        self.menor_distancia_cm = min(self.menor_distancia_cm, menor)
        return min(menor, self.ALCANCE_SENSOR_CM)

    def _colidiria(self, x: float, y: float) -> bool:
        if (
            x - self.RAIO_CM <= 0
            or x + self.RAIO_CM >= self.arena.largura
            or y - self.RAIO_CM <= 0
            or y + self.RAIO_CM >= self.arena.altura
        ):
            return True
        return any(
            _circulo_intersecta_retangulo(x, y, self.RAIO_CM, obstaculo)
            for obstaculo in self.arena.obstaculos
        )

    def passo(self, intervalo_ms: int = 20) -> None:
        # O firmware consulta o sensor a cada 80 ms em qualquer modo/estado.
        if self.controle.agora_ms >= self.proxima_leitura_sensor_ms:
            distancia = self.medir_distancia_cm()
            self.controle.ler_sensor(distancia)
            self.proxima_leitura_sensor_ms = (
                self.controle.agora_ms + self.controle.INTERVALO_SENSOR_MS
            )

        segundos = intervalo_ms / 1000.0
        motores = self.controle.motores

        if motores in (FRENTE, TRAS):
            angulo = radians(self.angulo_graus)
            sentido = 1.0 if motores == FRENTE else -1.0
            deslocamento = sentido * self.VELOCIDADE_CM_S * segundos
            novo_x = self.x + cos(angulo) * deslocamento
            novo_y = self.y + sin(angulo) * deslocamento
            if self._colidiria(novo_x, novo_y):
                self.colisoes += 1
                self.controle.processar_linha("ESTOP")
            else:
                self.x = novo_x
                self.y = novo_y
                self.distancia_percorrida_cm += abs(deslocamento)
        elif motores == CURVA_DIREITA:
            self.angulo_graus -= self.VELOCIDADE_ANGULAR_GRAUS_S * segundos
        elif motores == CURVA_ESQUERDA:
            self.angulo_graus += self.VELOCIDADE_ANGULAR_GRAUS_S * segundos
        elif motores == GIRO:
            self.angulo_graus -= 2 * self.VELOCIDADE_ANGULAR_GRAUS_S * segundos

        self.angulo_graus %= 360.0
        self.controle.avancar_tempo(intervalo_ms)

    def executar(self, duracao_s: float, intervalo_ms: int = 20) -> ResultadoArena:
        passos = int(duracao_s * 1000 / intervalo_ms)
        for _ in range(passos):
            self.passo(intervalo_ms)
            if self.colisoes:
                break

        return ResultadoArena(
            duracao_s=self.controle.agora_ms / 1000.0,
            distancia_percorrida_cm=self.distancia_percorrida_cm,
            menor_distancia_cm=self.menor_distancia_cm,
            desvios=self.controle.quantidade_desvios,
            colisoes=self.colisoes,
            terminou_em_seguranca=(
                self.controle.parada_emergencia or not self.controle.sensor_seguro
            ),
            posicao_final=(self.x, self.y),
            angulo_final_graus=self.angulo_graus,
        )


def cenarios_padrao() -> dict[str, tuple[Arena, tuple[float, float, float]]]:
    return {
        "parede_frontal": (
            Arena(obstaculos=[Retangulo(180, 30, 12, 240)]),
            (50, 150, 0),
        ),
        "objeto_pequeno": (
            Arena(obstaculos=[Retangulo(170, 140, 18, 20)]),
            (50, 150, 0),
        ),
        "multiplos_obstaculos": (
            Arena(
                obstaculos=[
                    Retangulo(145, 95, 25, 110),
                    Retangulo(245, 15, 25, 105),
                    Retangulo(245, 180, 25, 105),
                    Retangulo(330, 100, 20, 100),
                ]
            ),
            (50, 150, 0),
        ),
        "corredor_com_barreira": (
            Arena(
                obstaculos=[
                    Retangulo(40, 70, 260, 10),
                    Retangulo(40, 220, 260, 10),
                    Retangulo(240, 80, 10, 100),
                ]
            ),
            (70, 150, 0),
        ),
    }


def demonstracao() -> None:
    for nome, (arena, pose) in cenarios_padrao().items():
        robo = RoboNaArena(arena, *pose)
        robo.iniciar_autonomo()
        resultado = robo.executar(30)
        print(
            f"{nome:24s} | colisoes={resultado.colisoes} "
            f"desvios={resultado.desvios} distancia={resultado.distancia_percorrida_cm:.1f} cm "
            f"seguranca={resultado.terminou_em_seguranca}"
        )


if __name__ == "__main__":
    demonstracao()
