# Modo 2 — continuidade com o rosto fora de vista

Solicitado: melhorar o acompanhamento quando a pessoa vira de costas. A versão
anterior encerrava todo seguimento sem rosto após três segundos, inclusive com
o corpo continuamente observado. Esta entrega altera apenas a visão do Modo 2;
preserva firmware, transporte USB, autônomo, gestos e seus comandos de parada.

## Comportamento

- A seleção continua explícita pelo cadastro facial. O rosto precisa primeiro
  associar o alvo a um corpo detectado. Roupa nunca inicia ou recupera uma identidade.
- O worker extrai uma assinatura pequena das cores de duas regiões, tronco e
  parte inferior do corpo, num recorte central de 24 × 48 pixels. Não existe
  modelo adicional, chamada externa por quadro ou persistência da assinatura.
- Três observações faciais com horários distintos e próximas dos quadros corporais
  confirmam uma referência de aparência consistente. O painel informa
  “continuidade visual pronta”. Detecções pequenas ou cortadas não fornecem amostra.
- Sem rosto, a caixa precisa continuar próxima da anterior, sem lacuna superior
  a 500 ms, e as duas regiões de roupa precisam ser compatíveis com a referência.
  Com essa evidência contínua, pode acompanhar além dos três segundos. O estado
  “Alvo mantido pelo corpo e roupa” indica continuidade inferida, não novo reconhecimento facial.
- A referência não é atualizada por observações somente do corpo. Mudança de roupa,
  corpos sobrepostos ou outra pessoa com aparência semelhante interrompem o seguimento.
- Perda, congelamento ou atraso de imagem apagam a referência. Após perder o alvo,
  exige observação facial capturada depois da interrupção, seguida da confirmação
  temporal existente. Uma roupa parecida reaparecendo não libera movimento.
- Quando não há uma assinatura utilizável, vale a continuidade geométrica anterior
  de até três segundos sem rosto. Depois, solicita confirmação facial.
- Sensor inválido/atrasado, obstáculo a 30 cm e corpo muito grande continuam
  bloqueando aproximação. Liberação por distância continua em 40 cm. Previsão
  visual de até 500 ms continua produzindo somente PARAR.

## Limites e uso

Mostre rosto, tronco e pernas à câmera, selecione o cadastro e aguarde a indicação
de continuidade pronta antes de virar. A roupa ajuda a manter uma trajetória já
confirmada; não constitui identificação única. Uniformes, roupa muito diferente
na frente e atrás, grandes mudanças de iluminação, corte do enquadramento e
oclusão podem interromper o acompanhamento. Trocas não observáveis entre pessoas
com a mesma aparência não podem ser excluídas por este método.

Comece pela prévia sem Arduino. Ainda falta validar uma sequência real da pessoa
virando, iluminação e movimento da câmera montada no carrinho. Os testes de
software não demonstram precisão geral, distância de frenagem nem movimento real.

## Verificação

- Testes de lógica e aparência: 52 casos aprovados, incluindo cores com exposição moderadamente diferente,
  regiões incompatíveis, entradas inválidas, um minuto de continuidade sintética,
  rosto em cache, roupa diferente, pessoa semelhante, perda e readquisição facial,
  sensor/obstáculo e congelamento.
- Navegador do Modo 2: 35 cenários com inferência e USB simulados, incluindo
  continuidade além de três segundos e parada transmitida ao encontrar concorrente.
- Worker/modelo real em `bus.jpg` local: três pessoas detectadas e duas amostras
  válidas de aparência; a pessoa cortada na borda não forneceu amostra.
- Regressões de câmera/site, gestos e controle serial simulados aprovadas.

O relatório de 07/09 documenta a versão anterior; seu limite absoluto de três
segundos foi substituído somente pelas condições de continuidade descritas aqui.
