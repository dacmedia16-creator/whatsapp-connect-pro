# Tornar o intervalo do "Chama Simples" configurável

Hoje o modo **Chama Simples** usa um intervalo fixo de **15 segundos** entre canais (hardcoded no backend e no formulário). Você quer poder definir esse valor ao criar/editar a campanha.

## Mudança proposta

Reutilizar o campo `delay_seconds` que já existe em `campaign_send_settings` como o "gap entre canais" do modo Chama Simples — assim **não precisa criar coluna nova** no banco.

### 1. UI — `src/components/campaign/send-settings-form.tsx`
- No card do "Chama Simples", trocar o texto fixo "15 segundos" por uma frase dinâmica usando `form.delay_seconds` (ex.: *"1 envio por canal em sequência, **{X} segundos** entre canais…"*).
- Quando `rotation_mode === "simple_call"`, **habilitar** o input de "Delay entre envios (s)" (hoje fica desativado) com:
  - label adaptada: *"Segundos entre canais"*
  - `min={5}` (proteção contra spam acidental), default 15
  - remover a mensagem *"Desativado no modo Chama Simples (fixo 15s entre canais)"*
- Na função `estimateDuration`, trocar `60 / 15` por `60 / Math.max(5, form.delay_seconds)`.

### 2. Backend — `src/lib/send/channel-selector.server.ts`
No bloco `isSimpleCall`, não forçar mais `delay_seconds: 15`. Manter o valor vindo do settings, com piso de 5s:
```ts
delay_seconds: Math.max(5, Number(settings?.delay_seconds) || 15),
```
O resto da lógica (gap global via `lastCampaignSendAt`) já lê esse `delay_seconds` automaticamente.

### 3. Process queue — `src/routes/api/public/hooks/process-queue.ts`
Hoje a constante é fixa: `SIMPLE_CALL_GAP_MS = 15_000`. Mudar para ler por campanha:
- Ao carregar `simpleCallCampaigns`, também guardar o `delay_seconds` de cada uma (`Map<campaignId, number>`).
- No loop, usar `gapMs = (settings.delay_seconds ?? 15) * 1000` em vez da constante.
- O teto de tick (`TICK_BUDGET_MS = 50_000`) continua igual — se o gap configurado for muito alto (ex.: 60s), o próximo tick do cron pega o item.

### 4. Sem migração de banco
A coluna `delay_seconds` já existe em `campaign_send_settings`. Campanhas existentes em modo Chama Simples continuam funcionando: se o valor salvo for `30` (default), passam a usar 30s; se quiser manter 15s, é só editar a campanha.

## Resultado
Ao criar/editar uma campanha em **Chama Simples**, aparece o campo "Segundos entre canais" editável (mín. 5s). O backend respeita esse valor tanto na seleção de canal quanto no pacing do worker.

## Fora de escopo
- Não mexer no mínimo de 4 canais (regra mantida).
- Não mexer em `max_per_minute/hour` nem no `batch_mode` (continuam ignorados em Chama Simples).
