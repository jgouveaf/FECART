# CHECKPOINT — ETAPA 8

**STATUS: CONCLUÍDA EM SOFTWARE / RSSI SIMULADO / SEM BLUETOOTH REAL**

## Implementado

- Modelo log-distance para converter RSSI em distância aproximada.
- Faixas de proximidade para cenário com um receptor.
- Estimativa 2D robusta com no mínimo três âncoras não colineares.
- Filtro de mediana por âncora.
- Simulação de ruído e atenuação por parede.
- Raio de erro, RMSE e confiança limitada a `BAIXA`/`MEDIA`.
- Rejeição de RSSI inválido e geometria impossível.

## Arquivos principais

- `localization/rssi_localizer.py`
- `tests/test_rssi_localization_offline.py`
- `docs/PESQUISA_ETAPA_8.md`

## Testes e resultados

- 5 testes específicos aprovados.
- Posição conhecida recuperada com erro menor que 1 metro no cenário calibrado e ruidoso.
- 1.000 posições aleatórias processadas com resultados finitos.
- Atenuação de parede nunca recebeu confiança `ALTA`.
- Um receptor foi impedido de gerar coordenadas falsas.

## Limitações honestas

- Os resultados são matemáticos e simulados.
- A precisão física dependerá de adaptadores, antenas, posição dos receptores, paredes e calibração do local.
- Nenhum Bluetooth foi ligado ou consultado.

## Próxima etapa

Etapa 9: integração geral dos módulos em um orquestrador software, com testes longos e garantia de que todo hardware continua bloqueado.
