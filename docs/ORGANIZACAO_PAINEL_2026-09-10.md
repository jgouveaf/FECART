# Organização do painel — 10/09/2026

Após identificar um fio solto no motor direito, o usuário confirmou que os gestos funcionavam e restringiu o pedido à organização do site.

## Alterações

- Controle USB, parada de emergência, modos e telemetria aparecem logo após a apresentação compacta. O simulador fica depois da operação física.
- Navegação agrupada em Operação, Preparação e Acompanhamento. Configurações do navegador têm uma seção própria.
- Seleção e ativação da câmera ficam junto da visualização. O texto distingue a seleção da visualização da seleção do modo do carrinho.
- Gravação de firmware, teste físico dos motores e edição de código ficam em blocos separados. Os controles continuam usando os mesmos identificadores e eventos.
- Informações sobre o projeto e a validação anterior ficam disponíveis no Guia rápido, em uma área expansível.
- Layout adaptado para telas estreitas, incluindo as abas dos sketches. Temas claro e escuro usam as cores existentes.

As mudanças de produto estão limitadas a `index.html` e `web/operation-layout.css`. Não houve alteração dos scripts de controle, reconhecimento ou conexão, dos sketches ou dos arquivos compilados.

## Verificação

- `tests/browser_operation_layout.cjs`: navegação em 320, 390, 768, 1024 e 1440 pixels nos dois temas; acesso à emergência; ausência de IDs duplicados e links internos quebrados; controles dentro da tela; persistência das configurações; nenhum erro JavaScript.
- `tests/browser_interface_tools.cjs`: temas, persistência, zoom sob o ponteiro, navegação durante o zoom, ajuda contextual, digitação e menu móvel.
- `tests/browser_full_site_smoke.cjs`: simulador, câmera artificial, carregamento dos modelos locais de rosto/mão e desligamento; nenhum erro de página, console ou requisição.
- Comparação do HTML anterior com o reorganizado: preservados 168 IDs existentes, 83 elementos de controle/mídia e 20 URLs/atributos de scripts. `git diff --check` sem erros.

Os testes de navegador não usam Arduino, câmera ou motores físicos. O diagnóstico elétrico foi informado pelo usuário. A organização visual não modifica os bloqueios de movimento nem valida o comportamento físico do carrinho.
