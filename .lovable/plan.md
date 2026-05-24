## Modo "Chama Simples"

Novo modo de rotação que envia um por canal, em ordem fixa, com **15 segundos** entre canais. Ao chegar no último, recomeça do primeiro. Requer **mínimo 4 canais** selecionados. Quando ativo, todas as outras configurações de velocidade/limites/lote são ignoradas e ficam desabilitadas no formulário.

---

### 1. Banco (migration)

Adicionar o valor `simple_call` ao enum `rotation_mode`:
```sql
ALTER TYPE public.rotation_mode ADD VALUE IF NOT EXISTS 'simple_call';
```

### 2. Tipos compartilhados — `src/lib/send-settings-defaults.ts`

- Adicionar `"simple_call"` ao tipo `RotationMode`.

### 3. Sender — `src/lib/send/channel-selector.server.ts`

- Em `pickChannel` (runtime) e `pickChannelForEnqueue` (planejamento): tratar `mode === "simple_call"` igual a `round_robin` para ordem cíclica (usa `rotation_cursor`).
- Quando o modo for `simple_call`, **sobrescrever os settings em memória** antes dos checks:
  - `delay_seconds = 15`
  - `random_delay_min = null`, `random_delay_max = null`
  - `max_per_minute`, `max_per_hour` = ignorados (não aplicar como bloqueio de pacing — apenas o gap de 15s vale)
  - `batch_mode = false`
- Mantém os checks de `status` (paused/error) e `max_per_day_per_channel` / `daily_limit` por segurança (chip caído continua sendo pulado).

### 4. Formulário — `src/components/campaign/send-settings-form.tsx`

- Adicionar 4ª opção no `RadioGroup` de estratégia: **"Chama Simples"** — descrição: *"1 envio por canal em sequência, 15 segundos entre canais. Requer mínimo 4 canais."*
- Quando `form.rotation_mode === "simple_call"`:
  - Card **"Velocidade e limites"**: aplicar `opacity-50 pointer-events-none` no `<CardContent>` e mostrar nota: *"Desativado no modo Chama Simples (fixo 15s entre canais)."*
  - Card **"Lotes sincronizados"**: mesmo tratamento.
  - Forçar `batch_mode = false` ao selecionar o modo.
- Exibir badge/alerta vermelho no card de canais quando `simple_call` e `selected_channel_ids.length < 4`: *"Chama Simples requer no mínimo 4 canais selecionados."*

### 5. Validação — `validateSendSettings`

Adicionar regra:
```ts
if (form.rotation_mode === "simple_call" && form.selected_channel_ids.length < 4) {
  return "Chama Simples requer no mínimo 4 canais selecionados.";
}
```
Isso bloqueia o salvamento (botão "Salvar" já usa `validateSendSettings` antes do upsert).

### 6. Estimativa — `estimateDuration`

Quando `rotation_mode === "simple_call"`: usar `delayMed = 15`, `ratePerMin = (60/15) * n = 4n msg/min`, ignorando `max_per_minute`.

---

### Notas
- O cursor de round-robin (`campaign_send_settings.rotation_cursor`) já existe e será reutilizado — não precisa de nova coluna.
- Não mexe na seleção de canais nem na janela de horário da campanha (continuam valendo).
- Chips em pacing/bloqueados continuam sendo pulados (mantém ordem cíclica, não trava).
