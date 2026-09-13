# Modo 2: confirmação por referência facial da sessão (2.0.4)

O usuário continua relatando confirmação repetida do alvo no carrinho. Foi
reproduzida uma causa no código publicado: após duas identificações com escore
0,60, quadros novos com escore 0,48 em relação ao cadastro e 0,96 em relação ao
último rosto confirmado perdiam a identidade quando a última comparação
estrita ultrapassava 800 ms. Geometria, imagem atual e identidade compatível
não evitavam essa expiração. Esta reprodução não prova que seja a única causa
no equipamento do usuário.

## Alteração

- A aquisição continua exigindo o cadastro salvo. Duas leituras estritas,
  contínuas e separadas por pelo menos 120 ms habilitam a referência da sessão.
- Uma leitura pode continuar o alvo com `SESSION_MATCH` se comparar bem com
  essa referência e passar pelos mesmos limites de imagem atual, geometria,
  confiança, margem entre pessoas e escore mínimo de continuidade.
- A idade da referência, sozinha, não apaga uma identidade que continua sendo
  medida. Cada quadro ainda exige um descritor facial novo; não há movimento
  autorizado apenas por tempo, posição prevista ou escolha manual do nome.
- Somente uma nova comparação estrita com o cadastro pode atualizar a
  referência. Resultados da sessão nunca treinam os próximos: uma sequência
  de rostos gradualmente diferentes não pode se autorizar por deriva.
- A referência fica apenas em memória. Cadastro, fotos, backup, modelos,
  limiares biométricos, firmware, protocolo serial e Modos 1/3 não mudaram.
- O painel distingue a comparação com o cadastro da referência da sessão.
  O diagnóstico inclui o escore da sessão, inclusive quando a leitura é
  rejeitada, sem exportar fotos ou descritores.

## Verificação

- Reprodução anterior: primeira rejeição em 2.000 ms de uma sequência iniciada
  em 1.000 ms, com última identificação estrita em 1.200 ms.
- Teste determinístico: mais de um minuto de leituras compatíveis conserva
  `FRENTE`; diferença facial, ambiguidade, perda de continuidade, atraso ou
  descritor inválido cancelam a sessão. Vetores SFace verificam que pequenas
  alterações acumuladas são rejeitadas contra a referência original.
- 202 testes Node passaram, incluindo 8.190 variações de seguimento e 34
  cenários do controlador serial.
- 53 cenários de navegador passaram. O teste novo mantém pedidos `FRENTE`
  por cinco segundos sem `PARAR`, embora o escore do cadastro permaneça abaixo
  do limiar de aquisição. Outro rosto cancela a sessão e a leitura fraca
  não pode readquirir o alvo. Inferência e USB são substitutos controlados.
- O fluxo SFace de cadastro, armazenamento, atualização e backup passou,
  incluindo comparação da sessão por mais de 800 ms e rejeição de deriva.
- O teste com SCRFD/SFace e EfficientDet reais, vídeo de fixture e USB
  substituta também passou para reconhecimento, avanço, curvas, obstáculo e
  desaparecimento. Entretanto, em oito segundos, houve 15 pedidos de parada
  por imagem com mais de 600 ms. Esses resultados não comprovam seguimento
  contínuo: latência permanece um problema separado da expiração da identidade.

## Limites e revisão

A mudança elimina a expiração temporal reproduzida, mas não resolve imagens
sem rosto detectado, diferenças faciais reais, oclusões, atraso acima de
600 ms ou ausência de telemetria. Pessoas semelhantes continuam sendo um
risco biométrico; manter referência de sessão exige ensaio supervisionado com
o carrinho, diferentes ângulos, iluminação e pessoas cruzando a imagem.
Nenhuma câmera física, porta USB real ou motor foi acionado nestes testes.

O reconhecimento já utiliza IA local SCRFD/SFace. A
[documentação oficial do SFace no OpenCV](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html)
descreve a comparação de características de dois rostos. O uso de uma
referência ao vivo e os limites acima são decisões deste projeto; não são
garantias de acurácia fornecidas pela biblioteca. Nenhuma API externa por
quadro foi adicionada.
