# Checkpoint - Etapa 3: Cadastro permanente de pessoas

## Status

CONCLUIDA EM SOFTWARE/TESTES OFFLINE. Webcam e hardware real permanecem
reservados para a Etapa 10.

## Implementado

- servico transacional unico para o botao `SALVAR CADASTRO`;
- validacao de nome e imagem;
- exigencia de exatamente um rosto por foto;
- foto persistente com caminho ASCII e nome de arquivo unico;
- pessoa e metadados persistentes em SQLite;
- embedding normalizado de 512 valores salvo em `data/embeddings`;
- recarga automatica da galeria ao iniciar;
- reconhecimento posterior por similaridade;
- prevencao de nome duplicado ignorando caixa, espacos e acentos;
- prevencao de rosto duplicado com outro nome;
- rollback de foto, pessoa e embedding em falhas intermediarias;
- exclusao explicita de pessoa, foto e embedding;
- migracao automatica de bancos anteriores para a coluna `name_key`.

## Arquivos alterados

- `app/quantum_app.py`
- `biometrics/face_recognition.py`
- `biometrics/registration_service.py`
- `database/database_manager.py`
- `recognition/insightface_service.py`
- `utils/config.py`
- `tests/test_registration_offline.py`
- `tests/test_insightface_real_offline.py`
- `docs/PESQUISA_ETAPA_3.md`
- `docs/CHECKPOINT_ETAPA_3.md`

## Testes executados

- cadastrar, fechar banco, reabrir, reconhecer, excluir e confirmar remocao;
- InsightFace real com modelos ONNX locais e imagem publica local;
- recorte contendo exatamente um rosto;
- embedding de 512 valores com norma 1;
- reconhecimento apos nova instancia do banco e do InsightFace;
- nome repetido com caixa, espacos e acentos diferentes;
- rosto repetido sob outro nome;
- foto vazia ou sem rosto;
- foto com varios rostos;
- duas fotos salvas no mesmo instante;
- falha simulada de disco ao salvar embedding;
- rollback total apos falha;
- migracao do banco real vazio;
- regressao global das Etapas 1, 2 e 3.

## Resultados

- 47 testes globais passaram;
- o InsightFace encontrou dois rostos na imagem publica de origem;
- o recorte de cadastro conteve exatamente um rosto;
- o fluxo real da interface criou foto, pessoa e embedding;
- apos fechar e reabrir completamente, reconheceu a pessoa com confianca maior
  que 99% na mesma imagem de teste;
- apos exclusao, banco e galeria ficaram vazios;
- falhas simuladas nao deixaram fotos nem linhas orfas;
- banco real permaneceu com 0 pessoas e 0 embeddings; somente a estrutura foi
  migrada para suportar a chave normalizada.

## Bugs corrigidos

- colisao de nomes de foto no mesmo segundo;
- falha de `cv2.imwrite` em pastas com caracteres acentuados no Windows;
- retorno de sucesso sem conferir se a foto foi realmente gravada;
- embeddings salvos na pasta de assets em vez da area persistente;
- cadastro parcial se a criacao do embedding falhasse;
- duplicatas por caixa, espacos ou acentos;
- cadastro ambiguo quando havia varias pessoas na foto.

## Limitacoes

- reconhecer a mesma imagem e mais facil do que reconhecer outra foto da mesma
  pessoa; variacoes reais ficam para a Etapa 10;
- o limiar de similaridade ainda precisara ser calibrado com pessoas reais;
- o modelo `buffalo_l` tem restricoes de licenca declaradas pelos mantenedores
  para usos fora de pesquisa nao comercial;
- fotos e embeddings biometricos sao dados sensiveis e exigem consentimento,
  controle de acesso e politica de privacidade numa distribuicao real;
- nenhum teste abriu webcam nem comprovou funcionamento em hardware.

## Proximo passo

Etapa 4: integrar, em simulacao, deteccao humana e maquina de estados para que o
robo logico fique parado sem alvo, siga com alvo e sempre priorize a prevencao
de colisao. Arduino e robo fisico continuam exclusivos da Etapa 10.
