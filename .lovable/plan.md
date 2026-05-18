
## Solidificar a lógica de envio (back-end), com módulos separados

A UI, a tabela `campaign_send_settings`, o worker `process-queue.ts` e o cron job (1×/min) já existem. Mas a lógica está concentrada em um arquivo só e o `enqueueCampaignFn` ainda ignora `campaign_send_settings`. Vou separar a lógica em módulos servidor e fazer o enqueue respeitar as configurações.

### Estado atual (já feito)

- `campaign_send_settings` (canais, rotação, delays, limites, janela, auto-pause).
- Cron `zionflow-process-queue` chamando `/api/public/hooks/process-queue` a cada minuto.
- `process-queue.ts` já implementa: consentimento, rotação por settings, limite diário por canal, janela de horário da campanha + business_hours do canal, limites por minuto/hora, auto-pause em "todos canais down", backoff exponencial, atualização de status, log via `send_logs`, criação de conversa/mensagem.
- Trigger `fn_log_campaign_event` já popula `campaign_events` automaticamente em INSERT/UPDATE de `campaign_recipients`.
- UIs: `sending-panel.tsx` (operação) e `campaigns.$campaignId.settings.tsx` (configuração).

### O que falta

1. **Separar a lógica do worker em módulos.** Hoje tudo está em `process-queue.ts`.
2. **`enqueueCampaignFn` não lê `campaign_send_settings`.** Usa `campaign.channel_ids` e `campaign.rate_per_min` — ignora canais, delay, random delay e janela configurados pelo gestor.

### 1. Nova organização (server-only)

```text
src/lib/send/
├── channel-selector.server.ts   # pickChannel(settings, current, campaignId, ctx)
├── rate-limit.server.ts         # recentSends + isWithinCampaignWindow + isWithinBusinessHours
├── sender.server.ts             # processQueueItem(item, ctx) — orquestra 1 item
└── audit.server.ts              # logQueueEvent(item, action, meta) — wrapper sobre send_logs
```

- `channel-selector.server.ts`:
  `pickChannel({ settings, currentChannelId, campaignId, ctx })` recebe um `ctx` com caches (channelsCache, rrCursor, settingsCache) e `recentSends`. Implementa `round_robin`, `least_used`, `manual_priority` + filtros (status, daily limit, max_per_minute, max_per_hour). Retorna canal ou `null`.

- `rate-limit.server.ts`:
  - `recentSends(channelId, sinceMs)` — conta `send_logs` 2xx por janela.
  - `isWithinBusinessHours(bh)` — para canal.
  - `isWithinCampaignWindow(settings)` — para campanha (tz, start/end, weekdays).
  - Helpers `nextValidWindow(...)`.

- `sender.server.ts`:
  `processQueueItem(item, ctx)` aplica em ordem os 10 passos: consent → pickChannel → channel ativo + limite diário → janela campanha + business_hours → carregar API key → enviar → atualizar fila/canal/recipient → criar conversa/message → schedule next em retry/reagendamento → auto-pause se aplicável. Retorna `{ status: "sent" | "failed" | "rescheduled" | "skipped" }`.

- `audit.server.ts`:
  - `logSendAttempt({ channel_id, contact_id, campaign_id, http_status, response_text })` — wrapper sobre `send_logs` (mantém compat com `logSend` de `ziontalk.server.ts`).
  - Trigger `fn_log_campaign_event` continua emitindo eventos em `campaign_events`.

- **`process-queue.ts` vira o "runner"**: claim atômico de até 25 itens, loop chamando `processQueueItem`, retorno de contagens. ~30 linhas.

### 2. `enqueueCampaignFn` respeitando settings

Modificar `src/lib/ziontalk.functions.ts`:
- Buscar `campaign_send_settings` para a campanha.
- Determinar canais elegíveis: `settings.selected_channel_ids` se houver, senão `campaign.channel_ids`, senão todos não pausados.
- Distribuição inicial por `settings.rotation_mode`:
  - `round_robin`: alterna em ordem.
  - `least_used`: ordena por `sent_today` ascendente a cada item.
  - `manual_priority`: usa `channel_priority` (primeiro canal disponível).
- `scheduled_for[i]`: `startAt + i * delay_seconds * 1000` (em ms). Se `random_delay_min/max` definidos, adiciona jitter uniforme entre eles.
- Se `startAt` cair fora da janela permitida (`allowed_weekdays`/`allowed_start_time`/`allowed_end_time`/`timezone`), avançar para o próximo slot válido antes de distribuir.
- Compatibilidade: se a campanha não tem `campaign_send_settings`, manter comportamento antigo (`rate_per_min` + round-robin simples).

### 3. Garantias dos 10 passos (mapa)

| # | Passo | Onde |
|---|---|---|
| 1 | Próxima mensagem pendente | `process-queue.ts` (claim atômico) |
| 2 | Consent + opt-out | `sender.server.ts` |
| 3 | Escolher canal por modo | `channel-selector.server.ts` |
| 4 | Canal ativo + limite diário | `channel-selector.server.ts` + `sender.server.ts` |
| 5 | Delay entre envios | `enqueueCampaignFn` (no `scheduled_for` inicial) + backoff em `sender.server.ts` |
| 6 | Enviar | `ziontalk.server.ts` (`zionSendMessage`) chamado por `sender.server.ts` |
| 7 | Atualizar status da fila | `sender.server.ts` |
| 8 | Registrar log | `audit.server.ts` + trigger `fn_log_campaign_event` |
| 9 | Agendar próximo envio | `enqueueCampaignFn` (inicial) + `sender.server.ts` (retry/reagendamento) |
| 10 | Auto-pause se sem canais | `sender.server.ts` (já existe) |

### 4. Separação final

| Camada | Arquivos |
|---|---|
| Interface do painel | `sending-panel.tsx` |
| Configurações da campanha | `campaigns.$campaignId.settings.tsx`, `send-panel.functions.ts` (get/upsert) |
| Seleção de canal | `src/lib/send/channel-selector.server.ts` |
| Rate limit / janela | `src/lib/send/rate-limit.server.ts` |
| Envio | `src/lib/send/sender.server.ts` + `ziontalk.server.ts` |
| Logs e auditoria | `src/lib/send/audit.server.ts`, tabela `send_logs`, tabela `campaign_events` |
| Runner (cron) | `src/routes/api/public/hooks/process-queue.ts` |

### 5. Sem mudanças de schema

Nenhuma migration. Apenas refactor de TypeScript + atualização de `enqueueCampaignFn`.

### Arquivos

- **novos**: `src/lib/send/channel-selector.server.ts`, `src/lib/send/rate-limit.server.ts`, `src/lib/send/sender.server.ts`, `src/lib/send/audit.server.ts`
- **editados**: `src/routes/api/public/hooks/process-queue.ts` (simplifica para runner), `src/lib/ziontalk.functions.ts` (enqueue lê `campaign_send_settings`)
