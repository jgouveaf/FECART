from __future__ import annotations

import unittest

from .arena_2d import (
    Arena,
    Retangulo,
    RoboNaArena,
    _circulo_intersecta_retangulo,
    _distancia_raio_retangulo,
    cenarios_padrao,
)


class TesteGeometria(unittest.TestCase):
    def test_raio_encontra_retangulo_a_frente(self) -> None:
        distancia = _distancia_raio_retangulo(0, 5, 1, 0, Retangulo(20, 0, 10, 10))
        self.assertAlmostEqual(distancia, 20)

    def test_raio_ignora_retangulo_fora_da_direcao(self) -> None:
        distancia = _distancia_raio_retangulo(0, 20, 1, 0, Retangulo(20, 0, 10, 10))
        self.assertEqual(distancia, float("inf"))

    def test_colisao_circular(self) -> None:
        obstaculo = Retangulo(20, 20, 10, 10)
        self.assertTrue(_circulo_intersecta_retangulo(15, 25, 6, obstaculo))
        self.assertFalse(_circulo_intersecta_retangulo(5, 5, 6, obstaculo))


class TesteArena(unittest.TestCase):
    def test_executar_tempo_nao_libera_boot_ou_parada_do_operador(self) -> None:
        robo = RoboNaArena(Arena(largura=1200, altura=300), 50, 150, 0)
        resultado = robo.executar(5)
        self.assertEqual(resultado.distancia_percorrida_cm, 0)
        self.assertEqual(resultado.posicao_final, (50, 150))
        robo.iniciar_autonomo()
        resultado = robo.executar(2)
        self.assertGreater(resultado.distancia_percorrida_cm, 40)
        distancia = resultado.distancia_percorrida_cm
        posicao = resultado.posicao_final
        robo.parar()
        resultado = robo.executar(5)
        self.assertEqual(resultado.distancia_percorrida_cm, distancia)
        self.assertEqual(resultado.posicao_final, posicao)
        robo.iniciar_autonomo()
        resultado = robo.executar(2)
        self.assertGreater(resultado.distancia_percorrida_cm, distancia + 40)

    def test_sensor_detecta_obstaculo_frontal(self) -> None:
        arena = Arena(obstaculos=[Retangulo(100, 130, 20, 40)])
        robo = RoboNaArena(arena, 50, 150, 0)
        self.assertAlmostEqual(robo.medir_distancia_cm(), 41, delta=1)

    def test_sensor_nao_enxerga_atras(self) -> None:
        arena = Arena(obstaculos=[Retangulo(20, 130, 10, 40)])
        robo = RoboNaArena(arena, 50, 150, 0)
        self.assertGreater(robo.medir_distancia_cm(), 300)

    def test_caminho_livre_percorre_distancia_sem_colidir(self) -> None:
        robo = RoboNaArena(Arena(largura=1200, altura=300), 50, 150, 0)
        robo.iniciar_autonomo()
        resultado = robo.executar(20)
        self.assertEqual(resultado.colisoes, 0)
        self.assertGreater(resultado.distancia_percorrida_cm, 450)

    def test_cenarios_padrao_nao_colidem(self) -> None:
        for nome, (arena, pose) in cenarios_padrao().items():
            with self.subTest(cenario=nome):
                robo = RoboNaArena(arena, *pose)
                robo.iniciar_autonomo()
                resultado = robo.executar(30)
                self.assertEqual(resultado.colisoes, 0, resultado)
                self.assertGreater(resultado.distancia_percorrida_cm, 20, resultado)
                self.assertGreaterEqual(resultado.desvios, 1, resultado)

    def test_estresse_repetido_deterministico(self) -> None:
        arena, pose = cenarios_padrao()["multiplos_obstaculos"]
        resultados = []
        for repeticao in range(20):
            with self.subTest(repeticao=repeticao):
                robo = RoboNaArena(arena, *pose)
                robo.iniciar_autonomo()
                resultado = robo.executar(60)
                self.assertEqual(resultado.colisoes, 0, resultado)
                self.assertGreater(resultado.distancia_percorrida_cm, 20, resultado)
                self.assertGreaterEqual(resultado.desvios, 2, resultado)
                resultados.append(resultado)
        self.assertTrue(all(resultado == resultados[0] for resultado in resultados))


if __name__ == "__main__":
    unittest.main(verbosity=2)
