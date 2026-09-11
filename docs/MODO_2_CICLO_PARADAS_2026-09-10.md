# Modo 2: ciclo de identificação e parada

O usuário relata que o sistema identifica a pessoa, para e volta a identificar em um ciclo de aproximadamente um segundo. A falha anterior do motor direito foi identificada pelo usuário como um fio solto. Esta correção trata exclusivamente do seguimento visual e da sua observabilidade.

## Causas reproduzidas no código

1. O detector entrega pessoas a partir de 0,50 de confiança, mas o rastreador descartava todas abaixo de 0,55. Uma oscilação de 0,53 para 0,90 na mesma pessoa apagava a confirmação facial e iniciava novamente a aquisição do alvo.
2. O rastreador rejeitava intervalos de observação acima de 500 ms, embora o limite de validade da imagem e o watchdog permitissem 600 ms. Isso produzia reinícios desnecessários mesmo com observações válidas a cada 550 ms.
3. O watchdog chamava `missing()` enquanto uma nova imagem ainda estava sendo processada. Além de parar um comando vencido, apagava a evidência facial e de roupa. Um resultado novo, ainda dentro dos limites de validade e de continuidade, precisava reiniciar a confirmação da pessoa.

Essas situações foram reproduzidas com tempo e inferência controlados; não foram observadas diretamente na câmera do usuário. O diagnóstico adicional permite diferenciar essas causas de paradas por distância, sensor inválido, perda real do alvo ou baixa capacidade de processamento.

## Alteração mínima

- Aquisição e confirmação continuam exigindo corpo com confiança de pelo menos 0,55 e duas observações faciais distintas.
- Uma detecção entre 0,50 e 0,55 só mantém um alvo já confirmado: sobreposição de pelo menos 0,60, deslocamento horizontal menor que 0,06 da imagem e confirmação por rosto atual ou roupa previamente validada. A tolerância dura no máximo 500 ms desde a última detecção forte; uma detecção fraca não renova esse prazo nem treina a referência de roupa.
- Candidatos fracos também participam das verificações de sobreposição e roupas semelhantes. Eles não podem ser ignorados para produzir uma falsa aparência de alvo único.
- O intervalo máximo entre observações foi alinhado ao limite de imagem existente, de 600 ms. Imagens com mais de 600 ms continuam rejeitadas.
- O watchdog continua emitindo `PARAR` para uma decisão vencida. A nova observação decide se há continuidade, respeitando os limites de tempo, geometria, identidade, aparência e sensor. Perda real, erro do detector ou intervalo excessivo continuam exigindo nova confirmação facial.
- Uma área expansível exibe tempo de processamento, intervalo das imagens e o motivo persistente da última parada. O arquivo de diagnóstico contém no máximo 60 transições, sem nomes, imagens ou descritores biométricos. É gerado localmente quando o operador clica para baixar.

O firmware, os modelos, a comparação facial, os cadastros, o transporte USB e os Modos 1 e 3 não foram modificados.

## Fontes e escolhas

- [ByteTrack, ECCV 2022](https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136820001.pdf): descartar detecções de menor confiança fragmenta trajetórias; a associação com uma trajetória existente permite tratar parte delas de forma diferente. A alteração usa esse princípio de forma restrita, sem instalar ou alegar implementar o rastreador ByteTrack completo. Os números publicados no artigo não são resultados deste carrinho.
- [MediaPipe: detector de objetos para Web](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js): inferência síncrona pode bloquear a interface; processamento em worker e horários dos quadros são relevantes. O worker local existente foi preservado.
- [Human: caching](https://github.com/vladmandic/human/wiki/Caching) e [Human: performance](https://github.com/vladmandic/human/wiki/Performance): cache e módulos habilitados afetam execução e atualização dos resultados. Não foi feita mudança indiscriminada desses parâmetros, pois os defeitos reproduzidos estão na continuidade do rastreamento. Horários diferentes de chamadas não provam, por si só, que todos os submodelos do Human foram recalculados; o cache continua sendo uma limitação da evidência facial existente.

Descartadas nesta correção: trocar o motor de reconhecimento sem evidência de erro na comparação facial; reduzir o limiar de identidade para aceitar qualquer rosto; prolongar movimento usando apenas previsão; aumentar indiscriminadamente timeouts; enviar imagens para APIs externas; substituir o firmware para resolver um ciclo originado no navegador.

## Testes e limites

- 85 testes de lógica/agendamento: confiança oscilante, continuação de costas, prazo da tolerância, candidato fraco concorrente, identidade desconhecida, rosto antigo, roupa incompatível, perda real, limites de 600/601 ms, watchdog e sensor. Os casos novos que verificam continuidade falhavam antes da correção.
- 39 cenários no navegador com aplicação, IndexedDB e controlador USB reais, usando câmera/inferência/porta simuladas. Incluem confirmação de `CMD:FRENTE` sem `CMD:PARAR` no cenário de oscilação; parada por decisão vencida com inferência lenta; retomada sem reiniciar a identificação; exportação limitada e sem dados biométricos.
- 25 testes de regressão de integração, gestos e máquina de estados do firmware aprovados.
- 33 cenários do controlador Web Serial aprovados, incluindo ACK, perda de conexão e liberação explícita. Circuito de falhas faciais interrompeu após três erros e recuperou por ação explícita, sem erros inesperados no navegador.
- Worker com o modelo real, em uma foto local: três pessoas detectadas e duas amostras utilizáveis de roupa. Isso verifica a integração, não a acurácia com o usuário.

Com processamento consistentemente lento, o robô ainda pode parar por imagens vencidas. O ajuste evita reiniciar a identidade desnecessariamente; não mascara falta de capacidade do PC nem movimenta o robô sem observação válida. Câmera em movimento, pouca luz, roupas semelhantes e oclusões continuam exigindo validação física supervisionada. Não foram acionados motores, acessada câmera real ou regravado o Arduino.

Na próxima operação, usar a versão atualizada do site e observar o Modo 2. Se o ciclo persistir, abrir **Diagnóstico do seguimento** e baixar o arquivo: o motivo e os tempos ficam registrados mesmo que o estado mude rapidamente.
