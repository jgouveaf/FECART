# Teste temporário de potência, sem mudar fios

O firmware principal usa os valores pedidos: esquerda **200**, direita **170**,
em uma escala de 0 a 255. Eles ajustam o tempo de acionamento, não garantem uma
velocidade específica nem que o carrinho ande reto sob qualquer carga.

Mantenha os jumpers ENA/ENB e todas as ligações atuais. Não conecte D9/D10.
O arquivo enviado propunha esses pinos, mas o pedido posterior foi manter a
ligação existente. Como D4/D7 não têm PWM de hardware, o teste usa interrupções
do Timer1 para modular IN1..IN4 em aproximadamente 977 Hz.

PARAR zera as direções e impede que a próxima interrupção reative os motores.
Os intervalos sem acionamento também deixam as duas entradas da ponte em LOW,
com os enables habilitados. Não foi alterado o Timer0 de millis/micros.
Não use Servo ou outra biblioteca que ocupe o Timer1 com este teste.

Somente a saída dos motores foi ajustada. A troca de modos, o ESTOP, o timeout
remoto e a leitura do sensor apenas no Modo 1 mantêm a lógica atual. O trecho
colado que recolocava o sensor nos modos 2 e 3 não foi reaplicado.

O texto enviado também continha dois loops e inicialização dentro da função
dos motores. Essas partes foram corrigidas na integração, sem copiar o trecho
de e-mail para o programa.

Antes de testar no chão, grave com a alimentação dos motores desligada e
verifique frente, trás e PARAR com as rodas suspensas. Compare se os dois
motores conseguem partir com esses valores; a força em rampas pode diminuir.
Compilação e testes de lógica não comprovam funcionamento físico.

Se o teste piorar o movimento, a versão anterior está em
`backup_antes_pwm/backup_antes_pwm.ino`, pronta para gravar novamente. Nenhuma
mudança de ligação é necessária para a volta.

Referências: [pinos PWM do Arduino Uno](https://support.arduino.cc/hc/en-us/articles/9350537961500-Use-PWM-output-with-Arduino)
e [datasheet do L298](https://www.st.com/resource/en/datasheet/l298.pdf).
