# Câmera e comandos do Modo 2

## Problema e causas verificadas

O usuário informou câmera atrasada e carrinho ONLINE que reconhecia a pessoa sem iniciar seguimento. No código anterior, `Seguir` somente selecionava o cadastro: a ativação do Modo 2 dependia de outro botão. O processamento facial também executava os modelos de cadastro no mesmo ambiente JavaScript da interface e da supervisão USB.

Em uma câmera controlada de 1280×720, com imagem de aquecimento do próprio Human movimentada suavemente, o processamento anterior demorou em média 3.892 ms por leitura. Esse tempo excede o limite vigente de 800 ms da observação facial. Reconhecer um nome nessas condições não autoriza movimento. Não temos um diagnóstico exportado da sessão física do usuário; isso demonstra causas possíveis e reproduzidas, sem atribuir todo o problema físico a uma única causa.

## Alteração

1. `Seguir` seleciona a pessoa e chama a preparação existente de Modo 2/câmera. `Parar de seguir` desmarca o alvo. Conexão, transação de modo, ACKs e liberação de emergência continuam pertencendo ao controlador USB existente.
2. Human 3.3.6 executa os mesmos modelos faciais em um worker local, com o backend WebAssembly 4.22.0 compatível com o TensorFlow.js já incluído. Os três binários, licença e hashes estão em `web/vendor/human/wasm/`; nenhuma imagem sai do navegador.
3. Durante o seguimento, a maior dimensão processada é limitada a 640 pixels. Rosto, descritor e malha permanecem ativos. Íris e classificadores de presença voltam a ser executados ao digitar um nome, solicitar confirmação por movimento ou cadastrar. A câmera visível conserva sua resolução.
4. As coordenadas faciais são convertidas de volta para o espaço original do vídeo sem modificar os dados em cache do Human. Isso preserva alinhamento da malha, recorte da foto e associação entre rosto e corpo.
5. O detector corporal não consome processamento quando não há alvo escolhido. Existe no máximo uma imagem facial e uma corporal em processamento, sem fila de quadros antigos. Carregamentos simultâneos compartilham a mesma solicitação facial; respostas de workers encerrados são ignoradas.
6. O painel indica quando reconheceu um rosto, mas precisa de enquadramento do corpo. Mostra o motivo de PARAR junto à entrega USB e inclui tempo de processamento facial no diagnóstico exportável.

Não foram alterados firmware/HEX, pinos, sensor, gestos, transporte USB, limiar de identidade, expiração de observações ou regras de parada física. Não foi aumentado o tempo tolerado de uma imagem antiga para fazer o carrinho andar.

## Medições locais

Chromium sem interface, mesmo computador, câmera controlada de 1280×720. Após dez leituras iniciais, janela de oito segundos. A sonda de interface é um temporizador nominal de 25 ms: os valores abaixo são seus intervalos observados, não uma medição direta do FPS da câmera.

- Antes: leitura facial média 3.892 ms; maior intervalo da sonda 1.020 ms; percentil 95 de 617 ms.
- Somente redução de entrada e modelos auxiliares, ainda em WebGL na interface: leitura média 1.574 ms. Insuficiente, portanto descartada como solução completa.
- WebAssembly ainda na interface: leitura média 246 ms, mas maior intervalo da sonda de 403 ms. Justificou separar a inferência da interface.
- Worker facial: leitura média 296 ms; maior intervalo da sonda 55 ms; percentil 95 de 27 ms.
- Workers facial e corporal reais simultâneos: leitura facial média 360 ms; maior intervalo da sonda 72 ms; percentil 95 de 30 ms. Última decisão corporal: idade de 125 ms e intervalo de captura de 148 ms.

Esses números variam com computador, câmera, carga, iluminação e cena. A fixture é de um rosto, portanto não valida seguimento físico nem identidade corporal completa. Para repetir a medição atual, servir o repositório, configurar `QT_SITE_URL` e executar `node tests/browser_face_latency.cjs`; `QT_BOTH_WORKERS=1` ativa a medição simultânea. O cadastro usado nessa medição fica apenas no contexto descartável do navegador de teste.

