# Cadastro facial sem desafio de presença

## Problema e decisão

O cadastro ficava aguardando presença/vivacidade; os avisos de presença, vivacidade e piscar permaneciam amarelos. No código anterior, presença automática ou confirmação por movimento bloqueava a aceitação. Piscar era um indicador auxiliar. No perfil de identificação, os classificadores desligados também mantinham os avisos sem confirmação.

O usuário solicitou retirar essa exigência, pois o projeto não precisa distinguir uma pessoa de uma foto no cadastro. Esta alteração substitui a confirmação descrita nos documentos anteriores de presença e no item 3 de `MODO_2_CAMERA_COMANDOS_2026-09-11.md`.

## Alteração mínima

- Cadastro direto: digitar o nome, manter um rosto legível de frente e clicar em cadastrar. Removidos os três indicadores e a confirmação por movimento.
- Íris, antispoof e liveness ficam desligados desde o carregamento e nos dois perfis de processamento. A malha facial e os descritores de identidade continuam ativos.
- Removido o módulo de desafio que deixou de ser utilizado. Novos registros informam `presenceMethod: NOT_REQUIRED`, sem inventar escores de presença.
- Preservadas as cinco etapas de captura, consistência entre amostras, qualidade básica, quadro recente, cancelamento e armazenamento local. Descritores exatamente iguais continuam sendo deduplicados pelo armazenamento existente.
- Cadastros antigos, backup, seleção da pessoa, seguimento, USB, firmware, gestos e proteções do carrinho não foram alterados.

## Validação executada

- 14 testes de processamento, cliente do worker e malha passaram.
- 12 cenários no navegador passaram: cadastro com escores de presença zerados ou ausentes, sem piscar nem virar; persistência; malha; bloqueio de duas pessoas, rosto pequeno, pose lateral, baixa confiança, descritor inválido, câmera congelada e falha de inferência; reinício da câmera.
- 41 cenários de regressão do Modo 2 passaram com inferência e USB simuladas, incluindo persistência, seguimento, parada e retorno aos Modos 1 e 3.
- 21 verificações estáticas passaram.
- Modelos reais: os perfis de cadastro e seguimento preservaram similaridade 1,00 para a mesma imagem de teste, descritor de 1.024 valores e malha de 468 pontos. Nenhum modelo de íris, antispoof ou liveness foi solicitado; os modelos e o WebAssembly permaneceram locais.
- Aplicação com modelos reais e vídeo gerado da imagem de aquecimento do Human: as cinco etapas de cadastro concluíram e o registro foi salvo no IndexedDB sem desafio de presença. A malha manteve 468 pontos e 2.640 índices de triangulação.

## Limites e regressões consideradas

O cadastro passa a aceitar também uma foto de um rosto: é consequência intencional da solicitação. As verificações restantes evitam salvar amostras ilegíveis, misturadas ou antigas. Não foi relaxado o limite de idade das observações nem qualquer regra de movimento. Os testes usam contextos descartáveis de navegador; não houve teste com a câmera física do usuário nem acionamento do Arduino.
