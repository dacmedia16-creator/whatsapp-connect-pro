## Problema

A campanha **Teste** foi marcada como `done`, mas **165 mensagens continuam pendentes na fila** e o worker do cron não verifica o status da campanha antes de enviar — por isso os envios continuaram após o "cancelamento" (último envio às 02:48).

## Solução em 2 partes

### Parte 1 — Limpar o que ficou para trás (one-shot agora)

Atualizar imediatamente os 165 itens órfãos da campanha `e6c2f445-…`:

- `message_queue`: `pending` → `failed` (com `last_error = "Campanha cancelada pelo gestor"`) para os itens dessa campanha
- `campaign_recipients`: `queued` → `failed` (com `error = "Campanha cancelada"`) para os mesmos

Resultado: o cron para de tocar nesses itens na próxima execução.

### Parte 2 — Corrigir o comportamento de "cancelar" para o futuro

Hoje `setCampaignStatusFn` em `src/lib/send-panel.functions.ts` só atualiza `campaigns.status`. Mudar para que, quando o novo status for `paused` ou `done`, também:

1. Marque todos os `message_queue.pending`/`processing` daquela campanha como `failed` (motivo: "Campanha pausada/finalizada")
2. Marque os `campaign_recipients` correspondentes ainda em `queued` como `failed` com `error` explicativo
3. Quando o status for `paused`, manter os itens como `pending` mas adicionar uma checagem no `processQueueItem` (`src/lib/send/sender.server.ts`): antes de enviar, ler `campaigns.status` da campanha do recipient — se for `paused` ou `done`, reagendar (paused) ou marcar como `failed` (done) sem chamar a Ziontalk.

Assim:
- **Pausar** = para o envio, mantém a fila para retomar depois
- **Finalizar (done)** = cancela definitivamente os pendentes
- **Defesa em profundidade**: mesmo que algum item escape, o sender confere o status da campanha antes de enviar

## Arquivos afetados

- `src/lib/send-panel.functions.ts` — expandir `setCampaignStatusFn`
- `src/lib/send/sender.server.ts` — adicionar checagem do status da campanha no início de `processQueueItem`
- SQL one-shot (via insert tool) para limpar os 165 órfãos atuais

## Observação

Não vou mexer no schema nem em RLS — só lógica de aplicação e um update pontual de dados.
