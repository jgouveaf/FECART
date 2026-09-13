# Modo 2: telemetria, direção visual e alvo escolhido (2.0.3)

O usuário relatou bloqueio pelo sensor mesmo com uma distância numérica na
tela, além da impressão de que o alvo mudava. A leitura exibida no painel
permanecia com o último valor recebido; sua idade não estava visível. O Modo 2
exige uma leitura de até 700 ms, portanto um número aparentemente válido não
significava telemetria atual. Esse cenário foi reproduzido suspendendo apenas
a telemetria periódica, com reconhecimento e ACKs de movimento ainda ativos.

## Correção

- No Modo 2 ativo, o site consulta `STATUS` quando a telemetria alcança 400 ms.
  O controlador permite no máximo duas consultas por segundo, uma escrita
  pendente e somente na conexão/modo atuais. Consultas atrasadas na fila
  expiram em 500 ms. Nos Modos 1 e 3 essa consulta automática não acontece.
- Somente uma nova telemetria atualiza a leitura. ACKs, consultas enviadas,
  texto numérico antigo e erros não renovam a validade. Sensor sem resposta
  continua bloqueando os motores; o firmware também exige sensor válido.
- A direção calculada pela visão é preservada separadamente do comando
  liberado aos motores. É possível visualizar `FRENTE` na visão e `PARAR`
  no carrinho quando falta telemetria. O campo visual não autoriza movimento.
- O painel mostra distância e idade, tornando explícita uma leitura atrasada.
- “Rosto selecionado” foi corrigido para “Leitura facial atual”. Enquanto
  há um alvo selecionado, uma leitura desconhecida aparece como
  “NÃO CONFIRMADO”, sem exibir um novo TEMP como se fosse outro alvo.
  O cadastro escolhido continua fixo; não foi introduzida troca automática.
- “Distância” no cadastro agora diz “Tamanho do rosto”, pois essa validação
  mede o enquadramento facial e não o sensor ultrassônico.

Modelos, limiares biométricos, firmware, distância de parada e ESTOP foram
preservados. As mudanças de apresentação não criam identidade quando a
leitura falha. Uma diferença persistente de rosto ainda exige diagnóstico
com a câmera real; não se presume que seja apenas oscilação do painel.

## Verificação

O teste novo falhou antes da correção: sem telemetria periódica, o site não
consultava `STATUS`. Depois passaram 200 testes Node, incluindo as 8.190
variações de seguimento e 34 testes de controle serial, e 52 cenários de
navegador. Foram verificados consultas limitadas, ESTOP preservado, continuidade
de FRENTE com resposta a STATUS, parada sem resposta, recuperação com o mesmo
alvo, diagnóstico e ausência de interferência nos Modos 1 e 3. O painel foi
inspecionado em captura e nos tamanhos 360, 768 e 1440 px.

No teste com SCRFD/SFace e EfficientDet reais, vídeo de fixture e USB simulada,
houve pedidos FRENTE e cinco paradas em oito segundos, todas comprovadamente
por captura acima de 600 ms, seguidas de retomadas. O teste verificou curvas,
obstáculo e desaparecimento. Isso não demonstra seguimento físico contínuo;
os atrasos de processamento permanecem uma limitação, separada da telemetria.

## Avaliação do Gemini

A [documentação oficial da Live API](https://ai.google.dev/gemini-api/docs/live-api)
informa imagens a até 1 FPS e transporte por WebSocket. Para este projeto,
isso acrescentaria dependência de rede ao ciclo de movimento e não resolveria
o recebimento de distância. A recomendação é continuar com visão local no
controle imediato; a API não foi integrada e nenhuma chave foi solicitada.
