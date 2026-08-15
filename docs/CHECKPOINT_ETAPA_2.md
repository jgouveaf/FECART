# Checkpoint - Etapa 2: Sistema de visao e identificacao por ID

## Status

CONCLUIDA EM SOFTWARE/TESTES OFFLINE. Webcam fisica, robo, Arduino e qualquer
porta serial permanecem reservados exclusivamente para a Etapa 10.

## Implementado

- deteccao de pessoas com YOLO usando apenas a classe `person`;
- tracking temporal com IDs persistentes e ByteTrack;
- caminho sincrono para imagens e videos gravados, separado do caminho
  assincrono usado pela interface;
- processamento imediato do primeiro quadro, sem tela inicialmente vazia;
- estados `VISIBLE`, `OCCLUDED`, `GHOST`, `LOST` e `REMOVED`;
- filtro de Kalman para predicao durante falhas curtas de deteccao;
- Re-ID visual por histograma para recuperar um ID apos o backend criar outro;
- protecao contra ID duplicado recebido no mesmo quadro;
- preservacao do ultimo perfil visual realmente observado durante oclusoes;
- fonte de quadros testavel por arquivo, sem abrir webcam;
- HUD com caixa, ID, nome, estado, confianca, distancia estimada e velocidade;
- benchmark reproduzivel para condicoes visuais e comparacao de trackers.

## Arquivos alterados

- `tracker/yolo_tracker.py`
- `tracker/track_manager.py`
- `tracker/tracker_wrapper.py`
- `vision/frame_source.py`
- `vision/benchmark_etapa_2.py`
- `tests/test_tracking_offline.py`
- `tests/test_vision_pipeline_offline.py`
- `tests/test_yolo_offline.py`
- `tests/__init__.py`
- `docs/RESULTADO_BENCHMARK_ETAPA_2.json`
- `docs/CHECKPOINT_ETAPA_2.md`

## Testes executados

- deteccao YOLO real sobre imagem oficial local, sem internet e sem camera;
- variacoes normal, escura, clara, desfocada e baixa resolucao;
- pessoa mais distante (65%) e mais proxima (125%);
- sequencias com deslocamento e oclusao parcial;
- uma, duas e seis pessoas simuladas;
- trajetorias cruzadas e IDs fornecidos pelo ByteTrack;
- recuperacao apos oclusao e troca de ID do backend;
- ID duplicado no mesmo quadro;
- maquina de estados completa e eventos emitidos uma unica vez;
- stress de 5.000 quadros com seis pessoas e oclusoes curtas;
- video temporario de 24 quadros lido integralmente por `VideoCapture`;
- renderizacao do HUD em todos os estados;
- comparacao offline ByteTrack x BoT-SORT;
- descoberta global com regressao da Etapa 1.

## Resultados

- 39 testes globais das Etapas 1 e 2 passaram;
- YOLO encontrou pessoas em todas as sete variacoes do teste automatizado;
- um ID principal persistiu nos 13 de 13 quadros da sequencia de movimento;
- no benchmark final, ByteTrack e BoT-SORT mantiveram um ID nos 16 de 16
  quadros, inclusive com oclusao parcial;
- ByteTrack: media de 125,5 ms e P95 de 151,4 ms no benchmark final;
- BoT-SORT: media de 127,2 ms e P95 de 147,1 ms no mesmo benchmark;
- como a diferenca foi pequena e variou com aquecimento, ByteTrack foi mantido
  por simplicidade e por ja estar integrado, nao por alegacao de superioridade;
- o firmware da Etapa 1 continuou compilando: 1974 bytes de flash e 38 bytes
  de RAM; ele nao foi enviado ao Arduino.

## Bugs corrigidos

- primeiro quadro nao era enviado quando o intervalo de deteccao era maior que 1;
- fotos isoladas reaproveitavam indevidamente estado temporal do tracker;
- ID duplicado poderia fundir duas deteccoes em uma pessoa;
- durante falha de deteccao, o fundo poderia substituir o perfil visual valido;
- testes dos simuladores da Etapa 1 dependiam da pasta de execucao.

## Limitacoes

- os arquivos locais nao cobrem toda a variacao de uma webcam real;
- luz extrema, movimento muito rapido e multidoes densas exigem validacao na
  Etapa 10;
- histograma HSV pode confundir pessoas com roupas de cores semelhantes;
- ID de tracking representa uma trajetoria na sessao, nao um cadastro permanente;
- a estimativa de distancia por altura da caixa nao e uma medicao fisica;
- nenhum resultado desta etapa comprova funcionamento em camera ou robo reais.

## Proximo passo

Etapa 3: auditar e testar cadastro permanente, fotos, banco de dados, embeddings,
reinicializacao, exclusao e prevencao de duplicatas usando somente dados
temporarios offline. Hardware continua proibido ate a Etapa 10.
