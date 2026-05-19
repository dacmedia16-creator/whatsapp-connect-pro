# Marcar campanha como Concluída automaticamente

## Diagnóstico

Olhando no banco, as duas campanhas estão de fato terminadas:

- **REMAX - Visita Prova**: 30 de 30 enviados, 0 na fila → status ainda `running`
- **remax 2**: 3 de 3 enviados, 0 na fila → status ainda `running`

O motivo é simples: **não existe nenhum código que mude o status para `done` automaticamente**. Hoje o `done` só acontece se o usuário clicar manualmente no botão "Finalizar" (em `campaigns.$campaignId.tsx` e `sending-panel.tsx`). O cron de envio (`sender.server.ts`) só lê `done` para parar de enviar — nunca grava.

## O que vou fazer

### 1. Auto-finalizar ao terminar o último envio

Em `src/lib/send/sender.server.ts`, ao final de `processQueueItem` quando o envio é bem-sucedido (ou quando um recipient vai para `failed` definitivo após 3 tentativas), checar se ainda restam destinatários pendentes da campanha:

```sql
select count(*) from campaign_recipients
where campaign_id = $1 and status = 'queued'
```

Se `count = 0` **e** não há itens em `message_queue` com `status in ('pending','processing')` para essa campanha, marcar `campaigns.status = 'done'`.

Para evitar custo a cada envio, só rodar essa checagem quando o item processado for de campanha (já temos `campaignId`) e o resultado foi `sent` ou `failed`-final. Cache simples por batch (`Set<string>` em `SenderContext`) para não checar a mesma campanha mais de uma vez por execução do cron.

### 2. Backfill das duas campanhas atuais

Via insert tool, atualizar `REMAX - Visita Prova` e `remax 2` para `status = 'done'` agora, já que ambas estão 100% concluídas.

### 3. UI (sem mudança)

A página `campaigns.index.tsx` já tem o badge "Concluída" mapeado para o status `done` — vai aparecer sozinho assim que o status mudar. Nada a fazer no front.

## Detalhes técnicos

- **Arquivo principal**: `src/lib/send/sender.server.ts`
  - Adicionar helper `maybeFinishCampaign(ctx, campaignId)` que faz as duas contagens e o update.
  - Chamar após o ramo `result.ok` (depois de atualizar `campaign_recipients` para `sent`) e no ramo de falha quando `tooMany === true`.
  - Adicionar `finishedCheckedCampaigns: Set<string>` ao `SenderContext`.
- **Backfill**: `UPDATE campaigns SET status='done' WHERE id IN ('ab34583a-…','1297e253-…')`.
- **Sem mudança de schema**: o enum `campaign_status` já tem `done`.

## Validação

- Após implementar e rodar o backfill, as duas linhas em `/campaigns` devem aparecer com o badge **Concluída** em vez de **Em execução**.
- Próxima campanha nova: ao terminar o último envio, o status deve virar `done` automaticamente dentro do mesmo tick do cron.

## Pergunta

Pode prosseguir com (a) o auto-finalizar e (b) o backfill das duas campanhas existentes para `Concluída`?
