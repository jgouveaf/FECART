# CHECKPOINT — ETAPA 6

**STATUS: CONCLUÍDA EM SOFTWARE / VÍDEOS GRAVADOS / SEM ROBÔ FÍSICO**

## Implementado

- Controlador offline de câmera com estados `STOPPED`, `RUNNING`, `PAUSED`, `EOF` e `ERROR`.
- Ações de iniciar, pausar, continuar, parar e repetir vídeo.
- Metadados de FPS, total e quantidade de quadros entregues.
- Diagnóstico de brilho, excesso de luz, desfoque e baixa resolução.
- Bloqueio explícito de fontes numéricas de webcam durante os testes offline.
- Tratamento de arquivo ausente, corrompido e fim de vídeo.

## Arquivos principais

- `vision/frame_source.py`
- `vision/camera_controller.py`
- `tests/test_camera_control_offline.py`

## Testes e resultados

- 6 testes específicos da Etapa 6 aprovados.
- Reprodução contínua de 1.000 quadros de vídeo gravado.
- Regressão global: 50 testes aprovados em 18,12 segundos.
- Detector YOLO real continuou encontrando pessoas em 7 variações visuais.
- Melhor ID persistiu nos 13 quadros da sequência de tracking.
- Nenhuma webcam foi aberta e nenhuma porta serial foi enumerada.

## Limitações honestas

- Codec, driver, foco automático e exposição de uma webcam real não foram medidos.
- O teste demonstra controle do pipeline e qualidade de quadros gravados, não hardware.
- Acesso físico continua reservado para a Etapa 10.

## Próxima etapa

Etapa 7: consolidar gestos, estabilidade temporal e prioridade sobre os demais comandos, mantendo a segurança de obstáculo acima de qualquer ordem de movimento.
