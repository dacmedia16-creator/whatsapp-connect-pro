## Problema

Quando você responde na caixa de entrada, a mensagem sai por um canal diferente daquele em que o cliente escreveu.

## Causa

No envio (`src/routes/_authenticated/inbox.tsx` linha 306), a resposta é enviada por `conv.channel_id`. Já o webhook (`src/routes/api/public/webhooks/ziontalk.ts`), na correção anterior, **só preenche** `conversations.channel_id` quando ele está **null**:

```ts
if (channelId && !existingConv?.channel_id) patch.channel_id = channelId;
```

Resultado: se a conversa foi criada/marcada com o canal A e o cliente depois escreve para o canal B, a conversa continua marcada como canal A — e a resposta sai pelo A.

(As mensagens individuais já guardam `sent_via_channel_id` corretamente, então o histórico está certo; o problema é só no roteamento da resposta.)

## Plano

### 1. Webhook: sempre alinhar o canal da conversa com o último canal recebido
Em `src/routes/api/public/webhooks/ziontalk.ts`, mudar a regra para:

- Se o payload identificou `channelId` e ele é **diferente** do `existingConv.channel_id`, atualizar `channel_id` da conversa para o novo.
- Se o payload não identificou canal, manter o anterior (não sobrescrever com null).

Isso garante que a próxima resposta saia pelo mesmo número onde o cliente escreveu por último.

### 2. UI: deixar o atendente forçar outro canal (opcional, peça se quiser)
No painel da conversa, adicionar um seletor "Enviar por: [canal]" com o canal atual pré-selecionado e a opção de trocar antes de enviar. **Só faço isso se você confirmar** — a correção do item 1 já resolve o caso descrito.

### 3. Sem mudanças de schema, sem migração de dados
A correção entra em vigor na próxima mensagem que o cliente enviar (o webhook vai recalibrar o canal da conversa naquele momento).

## Fora de escopo
- Envio de campanha.
- Layout da inbox.
- Lógica de atribuição/atendente.