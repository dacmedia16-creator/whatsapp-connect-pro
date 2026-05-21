
# Diagnóstico — Auditoria de consistência e segurança operacional

> Esta etapa é apenas diagnóstico. Nada será alterado sem sua aprovação.

## 1. Resumo executivo

Os dados divergem porque a mesma configuração mora em **mais de um lugar** e cada tela escolhe um *fallback* diferente quando o registro principal não existe. O envio real é decidido pelo `sender.server.ts` num momento (run-time), mas o que aparece na UI é o snapshot gravado pelo `enqueueCampaignCore` em outro momento (enqueue-time). Entre os dois, o `pickChannel` pode trocar o chip — e nem sempre essa troca é refletida na fila visível.

Há também **mistura de escopo**: `channels.sent_today` é global do chip (soma todas as campanhas + envios manuais + testes), mas o painel mostra esse número em telas que o operador interpreta como "desta campanha".

---

## 2. Riscos críticos (podem causar bloqueio/perda de chip)

| # | Risco | Causa raiz |
|---|---|---|
| C1 | **Modo de rotação exibido ≠ modo salvo ≠ modo executado** | 4 *defaults* diferentes para `rotation_mode` espalhados pelo código: `send-panel.functions.ts` → `round_robin`, `send-settings-form.tsx` → `least_used`, `createCampaignFn` fallback → `least_used`, `enqueueCampaignCore` fallback → `round_robin`, `sending-panel.tsx` setMode → `round_robin`. Quando `campaign_send_settings` não existe, cada tela "inventa" um padrão. |
| C2 | **Chip exibido na fila ≠ chip realmente usado** | `createCampaignFn` grava `campaign_recipients.channel_id = primaryChannelId` (o primeiro da lista) para todos. `enqueueCampaignCore` distribui via `pickInitialChannel` e grava `message_queue.channel_id`. O `sender.server.ts` chama `pickChannel` em run-time e pode trocar o canal (faz `update({ channel_id })`). UI lê snapshot, então mostra um chip que pode não ser o real. |
| C3 | **"Pausar campanha" se comporta como cancelar** | `setCampaignStatusFn` ao receber `paused` faz `message_queue.update({ status: "failed", last_error })` e `campaign_recipients.update({ status: "failed" })`. Não existe retomada — quem pausa perde os pendentes silenciosamente. |
| C4 | **Limites por campanha vazam para outras campanhas** | `channels.sent_today` é incrementado por TODOS os envios (sender de qualquer campanha + `sendMessageFn` da inbox + `testChannelFn`). O `max_per_day_per_channel` da campanha A consome quota da campanha B. Não há contador por (canal, campanha). |
| C5 | **Duplicidade `campaigns.channel_ids` vs `campaign_send_settings.selected_channel_ids`** | `createCampaignFn` grava nos dois. `upsertSendSettingsFn` (chamado pelo painel de envios e pela tela de configurações) só atualiza `campaign_send_settings`. `enqueueCampaignCore` prioriza `selected_channel_ids` e cai para `channel_ids` — divergência entre os dois leva a chips fantasmas ou faltantes. |
| C6 | **Duplicidade `campaigns.rate_per_min` vs `campaign_send_settings.max_per_minute`** | Tela de criar campanha exibe um; configurações de envio mostra outro. Sender usa `max_per_minute`. `enqueueCampaignCore` usa `delay_seconds` do settings mas o offset inicial não considera `batch_mode` — quando o batch está ligado, o agendamento inicial não respeita o lote. |
| C7 | **`requeueRecipientFn` reenfileira sem revalidar consent/opt-out** | Se o contato deu opt-out entre o enqueue original e o requeue, ele volta para a fila. Só o sender bloqueia (em `processQueueItem`), mas a contagem visível de "pendentes" cresce e há risco de janela de erro. |
| C8 | **Janela de horário com offset BRT hardcoded** | `rate-limit.server.ts` → `nextDateInTz` faz `setUTCHours(hour + 3)`. Ignora `tz` real. Para campanha em `America/Manaus` (UTC-4) reagenda na hora errada. |

---

## 3. Riscos médios

