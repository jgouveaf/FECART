# Conexão USB: estado de falha e recuperação

## Problema confirmado

Após timeout de identificação, `connectRobot` publicava ERROR e fechava a
porta enviando ESTOP por precaução. `markTx` interpretava qualquer escrita
com `connected=false` como CONNECTING, sobrescrevendo ERROR. O painel ficava
com robô em falha e comunicação eternamente conectando. Um teste novo
reproduziu exatamente essa divergência antes da correção.

Isso explica o estado inconsistente, **não prova por que o UNO físico deixou
de responder**. Não houve acesso ao dispositivo nesta alteração.

## Mudança limitada

- Registro de TX/RX não decide o estado da conexão. Mantidos READY V7 e os
  ACKs de ESTOP, CMD:PARAR e MODE antes de declarar ONLINE.
- Respostas de uma leitura pendente, entregues durante o fechamento ou após
  mudança de sessão, são descartadas antes de afetar o painel.
- Diagnóstico separado para ausência total de bytes, dados sem identificação,
  sketch autônomo isolado (AUTO/IDE5), versão QT incompatível e V7 sem ACK.
- Evidência de identificação é reiniciada a cada tentativa. Nenhum timeout
  foi simplesmente estendido e nenhuma validação foi removida.
- AUTO/IDE5 e versões incompatíveis mostram link para Códigos. O link apenas
  navega: não grava, reinicia a placa ou libera motores automaticamente.
- Novo identificador de cache no controlador web. Nenhum .ino/.hex, pinagem,
  polaridade, temporização de movimento ou detector de gestos foi alterado.

## Verificação executada sem hardware

- 33 testes Web Serial Node aprovados (porta simulada), incluindo os 26
  anteriores. Cobrem quatro assinaturas isoladas, três ACKs ausentes,
  silêncio, bytes ilegíveis/incompletos, RX tardio e nova conexão em ESTOP.
- Quatro cenários adicionais no Chromium com streams seriais simulados:
  rótulos reais do painel, link de recuperação, fechamento e reconexão V7
  permanecendo bloqueada. Nenhuma porta ou câmera física acessada.
- 15 cenários de lógica do firmware aprovados, com IO/tempo simulados.
- Bateria Python: 659 testes executados, 657 aprovados e dois ignorados.
  Não somar wrappers que já executam testes Node como testes independentes.
- Smoke do site no Chromium com câmera artificial: câmera, modelos locais,
  seis comandos virtuais, ausência de gesto, teclado e três larguras de tela
  aprovados, sem erros de página ou requisições externas.

## Limites e próximo teste

O protocolo continua exigindo V7: o código autônomo separado que funciona
na IDE não implementa a comunicação de gestos do painel. Não aceitar esse
código como ONLINE é intencional. Instalar o firmware só é indicado quando
essa incompatibilidade for identificada; silêncio também pode envolver porta,
cabo, alimentação ou velocidade serial.

Sem resposta/ACK, a parada enviada na limpeza não é confirmação de que as
rodas pararam. Desligar a alimentação dos motores antes de recuperar a conexão
ou gravar, e só testar movimento com rodas suspensas e supervisão.
Não se afirma que a falha física foi resolvida, nem precisão perfeita dos
gestos, nem ausência de problemas no simulador físico de arena.

Referência consultada: [Web Serial — documentação do Chrome](https://developer.chrome.com/docs/capabilities/serial),
sobre seleção explícita, baud rate e liberação dos streams ao fechar a porta.
