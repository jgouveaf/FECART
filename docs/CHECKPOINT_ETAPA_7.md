# CHECKPOINT — ETAPA 7

**STATUS: CONCLUÍDA EM SOFTWARE / SEM WEBCAM / SEM ROBÔ FÍSICO**

## Implementado

- Mapeamento solicitado: 1 dedo `SEGUIR`, 2 `DIREITA`, 3 `ESQUERDA`, 4 `PARAR`, 5 `GIRAR`.
- Estabilizador temporal exige três quadros coerentes antes de trocar movimento.
- `PARAR` é aceito imediatamente, sem aguardar estabilização.
- Pequenas perdas de detecção não derrubam o gesto antes de quatro quadros.
- Gestos substituem planejador automático e comando manual.
- Segurança de obstáculo permanece como única prioridade acima do gesto.
- Treinamento SVM calibrado, persistência e recarga do modelo testados.
- API depreciada `SVC(probability=True)` removida.

## Arquivos principais

- `vision/gesture_recognizer.py`
- `vision/gesture_trainer.py`
- `robot/robot_controller.py`
- `robot/robot_state_machine.py`
- `tests/test_gesture_priority_offline.py`

## Testes e resultados

- 7 testes específicos aprovados.
- 20.000 quadros de stress com gestos e obstáculos virtuais.
- Modelo treinado com dados sintéticos, salvo, reaberto e usado para classificar.
- Nenhuma webcam, Bluetooth, porta serial ou robô físico foi acessado.

## Regra de prioridade

1. Segurança de obstáculo e parada preventiva.
2. Gesto estável detectado.
3. Comando manual da interface.
4. Planejador automático.

A segurança fica acima do gesto para impedir que `SEGUIR` mande avançar contra um obstáculo.

## Limitações honestas

- Landmarks foram simulados; não houve teste com câmera física.
- Luz, distância da mão, pele, fundo e oclusões reais serão avaliados somente na fase física autorizada.

## Próxima etapa

Etapa 8: estimativa indireta de localização por RSSI em software, sem afirmar que Bluetooth fornece posição exata através de paredes.
