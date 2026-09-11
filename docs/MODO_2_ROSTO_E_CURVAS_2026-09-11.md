# Modo 2: contagem, seguimento pelo rosto e correções em curva

## Causas confirmadas

O painel enviado pelo usuário mostrava zero pessoas e nenhum alvo escolhido. O contador recebia apenas corpos do EfficientDet, e esse worker ficava desligado sem um alvo selecionado. Um rosto reconhecido pelo Human não atualizava o contador. Para seguir, a lógica também exigia associação entre rosto e corpo completo.

O teste com modelos reais revelou outra falha: `mergeEmbeddings` eliminava amostras iguais das cinco capturas. Uma pessoa parada podia terminar com apenas uma referência, enquanto `chooseIdentity` exige pelo menos três. O registro era salvo, mas não podia ser reconhecido. A comparação direta entre resoluções não reproduziu perda de similaridade nessa fixture; não foi necessário mudar a resolução, o modelo ou os limiares de identidade.

## Correções

- A contagem combina rostos recentes e corpos recentes, evitando duplicar rosto/corpo associados. Ela funciona antes da seleção. Com a câmera desligada, mostra um traço. A escolha explícita continua necessária; o painel dá acesso aos cadastros e mostra a posição atual do alvo.
- Duas observações faciais distintas, consistentes e do alvo escolhido permitem seguir sem corpo completo. Uma cabeça classificada como pessoa também é aceita nesse caminho quando as caixas correspondem. O histórico facial fica separado do corporal; perder o rosto não inventa um corpo nem autoriza continuar às cegas.
- A continuidade corporal e por roupa permanece disponível após sua própria aquisição. Corpos conflitantes, múltiplos rostos, evidência antiga, sensor inválido e falhas continuam provocando parada.
- As cinco capturas são preservadas mesmo quando os descritores coincidem. A união de backups conserva a maior multiplicidade existente em cada conjunto, evitando que importar o mesmo arquivo repetidamente multiplique as amostras. Os limites de 15 amostras, similaridade 0,80, margem 0,05 e três referências continuam iguais.
- Registros antigos com menos de três amostras mostram **Completar cadastro**. O botão preenche o nome, ativa a câmera e permite capturar novamente mantendo o ID. Não fabrica referências ausentes nem seleciona automaticamente um alvo.

## Correções de direção

Na faixa central, segue reto. Fora dela, alterna curvas curtas para o lado do alvo com avanço. O tempo nominal de correção cresce com o desvio: 120–320 ms dentro de um ciclo de 800 ms. A histerese de direção é independente da fase de avanço, evitando troca de lado causada pelo próprio ciclo. Se o alvo estiver muito na borda, prioriza orientar o robô antes de avançar reto.

O firmware V7 existente executa direita/esquerda mantendo uma roda para frente e a outra parada. Não usa `GIRAR` para essas correções. Não houve alteração de firmware, HEX, pinos, protocolo USB, Modos 1/3 ou emergência. Trata-se de curvas em arco intercaladas com avanço, não controle contínuo de velocidades independentes das duas rodas. Os intervalos reais dependem da chegada de novas observações e dos ACKs USB; nenhum temporizador gera movimento sem evidência atual.

O caminho facial respeita imagem de até 600 ms e a sincronização existente com o detector. Mantém parada pelo sensor em 30 cm e retomada em 40 cm. Um rosto muito próximo também provoca parada, com histerese própria de tamanho. Isso não é medição de distância em centímetros pela câmera.

## Testes

- 121 testes de lógica passaram, incluindo as 8.190 variações geradas de segurança, seguimento corporal, roupa, agendamento, amostras de cadastro, rosto isolado e curvas. O caso de pessoa ausente agora remove rosto e corpo; rosto do alvo ainda visível passou a ser um caso válido específico.
- 46 cenários no navegador passaram com inferência/USB simuladas e controlador real: contagem antes de selecionar, rosto/corpo sem duplicação, rosto sem corpo entregando `CMD:FRENTE`, curvas alternadas com avanço e parada por perda/obstáculo, além de regressões dos Modos 1/3.
- 14 cenários de cadastro passaram, incluindo completar um registro antigo com uma referência, preservando seu nome/ID e sem solicitar USB.
- Quatro cenários de recuperação USB passaram com streams simulados. A verificação isolada do reconhecedor manteve rejeição de poucas referências e identidades ambíguas.
- 21 verificações estáticas passaram, incluindo integridade do HEX existente.
- Human e EfficientDet reais, com vídeo gerado da imagem de aquecimento local do Human: o cadastro foi reconhecido, a contagem foi 1 com zero corpos detectados, o estado chegou a `FACE_TRACKING/FRENTE`, corrigiu para ambos os lados e parou ao retirar o rosto. Nenhum frame/modelo foi enviado a serviço externo e nenhuma porta USB física foi aberta.

Esses testes comprovam comportamento do software nas condições descritas. A trajetória e a suavidade no carrinho físico continuam pendentes de validação. Câmera, iluminação, alimentação, atrito e diferenças entre motores podem alterar o resultado.

## Referências

- [MediaPipe: detecção, filtragem por classe, caixas e execução em worker](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js).
- [Human: documentação do projeto utilizado](https://github.com/vladmandic/human/wiki).
- Implementação existente de `girarDireita`, `girarEsquerda` e `girarNoLugar` em `firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino`.
