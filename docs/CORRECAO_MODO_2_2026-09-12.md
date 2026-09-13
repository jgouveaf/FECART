# Modo 2: correção do bloqueio em PARAR (2.0.1)

Foram reproduzidos dois bloqueios independentes no software. O relato do
carrinho não incluiu o motivo exato da parada, portanto a validação abaixo
não substitui a confirmação no equipamento.

- Um rosto com 45% da altura da imagem, ou corpo com 88%, impedia FRENTE
  mesmo com alvo confirmado, centralizado e sensor informando 100 cm livres.
- Resultados faciais atrasados eram tratados como desaparecimento do alvo.
  Isso apagava a confirmação anterior e podia rejeitar o próximo resultado,
  que havia sido capturado antes da parada, criando um ciclo de reconfirmação.

A distância física agora usa a leitura atual do sensor: para até 30 cm e
retoma a partir de 40 cm. Sensor inválido ou leitura acima de 700 ms continua
impedindo movimento. O tamanho na imagem permanece como limite na prévia
sem Arduino; não é uma medida calibrada em centímetros.

Os relógios de captura facial e corporal são separados. Na ausência de corpos
em uma observação recente, uma identidade facial pode gerar uma decisão assim
que chega. Corpos conflitantes, detector parado/com falha, cadastro, pausa e
perda da câmera não são ignorados. A evidência facial continua limitada a
600 ms; uma parada por expiração não transforma informação antiga em nova.

Durante o seguimento, o resultado da identificação chega antes da malha.
O desenho tem frequência limitada e nunca publica identidade nem comandos.
Respostas visuais antigas são descartadas. Cadastro e análise de imagens
continuam recebendo o resultado completo. O detector corporal usa intervalo
de 200 ms com rosto do alvo recente e 100 ms quando essa condição desaparece.

## Verificação

Os testes novos falharam antes da correção, reproduzindo o bloqueio por
enquadramento e a reconfirmação causada por resultados atrasados. Foram
adicionadas verificações de ordem entre os workers, prioridade de identidade,
malha atrasada, retomada e preservação das paradas de segurança.

O teste com modelos SCRFD/SFace e EfficientDet reais usa um vídeo sintético
de uma imagem de referência e uma porta USB simulada. Na execução local de
oito segundos houve 18 pedidos FRENTE e dois PARAR, ambos associados a
capturas comprovadamente acima de 600 ms. O alvo voltou a FRENTE e o teste
também verificou curvas, obstáculo e desaparecimento. Isso não representa
taxa de acerto biométrico nem ensaio físico.

O teste real passou a exigir movimento repetido e evidência de captura
expirada para qualquer parada durante a cena estável. Exigir zero paradas
independentemente da velocidade da máquina contrariaria o watchdog.
Os testes com tempos controlados continuam exigindo ausência de paradas
quando todas as observações permanecem recentes.

Passaram 125 testes Node (incluindo 8.190 variações de seguimento e a suíte
do controlador USB), 44 verificações Python, 48 cenários de navegador, os
testes de cadastro/migração e de inferência SCRFD/SFace. O teste geral da
página terminou sem erros de JavaScript nem requisições de modelos externos.

Firmware e controle USB não foram alterados. A liberação da parada de
emergência continua manual. A confirmação física deve verificar a leitura
do sensor e o sentido dos motores com supervisão.
