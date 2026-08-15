from __future__ import annotations

import re
import unittest
from pathlib import Path

from .simulador_robo import (
    CURVA_DIREITA,
    CURVA_ESQUERDA,
    FRENTE,
    PARADO,
    Estado,
    SimuladorRobo,
)


class TesteEtapa1(unittest.TestCase):
    def test_caminho_livre_mantem_frente(self) -> None:
        robo = SimuladorRobo()
        for _ in range(100):
            robo.ler_sensor([80, 81, 79])
            robo.avancar_tempo(50)
        self.assertEqual(robo.estado, Estado.FRENTE)
        self.assertEqual(robo.motores, FRENTE)
        self.assertEqual(robo.quantidade_desvios, 0)

    def test_ruido_isolado_nao_causa_desvio(self) -> None:
        robo = SimuladorRobo()
        robo.ler_sensor([10, 100, 100])
        self.assertEqual(robo.estado, Estado.FRENTE)

    def test_sem_eco_nao_inventa_obstaculo(self) -> None:
        robo = SimuladorRobo()
        robo.ler_sensor([0, 0, 0])
        self.assertEqual(robo.estado, Estado.FRENTE)

    def test_obstaculo_exige_duas_de_tres_leituras(self) -> None:
        self.assertTrue(SimuladorRobo.obstaculo_confirmado([10, 12, 100]))
        self.assertFalse(SimuladorRobo.obstaculo_confirmado([10, 100, 100]))

    def test_sequencia_completa_de_desvio(self) -> None:
        robo = SimuladorRobo()
        robo.ler_sensor([15, 14, 16])
        self.assertEqual((robo.estado, robo.motores), (Estado.PAUSA_ANTES_CURVA, PARADO))

        robo.avancar_tempo(120)
        self.assertEqual((robo.estado, robo.motores), (Estado.CURVANDO, CURVA_DIREITA))

        robo.avancar_tempo(800)
        self.assertEqual((robo.estado, robo.motores), (Estado.FRENTE, FRENTE))

    def test_curvas_alternam_direita_e_esquerda(self) -> None:
        robo = SimuladorRobo()
        robo.executar_desvio_completo()
        robo.ler_sensor([10, 11, 12])
        robo.avancar_tempo(120)
        self.assertEqual(robo.motores, CURVA_ESQUERDA)

    def test_curva_aumenta_quando_bloqueio_repete(self) -> None:
        robo = SimuladorRobo()
        robo.executar_desvio_completo()
        robo.ler_sensor([10, 11, 12])
        self.assertEqual(robo.tempo_da_curva_ms(), 980)

    def test_cinco_desvios_rapidos_param_por_seguranca(self) -> None:
        robo = SimuladorRobo()
        for _ in range(4):
            robo.executar_desvio_completo()
        robo.ler_sensor([10, 11, 12])
        self.assertEqual(robo.quantidade_desvios, 5)
        self.assertEqual((robo.estado, robo.motores), (Estado.PARADO_SEGURANCA, PARADO))

    def test_janela_expirada_reinicia_contagem(self) -> None:
        robo = SimuladorRobo()
        for _ in range(4):
            robo.executar_desvio_completo()
        robo.avancar_tempo(16_000)
        robo.ler_sensor([10, 11, 12])
        self.assertEqual(robo.quantidade_desvios, 1)
        self.assertEqual(robo.estado, Estado.PAUSA_ANTES_CURVA)

    def test_janela_e_movel_e_nao_depende_do_boot(self) -> None:
        robo = SimuladorRobo()
        robo.avancar_tempo(14_000)
        for _ in range(4):
            robo.executar_desvio_completo()
        robo.ler_sensor([10, 11, 12])
        self.assertEqual(robo.estado, Estado.PARADO_SEGURANCA)

    def test_simulador_permanece_sincronizado_com_constantes_do_sketch(self) -> None:
        sketch = (
            Path(__file__).parents[1]
            / "quantum_tracker_arduino"
            / "quantum_tracker_arduino.ino"
        ).read_text(encoding="utf-8")
        esperados = {
            "IN1": 7,
            "IN2": 6,
            "IN3": 5,
            "IN4": 4,
            "TRIG": 3,
            "ECHO": 2,
            "DISTANCIA_OBSTACULO_CM": 20,
            "TEMPO_PARADO_MS": 120,
            "TEMPO_CURVA_BASE_MS": 800,
            "AUMENTO_CURVA_MS": 180,
            "LIMITE_DESVIOS": 5,
        }
        for nome, valor in esperados.items():
            padrao = rf"const\s+[^;=]+\s+{nome}\s*=\s*{valor}\s*;"
            self.assertRegex(sketch, re.compile(padrao), nome)


if __name__ == "__main__":
    unittest.main(verbosity=2)
