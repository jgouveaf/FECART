# Tutorial do painel web — Quantum Tracker

Este guia explica o fluxo correto para entrar no painel, trocar um código, gravar o Arduino, conectar o robô e cadastrar rostos. Faça o primeiro teste com as rodas fora do chão.

## 1. Entrar e conferir a senha

1. Abra <https://jgouveaf.github.io/FECART/> no Chrome ou Edge.
2. Digite o usuário e a senha do projeto.
3. Se precisar conferir o que digitou, clique em **Mostrar**. Clique em **Ocultar** para esconder novamente.
4. Clique em **Entrar**.

Resultado esperado: o painel aparece. O botão **Sair** encerra o acesso salvo nesse navegador.

> A tela de entrada é somente uma barreira visual em um site estático. Ela não deve ser usada para guardar segredos ou dados sensíveis.

## 2. Trocar ou editar um código

1. Abra **Códigos**.
2. Escolha a aba **Código principal**, **Teste dos motores** ou **Teste do sensor**.
3. Para usar outro arquivo, clique em **Atualizar código** e selecione um `.ino` ou `.txt` de até 256 KB. Também é possível editar o texto diretamente.
4. O site verifica se o arquivo contém `void setup()` e `void loop()`.
5. Clique em **Salvar edição** para manter a versão no navegador.
6. Clique em **Baixar .ino**.

Resultado esperado: o status mostra **IMPORTADO · SALVE A EDIÇÃO** e, depois de salvar, **EDITADO NESTE NAVEGADOR**. Ao trocar de aba ou sair com mudanças não salvas, o painel pede confirmação.

Importante: editar ou importar no site não grava o Arduino. O botão **Rodar** inicia uma função que já existe no firmware gravado; ele não compila nem envia o texto do editor.

## 3. Gravar o Arduino UNO

1. Abra o `.ino` baixado no Arduino IDE.
2. Selecione a placa **Arduino UNO** e a porta correta.
3. Feche qualquer Monitor Serial que esteja usando a porta.
4. Clique em **Upload**.
5. Aguarde a confirmação de envio.
6. Feche o Monitor Serial e o Arduino IDE para liberar a porta.

Resultado esperado: a IDE informa que o upload terminou sem erro. Se aparecer “acesso negado”, algum programa ainda está usando a porta.

## 4. Conectar e operar o robô

1. Volte ao painel e abra **Câmeras & robô**.
2. Clique em **Conectar Arduino USB** e selecione a porta do UNO.
3. Aguarde o handshake do firmware.
4. Escolha o modo desejado e faça os testes primeiro com as rodas levantadas.

Resultado esperado: os cartões **ROBÔ** e **COMUNICAÇÃO** ficam online e a telemetria passa a atualizar. O Web Serial exige HTTPS e um navegador Chromium compatível.

## 4.1. Usar a Central de testes no Arduino real

1. Abra **Central de testes**.
2. Em **Destino do teste**, escolha **Arduino real**.
3. Se necessário, clique em **Conectar Arduino** e selecione a porta USB do UNO.
4. Confira as rodas e libere o ESTOP no painel **Câmeras & robô**.
5. Selecione **Testar gestos** para habilitar os cinco botões manuais.
6. Use os botões ou o teclado: `1/↑` frente, `2/→` direita, `3/←` esquerda, `4/↓` parar e `5/G` girar.

Resultado esperado: o veículo virtual continua mostrando uma prévia, enquanto o mesmo comando é enviado ao Arduino e confirmado por ACK. O comando físico expira automaticamente em cerca de um segundo se não houver nova entrada. Sensor, ESTOP, timeout e confirmação serial continuam tendo prioridade.

Selecionar apenas **Arduino real** não movimenta o carrinho. A conexão começa bloqueada; é preciso escolher o modo e liberar conscientemente o ESTOP.

## 5. Cadastrar e reconhecer uma pessoa

1. Ative a câmera e abra a aba facial.
2. Deixe somente uma pessoa enquadrada, de frente, com boa iluminação.
3. Digite o nome e clique em **Validar e cadastrar rosto**.
4. Mova levemente o rosto enquanto o painel coleta cinco amostras.
5. Não exclua o cadastro para reconhecer a mesma pessoa depois.

Resultado esperado: o nome só é aceito quando a média das melhores amostras atinge pelo menos 80%, existem ao menos três referências válidas e não há outro cadastro quase tão parecido. Caso contrário, aparece como desconhecido.

O cadastro fica no IndexedDB desse navegador. Use **Exportar backup** para copiar as identidades antes de trocar de computador, perfil ou navegador; o arquivo contém dados biométricos e deve ser guardado com segurança.

## 6. Configurar gestos

1. Abra **Códigos** e vá até **Comandos & configurações**.
2. Escolha o comando associado a cada quantidade de dedos.
3. Ajuste confiança, intervalo e tempo de instabilidade.
4. Clique em **Salvar configurações**.

Resultado esperado: as mudanças passam a valer imediatamente, sem F5. Se o navegador bloquear o armazenamento local, o painel avisa que a configuração vale apenas durante a sessão.

## Recuperação rápida

- **Porta ocupada:** feche Arduino IDE, Monitor Serial e outros sites conectados ao UNO.
- **Câmera bloqueada:** autorize a câmera no cadeado da barra de endereço e tente novamente.
- **Código inválido:** confirme que o arquivo possui `setup()` e `loop()` e não ultrapassa 256 KB.
- **Edição perdida:** antes de limpar dados do navegador, baixe o `.ino` e exporte o backup facial.
- **Face confundida:** recadastre com cinco amostras nítidas, boa luz e somente uma pessoa no quadro.

## Próximos passos — ponto de retomada

Quando o trabalho continuar, siga esta ordem:

1. Abra a versão publicada e confirme que aparecem **Guia rápido**, **Atualizar código**, **Mostrar/Ocultar senha**, **Sair do painel** e o destino **Arduino real** na Central de testes.
2. Faça o ensaio físico do **Teste dos motores** com as rodas levantadas. Anote se as duas rodas giram juntas e se frente/trás estão corretos.
3. Faça o ensaio do **HC-SR04** com objetos em 10, 20, 40 e 80 cm. Anote leituras `SEM ECO` ou `999 cm`.
4. Rode o modo autônomo no chão, em área livre, e ajuste somente depois de medir o ângulo e o raio real da curva.
5. Cadastre pelo menos duas pessoas diferentes, com cinco amostras de cada, e teste alternando quem fica diante da câmera. O esperado é reconhecer apenas acima de 80% e mostrar desconhecido quando houver dúvida.
6. Exporte o backup facial, importe em um perfil de navegador de teste e confirme que nomes iguais são atualizados, não duplicados.
7. Teste a troca de gestos e confirme que os rótulos e comandos mudam imediatamente, sem atualizar a página.
8. Registre no relatório: data, computador/navegador, porta COM, alimentação usada, resultado observado e foto/vídeo do ensaio físico.

Pendências que exigem o robô e não podem ser concluídas só pelo software:

- calibrar os tempos de ré e curva para chegar perto de 90 graus;
- medir queda de tensão das baterias com os dois motores ligados;
- confirmar distância e estabilidade do HC-SR04 no chassi real;
- validar desconexão USB, timeout e parada de emergência com as rodas levantadas;
- testar o reconhecimento com iluminação e pessoas reais diferentes.

Antes de editar novamente, baixe ou copie a versão atual do repositório e consulte `docs/REVISAO_QUALIDADE_2026-09-01.md`. Não altere pinos, tempos de motor e lógica facial ao mesmo tempo: faça uma mudança por rodada e repita os testes correspondentes.