| # | Risco | Causa raiz |
|---|---|---|
| M1 | **`audience_filter.autoPauseOnErrors` é configuração órfã** | Salva em `campaigns.audience_filter` por `createCampaignFn`. Nenhum lugar lê. Operador acha que tem proteção que não existe. |
| M2 | **`getChannelsHealthFn` é global mas exibido no contexto de uma campanha** | Mostra `sent_today_effective` do chip (todas as campanhas), não do contexto atual. Confunde "saúde" com "consumo desta campanha". |
| M3 | **Painel de envios mostra `total` = `campaign_recipients` da campanha, mas o card "Total na fila" sugere `message_queue`** | Label sugere fila; valor vem de recipients. Inconsistência semântica com "Pendentes" (também recipients). |
| M4 | **Form de configurações pode salvar `rotation_cursor`** | `getSendSettingsFn` faz `select("*")` e devolve `rotation_cursor`. Form inicializa baseline com esse campo. O schema do upsert filtra, então não persiste — mas é poluição que mascara diffs em "Alterações não salvas". |
| M5 | **`requeueFailedFn` reseta `attempts` mas não revalida settings/canal** | Pode reenviar com chip pausado/sem chave se settings mudaram. Sender filtra, mas a fila fica em loop pending→failed. |
| M6 | **`enqueueCampaignCore` agendamento inicial ignora `batch_mode`** | Empurra `scheduled_for = startAt + idx*delay`. Quando batch_mode liga, o sender empurra batch depois — mas o item da posição N já tem horário cravado. Pode disparar fora de fase. |
| M7 | **Realtime escuta `*` de `message_queue` global** | `sending-panel.tsx` se reinvalida com qualquer mudança da fila (qualquer campanha). Reabre queries de outras campanhas. Custo, não correção. |

---

## 4. Tabela por opção (escopo, persistência, leitura, divergência)

| Opção | Tela onde é configurada | Campo/tabela | Tela onde é exibida | Onde é usada | Inconsistência | Risco | Correção sugerida |
|---|---|---|---|---|---|---|---|
| Canais selecionados | criar campanha + painel de envios + `campaigns.$id.settings` | `campaigns.channel_ids` **+** `campaign_send_settings.selected_channel_ids` | painel de envios (lê settings) | `enqueueCampaignCore`, `sender.server.ts` | Duplicidade. Edição posterior só atualiza um lado. | Crítico | Eliminar `campaigns.channel_ids` ou marcá-lo como snapshot read-only. Fonte única = `campaign_send_settings`. |
| Modo de rotação | criar campanha + painel de envios + settings | `campaign_send_settings.rotation_mode` | painel de envios + settings | `sender.server.ts → pickChannel` | 4 *defaults* diferentes no código. | Crítico | Constante única (`SEND_SETTINGS_DEFAULTS`) importada por servidor e cliente. `getSendSettingsFn` retorna sempre o registro persistido — se não existir, cria com os defaults canônicos. |
| Prioridade manual | painel + settings | `campaign_send_settings.channel_priority` | painel + settings | `pickChannel` | OK na origem; "perde" entradas quando `selected_channel_ids` muda fora de sincronia. | Médio | Validar no upsert: `channel_priority ⊆ selected_channel_ids`. |
| Delay por chip | settings | `campaign_send_settings.delay_seconds` + `random_delay_min/max` | settings + estimativa | `pickChannel` (gap) + `enqueueCampaignCore` (offset inicial) | OK isoladamente; conflita com `batch_mode`. | Médio | No enqueue, quando `batch_mode=true`, ignorar offset incremental e enfileirar todos com `scheduled_for=now`. |
| Lotes sincronizados | settings | `campaign_send_settings.batch_mode` + `batch_pause_seconds` | settings | `sender.server.ts → pushBatchScheduledFor` | Enqueue inicial não considera. | Médio | Acima. |
| Limite por minuto/hora | settings | `campaign_send_settings.max_per_minute/hour` | settings + overview | `pickChannel` via `recentSends` | `recentSends` consulta `send_logs` global do chip, não da campanha. | Crítico | Filtrar `recentSends` por `(channel_id, campaign_id)` quando o limite for por campanha; manter global apenas como teto do chip. |
| Limite diário por canal | settings | `campaign_send_settings.max_per_day_per_channel` | settings | `sender` faz `min(maxDay, channel.daily_limit)` | `channel.sent_today` é global → uma campanha consome cota da outra. | Crítico | Criar tabela `channel_daily_usage(channel_id, date, campaign_id, sent)` ou contar `send_logs` 2xx por `(channel_id, campaign_id, dia)`. |
| Janela horária | settings | `campaign_send_settings.allowed_start/end/weekdays/timezone` | settings | `isWithinCampaignWindow` | `nextWindow` usa BRT hardcoded. | Crítico | Calcular `nextWindow` com `Intl.DateTimeFormat` no `tz` real (ou luxon). |
| Auto-pause fora do horário | settings | `auto_pause_outside_hours` | settings | **Não é lido em lugar nenhum** | Sender reagenda mas nunca pausa a campanha. | Médio | Implementar leitura no sender ou remover o toggle. |
| Auto-pause se todos canais caem | settings | `auto_pause_on_all_channels_down` | settings | `sender.server.ts` (lê) | OK. | — | — |
| Status da campanha (pause/cancel) | painel | `campaigns.status` + `setCampaignStatusFn` | painel + lista | `sender` (defesa em profundidade) | Pause faz `failed` em fila. Retomar não reenfileira. | Crítico | Diferenciar pause (reagenda fila para +5min) de cancel (marca failed). Já existe a lógica de reagendar no sender — basta NÃO marcar failed em pause. |
| Opt-out / consent | inbox + import | `contacts.consent`, `contacts.opt_out_at` | painel de envios (recipients) | `previewRecipientsFn`, `createCampaignFn`, `processQueueItem` | `requeueRecipientFn` reenfileira sem checar. | Médio | Revalidar consent/opt-out em todos os caminhos de requeue. |
| Mensagem template | criar campanha | `campaigns.message_template` | painel de envios | `enqueueCampaignCore` (renderiza) | Sem snapshot em `message_queue.rendered_text`? Existe (`rendered_text`) — OK. | — | — |
| Limite global `rate_per_min` | criar campanha | `campaigns.rate_per_min` | nenhuma | `enqueueCampaignCore` (fallback de `delay_seconds`) | Duplica `max_per_minute`. | Médio | Remover de `campaigns`. |
| Auto-pause em erros | criar campanha | `campaigns.audience_filter.autoPauseOnErrors` | nenhuma | **Ninguém** | Configuração órfã. | Médio | Implementar ou remover. |
| Mídia | criar campanha | `campaigns.media_*` | painel + sender | `processQueueItem` | OK. | — | — |

