# Pesquisa tecnica - Etapa 3

## Reconhecimento facial

O projeto usa `FaceAnalysis` do InsightFace com ONNX Runtime em CPU. O fluxo
oficial permite detectar rostos e extrair vetores faciais normalizados. A
comparacao local utiliza produto escalar entre vetores normalizados, equivalente
a similaridade de cosseno.

Referencias:

- https://github.com/deepinsight/insightface/tree/master/python-package
- https://github.com/deepinsight/insightface/blob/master/examples/demo_analysis.py

## Persistencia

SQLite foi mantido por ser local, portatil e suficiente para a escala do
projeto. Fotos e vetores ficam como arquivos em `data/`, enquanto o banco guarda
metadados e caminhos. O cadastro coordena os dois lados e executa rollback se
uma etapa falhar.

Referencia:

- https://docs.python.org/3/library/sqlite3.html

## Licenca

O codigo da biblioteca InsightFace e aberto, mas os modelos pre-treinados
fornecidos pelo projeto, incluindo o pacote `buffalo_l`, possuem termos proprios
e sao descritos pelos mantenedores como destinados a pesquisa nao comercial.
Antes de qualquer distribuicao ou uso comercial, sera necessario confirmar ou
substituir a licenca do modelo.

## Decisoes

- exigir exatamente um rosto na foto de cadastro;
- impedir nomes duplicados ignorando caixa, espacos e acentos;
- impedir o mesmo rosto sob outro nome quando a similaridade ultrapassar o
  limiar configurado;
- salvar embeddings em `data/embeddings`, nao em `assets`;
- usar nomes de arquivos ASCII, unicos e seguros no Windows;
- manter nome com acentos no banco e na interface;
- excluir foto e embedding somente mediante acao explicita;
- falhar sem deixar cadastro parcial.
