# Bug: campanhas não viram "Concluída" quando terminam

## Causa raiz

Em `src/lib/send/sender.server.ts`, a função `maybeFinishCampaign` tem **dois defeitos** que se combinam e impedem a transição `running → done`:

### Defeito 1 — `finishChecked` curto-circuita cedo demais

```ts
async function maybeFinishCampaign(ctx, campaignId) {
  if (ctx.finishChecked.has(campaignId)) return;
  ctx.finishChecked.add(campaignId);   // marca ANTES de checar
  ...
}
```

O cron faz claim atômico de até 25 itens de uma vez (`message_queue.status: pending → processing`). Quando os 3 envios de uma campanha pequena caem no mesmo lote:

1. Item 1 envia com sucesso → chama `maybeFinishCampaign` → marca `finishChecked` → vê itens 2 e 3 ainda em `processing` → retorna sem finalizar.
2. Itens 2 e 3 enviam com sucesso → `maybeFinishCampaign` retorna na primeira linha (já está em `finishChecked`).
3. Cron termina sem nunca marcar a campanha como `done`.
4. Próximas execuções do cron não pegam nenhum item dessa campanha (fila vazia), então `maybeFinishCampaign` **nunca mais é chamada**.

Resultado observado no banco agora: campanha "Teste" tem 3/3 recipients com `status='sent'`, fila vazia, mas `campaigns.status='running'`.

### Defeito 2 — checagem inclui `processing`

Mesmo sem o defeito 1, a query inclui status `processing`, que captura os próprios itens do lote em execução. O último item processado entra na função quando ele próprio já está marcado `sent`, mas se houver outro `processing` em paralelo (no mesmo lote), também falha.

## Correção

Em `src/lib/send/sender.server.ts`:

1. **Remover o cache `finishChecked`** do `SenderContext` e de `createSenderContext` (não é mais necessário).
2. **Reescrever `maybeFinishCampaign`** para:
   - Não usar Set de short-circuit.
   - Contar `campaign_recipients` com `status='queued'` (deve ser 0).
   - Contar `message_queue` ainda `pending` **dessa campanha** via join filtrado, em vez de puxar 500 itens globais e filtrar em memória. Excluir `processing` da checagem — confiamos que cada item processado vai re-disparar a checagem e o último vai ver fila zerada.
   - Se ambos zero, `UPDATE campaigns SET status='done'` (mantendo o filtro `.in("status", ["running","scheduled","paused"])` para idempotência).

```ts
async function maybeFinishCampaign(_ctx, campaignId) {
  const { count: queued } = await supabaseAdmin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "queued");
  if ((queued ?? 0) > 0) return;

  // pending da campanha (via recipient_id IN (...))
  const { data: recs } = await supabaseAdmin
    .from("campaign_recipients")
    .select("id").eq("campaign_id", campaignId);
  const ids = (recs ?? []).map(r => r.id);
  if (ids.length) {
    const { count: pending } = await supabaseAdmin
      .from("message_queue")
      .select("id", { count: "exact", head: true })
      .in("campaign_recipient_id", ids)
      .in("status", ["pending", "processing"]);
    if ((pending ?? 0) > 0) return;
  }

  await supabaseAdmin
    .from("campaigns")
    .update({ status: "done" })
    .eq("id", campaignId)
    .in("status", ["running", "scheduled", "paused"]);
}
```

3. **Backfill manual** das campanhas já travadas: rodar `UPDATE` marcando como `done` qualquer campanha em `running/scheduled/paused` sem recipients `queued` e sem itens `pending`/`processing` na fila (cobre a "Teste" atual).

## Validação

1. Rodar o backfill → a campanha "Teste" passa a aparecer como "Concluída".
2. Criar uma campanha nova pequena (2-3 destinatários) → após o último envio o status muda automaticamente para `done` na próxima passada do cron (ou na mesma, dependendo do timing).
3. Campanhas grandes continuam funcionando normalmente (checagem extra é barata: dois counts indexados).
