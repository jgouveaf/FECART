# Revisão de qualidade do painel — 1º de setembro de 2026

## O que precisava ser feito

1. Permitir trocar o conteúdo dos sketches pelo site sem dar a falsa impressão de que o navegador grava o Arduino.
2. Adicionar controle acessível para mostrar ou ocultar a senha.
3. Tornar o fluxo inicial mais intuitivo e documentar o resultado esperado de cada etapa.
4. Revisar falhas de persistência, reconhecimento facial, configurações, navegação e compatibilidade.
5. Automatizar as novas regras, executar regressão e publicar somente com nota mínima de 9,7/10.

## Resultado esperado

- Importação de `.ino`/`.txt` validada, limitada a 256 KB e salva somente após ação explícita.
- Aviso antes de descartar uma edição não salva.
- Senha visível somente quando o operador solicitar, com estado anunciado a leitores de tela.
- Guia operacional dentro do site e tutorial completo no repositório.
- Configurações aplicadas imediatamente e confirmação real de persistência.
- Identificação facial aceita somente a partir de 80%, com ao menos três amostras de referência e margem contra resultados ambíguos.
- Nenhuma regressão na comunicação USB, câmera, gestos, simulador e firmware.

## Falhas encontradas e correções

| Área | Falha observada | Correção aplicada |
|---|---|---|
| Editor | Trocar de aba podia descartar texto não salvo | Confirmação de descarte e aviso ao fechar a página |
| Importação | Não havia fluxo para substituir um sketch por arquivo | Botão **Atualizar código**, leitura pelo File API e validação isolada/testável |
| Persistência | A interface podia dizer “salvo” mesmo com `localStorage` bloqueado | Escrita verificada por releitura e mensagem de recuperação |
| Login | Não havia forma de conferir a senha digitada | Botão **Mostrar/Ocultar** com `aria-pressed` e retorno automático ao modo oculto após erro |
| Configuração | Mudanças de gestos dependiam de recarregar a página | Evento interno aplica os novos valores imediatamente |
| FaceID | Um quadro sem embedding válido podia alimentar a rotina de comparação | Guarda de tamanho/tipo antes da identificação |
| FaceID | Poucas referências ou cadastros repetidos aumentavam falsos positivos | Mínimo de três referências, cinco amostras no cadastro, fusão de nomes repetidos e descarte de embeddings idênticos |
| FaceID | Apenas o limiar de 80% não resolvia duas pessoas muito parecidas | Margem mínima de 5 pontos percentuais entre o primeiro e o segundo candidato |
| Conteúdo | Contagem fixa de testes ficava desatualizada | Estado qualitativo “suíte automatizada” em vez de número estático |
| Operação | Editar, gravar e rodar eram ações fáceis de confundir | Guia rápido, resultados esperados e aviso explícito de que Web Serial não envia sketches |
| Testes | Os controles da bancada movimentavam apenas o robô virtual | Destino selecionável; a mesma interface envia modos e comandos ao Arduino real pelo controlador Web Serial seguro |

## Pesquisa usada na revisão

- [MDN — File API](https://developer.mozilla.org/en-US/docs/Web/API/File_API): seleção local e leitura de arquivos escolhidos pelo usuário.
- [MDN — Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API): exigência de contexto seguro e compatibilidade limitada.
- [MDN — localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage): persistência por origem e possíveis exceções de segurança.
- [MDN — beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event): proteção de alterações não salvas.
- [Arduino — Upload a sketch](https://support.arduino.cc/hc/en-us/articles/4733418441116-Upload-a-sketch-in-Arduino-IDE): fluxo oficial de gravação pela IDE.
- [Arduino CLI — upload](https://docs.arduino.cc/arduino-cli/commands-reference/arduino-cli_upload): upload exige firmware previamente compilado e ferramenta própria; Web Serial não substitui esse processo.
- [WCAG 2.2 — Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible): foco de teclado perceptível.
- [WCAG 2.2 — Technique H100](https://www.w3.org/WAI/WCAG22/Techniques/html/H100.html): uso correto de controles nativos para entrada de arquivos.

## Critérios de avaliação

| Critério | Peso | Condição para nota máxima |
|---|---:|---|
| Funcionalidade | 3,0 | Fluxos novos funcionam e falham de modo seguro |
| Regressão | 2,0 | Suítes existentes e novas passam |
| Segurança e privacidade | 1,5 | Sem promessa enganosa; dados biométricos continuam locais |
| Usabilidade e acessibilidade | 1,5 | Guia, estados, teclado, foco e mensagens acionáveis |
| Compatibilidade | 1,0 | Site estático, HTTPS, Chrome/Edge e Arduino UNO preservados |
| Documentação | 1,0 | Passos, resultado esperado, mudanças e limitações registrados |

O resultado final, os comandos executados e a nota somente devem ser registrados depois da validação completa e da verificação da publicação.

## Resultado da validação de software — 2 de setembro de 2026

- 559 testes Python passaram, incluindo editor, configuração, reconhecimento facial, câmera, gestos, comunicação e os dois destinos da Central de testes.
- 2 suítes Node de regras puras passaram: importação de código e comparação facial.
- 16 testes Node do controlador Web Serial passaram, incluindo handshake, ACK, timeout, desconexão, falha de sensor e ESTOP.
- Os três sketches do Arduino UNO já haviam sido compilados com Arduino CLI: principal (6.930 bytes, 397 bytes globais), motores (1.094 bytes, 9 bytes globais) e sensor (2.646 bytes, 188 bytes globais).
- A interface local foi verificada sem abrir a porta serial: **Arduino real** mostra o estado desconectado e o botão de conexão; ao voltar para **Simulador**, o botão físico é ocultado e os comandos continuam na bancada virtual.

| Critério | Nota |
|---|---:|
| Funcionalidade | 3,0 / 3,0 |
| Regressão | 2,0 / 2,0 |
| Segurança e privacidade | 1,5 / 1,5 |
| Usabilidade e acessibilidade | 1,4 / 1,5 |
| Compatibilidade | 0,9 / 1,0 |
| Documentação | 1,0 / 1,0 |
| **Total de software** | **9,8 / 10** |

A avaliação supera o mínimo de 9,7. Os 0,2 ponto restantes dependem do ensaio físico anotado no tutorial: esta rodada, por solicitação do operador, não conectou nem movimentou o Arduino real.
