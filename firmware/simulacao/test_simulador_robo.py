from __future__ import annotations

import re
import unittest
from pathlib import Path

from .simulador_robo import (
    CURVA_DIREITA, CURVA_ESQUERDA, FRENTE, GIRO, PARADO, TRAS,
    Comando, EstadoDesvio, EstadoOperacional, Modo, SimuladorRobo,
)


def preparar_caminho_livre(robo: SimuladorRobo) -> None:
    robo.ler_sensor(100)
    robo.ler_sensor(100)


def confirmar_obstaculo(robo: SimuladorRobo, distancia: float = 4.0) -> None:
    robo.ler_sensor(distancia)  # para imediatamente e abre confirmação
    robo.ler_sensor(distancia)
    robo.ler_sensor(distancia)


class TesteFirmwareIntegradoV6(unittest.TestCase):
    def test_boot_fica_parado_ate_duas_leituras_validas(self) -> None:
        robo = SimuladorRobo()
        robo.ler_sensor(100)
        self.assertEqual(robo.motores, PARADO)
        self.assertEqual(robo.estado_operacional, EstadoOperacional.SENSOR_FAIL)
        robo.ler_sensor(100)
        self.assertEqual(robo.motores, FRENTE)

    def test_autonomo_nao_possui_timeout_de_missao(self) -> None:
        robo = SimuladorRobo()
        preparar_caminho_livre(robo)
        robo.avancar_tempo(3_600_000)
        self.assertEqual(robo.motores, FRENTE)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)

    def test_primeira_leitura_proxima_para_antes_da_confirmacao(self) -> None:
        robo = SimuladorRobo()
        preparar_caminho_livre(robo)
        robo.ler_sensor(4)
        self.assertEqual(robo.motores, PARADO)
        self.assertTrue(robo.confirmando_obstaculo)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)

    def test_pico_isolado_nao_dispara_re(self) -> None:
        robo = SimuladorRobo()
        preparar_caminho_livre(robo)
        robo.ler_sensor(4)
        robo.ler_sensor(100)
        robo.ler_sensor(100)
        self.assertEqual(robo.motores, FRENTE)
        self.assertNotIn(TRAS, [registro[-1] for registro in robo.historico])

    def test_sequencia_aprovada_do_desvio(self) -> None:
        robo = SimuladorRobo()
        preparar_caminho_livre(robo)
        confirmar_obstaculo(robo)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.PAUSA_INICIAL, PARADO))
        robo.avancar_tempo(150)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.RE, TRAS))
        robo.avancar_tempo(400)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.PAUSA_RE, PARADO))
        robo.avancar_tempo(150)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.CURVA, CURVA_DIREITA))
        robo.avancar_tempo(650)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.PAUSA_CURVA, PARADO))
        robo.ler_sensor(100)
        robo.ler_sensor(100)
        robo.avancar_tempo(10)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.INATIVO, FRENTE))

    def test_curvas_de_novos_desvios_alternam(self) -> None:
        robo = SimuladorRobo()
        robo.executar_desvio_completo()
        confirmar_obstaculo(robo)
        robo.avancar_tempo(150 + 400 + 150)
        self.assertEqual(robo.motores, CURVA_ESQUERDA)

    def test_obstaculo_persistente_prolonga_curva_sem_segunda_re(self) -> None:
        robo = SimuladorRobo()
        preparar_caminho_livre(robo)
        confirmar_obstaculo(robo)
        robo.avancar_tempo(150 + 400 + 150 + 650)
        robo.ler_sensor(4)
        robo.ler_sensor(4)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.CURVA)
        self.assertEqual(robo.motores, CURVA_DIREITA)
        self.assertIn("EVENTO:CURVA_CONTINUA", robo.saida_serial)
        comandos = [registro[3] for registro in robo.historico]
        self.assertEqual(comandos.count(Comando.TRAS), 1)

    def test_sem_echo_interrompe_movimento_e_manobra(self) -> None:
        for estado in EstadoDesvio:
            with self.subTest(estado=estado.value):
                robo = SimuladorRobo()
                preparar_caminho_livre(robo)
                robo.estado_desvio = estado
                robo.ler_sensor(None)
                self.assertEqual(robo.motores, PARADO)
                self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)

    def test_recuperacao_exige_duas_leituras_novas(self) -> None:
        robo = SimuladorRobo()
        preparar_caminho_livre(robo)
        robo.ler_sensor(None)
        robo.ler_sensor(100)
        self.assertEqual(robo.motores, PARADO)
        robo.ler_sensor(100)
        self.assertEqual(robo.motores, FRENTE)

    def test_timeout_para_modos_remotos(self) -> None:
        for modo in (2, 3):
            with self.subTest(modo=modo):
                robo = SimuladorRobo()
                preparar_caminho_livre(robo)
                robo.processar_linha(f"MODE:{modo}")
                robo.processar_linha("CMD:FRENTE")
                robo.avancar_tempo(1501)
                self.assertEqual(robo.motores, PARADO)
                self.assertEqual(robo.estado_operacional, EstadoOperacional.LINK_WAIT)

    def test_ping_nao_renova_comando(self) -> None:
        robo = SimuladorRobo()
        preparar_caminho_livre(robo)
        robo.processar_linha("MODE:3")
        robo.processar_linha("CMD:FRENTE")
        robo.avancar_tempo(1000)
        self.assertEqual(robo.processar_linha("PING"), ["PONG"])
        robo.avancar_tempo(501)
        self.assertEqual(robo.motores, PARADO)

    def test_estop_supera_todos_os_estados(self) -> None:
        for estado in EstadoDesvio:
            with self.subTest(estado=estado.value):
                robo = SimuladorRobo()
                preparar_caminho_livre(robo)
                robo.estado_desvio = estado
                self.assertEqual(robo.processar_linha("ESTOP"), ["OK:ESTOP"])
                self.assertEqual(robo.motores, PARADO)
                self.assertEqual(robo.estado_operacional, EstadoOperacional.ESTOP)

    def test_comandos_remotos_e_polaridades(self) -> None:
        esperado = {
            "FRENTE": FRENTE, "TRAS": TRAS, "DIREITA": CURVA_DIREITA,
            "ESQUERDA": CURVA_ESQUERDA, "GIRAR": GIRO, "PARAR": PARADO,
        }
        for nome, saida in esperado.items():
            with self.subTest(comando=nome):
                robo = SimuladorRobo()
                preparar_caminho_livre(robo)
                robo.processar_linha("MODE:3")
                robo.processar_linha(f"CMD:{nome}")
                self.assertEqual(robo.motores, saida)

    def test_parser_descarta_linha_longa_inteira(self) -> None:
        robo = SimuladorRobo()
        preparar_caminho_livre(robo)
        robo.processar_linha("MODE:3")
        self.assertEqual(robo.receber_bytes("X" * 34 + "CMD:FRENTE\n"), ["ERRO:LINHA_LONGA"])
        self.assertEqual(robo.motores, PARADO)
        self.assertEqual(robo.receber_bytes("CMD:FRENTE\n"), ["OK:CMD:FRENTE"])
        self.assertEqual(robo.motores, FRENTE)

    def test_protocolo_e_telemetria_v6(self) -> None:
        robo = SimuladorRobo()
        self.assertEqual(robo.processar_linha("HELLO"), ["QT:READY:V6"])
        preparar_caminho_livre(robo)
        self.assertEqual(
            robo.processar_linha("STATUS"),
            ["QT|MODE:1|DIST:100.0|CMD:FRENTE|STATE:AUTONOMO"],
        )

    def test_quinhentos_ciclos_de_obstaculo_nao_travam(self) -> None:
        robo = SimuladorRobo()
        for _ in range(500):
            robo.executar_desvio_completo()
            self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)
            self.assertEqual(robo.motores, FRENTE)
            self.assertFalse(robo.parada_emergencia)
        self.assertEqual(robo.quantidade_desvios, 500)

    def test_simulador_permanece_sincronizado_com_sketch(self) -> None:
        sketch = (
            Path(__file__).parents[1] / "quantum_tracker_arduino"
            / "quantum_tracker_arduino.ino"
        ).read_text(encoding="utf-8")
        esperados = {
            "IN1": 7, "IN2": 6, "IN3": 5, "IN4": 4, "TRIG": 3, "ECHO": 2,
            "DISTANCIA_OBSTACULO_CM": 5.0, "INTERVALO_SENSOR_MS": 80,
            "TIMEOUT_COMANDO_MS": 1500, "JANELA_COMANDO_INICIAL_MS": 750,
            "TEMPO_PAUSA_MS": 150, "TEMPO_RE_MS": 400,
            "TEMPO_CURVA_MS": 650, "LEITURAS_CONFIRMACAO": 2,
        }
        for nome, valor in esperados.items():
            padrao = rf"const\s+[^;=]+\s+{nome}\s*=\s*{re.escape(str(valor))}(?:UL)?\s*;"
            self.assertRegex(sketch, re.compile(padrao), nome)
        compacto = re.sub(r"\s+", "", sketch)
        for chamada in (
            "aplicarMotores(LOW,LOW,LOW,LOW)",
            "aplicarMotores(LOW,HIGH,LOW,HIGH)",
            "aplicarMotores(HIGH,LOW,HIGH,LOW)",
            "aplicarMotores(LOW,HIGH,LOW,LOW)",
            "aplicarMotores(LOW,LOW,LOW,HIGH)",
            "aplicarMotores(LOW,HIGH,HIGH,LOW)",
        ):
            self.assertIn(chamada, compacto)


if __name__ == "__main__":
    unittest.main(verbosity=2)
