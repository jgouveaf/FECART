# Modelos 3D do simulador

Arquivos utilizados exclusivamente pelo simulador, hospedados junto do site.
Nenhum deles é usado como entrada para reconhecimento facial ou controle USB.

## Escritório

`web/assets/models/office-lobby.glb` vem de
[Office Lobby — 3DAssets.dev](https://3dassets.dev/assets/office-lobby-and-facilities-office-lobby-a6a9c028-starter-scene),
sob CC0 1.0 Universal. Download: `https://cdn.3dassets.dev/assets/26326/v1/model.glb`.
O autor informa geração assistida por IA. Trata-se de uma recepção mobiliada,
com aproximadamente 32 mil triângulos, sem texturas externas; não é um escaneamento
fotográfico. Piso, paredes e iluminação são complementados pelo simulador.

Os limites dos móveis são extraídos do GLB transformado e usados pelo mapa e
pelas colisões. São limites retangulares conservadores: incluem as bordas de mesas
e cadeiras. Tapetes baixos e peças suspensas no teto não bloqueiam o piso.
O escritório e suas colisões são ativados juntos. Se o download falhar, a sala
anterior continua ativa com suas próprias colisões.

## Personagem e animações Mixamo

`web/assets/models/person-mixamo.glb` é a personagem **Michelle**, obtida do
[repositório oficial do Three.js, versão r180](https://github.com/mrdoob/three.js/blob/r180/examples/models/gltf/Michelle.glb).
Arquivo fonte: `https://cdn.jsdelivr.net/gh/mrdoob/three.js@r180/examples/models/gltf/Michelle.glb`.

`web/assets/models/person-motion.json` contém Idle e Walk adaptados do
[Soldier do Three.js r180](https://github.com/mrdoob/three.js/blob/r180/examples/models/gltf/Soldier.glb)
para o esqueleto de Michelle. O Soldier original é usado somente na preparação
offline, sem ser incluído na entrega. O script reprodutível é
`tools/prepare_simulator_motion.mjs`; argumentos: GLB Soldier, GLB Michelle e JSON
de saída. A adaptação preserva os comprimentos dos ossos e remove a translação
horizontal, pois o deslocamento pertence ao mundo virtual.

Personagens e animações são conteúdo **Adobe Mixamo**, não CC0. A
[FAQ oficial da Adobe](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
permite uso royalty-free em projetos pessoais, comerciais e sem fins lucrativos,
incluindo jogos. O conteúdo está integrado a este simulador, sem recurso para
exportar personagens ou fornecer um pacote de assets independente. A licença MIT
do código Three.js não substitui os termos do conteúdo Mixamo.

Cada pessoa usa uma cópia independente do esqueleto. Geometria e texturas são
compartilhadas para limitar uso de memória; caminhada depende de deslocamento
real no mundo virtual. A aparência das pessoas vem do mesmo personagem-base.

## Biblioteca e integridade

`GLTFLoader.js`, `BufferGeometryUtils.js`, `SkeletonUtils.js` e `RoomEnvironment.js`
vêm do Three.js r180, sob MIT, com imports relativos para a versão local.
Licença em `web/vendor/three/LICENSE`; hashes em `web/vendor/three/manifest.json`.
Os hashes dos modelos e das animações estão em `web/assets/models/manifest.json`.

Downloads realizados em 2026-09-15. As validações do simulador não medem
comportamento físico do robô.
