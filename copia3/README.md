# FECART — cópia 3 online

Site: https://jgouveaf.github.io/FECART/copia3/

Apresentação: https://jgouveaf.github.io/FECART/copia3/apresentacao.html

Esta pasta publica a interface da terceira cópia em GitHub Pages. A raiz do
repositório continua servindo o site original.

O site, os modelos de visão usados no navegador e o simulador são arquivos
estáticos. O controle do Arduino continua exigindo conexão USB, navegador com
Web Serial e liberação explícita do ESTOP. Publicar ou abrir a página não grava
firmware e não libera a parada de emergência.

No Modo 4 online, o reconhecimento depende do serviço de fala do navegador.
O servidor Python com Vosk e o aplicativo JARVIS continuam locais; GitHub Pages
não executa esses processos. A página online direciona a integração JARVIS para
o servidor local, sem tentar carregar seu iframe HTTP dentro do site HTTPS.

Foram incluídos apenas os arquivos da interface, modelos usados no navegador,
fontes Arduino, firmware HEX e testes JavaScript. Não foram enviados servidor
local, chaves de API, dados biométricos do navegador ou configuração do JARVIS.

Validação: `node --test copia3/tests-*.cjs`.