---

## 5. Fluxo de seleção de chip (onde quebra)

```text
[Criar campanha]
  └── grava: campaigns.channel_ids = [c1,c2,c3]
            campaign_send_settings.selected_channel_ids = [c1,c2,c3]
            campaign_send_settings.rotation_mode = least_used (default UI)
            campaign_recipients.channel_id = c1 (todos!)  ← snapshot enganoso

[Enqueue (createCampaignFn → enqueueCampaignCore)]
  └── lê: settings.rotation_mode ?? "round_robin"  ← FALLBACK DIFERENTE
            settings.selected_channel_ids OR campaigns.channel_ids
            distribui via pickInitialChannel
            grava: message_queue.channel_id = cN  ← outro snapshot

[Sender (processQueueItem)]
  └── lê: settings via getSettings  ← terceiro lugar, sem fallback se NULL
            roda pickChannel → pode trocar canal
            grava: message_queue.channel_id = cM  (update)
                    campaign_recipients.channel_id = cM (só em sucesso)

[UI: painel de envios "Canais"]
  └── lê: campaign_send_settings (form local) + getChannelsHealthFn (global)
       └─ "Enviados hoje" do chip = TODAS as campanhas, não desta
```

Três cópias da decisão. Cada uma com defaults diferentes. Nenhuma é tratada como verdade absoluta.

---

## 6. Logs e rastreabilidade (lacunas)

`send_logs` registra: `channel_id, contact_id, campaign_id, http_status, response_text, created_at`.

Não registra:
- chip que **deveria** ter sido escolhido (intent) vs chip realmente usado;
- motivo da escolha (cursor RR, least_used score, prioridade);
- snapshot da config no momento do envio;
- usuário que iniciou/pausou/alterou a campanha (existe `campaign_events`? a auditoria menciona trigger `fn_log_campaign_event` mas não há leitura na UI);
- se houve fallback de default.

---

## 7. RLS e permissões (a verificar na fase 2)

Por inspeção do código:
- Server functions usam `supabaseAdmin` (bypass RLS) e validam role via `user_roles` (`admin`/`gestor`). OK.
- UI lê `campaigns`, `channels`, `messages` diretamente via `supabase` (browser client) — RLS é a única proteção. Preciso rodar `supabase--linter` e listar policies por tabela na próxima rodada.
- `sendMessageFn` permite atendente enviar apenas em conversa atribuída a ele. OK.
- `testChannelFn` exige admin. OK.
- `requeueFailedFn`, `markIgnoredFn`, `pauseChannelFn` exigem gestor. OK.

