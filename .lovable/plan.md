## Painel de Controle de Envios

Novo painel global em `/sending-panel` + controles avançados na tela de detalhe da campanha. Reaproveita a infra atual (`message_queue` + `/api/public/hooks/process-queue` + pg_cron) e adiciona regras de rotação, delay, janela horária e limites por canal **por campanha**.

---

### 1. Banco de dados (migração)

Criar **uma única nova tabela** `campaign_send_settings` (1↔1 com `campaigns`) e estender o que já existe — sem duplicar `send_queue` nem `send_logs` (que já existem).

`campaign_send_settings`:
- `campaign_id` (PK, FK→campaigns, ON DELETE CASCADE)
- `selected_channel_ids uuid[]` — canais ativos no envio
- `rotation_mode` enum: `round_robin` | `least_used` | `manual_priority` (default `round_robin`)
- `channel_priority uuid[]` — ordem quando `manual_priority`
- `delay_seconds int` (default 30) — tempo fixo entre disparos
- `random_delay_min int`, `random_delay_max int` (nulláveis) — variação aleatória opcional
- `max_per_minute int` (default 20)
- `max_per_hour int` (default 200)
- `max_per_day_per_channel int` (default 500) — sobrescreve `channels.daily_limit` quando definido
- `allowed_start_time time` (default 09:00)
- `allowed_end_time time` (default 18:00)
- `allowed_weekdays int[]` (default `{1,2,3,4,5}`)
- `timezone text` (default 'America/Sao_Paulo')
- `auto_pause_outside_hours bool` (default true)
- `auto_pause_on_all_channels_down bool` (default true)
- `created_at`, `updated_at`

RLS: igual ao padrão `admin|gestor` (manage) e leitura para autenticados.

Adicionar em `message_queue`: índice `(status, scheduled_for)` se ainda não existir, para o claim atômico ficar barato.

Reaproveitar `send_logs` existente para a aba "Atividade em tempo real" (já tem `campaign_id`, `channel_id`, `contact_id`, `response_text`).

> Não vou criar `send_queue` paralela — extender `message_queue` evita migração de dados e mantém o processador único.

---

### 2. Server functions novas (`src/lib/send-panel.functions.ts`)

Todas com `requireSupabaseAuth` + check admin/gestor:

- `getSendSettingsFn({ campaignId })` — retorna settings + defaults dos canais
- `upsertSendSettingsFn({ campaignId, …fields })` — Zod validado, valida que `selected_channel_ids` ⊂ canais existentes
- `getSendPanelOverviewFn({ campaignId? })` — agrega: total na fila, enviados, pendentes, falhas, canais ativos, velocidade atual (msg/min derivada de `send_logs` últimos 5 min), próximo envio agendado
- `getChannelsHealthFn()` — para cada canal: status, `sent_today`, daily_limit efetivo, saldo, último envio, último erro
- `enqueueWithSettingsFn({ campaignId })` — substitui `enqueueCampaignFn` quando há settings: aplica rotação inicial (`round_robin` / `least_used` / `manual_priority`) atribuindo `channel_id` por destinatário, distribui `scheduled_for` respeitando `delay_seconds` + variação + janela horária
- `pauseCampaignFn`, `resumeCampaignFn`, `stopCampaignFn` — manipulam `campaigns.status` e flagam itens em `message_queue` (status=`paused` novo, ou `scheduled_for` longe no futuro)
- `requeueFailedFn({ campaignId })` — re-enfileira falhas (status=`failed` → `pending`, attempts=0)
- `requeueRecipientFn({ recipientId })` — uma linha
- `markIgnoredFn({ recipientId })`
- `testChannelFn` já existe — reaproveitar

Estender `processQueueFn` (e o gêmeo em `/api/public/hooks/process-queue`):
- Antes de cada item, ler `campaign_send_settings` do `campaign_id` do recipient
- Aplicar `max_per_minute` / `max_per_hour` por canal consultando `send_logs` (count nas janelas)
- Aplicar `max_per_day_per_channel` se definido (sobrescreve `channels.daily_limit`)
- Aplicar janela `allowed_start_time` / `allowed_end_time` / `allowed_weekdays` / `timezone`
- Se todos os canais selecionados estiverem indisponíveis e `auto_pause_on_all_channels_down`, setar `campaigns.status='paused'` + alert
- Adicionar novo status `queue_status`: `paused` (enum existente — verificar e ALTER TYPE se preciso)

---

### 3. UI — Nova rota `/sending-panel` (visão global)

`src/routes/_authenticated/sending-panel.tsx`:

```
┌─ Cabeçalho: "Painel de Controle de Envios" ────────────┐
│  6 cards: Total fila | Enviados | Pendentes | Falhas   │
│           Canais ativos | Velocidade (msg/min)         │
├─ Seletor de campanha (dropdown) ───────────────────────┤
│  Resumo: nome / status / total / agendamento / mensagem │
├─ Tabs: [Canais] [Distribuição] [Velocidade] [Horário] │
│        [Controles] [Fila] [Atividade]                  │
└────────────────────────────────────────────────────────┘
```

