# Cópia anterior ao teste de potência

`backup_antes_pwm.ino` e `backup_antes_pwm.ino.hex` são cópias byte a byte dos
arquivos existentes antes do teste. Não foram gerados a partir do texto enviado,
que continha trechos duplicados e uma versão antiga do controle por sensor.

SHA-256 dos bytes locais originais:

- INO: `9084ac57e562b75b0d805b80037182b3fb114b95eb382b582a2b6548079a6e9c`
- HEX: `12fd81dcb4329e95fbaad1a3dc6c27ea2605a175bcd298f97f0633f6700da0f2`

O Git pode normalizar quebras de linha; isso não altera o programa.

Para voltar na placa, abra `backup_antes_pwm.ino` na IDE, selecione Arduino Uno
e grave com os motores sem alimentação e as rodas suspensas. A ligação original
permanece igual: D7/D6/D5/D4 para IN1/IN2/IN3/IN4, jumpers ENA/ENB instalados.

Restaurar arquivos do projeto ou reverter um commit não regrava uma placa já
instalada: é necessário carregar o firmware anterior novamente no Arduino.