Pendências para a fase 2 do diagnóstico:
- Confirmar RLS de `campaigns`, `campaign_recipients`, `message_queue`, `send_logs`, `channels`, `contacts`, `conversations`, `messages`, `user_roles` (cada operação tem policy?).
- Verificar se o front consegue UPDATE direto em campos sensíveis (`channels.daily_limit`, `campaigns.status`, `contacts.consent`).
- Confirmar que `auth.users` não é referenciado por FK direta.

---

## 8. Modo dry-run (proposta — não implementado hoje)

Não existe. Proposta:
- Adicionar `campaigns.dry_run boolean default false`.
- Quando `true`, `enqueueCampaignCore` enfileira normalmente, mas `processQueueItem` substitui `zionSendMessage` por um stub que:
  - resolve qual chip seria escolhido (`pickChannel`);
  - grava em `send_logs` com `http_status = 0` e `response_text = "DRY_RUN: ..."`;
  - marca `campaign_recipients.status = 'sent'` apenas para fins de visualização (ou novo status `'simulated'`).
- Tela de painel mostra contraste "simulado vs real" e bloqueia executar real até o operador aprovar.

---

## 9. Plano de correção priorizado (a executar APÓS sua aprovação)

**Fase A — fonte única (sem mexer no envio real):**
1. Eliminar duplicidades: `campaigns.channel_ids` e `campaigns.rate_per_min` viram derived/read-only ou são removidos.
2. Constante única `SEND_SETTINGS_DEFAULTS` importada por servidor e cliente. `getSendSettingsFn` cria registro com defaults se não existir e retorna sempre o persistido.
3. `getSendSettingsFn` deixa de retornar `rotation_cursor` para o cliente.
4. Validação no upsert: `channel_priority ⊆ selected_channel_ids`.

**Fase B — corrigir comportamento de pause e logs:**
5. `setCampaignStatusFn` em `pause` deixa de marcar `failed`. Reagenda `pending` para +5min (já é o que o sender faz se vir status `paused`).
6. Implementar leitura de `auto_pause_outside_hours` no sender (ou remover o toggle).
7. Corrigir `nextDateInTz` para usar `tz` real.
8. Adicionar colunas em `send_logs`: `intended_channel_id`, `chosen_reason`, `settings_snapshot jsonb` (opcional).

**Fase C — isolamento por campanha:**
9. Contar `recentSends` e `dailyUsage` por `(channel_id, campaign_id)` quando o limite é da campanha. Manter global como teto do chip.
10. `getChannelsHealthFn` ganha versão "por campanha" usada no painel quando há `campaignId`.

**Fase D — robustez de requeue:**
11. `requeueFailedFn` e `requeueRecipientFn` revalidam consent/opt-out/canal antes.
12. No enqueue, quando `batch_mode=true`, todos os itens entram com `scheduled_for=now` e o sender controla o pacing.

**Fase E — dry-run e auditoria UI:**
13. Implementar dry-run conforme seção 8.
14. Expor `campaign_events` numa aba "Histórico" do painel.

---

## 10. Checklist de validação (a passar depois da correção)

- [ ] Modo de rotação salvo aparece igual em criar / settings / painel de envios.
- [ ] Chip exibido em `campaign_recipients` e `message_queue` é o realmente usado em `send_logs`.
- [ ] Pause + retomar não perde mensagens.
- [ ] Campanha A não consome quota da campanha B no mesmo chip.
- [ ] Janela horária reagenda para o `tz` correto.
- [ ] Requeue de contato com opt-out posterior é bloqueado.
- [ ] Card "Saúde dos canais" tem rótulo claro de escopo (global vs campanha).
- [ ] `audience_filter.autoPauseOnErrors` ou funciona ou some.
- [ ] Logs respondem: qual chip deveria, qual foi, por quê.
- [ ] Dry-run mostra divergências antes do envio real.

---

## 11. Próximo passo

Aguardo sua aprovação para iniciar pela **Fase A** (fonte única) — é a menos arriscada e elimina a maior parte das divergências visíveis. As fases B–E ficam para PRs separados, cada uma com QA dedicado, para que o envio real continue auditável a cada mudança.