Componentes em `src/components/sending-panel/`:
- `OverviewCards.tsx` — 6 métricas, atualizadas via Realtime
- `CampaignSelect.tsx`
- `ChannelSelectorCard.tsx` — checkbox por canal, status badge, sent/limit, último envio, botões pausar canal / testar conexão
- `RotationModeCard.tsx` — radio: Round-robin / Menor uso / Prioridade manual (drag-and-drop quando manual) + descrição curta
- `SpeedSettingsCard.tsx` — inputs: delay fixo, variação min/max (toggle), max/min, max/hora, max/dia por canal
- `BusinessHoursCard.tsx` — start/end (time), weekdays (toggle group), timezone, switch "pausar fora do horário"
- `ControlsBar.tsx` — Iniciar | Pausar | Retomar | Interromper | Processar lote | Reprocessar falhas (botões alternam por status)
- `ProgressBar.tsx` — barra + % + estimativa baseada em `velocidade atual`
- `QueueTable.tsx` — paginada: nome, telefone, canal, status badge, tentativas, última, próxima, erro, ações (Reenviar / Ignorar / Detalhes)
- `LiveActivityPanel.tsx` — lateral, stream últimos 50 eventos de `send_logs` + `campaign_events` via Realtime

Antes de "Iniciar envios": `AlertDialog` com resumo (campanha, contatos válidos, canais, velocidade, janela, estimativa) e confirmação.

### 4. UI — Tela de detalhe da campanha existente

Em `src/routes/_authenticated/campaigns.$campaignId.tsx` adicionar uma nova aba **"Painel de envios"** ao lado das atuais ("Log de eventos", "Destinatários") que renderiza os mesmos componentes de `src/components/sending-panel/` no contexto daquela campanha. Mantém o atalho `Link → /sending-panel?campaignId=…` para abrir em tela cheia.

### 5. Tempo real

Reusar padrão já existente (`supabase.channel(...).on("postgres_changes"...)`):
- Subscribe em `message_queue` (filter `campaign_id`), `campaign_recipients`, `send_logs`, `channels`
- Invalida queries de overview / canais / fila / atividade
- Badge "Ao vivo" / "Conectando" / "Offline" reaproveitando o componente já criado para inbox

### 6. Sidebar + navegação

Adicionar item "Painel de envios" em `src/components/app-sidebar.tsx` (ícone `Gauge` ou `SlidersHorizontal`) apontando para `/sending-panel`. Posicionar entre "Campanhas" e "Canais".

### 7. Regras de negócio (aplicadas em `processQueueFn` + UI)

- Nunca enviar sem `consent` ou com `opt_out_at` (já existe)
- Nunca usar canal `paused` / `error` / fora dos `selected_channel_ids` da campanha
- Respeitar `max_per_day_per_channel` (override > `channels.daily_limit`)
- Respeitar `max_per_minute` / `max_per_hour` consultando `send_logs`
- Respeitar janela horária + weekdays + timezone
- Rotação aplicada na **re-fila** quando canal indisponível (escolhe próximo da lista conforme `rotation_mode`)
- Backoff exponencial em falha (já existe), até 3 tentativas
- Se todos os canais selecionados indisponíveis + auto_pause → `campaigns.status='paused'` + insert em `alerts`

---

### Detalhes técnicos

- **Stack**: TanStack Start + Server Functions + Supabase Realtime + TanStack Query (já o padrão do projeto)
- **Status novo** em `queue_status` enum: adicionar `paused` via `ALTER TYPE` (verificar tipos existentes na migração)
- **Velocidade atual**: `SELECT count(*) FROM send_logs WHERE created_at > now() - interval '1 minute' AND http_status BETWEEN 200 AND 299` por canal
- **Estimativa de conclusão**: `pendentes / velocidade_atual` (fallback `max_per_minute` agregado se velocidade=0)
- **Atomicidade**: claim atômico já implementado no cron (`UPDATE … WHERE status='pending' RETURNING id`) — mantido
- **Pausar canal individual**: usa `channels.status='paused'` já existente
- **Distribuição inicial** (em `enqueueWithSettingsFn`): para N destinatários e M canais selecionados, calcula `scheduled_for[i] = now + i * delay_seconds` (+ jitter), atribui `channel_id` round-robin/menor-uso/prioridade
- **Reprocessar falhas**: `UPDATE message_queue SET status='pending', attempts=0, scheduled_for=now() WHERE campaign_id=$1 AND status='failed'`

---

### Entregáveis

1. Migração SQL (`campaign_send_settings` + enum update + índices)
2. `src/lib/send-panel.functions.ts` (server fns + extensão do processador)
3. Atualização de `src/lib/ziontalk.functions.ts` e `src/routes/api/public/hooks/process-queue.ts` para honrar as settings
4. `src/routes/_authenticated/sending-panel.tsx` (nova tela)
5. Pasta `src/components/sending-panel/` (~10 componentes)
6. Nova aba na tela de detalhe da campanha
7. Item no sidebar
8. Design: cards com métricas, badges coloridas por status, tabela paginada, painel lateral de atividade — seguindo tokens de `src/styles.css` já em uso (gold/dark do ZionFlow)
