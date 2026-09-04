# Autônomo isolado v1

Este firmware não usa câmera, gestos nem o controlador de três modos.
O firmware integrado permanece em `firmware/quantum_tracker_arduino`.

- Placa: Arduino UNO, 9600 baud.
- IN1/IN2/IN3/IN4: D7/D6/D5/D4. TRIG: D3. ECHO: D2.
- ENA e ENB precisam dos jumpers. Preserve a alimentação e o GND comum já conferidos.
- Inicia parado, inclusive depois de reset. Não grave nem mude fios com motores alimentados.
- `START` inicia; `STOP` ou `ESTOP` para. Comandos terminam em nova linha.
- O STOP não é liberado por recuperação do sensor nem por HELLO/PING.
- `STATUS` mostra fase, ordem elétrica, eco em microssegundos, leitura e tempo desde o boot.
- Identificação: `AUTO:READY:1`. Não opere este sketch pelo painel integrado.

Use **Códigos → Autônomo isolado** na página principal (`index.html#codigos`)
para gravar o HEX verificado, conectar, iniciar, parar e conferir o sensor.
`autonomo.html` permanece disponível como acesso alternativo ao mesmo controlador.
Os painéis da página principal bloqueiam conexões/gravações USB simultâneas,
inclusive durante a seleção da porta. Feche outras abas e o Monitor Serial.
Para voltar aos três modos, use Parar e desconectar e abra **Versão integrada**
na mesma seção para gravar o outro firmware. Trocar de página ou abrir essa seção
não troca o firmware instalado e não envia comandos de movimento.

## Sequência

Distância livre acima de 35 cm: frente contínua. Obstáculo: pausa de 150 ms,
ré de 400 ms, pausa de 150 ms, curva de 650 ms e duas novas leituras.
Se continuar perto, gira novamente, sem repetir a ré às cegas. Não há parada por
número de obstáculos ou tempo de missão. Curvas alternam entre novos encontros;
650 ms não garante um ângulo específico sem calibração física.

Leitura inválida ou vencida interrompe os motores e mantém a medição; duas
leituras válidas permitem reavaliar o caminho. Uma distância falsa mas dentro
da faixa não pode ser identificada como falsa só pelo software.

## Validação pendente no carrinho

Antes de START, confira um livro plano de frente para o sensor em 20 e 50 cm.
O teste anterior não acompanhou o objeto: ficou em 51,4 cm. Não é correto
considerar esse problema resolvido pela separação dos modos.

Depois, teste as rodas suspensas e finalmente o chassi no chão, longe de escadas,
pessoas e animais. O sensor frontal não mede a traseira nem evita queda de mesa.
Mantenha a chave de alimentação acessível. Sem USB, o autônomo continua na placa;
fechar a página só tenta enviar STOP, sem garantia. Saia por Parar e desconectar.

## Testes de software

`node tests/autonomous_isolated_logic.test.cjs` executa funções extraídas do sketch,
com IO e tempo simulados. Não simula potência, física, AVR ou overflow de millis.
Compile separadamente com `arduino-cli compile --fqbn arduino:avr:uno firmware/autonomo_isolado`.
Compilação e testes de lógica não comprovam movimento real.

`node tests/autonomous_bench_browser.cjs` testa ambos os painéis em Chromium,
com Web Serial simulada: comandos e confirmações, parada durante START pendente,
recusa de firmware incompatível, integridade do HEX, exclusão de uso simultâneo
da USB, cancelamento do seletor, reconexão e layout móvel. Não abre USB real.
