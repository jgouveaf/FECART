# Modo 2: oscilação da identidade facial (2.0.2)

O usuário informou que o rosto continuava visível, mas o painel alternava entre
o cadastro e “Não cadastrado”/“Nenhum”. O carrinho chegou a andar por cerca de
meio segundo e voltou a pedir confirmação. Não foi capturado um diagnóstico
da câmera física; o mecanismo abaixo foi reproduzido no software.

Com SFace, uma sequência de pontuações 0,60 → 0,60 → 0,48 → 0,60 → 0,48
produzia CONFIRMING → FRENTE → TARGET_LOST → CONFIRMING → TARGET_LOST.
Cada queda abaixo de 0,50 era tratada como identidade desconhecida, mesmo
numa trajetória facial contínua. A memória anterior só armazenava resultados;
não participava dessa decisão.

## Alteração

Foi adicionada uma tolerância temporal somente durante o seguimento de um
cadastro selecionado. Os limites para reconhecimento inicial e cadastro
permanecem iguais. A continuidade exige:

- Duas leituras estritas do mesmo rosto, abrangendo pelo menos 120 ms.
- Uma nova imagem de exatamente um rosto, com confiança mínima de 0,58,
  idade máxima de 600 ms e sobreposição de pelo menos 0,50 com o quadro anterior.
- O mesmo cadastro como melhor candidato, com três referências válidas e
  a margem original sobre os demais cadastros.
- Pontuação mínima 0,45 no SFace ou 0,77 no Human, mais comparação da leitura
  atual com a última leitura estrita: mínimo 0,80 no SFace ou 0,90 no Human.
- No máximo 800 ms desde a captura da última leitura estrita. Leituras na
  faixa de tolerância não renovam esse prazo nem a referência facial.

Sem essas condições, a continuidade é descartada. Falha, desaparecimento,
vários rostos, mudança de câmera, de cadastro ou de motor também a apagam.
Essa tolerância não é usada para cadastrar pessoas nem para aprender novas
amostras. A comparação usa a imagem atual e conserva seu horário real.

O painel distingue rosto visível sem identidade confirmada de rosto ausente.
O diagnóstico exportado inclui contagem, motivo, pontuação e margem em cada
transição, sem incluir nomes, identificadores, fotos ou descritores faciais.

Firmware, protocolo USB, limiares de obstáculos, relógios dos detectores e
lógica de movimento não foram alterados. A resolução também foi preservada:
a comparação exploratória com três identidades em seis tamanhos não
reproduziu perda por mudança de resolução, portanto essa hipótese não
justificou uma alteração nesta correção.

## Evidência e limites

- 199 testes Node aprovados, incluindo 8.190 variações de seguimento,
  estados de segurança, reconhecimento e controle serial.
- As regressões novas cobrem oscilação seguida de FRENTE, expiração,
  pessoa diferente no mesmo lugar, concorrência entre cadastros, imagem
  atrasada, geometria inválida, reset e os dois motores faciais.
- O navegador com cadastro SFace confirmou a tolerância, a expiração e a
  rejeição de outra identidade; cadastro, atualização Human/SFace e backup passaram.
- 50 cenários de navegador do Modo 2 aprovados com inferência e USB simuladas,
  incluindo FRENTE sem interrupção nas oscilações, parada após expiração,
  indicação correta no painel e diagnóstico sem registros biométricos.
- No teste de oito segundos com SCRFD/SFace e EfficientDet reais houve
  17 pedidos FRENTE e um PARAR por captura expirada (619 ms). Depois houve
  retomada, curvas para ambos os lados e paradas por obstáculo e perda.
  A câmera usou uma imagem local animada em canvas; a porta USB era simulada.
- A verificação do site não encontrou erros JavaScript, requisições externas
  dos modelos ou transbordamento horizontal em 320, 768 e 1440 px.

Dois testes antigos de roupa ainda presumiam parada imediatamente após uma
perda de 200 ms. Foram corrigidos para exercitar perda além da tolerância
facial já existente de 450 ms; continuam exigindo nova identificação depois
dessa perda. Nenhuma regra de movimento foi modificada para satisfazê-los.

A tolerância reduz interrupções por pontuações próximas do limite; aumenta
ligeiramente a faixa aceita por até 800 ms, condicionada às evidências acima.
Não substitui ensaio com a pessoa real, iluminação, movimento da câmera e
distância de frenagem do carrinho. Não há estimativa de acurácia geral.

Referência consultada: [documentação oficial do SFace/OpenCV](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html).
Ela usa comparação entre características de rostos alinhados e apresenta
limiares de diferentes conjuntos de avaliação. Esses resultados não são
medidas deste projeto; o limite inicial do projeto permaneceu em 0,50.
