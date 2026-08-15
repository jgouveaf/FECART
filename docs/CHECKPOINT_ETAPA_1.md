# Checkpoint - Etapa 1: Robo autonomo basico

## Status

CONCLUIDA EM SOFTWARE/SIMULACAO. A validacao no equipamento fisico nao faz
parte desta etapa e permanece reservada para a Etapa 10.

## Implementado

- testes isolados de motores e HC-SR04 reservados para a Etapa 10;
- firmware autonomo sem app, Bluetooth, ESP32, gestos ou comandos USB;
- confirmacao de obstaculo por duas de tres leituras;
- sequencia parar, girar no proprio eixo e continuar;
- eliminacao do recuo cego, pois nao existe sensor traseiro;
- curvas alternadas direita/esquerda e progressivamente maiores;
- parada de seguranca apos cinco desvios em uma janela movel de quinze segundos;
- simulador logico da maquina de estados;
- simulador 2D com corpo circular, paredes, caixas, feixe ultrassonico e colisao;
- guia de pinagem e diagnostico fotografico para uso futuro na Etapa 10.

## Arquivos alterados

- `firmware/quantum_tracker_arduino/quantum_tracker_arduino.ino`
- `firmware/teste_motores/teste_motores.ino`
- `firmware/teste_sensor_hcsr04/teste_sensor_hcsr04.ino`
- `firmware/simulacao/simulador_robo.py`
- `firmware/simulacao/test_simulador_robo.py`
- `firmware/simulacao/arena_2d.py`
- `firmware/simulacao/test_arena_2d.py`
- `firmware/README_ETAPA_1.md`
- `docs/DIAGNOSTICO_INICIAL.md`
- `docs/PESQUISA_ETAPA_1.md`
- `docs/CHECKPOINT_ETAPA_1.md`

## Testes executados

- compilacao para Arduino UNO com Arduino CLI 1.5.1 do IDE 2.3.10;
- caminho livre, ruido isolado, ausencia de eco e confirmacao 2/3;
- sequencia de parada, curva e retomada;
- alternancia e aumento progressivo de curvas;
- cinco obstaculos na janela movel e expiracao de eventos antigos;
- sincronizacao entre constantes do simulador e do sketch;
- geometria de raios, feixe ultrassonico e colisao circular;
- quatro arenas: parede, objeto pequeno, varios objetos e corredor;
- vinte repeticoes de estresse de sessenta segundos.

## Resultados

- dezenove testes automatizados passaram sem conexao com o robo;
- quatro arenas de trinta segundos terminaram sem colisao;
- vinte repeticoes de estresse terminaram sem colisao;
- firmware final compilou: 1974 bytes de flash e 38 bytes de RAM;
- nenhum resultado fisico foi inventado.

## Bugs corrigidos

- recuo automatico sem sensor traseiro;
- janela fixa de desvios, substituida por janela movel real;
- falsa suposicao de que um HC-SR04 frontal escolhe o lado livre;
- curva de duracao unica em bloqueios repetidos.

## Limitacoes

- simulacao nao testa corrente, bateria, mau contato, polaridade, atrito ou motor;
- um HC-SR04 fixo e frontal nao determina qual lado esta livre;
- os parametros fisicos do modelo sao aproximacoes e serao calibrados na Etapa 10;
- a pinagem fotografada e a alimentacao serao corrigidas somente na Etapa 10.

## Proximo passo

Iniciar a Etapa 2 com auditoria offline da captura, deteccao de pessoas,
tracking e consistencia de IDs. Nao conectar nem enviar sketches ao robo.
