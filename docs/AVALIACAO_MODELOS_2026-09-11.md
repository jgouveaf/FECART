# Avaliação de reconhecimento facial para o Modo 2

Data: 11/09/2026. Código do site avaliado: `1d7515fbb085cb165386447995b2809e21b3fe46`.

## Decisão para o projeto

O DeepFace é um candidato útil, mas os testes não justificam trocar imediatamente o reconhecimento do site. A configuração DeepFace + YuNet + SFace foi a mais rápida neste ensaio; o InsightFace que já existe no projeto detectou mais casos, incluindo o rosto de perfil que Human e YuNet perderam.

Para a aplicação Python, priorizar a avaliação do InsightFace existente em vídeo real. Para o site, manter o Human até comprovar uma alternativa no fluxo completo. Uma migração para Python exige um processo local, transporte de imagens/resultados e novos testes de latência e desconexão. GitHub Pages não executa esse servidor Python. Nenhum desses componentes foi adicionado nesta avaliação. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

Reconhecer a identidade e acompanhar a posição são tarefas diferentes. Quando a pessoa vira de costas, um reconhecedor facial não recebe um rosto utilizável. A continuidade precisa associar o alvo ao corpo observado, lidar com oclusão e parar quando a associação fica ambígua. Trocar somente a biblioteca facial não resolve essa parte.

## O que foi executado

Três motores processaram os mesmos 20 casos, sequencialmente, neste computador: Windows, Intel Core i5-10300H, quatro núcleos e oito processadores lógicos.

- **Human 3.3.6**, no worker WASM usado pelo site, Chromium sem interface. Inclui malha facial, descritor e transferência da imagem. Reutilização de descritores e saltos de detecção desativados para não reaproveitar a pessoa da imagem anterior.
- **DeepFace 0.0.99**, reconhecimento SFace e detector YuNet, Python 3.12.3 e OpenCV 4.13.0. Alinhamento ativo, `enforce_detection=True` e antiphoto desativado. Não foi usado o modelo padrão VGG-Face nem a demonstração `stream`.
- **InsightFace 1.0.1**, Buffalo L, Python 3.12.14 e ONNX Runtime 1.27.0 em CPU, detector com entrada 320 × 320. Somente detecção e reconhecimento; a aplicação Python atual também carrega outros módulos, portanto isto é uma configuração candidata, não uma medição do aplicativo inteiro.

Os casos foram preparados com a imagem de aquecimento já incluída no Human e dois recortes do arquivo `zidane.jpg` incluído no Ultralytics. Os rótulos são A, B e C, sem consultar cadastros do usuário. Para cada rosto: referência, repetição, iluminação reduzida a 60%, rotação de 10 graus, imagem menor e cobertura da parte inferior. Também houve uma imagem vazia e outra com dois rostos. A rotação é da fotografia no plano; não simula uma cabeça virando em 3D.

Nenhuma câmera física, porta USB, banco biométrico do usuário ou motor foi acessado. Os downloads iniciais foram apenas dos dois modelos oficiais do OpenCV, no diretório de trabalho da avaliação. Não houve envio de imagens a APIs de reconhecimento.

## Resultados observados

Para comparar latência, usei a **mediana dos mesmos dez casos em que os três motores produziram um único descritor**. Cada caso foi processado uma vez depois do aquecimento. Não é FPS de câmera nem tempo até o comando chegar ao Arduino.

- **Human:** 277,35 ms por imagem nesse recorte; detectou um rosto em 11 dos 18 casos com um rosto; associou corretamente 8 das 15 consultas à referência disponível. Não detectou o rosto C de perfil nem B na imagem pequena. Detectou A com a parte inferior coberta, mas o descritor ficou abaixo do limiar de identificação.
- **DeepFace + YuNet/SFace:** 66,70 ms; detectou 11 de 18; associou 9 de 15 consultas. Detectou B pequeno, que o Human perdeu. Não detectou C de perfil nem B com a parte inferior coberta.
- **InsightFace:** 226,77 ms; detectou 17 de 18; associou 14 de 15 consultas. Detectou C de perfil e suas versões com menos luz, rotação e tamanho menor. Perdeu C com a parte inferior coberta.

Os três retornaram zero rostos na imagem vazia e dois na cena com dois rostos. O comparador do ensaio não atribui uma única identidade à cena múltipla. Não houve atribuição a outra identidade entre as consultas, dentro desta amostra pequena.

Carregamento observado, separado da leitura: Human 1,33 s mais 0,28 s de aquecimento explícito; DeepFace 26,44 s mais 0,12 s; InsightFace 6,08 s mais 3,97 s. **O carregamento do DeepFace incluiu download inicial dos pesos**, enquanto os modelos dos outros já estavam locais. Esses números não são uma comparação justa de partida a frio.

Dados por caso e ambiente: [AVALIACAO_MODELOS_2026-09-11.json](AVALIACAO_MODELOS_2026-09-11.json).

### Limites da conclusão

São três fotos de origem, com versões derivadas das mesmas fotos. Isso testa funcionamento, sensibilidade às alterações e custo local; **não mede a taxa de acerto em pessoas novas ou em fotografias independentes da mesma pessoa**. Não houve teste de pessoa frontal passando a perfil, seguimento de costas, cruzamento de pessoas ou movimento físico do carrinho.

Os limiares também diferem: Human usa similaridade própria de pelo menos 0,80 e margem 0,05; SFace usa similaridade cosseno de pelo menos 0,407, obtida do padrão do DeepFace instalado; InsightFace usa 0,42, como o serviço atual. Esses valores não são porcentagens de confiança comparáveis. O ensaio usa uma foto de referência por pessoa para avaliar os modelos; não reproduz o cadastro de múltiplas amostras do site.

