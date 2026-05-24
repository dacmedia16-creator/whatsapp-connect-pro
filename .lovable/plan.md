## Fazer "Chama Simples" enviar a cada 15s de verdade

### Problema
Cron roda a cada 60s. No modo simple_call, o pacing global de 15s impede o 2º item do batch e o reagenda — então só sai 1 envio por tick = **1 a cada 60s** em vez de **1 a cada 15s**.

### Solução
No handler do cron (`src/routes/api/public/hooks/process-queue.ts`), processar múltiplos itens do mesmo tick **em série com sleep**, respeitando o gap de 15s, com teto de tempo para não bater no reaper (5 min).

### Mudança (1 arquivo)

**`src/routes/api/public/hooks/process-queue.ts`** — depois do claim e antes do loop:

1. Detectar se algum item pertence a campanha em `simple_call`: consultar `campaign_send_settings` dos `campaign_id` envolvidos (1 query).
2. No loop, antes de chamar `processQueueItem`, se o item for de campanha `simple_call`:
   - Buscar último envio da campanha via `lastCampaignSendAt(campaignId)` (já existe).
   - Se `Date.now() - last < 15_000`, `await new Promise(r => setTimeout(r, diff))`.
3. Adicionar um teto de tempo total por tick (ex.: 50 segundos): se ultrapassar, parar de processar e deixar os restantes voltarem ao próximo tick (release: marcar `status='pending'`, `processing_started_at=null` para os não-processados).

Resultado: cada tick de 60s processa até ~3 envios de campanhas simple_call (3 × 15s = 45s), e os demais itens (não-simple_call) continuam paralelos. Combinado com a continuidade entre ticks, a cadência efetiva fica próxima de 1 envio a cada 15s.

Sem alterações no banco, na UI ou em outras campanhas.
