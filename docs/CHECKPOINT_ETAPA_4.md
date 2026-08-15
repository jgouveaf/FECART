# Checkpoint - Etapa 4: Robo logico reagindo a deteccao humana

## Status

CONCLUIDA EM SOFTWARE/SIMULACAO. O robo, Arduino, HC-SR04 e portas seriais
fisicas continuam bloqueados ate a Etapa 10.

## Implementado

- seguimento autonomo da primeira pessoa visivel;
- estado parado quando nao existe pessoa;
- comandos frente, esquerda e direita conforme posicao do alvo;
- parada quando o alvo fica ocluido, perdido ou proximo demais;
- supervisor de obstaculos com prioridade sobre o seguimento;
- histerese de 20/28 cm para evitar oscilacao de comando;
- estado `AVOIDING_OBSTACLE`;
- distancia frontal e obstaculos exclusivamente virtuais no mapa 2D;
- sincronizacao entre comando logico e robo desenhado no simulador;
- parada explicita nao cancelada por nova deteccao;
- transporte fisico bloqueado por `hardware_enabled=False`;
- nenhuma enumeracao de COM ou conexao serial antes da Etapa 10.

## Arquivos alterados

- `app/quantum_app.py`
- `robot/esp32_adapter.py`
- `robot/robot_controller.py`
- `robot/robot_models.py`
- `robot/safety_supervisor.py`
- `simulator/synthetic_world.py`
- `simulator/visual_simulator.py`
- `utils/config.py`
- `tests/test_human_following_offline.py`
- `tests/test_visual_simulator_safety_offline.py`
- `docs/CHECKPOINT_ETAPA_4.md`

## Testes executados

- sem humano;
- primeiro humano visivel;
- humano centralizado, a esquerda e a direita;
- alvo ocluido e perdido;
- obstaculo durante seguimento;
- histerese de liberacao;
- prioridade da seguranca sobre comando de avancar;
- parada explicita persistente;
- sensor virtual integrado ao mapa visual;
- cem quadros sem humano no simulador visual;
- dez mil quadros alternando pessoa, ausencia e obstaculos;
- tentativa de enumerar e conectar `COM5` com hardware bloqueado;
- regressao global das Etapas 1 a 4.

## Resultados

- 58 testes globais passaram;
- sem pessoa, o comando permaneceu `PARAR`, mesmo com obstaculo proximo;
- com pessoa alinhada e distante, o comando foi `FRENTE`;
- com obstaculo virtual a ate 20 cm, o estado mudou para
  `AVOIDING_OBSTACLE` e o avanco foi interrompido;
- a seguranca permaneceu ativa ate 28 cm e depois liberou o seguimento;
- o robo visual ficou imovel por cem quadros sem pessoa;
- `available_ports()` retornou lista vazia, `connect("COM5")` foi recusado e o
  transporte permaneceu desconectado;
- firmware da Etapa 1 continuou compilando, sem upload.

## Bugs corrigidos

- controlador exigia selecao manual antes de seguir uma pessoa;
- simulador visual e controlador logico podiam mostrar comandos diferentes;
- controle de obstaculo nao estava ligado ao modo simulador do aplicativo;
- interface poderia enumerar portas antes da fase de hardware;
- nome legado `ESP32` aparecia no robo simulado, apesar de o projeto usar UNO.

## Limitacoes

- distancia, dinamica e obstaculos sao modelos virtuais aproximados;
- um unico sensor frontal nao escolhe o melhor lado livre;
- o simulador ainda nao representa inercia, derrapagem, bateria ou latencia USB;
- a deteccao humana do teste integrado usa alvos/caixas simuladas; YOLO real foi
  validado separadamente na Etapa 2;
- nenhuma afirmacao de movimento fisico foi feita.

## Proximo passo

Etapa 5: revisar e endurecer todo o subsistema de movimento em software,
incluindo falhas, invariantes de seguranca, testes prolongados e regressao.
Hardware permanece exclusivo da Etapa 10.