## Testes e revisão adversarial

- 114 testes de lógica, agendamento e processamento passaram. Incluem **8.190 cenários gerados**, distribuídos em 13 famílias com 630 variações determinísticas: alvo ausente, quadro antigo/duplicado/futuro, pessoa perdida, faces duplicadas, identidade conflitante, sensor inválido/antigo, obstáculo, baixa confiança, corpo sem aquisição facial e seguimento válido à esquerda/centro/direita.
- 41 cenários de Modo 2 no navegador, com inferência e USB simuladas: `Seguir` sozinho inicia o modo; com Arduino ONLINE, preserva ESTOP existente; após liberação explícita, decisões chegam a `CMD:FRENTE`/direções com ACK. Perda de alvo, sensor, atraso, cadastro, backup e retorno aos Modos 1 e 3 continuam verificados.
- 12 cenários de cadastro/malha e 33 testes do controlador Web Serial passaram. O circuito de erros interrompe após três falhas e permite recuperação explícita.
- 25 verificações estáticas/qualidade passaram, incluindo integridade do HEX existente.
- Worker facial real desenhou 478 pontos no cadastro. No perfil de seguimento, 468 pontos e descritor de 1.024 valores permaneceram disponíveis.
- Comparação real entre descritores WebGL existentes e worker WebAssembly, com a mesma fixture: similaridade reportada 1,00 nos perfis completo, seguimento e retorno ao cadastro, acima do limiar existente de 0,80. Os sinais de presença retornaram ao reativar o perfil de cadastro. Essa é uma verificação de compatibilidade de uma fixture, não taxa de reconhecimento de pessoas diferentes.
- Testes do cliente cobrem chamadas duplicadas, timeout, captura interrompida, erro de modelo e mensagem tardia após troca de worker. Testes de projeção impedem multiplicar novamente coordenadas armazenadas em cache.

## Complexidade, limites e escolhas

O custo de preparação da imagem cresce com seus pixels; no seguimento, essa entrada fica limitada. A busca facial existente cresce com rostos × cadastros × amostras × 1.024 componentes, além da ordenação dos candidatos. A projeção e o desenho crescem com os pontos/segmentos da malha. O número de imagens pendentes é constante; o histórico continua limitado a 60 transições e não contém biometria.

A divisão em workers acrescenta troca de mensagens e memória para o runtime. Ela foi adotada após medir bloqueio da interface, evitando substituir os modelos ou reescrever o controle do Arduino. A redução de resolução pode prejudicar rostos muito pequenos/distantes; nesses casos continuam valendo os limiares existentes, sem trocar silenciosamente de pessoa. Uma falha de worker ou timeout gera ausência de evidência e parada; não há fallback oculto para inferência pesada na interface.

O alvo de compatibilidade é o fluxo existente em Chrome/Edge com Web Serial, Worker, OffscreenCanvas e WebAssembly. Não há promessa de suporte a Internet Explorer, navegadores futuros ou falha zero. O teste físico com câmera montada e carrinho continua pendente. Não foi aberta porta USB real nem regravado Arduino.

## Fontes primárias

- [Human: exemplo oficial de execução em worker](https://github.com/vladmandic/human/blob/main/demo/index-worker.js).
- [Human: configuração de modelos, resolução e backend](https://github.com/vladmandic/human/blob/main/src/config.ts).
- [Human: aplicação da configuração em cada detecção](https://github.com/vladmandic/human/blob/main/src/human.ts).
- [TensorFlow.js: plataformas e backend WebAssembly](https://www.tensorflow.org/js/guide/platform_environment).
- [TensorFlow.js: binários WebAssembly e seleção de SIMD](https://github.com/tensorflow/tfjs/blob/master/tfjs-backend-wasm/README.md).
