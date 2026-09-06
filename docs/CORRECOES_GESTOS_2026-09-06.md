# Gestos: dedos dobrados na base

Escopo: geometria do detector web. Modo 1, firmware V7, pinagem, comandos,
parada de emergencia e limites de confianca preservados. Sem camera ou USB
fisicos durante esta verificacao.

## Causa e alteracao minima

A avaliacao de dedos longos considerava os angulos das falanges, mas nao a
direcao da ponta em relacao a palma. Um dedo dobrado na base podia apresentar
falanges alinhadas e profundidade grande no mundo 3D. Alem disso, uma primeira
falange muito curta na projecao produzia um alcance relativo artificialmente
alto. Isso gerava dedos extras e divergencia imagem/mundo, bloqueando comandos.

Agora o escore tambem exige avanco da ponta para fora da palma, medido no eixo
punho-base do proprio dedo e normalizado pelo tamanho da mao. Avanco negativo
nao pode virar dedo levantado apenas porque as falanges parecem retas. A regra
usa produto escalar, sem depender de lado da mao ou espelhamento da camera.

Nao houve reducao da confianca minima (0,65), aceleracao artificial do relogio,
supressao canonica de polegar ou remocao das paradas por perda de evidencia.
O cache do script passou para `gesture-math.js?v=8`.

## Evidencia fornecida pelo operador

Replay local de 240 amostras numericas, em 12 blocos de 20. O operador confirmou
que os blocos 5 e 6 foram gravados com 2 dedos, apesar de rotulados como 1.
Esses dois ajustes foram aplicados explicitamente apenas na avaliacao; o
arquivo original nao foi sobrescrito. Landmarks e identificadores da camera
nao foram incluidos no repositorio publico.

- Dados gravados: 13/240 amostras aceitas pelo limite de confianca.
- Geometria corrigida + filtro: 236/240 aceitas, todas com contagem correta;
  quatro recusadas por incerteza. Nao se considera recusa como acerto.
- Antes da decisao de aceitar, a contagem filtrada acerta 238/240: portanto
  ainda existem candidatos errados, mas eles nao passaram pelo limite.
- No replay pelo controlador real, os 12 blocos produziram o comando esperado
  sem emitir outro movimento. Primeira confirmacao por bloco entre 125 e 327 ms
  nos timestamps gravados. Filtros iniciam do zero a cada bloco; nao e medida
  de latencia ponta a ponta nem valida transicoes entre gestos no video real.

Esta mesma coleta ajudou a investigar a correcao: nao e um conjunto independente
de validacao nem estimativa de acuracia geral. Ha somente 1, 2 e 3 dedos, palma
e dorso. Ainda faltam coletas novas de 4/5, transicoes e condicoes de iluminacao.

## Reproducao local

Ferramenta sem rede, camera ou serial:

```sh
node tools/replay_gesture_samples.cjs CAMINHO_PRIVADO.json --expect=5:2 --expect=6:2
node --test tests/gesture_runtime_regression.test.cjs
python -m unittest tests.test_web_gesture_matrix -q
```

As opcoes `--expect` sao especificas desta coleta, confirmadas pelo operador;
nao devem ser aplicadas automaticamente a arquivos futuros. O harness de
regressao tambem aceita `QT_GESTURE_SAMPLES` e
`QT_GESTURE_EXPECTED_BY_BLOCK` (JSON) para executar a cadeia completa com dados
privados, sem publica-los.

## Regressao e riscos

Dois testes novos reproduziram erros antes da alteracao e passaram depois:
falanges retas dobradas na base (com variacoes de profundidade, rotacao e espelho)
e alcance inflado pela primeira falange curta. A bateria Node tem 17 testes
padrao, mais um replay privado opcional; os 18 passaram nesta execucao. A matriz
existente de 500 casos sinteticos passou sem mudar suas respostas esperadas.

Bateria geral `python -m unittest discover -s tests -q`: 659 testes, 657
aprovados e 2 ignorados. Os 500 casos e o wrapper Node estao incluidos nessa
contagem. Smoke test Chromium com camera sintetica passou: modelos locais,
comandos do simulador, ciclo ligar/desligar camera e layouts 320/768/1440 px,
sem erros de pagina/rede. Isso nao revalida fisicamente o Modo 1 nem resolve as
falhas de qualificacao de arena registradas nas notas V7.

Mao de lado, dedos parcialmente flexionados e profundidade mal estimada ainda
podem causar recusas ou erros; os escores nao sao probabilidades calibradas.
O teste seguinte deve ser no site atualizado, com motores desligados, incluindo
1 a 5 dedos de ambos os lados e trocas rapidas. So depois retomar teste fisico
supervisionado. Nenhum firmware precisa ser regravado para esta correcao.
