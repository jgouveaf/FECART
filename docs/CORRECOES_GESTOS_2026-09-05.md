# Gestos — contagem e tempo de resposta

Escopo: somente detector e interface web. Firmware V7, pinagem, movimentos e
Modo 1 preservados. Nenhuma porta serial ou câmera física foi aberta.

## Evidência e correções

As capturas do operador mostram 1 e 2 dedos como candidatos a 3 e quatro dedos
longos com polegar dobrado confirmados como 5, com indicação de 100%.

- A certeza era a mediana dos cinco dedos: três dedos fáceis escondiam um
  polegar incerto. Agora a contagem depende do dedo menos certo; desacordo
  significativo entre geometria de imagem e mundo impede confirmação.
- Os landmarks de imagem eram tratados como se a câmera fosse quadrada.
  Agora y é ajustado por altura/largura antes dos ângulos e distâncias;
  z mantém a unidade relativa à largura, como especificado pelo MediaPipe.
- Abertura do polegar considera também sua projeção lateral em relação à
  própria palma. Estar reto sobre a palma não basta para contar como estendido.
- Dedos longos precisam ter alcance de ponta coerente com a primeira falange.
- Foi retirada a regra que ignorava qualquer polegar quando houvesse menos de
  quatro dedos longos. A contagem considera os dedos realmente estendidos,
  sem exigir uma combinação canônica para 1–4.
- Mediana curta de três amostras rejeita picos; suavização mais responsiva reduz
  atraso. Movimentos exigem três quadros coerentes por pelo menos 120 ms;
  PARAR exige dois e 50 ms, inclusive quando o usuário remapeia o gesto.
- A cadência solicitada passou de 12 para até 20 inferências/s, sem repetir
  quadros. Não é uma promessa de 20 FPS no computador do usuário.
- Intervalo padrão entre comandos: 650 → 300 ms. Configurações personalizadas
  salvas foram preservadas; podem continuar usando outro intervalo.
- A tela não anuncia confirmação enquanto aguarda o intervalo de envio.
  Evidência insuficiente aparece como LEITURA INCERTA, não uma contagem certa.
- Quadros separados por mais de 250 ms não se acumulam como confirmação.
  Vídeo congelado também provoca PARAR, mesmo sem novo resultado do detector.

## Testes

- 14 cenários novos de regressão no controlador real com relógio/câmera
  simulados e geometria sintética; inclui as 32 combinações de dedos.
- Nos primeiros 11 cenários, a versão anterior falhou em 10; as correções
  passaram antes de adicionar mais três cenários de proteção e temporização.
- Matriz geométrica existente: 500 casos aprovados sem alterar seus resultados
  esperados. O teste de supressão canônica foi substituído por evidência
  geométrica de polegar dobrado; o teste de rejeição de pico foi preservado.
- Bateria `python -m unittest discover -s tests -q`: 659 testes, 657 aprovados
  e 2 ignorados. O wrapper dos 14 cenários está incluído, não se somam as contagens.
- Chromium com câmera sintética: modelo carregado, controles ativos e layout
  320/768/1440 px sem erro de página/rede ou acesso externo.
- Harness opcional tentou detectar mãos nas três capturas estáticas e não
  conseguiu. Esse resultado não valida acurácia; capturas cortadas/com overlay
  não equivalem ao vídeo original. Não foram inventados landmarks das capturas.

O teste de 150 ms mede só confirmação temporal com evidência limpa sintética.
O teste da cadeia geométrica completa verifica troca de 5 para 4 em até 450 ms
sob entrada sintética a aproximadamente 13 FPS. Nenhum mede latência física.

## Limitações e próximo teste

A indicação de certeza geométrica não é uma probabilidade calibrada de acerto.
Polegar sobreposto, mão de lado e landmarks com profundidade divergente podem
ser recusados em vez de provocar movimento. A calibração só coleta amostras:
ela ainda não treina nem ajusta limiares automaticamente.

Inferência ainda é síncrona no navegador. Se continuar travando em vídeo real,
medir duração por quadro e avaliar worker mantendo descarte de frames antigos.
Primeiro retestar a mão ao vivo, com motores desligados; depois usar amostras
numéricas rotuladas se restarem erros. Não está declarado funcionamento 100%.
As falhas de qualificação da arena do Modo 1 continuam abertas, sem alteração.

Referência: [guia oficial MediaPipe Hand Landmarker — coordenadas, processamento
e bloqueio da interface](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js).
