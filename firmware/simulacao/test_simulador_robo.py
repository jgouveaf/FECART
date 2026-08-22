from __future__ import annotations

import re
import unittest
from pathlib import Path

from .simulador_robo import (
    CURVA_DIREITA,
    CURVA_ESQUERDA,
    FRENTE,
    GIRO,
    PARADO,
    TRAS,
    Comando,
    EstadoDesvio,
    EstadoOperacional,
    Modo,
    SimuladorRobo,
)


class TesteFirmwareIntegrado(unittest.TestCase):
    def test_modo_autonomo_mantem_frente_em_caminho_livre(self) -> None:
        robo = SimuladorRobo()
        for _ in range(20):
            robo.ler_sensor(80)
            robo.avancar_tempo(80)
        self.assertEqual(robo.modo, Modo.AUTONOMO)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)
        self.assertEqual(robo.motores, FRENTE)
        self.assertEqual(robo.quantidade_desvios, 0)

    def test_obstaculo_exige_duas_leituras_consecutivas(self) -> None:
        robo = SimuladorRobo()
        robo.ler_sensor(10)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)
        robo.ler_sensor(100)
        robo.ler_sensor(10)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)
        robo.ler_sensor(12)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.PAUSA_INICIAL)
        self.assertEqual(robo.motores, PARADO)

    def test_sequencia_e_tempos_completos_do_desvio(self) -> None:
        robo = SimuladorRobo()
        robo.ler_sensor(15)
        robo.ler_sensor(15)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.PAUSA_INICIAL, PARADO))

        robo.avancar_tempo(200)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.RE, TRAS))
        robo.ler_sensor(50)

        robo.avancar_tempo(700)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.PAUSA_RE, PARADO))
        robo.avancar_tempo(150)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.CURVA, CURVA_DIREITA))
        robo.avancar_tempo(900)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.PAUSA_CURVA, PARADO))
        robo.avancar_tempo(150)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.SAIDA, FRENTE))
        robo.avancar_tempo(600)
        self.assertEqual((robo.estado_desvio, robo.motores), (EstadoDesvio.INATIVO, FRENTE))

    def test_curvas_alternam_direita_e_esquerda(self) -> None:
        robo = SimuladorRobo()
        robo.executar_desvio_completo()
        robo.ler_sensor(10)
        robo.ler_sensor(10)
        robo.avancar_tempo(200)
        robo.ler_sensor(50)
        robo.avancar_tempo(700 + 150)
        self.assertEqual(robo.motores, CURVA_ESQUERDA)

    def test_cinco_obstaculos_em_quinze_segundos_ativam_estop(self) -> None:
        robo = SimuladorRobo()
        for _ in range(5):
            robo.executar_desvio_completo()
        self.assertEqual(robo.quantidade_obstaculos, 5)
        self.assertTrue(robo.parada_emergencia)
        self.assertEqual(robo.motores, PARADO)
        self.assertIn("ALERTA:5_OBSTACULOS", robo.saida_serial)

    def test_janela_de_obstaculos_expirada_reinicia_contagem(self) -> None:
        robo = SimuladorRobo()
        for _ in range(4):
            robo.executar_desvio_completo()
        robo.avancar_tempo(15_010)
        robo.ler_sensor(10)
        robo.ler_sensor(10)
        self.assertFalse(robo.parada_emergencia)
        self.assertEqual(robo.quantidade_obstaculos, 1)

    def test_ping_responde_mas_nao_renova_comando_antigo(self) -> None:
        robo = SimuladorRobo()
        robo.processar_linha("MODE:2")
        robo.processar_linha("CMD:FRENTE")
        robo.avancar_tempo(1_000)
        self.assertEqual(robo.processar_linha("PING"), ["PONG"])
        robo.avancar_tempo(510)
        self.assertEqual(robo.comando_recebido, Comando.PARAR)
        self.assertEqual(robo.motores, PARADO)

    def test_hello_identifica_firmware_sem_depender_de_reset(self) -> None:
        robo = SimuladorRobo()
        self.assertEqual(robo.processar_linha("HELLO"), ["QT:READY:V3"])

    def test_novo_cmd_renova_validade(self) -> None:
        robo = SimuladorRobo()
        robo.processar_linha("MODE:3")
        robo.processar_linha("CMD:FRENTE")
        robo.avancar_tempo(1_000)
        robo.processar_linha("CMD:FRENTE")
        robo.avancar_tempo(1_000)
        self.assertEqual(robo.motores, FRENTE)

    def test_sensor_trava_apos_cinco_falhas_e_exige_tres_validas(self) -> None:
        robo = SimuladorRobo()
        for _ in range(5):
            robo.ler_sensor(None)
        self.assertTrue(robo.sensor_bloqueado)
        self.assertEqual(robo.estado_operacional, EstadoOperacional.SENSOR_FAIL)
        self.assertEqual(robo.motores, PARADO)

        robo.ler_sensor(100)
        robo.ler_sensor(100)
        self.assertTrue(robo.sensor_bloqueado)
        self.assertEqual(robo.motores, PARADO)
        robo.ler_sensor(100)
        self.assertFalse(robo.sensor_bloqueado)
        self.assertEqual(robo.motores, FRENTE)
        self.assertIn("EVENTO:SENSOR_RECUPERADO", robo.saida_serial)

    def test_nova_falha_zera_recuperacao_do_sensor(self) -> None:
        robo = SimuladorRobo()
        for _ in range(5):
            robo.ler_sensor(None)
        robo.ler_sensor(100)
        robo.ler_sensor(100)
        robo.ler_sensor(None)
        robo.ler_sensor(100)
        self.assertTrue(robo.sensor_bloqueado)
        self.assertEqual(robo.leituras_validas_recuperacao, 1)

    def test_obstaculo_bloqueia_frente_curvas_e_giro_nos_modos_remotos(self) -> None:
        for comando in (
            Comando.FRENTE,
            Comando.DIREITA,
            Comando.ESQUERDA,
            Comando.GIRAR,
        ):
            with self.subTest(comando=comando.value):
                robo = SimuladorRobo()
                robo.processar_linha("MODE:3")
                robo.processar_linha(f"CMD:{comando.value}")
                robo.ler_sensor(10)
                robo.ler_sensor(10)
                self.assertEqual(robo.estado_desvio, EstadoDesvio.PAUSA_INICIAL)
                self.assertEqual(robo.motores, PARADO)

    def test_re_e_parar_continuam_permitidos_com_obstaculo(self) -> None:
        robo = SimuladorRobo()
        robo.processar_linha("MODE:3")
        robo.processar_linha("CMD:TRAS")
        robo.ler_sensor(10)
        robo.ler_sensor(10)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)
        self.assertEqual(robo.motores, TRAS)
        robo.processar_linha("CMD:PARAR")
        self.assertEqual(robo.motores, PARADO)

    def test_re_remota_cancela_desvio_ativo_sem_furar_modo_autonomo(self) -> None:
        robo = SimuladorRobo()
        robo.processar_linha("MODE:2")
        robo.processar_linha("CMD:FRENTE")
        robo.ler_sensor(10)
        robo.ler_sensor(10)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.PAUSA_INICIAL)
        robo.processar_linha("CMD:TRAS")
        self.assertEqual(robo.estado_desvio, EstadoDesvio.INATIVO)
        self.assertEqual(robo.motores, TRAS)

        autonomo = SimuladorRobo()
        autonomo.processar_linha("CMD:TRAS")
        self.assertEqual(autonomo.modo, Modo.AUTONOMO)
        self.assertEqual(autonomo.motores, FRENTE)

    def test_obstaculo_durante_curva_interrompe_e_reinicia_desvio(self) -> None:
        robo = SimuladorRobo()
        robo.ler_sensor(10)
        robo.ler_sensor(10)
        robo.avancar_tempo(200)
        robo.ler_sensor(50)
        robo.avancar_tempo(700 + 150)
        self.assertEqual(robo.motores, CURVA_DIREITA)

        robo.ler_sensor(8)
        robo.ler_sensor(8)
        self.assertEqual(robo.estado_desvio, EstadoDesvio.PAUSA_INICIAL)
        self.assertEqual(robo.motores, PARADO)
        self.assertEqual(robo.quantidade_obstaculos, 2)

    def test_modos_e_estop_preservam_protocolo(self) -> None:
        robo = SimuladorRobo()
        self.assertEqual(robo.saida_serial[:2], ["QT:READY:V3", "OK:MODE:1"])
        self.assertEqual(robo.processar_linha("MODE:2"), ["OK:MODE:2"])
        self.assertEqual(robo.processar_linha("CMD:DIREITA"), ["OK:CMD:DIREITA"])
        self.assertEqual(robo.motores, CURVA_DIREITA)
        self.assertEqual(robo.processar_linha("ESTOP"), ["OK:ESTOP"])
        self.assertEqual(robo.motores, PARADO)
        self.assertEqual(robo.processar_linha("RESET_ESTOP"), ["OK:RESET_ESTOP"])
        self.assertEqual(robo.motores, PARADO)

    def test_telemetria_permanece_compativel(self) -> None:
        robo = SimuladorRobo()
        robo.ler_sensor(123.45)
        resposta = robo.processar_linha("STATUS")
        self.assertEqual(
            resposta,
            ["QT|MODE:1|DIST:123.5|CMD:FRENTE|STATE:AUTONOMO"],
        )
        for _ in range(5):
            robo.ler_sensor(None)
        self.assertEqual(
            robo.telemetria(),
            "QT|MODE:1|DIST:ERR|CMD:PARAR|STATE:SENSOR_FAIL",
        )

    def test_polaridades_dos_seis_comandos(self) -> None:
        self.assertEqual(PARADO, (PARADO.__class__)(0, 0, 0, 0))
        self.assertEqual(FRENTE, FRENTE.__class__(0, 1, 0, 1))
        self.assertEqual(TRAS, TRAS.__class__(1, 0, 1, 0))
        self.assertEqual(CURVA_DIREITA, CURVA_DIREITA.__class__(0, 1, 0, 0))
        self.assertEqual(CURVA_ESQUERDA, CURVA_ESQUERDA.__class__(0, 0, 0, 1))
        self.assertEqual(GIRO, GIRO.__class__(0, 1, 1, 0))

    def test_simulador_permanece_sincronizado_com_sketch(self) -> None:
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
            "DISTANCIA_OBSTACULO_CM": 20.0,
            "INTERVALO_SENSOR_MS": 80,
            "TIMEOUT_COMANDO_MS": 1500,
            "JANELA_OBSTACULOS_MS": 15000,
            "TEMPO_PAUSA_MS": 200,
            "TEMPO_RE_MS": 700,
            "TEMPO_CURVA_MS": 900,
            "TEMPO_SAIDA_MS": 600,
            "LIMITE_FALHAS_SENSOR": 5,
            "LEITURAS_VALIDAS_PARA_RECUPERAR": 3,
            "LIMITE_OBSTACULOS": 5,
        }
        for nome, valor in esperados.items():
            literal = re.escape(str(valor))
            padrao = rf"const\s+[^;=]+\s+{nome}\s*=\s*{literal}(?:UL)?\s*;"
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

        bloco_ping = re.search(
            r'else if \(strcmp\(linha, "PING"\).*?\{(.*?)\}',
            sketch,
            re.DOTALL,
        )
        self.assertIsNotNone(bloco_ping)
        self.assertNotIn("ultimoComandoEm", bloco_ping.group(1))


if __name__ == "__main__":
    unittest.main(verbosity=2)
