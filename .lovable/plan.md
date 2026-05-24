## Mostrar tempo de término da campanha

Na tela `/_authenticated/campaigns/$campaignId`, adicionar a previsão (ou hora real) de término ao lado das outras métricas do card de progresso.

### 1. Buscar `started_at` e `last_sent_at`
Adicionar uma `useQuery` que consulte `campaign_recipients` da campanha:
- `started_at` = `min(sent_at)` dos enviados
- `last_sent_at` = `max(sent_at)` dos enviados
(Uma query simples ordenando por `sent_at asc/desc limit 1`, sem agregação no cliente para evitar 1000-row cap.)

### 2. Calcular ETA
Criar helper local `computeEta({ status, stats, sendSettings, startedAt, lastSentAt })`:

- **`status === "done"`**: retorna `{ label: "Finalizada em", value: format(lastSentAt) }`.
- **`status === "running" | "paused" | "scheduled"`** e há pendentes (`queued > 0`):
  - `remaining = stats.queued`
  - Determinar segundos por envio:
    - Se `sendSettings.rotation_mode === "simple_call"`: `secPerMsg = max(5, sendSettings.delay_seconds || 15)` (1 envio global a cada X seg).
    - Caso contrário: `msgsPerMin = (campaign.rate_per_min || 1) * max(1, sendSettings.selected_channel_ids.length)` → `secPerMsg = 60 / msgsPerMin`.
  - `etaMs = remaining * secPerMsg * 1000`
  - `etaDate = new Date(Date.now() + etaMs)` (se `paused`, mostrar "Pausada — restam ~Xmin" sem data).
  - Formatar duração ("~1h 23min", "~12min", "<1min") + horário previsto (`HH:mm`).
- **Sem pendentes ou sem `sendSettings`**: não mostra o bloco.

### 3. UI
No card de Progresso (logo abaixo do `<Progress />`), trocar o grid de 4 colunas para 5 e adicionar uma nova célula:

```
Previsão de término
~1h 23min (≈ 16:42)
```

Para campanha `done`:
```
Finalizada em
24/05 14:07
```

Texto auxiliar pequeno explicando que é uma estimativa baseada na configuração de envio atual.

### Fora de escopo
- Não persistir `finished_at` no banco (usa `max(sent_at)` derivado).
- Não mexer no backend/worker.
- Não tocar em outras telas (lista de campanhas, painel de envios).
