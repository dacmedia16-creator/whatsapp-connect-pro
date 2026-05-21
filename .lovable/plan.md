
# Auditoria de consistência — sistema de envio WhatsApp

Este é um **relatório de diagnóstico**. Nenhum arquivo será alterado até sua aprovação.

---

## 1. Resumo executivo

A fonte única de verdade (`send-settings-defaults.ts` + tabela `campaign_send_settings`) **já existe e está corretamente plumbada** no formulário, no painel de envios, no `getSendSettingsFn`, no `enqueueCampaignCore` e no `sender.server.ts`. Porém, sobraram **5 divergências reais** que fazem tela, fila e execução não baterem:

1. **Default de `rotation_mode` inconsistente** entre o formulário (mostra "Menos usado") e o painel de envios (cai em `round_robin` quando `settings` ainda não chegou).
2. **`campaign.channel_ids` e `campaign.rate_per_min` continuam sendo gravados em paralelo** a `campaign_send_settings`, criando dois "lados da verdade" que podem divergir.
3. **`enqueueCampaignCore` tem uma cópia própria** da lógica de rotação (`pickInitialChannel`) que diverge do `pickChannel` real do sender — o canal mostrado na fila não é necessariamente o canal que vai disparar.
4. **`ziontalk.functions.ts` mantém um `nextDateInTz` legado com `hour + 3` hardcoded** (BRT fixo) — função morta mas pronta para reintroduzir bug.
5. **Não existe snapshot da configuração no momento do enqueue**: alterar settings depois muda silenciosamente o que estava na fila, e o painel não consegue explicar por que um envio escolheu certo chip.

Causa raiz: **duplicidade de configuração + lógica de seleção de canal escrita em dois lugares**. Não é bug visual, é arquitetura.

---

## 2. Fluxo ponta a ponta (mapa real)

```text
[SendSettingsForm] ──salva──> upsertSendSettingsFn ──> campaign_send_settings
[CreateCampaignFn]    ──salva──> campaigns.channel_ids + campaigns.rate_per_min  ⚠ duplica
                      ──salva──> campaign_send_settings                          ✓ fonte única
                      ──cria──> campaign_recipients (channel_id = primaryChannelId)  ⚠ snapshot estático
                      ──chama──> enqueueCampaignCore
                                   └─ lê campaign_send_settings ✓
                                   └─ pickInitialChannel(idx)  ⚠ lógica própria, diverge de pickChannel
                                   └─ insere message_queue (channel_id pré-decidido)
[cron /api/public/hooks/process-queue]
   └─ claim 25 pending
   └─ processQueueItem
        └─ pickChannel(settings)  ⚠ pode escolher OUTRO channel_id diferente do que está em message_queue
        └─ se diferente: UPDATE message_queue.channel_id  (não há log de "motivo")
        └─ envia, grava send_logs, atualiza campaign_recipients.channel_id
[SendingPanel]
   └─ getQueueRowsFn mostra channel_id do recipient (último usado)
   └─ getSendPanelOverviewFn conta por campaign_recipients ✓
```

**Divergências detectadas:**

| Etapa | Arquivo | Campo esperado | Campo real | Problema |
|---|---|---|---|---|
| Form → banco | `send-settings-form.tsx` | `rotation_mode='least_used'` (default exibido) | `SEND_SETTINGS_DEFAULTS.rotation_mode='least_used'` ✓ | OK |
| Banco default em `campaign_send_settings` | migration | `'round_robin'` | `'round_robin'` | ⚠ Diverge do default de código |
| Criação campanha | `campaigns.functions.ts:342` | só `campaign_send_settings` | grava também `channel_ids` e `rate_per_min` em `campaigns` | ⚠ Duplicidade |
| Enqueue | `ziontalk.functions.ts:357` | usa `pickChannel` central | usa `pickInitialChannel` local | ⚠ Lógica duplicada |
| message_queue | — | refletir snapshot | só tem `channel_id`, sem `planned_*`/`reason` | ⚠ Sem rastreabilidade |
| Sender troca chip | `sender.server.ts:175` | log de "motivo" | só `UPDATE channel_id` silencioso | ⚠ Tela mostra um chip, executa outro |
| Painel | `send-panel.functions.ts:349` | `planned` vs `actual` | mostra só último | ⚠ Esconde divergência |

