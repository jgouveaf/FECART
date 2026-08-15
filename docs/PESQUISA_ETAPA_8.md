# PESQUISA — ETAPA 8

## Conclusão técnica

O termo "ver através da parede" não descreve corretamente o que Bluetooth faz. Um transmissor BLE carregado pela pessoa pode emitir anúncios; receptores podem observar a intensidade RSSI e inferir **proximidade aproximada**. Isso não revela imagem, identidade corporal ou coordenada exata.

A documentação oficial da Microsoft afirma que RSSI pode ser traduzido apenas aproximadamente em distância e que paredes, capas, rádios diferentes e até condições ambientais dificultam a medição real. Ela recomenda faixas de proximidade e calibração experimental.

Fontes primárias/oficiais consultadas:

- Microsoft Learn — Bluetooth LE Advertisements: https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/ble-beacon
- Microsoft Learn — Windows Bluetooth Advertisement APIs: https://learn.microsoft.com/en-us/uwp/api/windows.devices.bluetooth.advertisement
- Bluetooth SIG — Core 6.0 feature overview e Channel Sounding: https://www.bluetooth.com/core-specification-6-feature-overview/
- Bluetooth SIG — Understanding Bluetooth Range: https://www.bluetooth.com/learn-about-bluetooth/key-attributes/range/

## Decisão do projeto

- Um receptor: somente faixa de proximidade.
- Três ou mais receptores em posições conhecidas: estimativa 2D aproximada.
- Aplicar mediana temporal para reduzir picos.
- Mostrar raio de erro e nunca usar confiança `ALTA` com RSSI clássico.
- Parede entra como atenuação desconhecida e degrada a estimativa.
- Nenhuma varredura Bluetooth real antes da Etapa 10.

## Alternativas futuras

Bluetooth Direction Finding/Channel Sounding pode melhorar localização, mas exige hardware compatível. Não é algo que software sozinho adicione ao Arduino UNO ou a um adaptador Bluetooth comum.
