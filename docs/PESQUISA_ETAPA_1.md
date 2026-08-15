# Pesquisa aplicada - Etapa 1

## HC-SR04

O modulo trabalha em 5 V, recebe pulso de trigger de pelo menos 10 us e mede
aproximadamente de 2 cm a 400 cm. O firmware utiliza pulso de 10 us, timeout de
25 ms e descarta leituras abaixo de 2 cm.

Fonte consultada: datasheet HC-SR04 distribuido pela DigiKey/SparkFun.

## L298N

O L298 possui duas pontes H e entradas Enable independentes. Com os jumpers ENA
e ENB instalados, as quatro entradas logicas controlam os dois sentidos dos
motores. O driver possui queda de tensao, portanto a simulacao logica nao pode
comprovar desempenho eletrico.

Fonte consultada: datasheet DS0218 Rev. 5 da STMicroelectronics.

## Decisoes resultantes

- duas de tres leituras confirmam obstaculo;
- ausencia de eco nao e tratada como obstaculo inventado;
- o sensor frontal nao determina qual lado esta livre;
- curvas alternam direita/esquerda em vez de fingir escolha espacial;
- curvas repetidas ganham duracao maior;
- o robo nao recua automaticamente sem sensor traseiro;
- cinco bloqueios em uma janela movel de quinze segundos acionam seguranca;
- testes eletricos e mecanicos ficam para a Etapa 10.