---

## 3. Alternância de chips — auditoria específica

- **Onde é selecionada:** `SendSettingsForm` (campos `rotation_mode`, `selected_channel_ids`, `channel_priority`) **e** também na aba "Canais" do painel de envios. Os dois caem no mesmo `upsertSendSettingsFn`. ✓
- **Onde é salva:** `campaign_send_settings`. ✓
- **Quem usa em runtime:**
  - `enqueueCampaignCore.pickInitialChannel` (decide o `channel_id` inicial no momento do enfileiramento) — **lógica própria, simplificada**:
    - `manual_priority` → sempre o primeiro
    - `least_used` → conta local em memória
    - `round_robin` → `idx % channelList.length`
  - `sender.server.ts → pickChannel` (decide na hora do disparo) — **lógica completa**: respeita limites/min, /hora, /dia, status, pacing, cursor RR persistido em `rotation_cursor`.
- **Conflito:** o canal que o painel mostra (`message_queue.channel_id`) é o do `pickInitialChannel`. O canal que **efetivamente envia** pode ser outro escolhido por `pickChannel`. Não há "motivo" registrado. O usuário vê chip A na fila e chip B nos logs.
- **`campaign.channel_ids`:** ainda é usado como fallback em `enqueueCampaignCore:357`. Se settings ficar vazio por qualquer razão (migração, edição manual), o sistema cai no campo legado sem avisar.

---

## 4. Riscos

**Críticos** (podem causar perda de chip ou envio fora da regra):
- R1 — Sender escolhe chip diferente do planejado **sem log de motivo**. Se o gestor pausou um chip e o sistema fez fallback, ninguém vê.
- R2 — Alterar `campaign_send_settings` depois do enqueue muda comportamento de itens já enfileirados **sem aviso**. Não há snapshot.
- R3 — `campaign.channel_ids` legado pode "ressuscitar" canais que foram removidos de `selected_channel_ids`.
- R4 — `getSendPanelOverviewFn` conta `processing` via `message_queue`, mas todos os outros via `campaign_recipients`. Em situações de race (sender atualizou recipient mas ainda não a queue, ou vice-versa) os totais podem não somar `total = sent + failed + pending + processing`.

**Médios:**
- R5 — `ziontalk.functions.ts:21` mantém `nextDateInTz` legado com `hour+3` BRT fixo. Função não é chamada hoje, mas qualquer refactor pode reintroduzir.
- R6 — `campaigns.rate_per_min` continua sendo lido para mostrar resumo de campanha; está dessincronizado de `campaign_send_settings.max_per_minute`.
- R7 — Default de `rotation_mode` no schema do banco (`'round_robin'`) ≠ default de código (`'least_used'`). Linhas criadas direto via SQL ficam diferentes do que o usuário vê.

---

## 5. Plano de correção (ordem de prioridade)

> **Aguardando aprovação**. Cada fase é um commit isolado, reversível.

### Fase 1 — Eliminar duplicidade de configuração (estrutural)
- Migration: marcar `campaigns.channel_ids` e `campaigns.rate_per_min` como **somente leitura legada** (manter colunas por compat, parar de gravar).
- Migration: alterar default `campaign_send_settings.rotation_mode` para `'least_used'` (alinhar com código).
- `campaigns.functions.ts`: parar de gravar `channel_ids` e `rate_per_min` na criação; salvar tudo só em `campaign_send_settings`.
- `enqueueCampaignCore`: remover fallback `?? campaignChannelIds`. Se settings está vazio, erro explícito.

### Fase 2 — Centralizar seleção de canal (causa raiz)
- Criar `src/lib/send/channel-selector.server.ts → pickChannelForEnqueue(...)`: versão "previsão" do `pickChannel`, sem efeitos colaterais (não atualiza cursor, não persiste). Mesma lógica, mesmas regras.
- `enqueueCampaignCore`: trocar `pickInitialChannel` por `pickChannelForEnqueue`. O canal previsto na fila passa a ser o mesmo que o sender escolheria.
- `pickChannel` (runtime) passa a **retornar `{ channel, reason }`** e o sender grava `reason` em `message_queue.last_error` (ou novo campo, ver Fase 3).