Human executa malha e transporte de imagem além do reconhecimento. Python não inclui transporte até o navegador, desenhar a interface, rastrear o corpo, enviar comandos ou esperar confirmação USB. OpenCV e TensorFlow foram limitados a duas threads; ONNX Runtime manteve sua configuração de CPU padrão. A diferença de tempo é do conjunto testado, não uma superioridade isolada da rede neural.

## Avaliação dos materiais enviados

### DeepFace — aproveitar como alternativa de reconhecimento local

Oferece detecção, alinhamento, descritores e comparação com vários modelos. Vale aproveitar o carregamento único dos modelos, cadastro pré-calculado e separação entre detecção e identificação. Para nosso objetivo, análise de idade, gênero e emoção não ajuda a conduzir o robô. [Repositório oficial](https://github.com/serengil/deepface)

Não copiar a demonstração `stream` como controlador do robô: seu código congela a visualização durante a análise e usa cinco segundos como tempo padrão de congelamento. Isso é comportamento da demonstração, não uma obrigação da biblioteca nem a causa comprovada da falha no nosso site. [Código do streaming](https://github.com/serengil/deepface/blob/master/deepface/modules/streaming.py)

SFace e YuNet também existem diretamente no OpenCV. Essa combinação merece uma etapa futura caso o processo Python seja escolhido: poderá evitar carregar todo o DeepFace, mas a versão direta não foi medida aqui. [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface), [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)

### Real Python — referência didática, sem migração indicada

O tutorial ajuda a estruturar cadastro, descritores e comparação. Sua implementação usa `face_recognition`, baseada em dlib; essa biblioteca informa que Windows não é oficialmente suportado. Isso aumenta o trabalho de instalação neste ambiente sem demonstrar ganho para nosso fluxo. O código foi avaliado como referência; essa pilha não estava instalada e não recebeu medição de desempenho. [Tutorial](https://realpython.com/face-recognition-with-python/), [biblioteca utilizada](https://github.com/ageitgey/face_recognition)

### MediaPipe/OpenCV — úteis, com papéis diferentes

O detector facial do MediaPipe entrega localização e pontos do rosto. A malha pode melhorar a visualização e a estimativa de pose, mas não constitui sozinha um reconhecedor de identidade. É necessário um descritor/comparador para distinguir a pessoa cadastrada. O projeto já separa essas responsabilidades. [Documentação do detector](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector)

### Tópicos do GitHub — ponto de busca, não critério de qualidade

A lista ordenada por atualização serve para descobrir projetos. Data recente e estrelas não comprovam manutenção, latência ou compatibilidade com o robô. A seleção precisa examinar código, modelos, dependências, tratamento de falhas e testes. Nesta avaliação, as alternativas concretas escolhidas foram DeepFace/SFace/YuNet e o InsightFace já presente. [Lista enviada](https://github.com/topics/facial-recognition?o=desc&s=updated)

### Vídeos — conteúdo técnico ainda não validado

Não consegui obter os vídeos ou verificar seus códigos-fonte. Por isso, não atribuo resultados ou garantias às aulas e não as uso como base da recomendação. A avaliação do MediaPipe acima vem da documentação oficial. [Primeiro vídeo enviado](https://www.youtube.com/watch?v=mCcPmlr7y3U), [segundo vídeo enviado](https://www.youtube.com/watch?v=EQiAQwMcDBQ&t=59)

## Como repetir

Os scripts estão em `tools/evaluate_face_candidates.py` e `tools/evaluate_face_candidates.cjs`. Os arquivos preparados, modelos baixados e resultados brutos ficam em `work/face-evaluation/`. Não adicionar essa pasta a um commit nem distribuir as fotos de teste com o site.

1. Em um Python com OpenCV, NumPy e Ultralytics: `python tools/evaluate_face_candidates.py prepare`.
2. No Python com DeepFace: `python tools/evaluate_face_candidates.py deepface-yunet`. A primeira execução pode baixar os modelos oficiais. Nenhum pacote é instalado pelo script.
3. Iniciar o servidor local do projeto em `127.0.0.1:9877`. Com Playwright disponível para Node: `node tools/evaluate_face_candidates.cjs`. `QT_SITE_URL` permite outra origem; o script usa uma página isolada, sem iniciar a aplicação ou a câmera.
4. No ambiente `.venv` existente: `.venv\Scripts\python.exe tools/evaluate_face_candidates.py insightface`.
5. Consolidar: `python tools/evaluate_face_candidates.py summarize`. O resumo verifica se todos os motores utilizaram os mesmos hashes de imagens.

Executar os motores um por vez para não disputar CPU. Não comparar pontuações de similaridade entre bibliotecas. Repetições de desempenho, imagens independentes e vídeo com trocas de pose são necessários antes de decidir uma migração.

## Próxima mudança admissível, após comprovação

Se o caminho Python vencer no fluxo completo, integrar um único motor facial local, com modelos carregados uma vez, descritores de cadastro em cache e processamento apenas da imagem mais recente. O resultado precisa trazer tempo da captura e identidade inequívoca; o controlador existente continua responsável por autorização de movimento, obstáculo, parada de emergência e perda de conexão.

Validar separadamente o rastreamento do corpo durante ausência do rosto. Medir atraso da captura até o comando confirmado, trocas indevidas de alvo e tempo para parar após perda. Só então substituir o motor ativo. Esta avaliação adiciona ferramentas e documentação; não modifica site, firmware ou conexões.
