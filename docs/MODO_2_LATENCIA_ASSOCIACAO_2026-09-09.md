# Modo 2 — menor espera e associação de alvo mais rigorosa

Melhorias solicitadas: demora para reconhecer/acompanhar e confusão entre pessoas.
Alterações limitadas ao processamento visual, evidências do alvo e testes.
Firmware, transporte serial, Modos 1 e 3 e comandos de parada permanecem intactos.

## Esperas entre quadros

- O processamento corporal passa a programar o próximo quadro ao receber o
  resultado, evitando esperar pelo próximo ciclo de consulta de 100 ms.
  Mantém apenas um quadro em processamento e partidas separadas por pelo menos
  100 ms. Respostas posteriores a uma pausa ou mudança de modo são descartadas.
- No Modo 2, fora de cadastro e sem erro, a espera após inferência facial leva
  em conta o tempo já gasto no processamento. Mantém intervalo mínimo de 70 ms
  entre inícios e descanso de pelo menos 20 ms após cada inferência. Cadastro,
  outros modos e recuperação de falhas mantêm os intervalos anteriores.
- O ganho é na espera programada; não acelera a execução dos modelos nem remove
  a confirmação do alvo. Não foi medida a latência com a câmera real do usuário.
  A maior frequência pode aumentar a carga do PC; os limites de atraso e paradas
  por imagem congelada permanecem ativos.

## Confusão entre pessoas

- Um alvo novo ou recuperado exige duas observações faciais com horários distintos,
  associadas a uma trajetória contínua do corpo. Reutilizar a mesma observação
  facial em vários quadros corporais não satisfaz a confirmação.
- Um reconhecimento facial que salta para um corpo distante não transfere
  imediatamente a autorização de movimento. Interrompe e exige nova confirmação.
  Intervalos maiores que 500 ms entre observações também interrompem a continuidade.
- Duas faces dentro da mesma caixa de corpo interrompem o seguimento, incluindo
  uma segunda face sem cadastro. As verificações anteriores de identidade
  conflitante, roupas semelhantes e sobreposição continuam ativas.
- A aparência considera também luminosidade e saturação, além da cor, para
  distinguir melhor roupas de mesma tonalidade mas intensidades muito diferentes.
  Tons neutros usam distribuição suave: pequenas variações de iluminação não
  saltam entre classes incompatíveis. O formato é transitório e não muda cadastros.

## Verificação e limites

Os testes exercitam a implementação real de agendamento com tempo virtual e
inferência simulada. Incluem processamento lento/rápido, ausência de fila, resposta
tardia, mudança de modo, pausa para cadastro e recuperação de erro. Os testes de
associação incluem roupa clara/escura, fronteiras de brilho, duas faces, rosto em
cache, salto entre corpos, perda e confirmação posterior do alvo.

O teste de navegador usa aplicação/IndexedDB/controlador reais e inferência/USB
simulados. O detector real é exercitado com uma foto local, sem câmera ou Arduino.
Regressões de câmera, gestos, transporte serial e circuito de falhas faciais
também são verificadas antes da publicação.

Resultados locais: 71 casos de lógica/agendamento aprovados; 36 cenários do
Modo 2 no navegador aprovados; regressões de câmera/site, gestos, serial e
recuperação facial aprovadas. O worker real detectou três pessoas na foto local
e produziu duas assinaturas de aparência válidas. Esses números são cobertura de
teste, não taxa de acerto com pessoas reais.

Não é uma garantia de identificação única. Roupas semelhantes, falso reconhecimento
facial repetido, câmera em movimento e mudanças fortes de iluminação continuam
sendo limitações. A confirmação adicional pode causar uma pausa ao saltar de
posição ou reaparecer. Não foram acionados motores nem regravado firmware.
