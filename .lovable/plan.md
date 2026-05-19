## Diagnóstico

Você criou a campanha **REMAX** (id `a10e7cba…`) às 13:46 BRT com 1 destinatário. Verifiquei no banco:

- `campaigns.status = running` ✅
- `campaign_recipients.status = queued` (1 linha) ✅
- `message_queue`: **0 linhas** ❌
- `send_logs` após 13:46: **nenhum** ❌

O canal está conectado, dentro da janela 09–18, com cota disponível. Ou seja: o envio nunca chegou ao ZionTalk porque **a fila nunca foi alimentada**.

## Causa raiz

`createCampaignFn` (`src/lib/campaigns.functions.ts`) faz três coisas quando o usuário marca "Iniciar agora":

1. Insere a campanha como `running`
2. Insere as linhas em `campaign_recipients` como `queued`
3. Persiste `campaign_send_settings`

**Nunca chama `enqueueCampaignFn`.** O cron `/api/public/hooks/process-queue` só processa o que está em `message_queue`, e essa tabela continua vazia até alguém abrir a tela da campanha e clicar em "Enfileirar" (ou usar o Painel de Envios). Por isso a campanha fica "running" para sempre sem disparar nada.

Campanhas anteriores funcionaram porque foram enfileiradas manualmente pela tela `/campaigns/$id` ou pelo painel.

## Correção proposta

Fazer o `createCampaignFn` enfileirar automaticamente quando `initiate = true` e não houver `scheduledAt`. A lógica de enqueue já existe em `enqueueCampaignFn` — vou extraí-la para uma função interna reutilizável (sem mudar regras de negócio) e chamá-la nos dois pontos.

### Passos

1. **Extrair `enqueueCampaignCore(campaignId)`** em `src/lib/ziontalk.functions.ts`
   - Move o corpo atual do `.handler` de `enqueueCampaignFn` para uma função normal exportada.
   - `enqueueCampaignFn` continua existindo (com `requireSupabaseAuth` + checagem de role) e só delega para `enqueueCampaignCore`. Mantém compatibilidade com a tela da campanha e do painel.

2. **Chamar o enqueue no `createCampaignFn`**
   - Em `src/lib/campaigns.functions.ts`, após o `upsert` de `campaign_send_settings`, se `data.initiate && !data.scheduledAt`:
     - `await enqueueCampaignCore(campaign.id)`
     - Em caso de erro, marcar a campanha como `draft` de novo e propagar erro, para o usuário não ficar com status "running" sem fila.
   - Quando há `scheduledAt`, manter o comportamento atual (status `scheduled`, sem enfileirar) — o cron pode enfileirar no horário futuramente, mas isso fica fora desse fix.

3. **Backfill do envio que falhou agora**
   - Após o deploy, basta abrir a campanha REMAX e clicar em "Enfileirar" uma vez — ou eu posso, se você quiser, disparar o enqueue manualmente via o endpoint de processamento. Confirmo isso na implementação.

### Arquivos previstos

- `src/lib/ziontalk.functions.ts` — extrair `enqueueCampaignCore`, manter `enqueueCampaignFn` como wrapper.
- `src/lib/campaigns.functions.ts` — chamar `enqueueCampaignCore` ao criar com "Iniciar agora".

### Fora de escopo

- Sem mudanças em UI, RLS, schema, ZionTalk client ou cron.
- Sem mexer em mídia/anexos — o caminho de envio já passa pelo `processQueueItem` (corrigido na rodada anterior) e inclui mídia corretamente assim que a fila for alimentada.