### Fase 3 — Rastreabilidade (banco)
- Migration aditiva em `message_queue`:
  - `planned_channel_id uuid` — chip decidido no enqueue.
  - `actual_channel_id uuid` — chip que efetivamente enviou.
  - `channel_selection_reason text` — `'rotation:round_robin'`, `'fallback:least_used'`, `'limit_min'`, `'limit_day'`, `'paused'`, etc.
  - `fallback_used boolean default false`.
  - `settings_snapshot jsonb` — cópia dos campos relevantes de `campaign_send_settings` no momento do enqueue (rotation_mode, selected_channel_ids, priority, delays, limites, janela, timezone).
- Backfill: `planned_channel_id = channel_id`, `actual_channel_id = channel_id` para registros existentes.

### Fase 4 — Painel de envios honesto
- `getQueueRowsFn`: retornar `planned_channel_label`, `actual_channel_label`, `selection_reason`, `fallback_used`.
- Coluna nova "Chip planejado → chip usado" com badge vermelho quando diferentes.
- Reconciliar `getSendPanelOverviewFn`: garantir `total = sent + failed + pending + processing + opted_out`. Hoje `processing` vem de tabela diferente.

### Fase 5 — Limpeza de código morto
- Remover `nextDateInTz` legado em `ziontalk.functions.ts` (linhas 21-26) e `getBusinessHoursWindow` que ninguém chama mais.
- Remover leitura de `campaigns.rate_per_min` em telas de resumo; substituir por `campaign_send_settings.max_per_minute`.

### Fase 6 — Dry-run
- Novo server fn `simulateCampaignFn({ campaignId })` que **não envia nada**:
  - Para cada recipient elegível: roda `pickChannelForEnqueue` + checa consent/opt-out/horário/limite.
  - Retorna: `{ contact, status: 'would_send'|'blocked_no_consent'|'blocked_opt_out'|'blocked_outside_hours'|'blocked_no_channel', planned_channel, reason }`.
- Botão "Simular" no painel, antes de "Iniciar".

---

## 6. Checklist de testes antes de envio real

Após Fase 1–4, validar em ordem:

1. Criar campanha nova → conferir que `campaigns.channel_ids` está vazio e tudo está em `campaign_send_settings`.
2. Mudar `rotation_mode` no painel → recarregar form da campanha → mesmo valor.
3. Enqueue → `message_queue.planned_channel_id` deve bater com a regra escolhida.
4. Pausar 1 chip durante envio → conferir que `message_queue.actual_channel_id` muda, `fallback_used=true`, `selection_reason` preenchido.
5. Pausar campanha → conferir que pending vai para `+5min`, nenhum vira `failed`.
6. Alterar `max_per_day_per_channel` depois do enqueue → conferir que itens já enfileirados continuam usando o `settings_snapshot` do enqueue, não o novo valor.
7. Dry-run de uma campanha grande → conferir distribuição esperada chip a chip.
8. Soma de contadores: `overview.total == sent + failed + pending + processing` para qualquer campanha.

---

## 7. Arquivos que serão tocados (quando aprovado)

- `supabase/migrations/<timestamp>_consistency_audit.sql` (novo) — colunas, defaults, backfill.
- `src/lib/campaigns.functions.ts` — parar de gravar campos duplicados.
- `src/lib/ziontalk.functions.ts` — remover `pickInitialChannel`, código morto, usar `pickChannelForEnqueue`; gravar `planned_channel_id` e `settings_snapshot`.
- `src/lib/send/channel-selector.server.ts` — extrair `pickChannelForEnqueue` puro; `pickChannel` passa a retornar `reason`.
- `src/lib/send/sender.server.ts` — gravar `actual_channel_id`, `selection_reason`, `fallback_used` em vez de só `channel_id`.
- `src/lib/send-panel.functions.ts` — novo `simulateCampaignFn`; ajustes em `getQueueRowsFn` e `getSendPanelOverviewFn`.
- `src/routes/_authenticated/sending-panel.tsx` — coluna planned vs actual, botão Simular.

Nada será alterado até você dizer **"aprovado, aplica fase 1"** (ou as fases que escolher).
