## Frente B — identificar o canal automaticamente

Investigação extra: a documentação pública da ZionTalk (`ziontalk.com.br/docs`) **não documenta** o formato do webhook de mensagens recebidas — só o endpoint de envio. Sem um payload real em mãos, não dá para garantir qual chave traz o número de destino.

Então a solução mais robusta — que não depende do que a ZionTalk decide enviar — é **incluir o canal na própria URL do webhook**, configurando uma URL diferente em cada canal da ZionTalk.

## Plano

### 1. Webhook aceita `channel_id` na query string
Em `src/routes/api/public/webhooks/ziontalk.ts`:

- Ler `channel_id` da query string (`?token=...&channel_id=<uuid>`).
- Se vier, validar que o UUID existe na tabela `channels` e usar **direto** como `channelId`, ignorando qualquer tentativa de extrair do payload.
- Se não vier, manter o fallback atual (tentar achar pelo `to`/`channel` do payload).
- Manter também o `console.log` do payload bruto para, no futuro, evoluir o fallback automático se quiser.

### 2. Tela de Canais mostra a URL específica de cada canal
Em `src/routes/_authenticated/channels.tsx` (ou o arquivo equivalente), adicionar para cada canal um campo "URL do webhook" com botão **Copiar**, montando:

```
https://enviomassapro.lovable.app/api/public/webhooks/ziontalk?token=SEU_ZION_WEBHOOK_TOKEN&channel_id=<uuid>
```

(O token continua igual para todos; só o `channel_id` muda por canal.)

### 3. Você cola a URL correta em cada canal da ZionTalk
Cada um dos 4 canais (Envio 1, 2, 3, 4) recebe sua própria URL com o `channel_id` certo. A partir daí:

- Toda mensagem recebida já chega com o canal correto identificado.
- `messages.sent_via_channel_id` passa a ser preenchido.
- `conversations.channel_id` é recalibrado para o canal do último inbound.
- Sua resposta na inbox sai pelo mesmo número onde o cliente escreveu.

### 4. (Não faz parte desta entrega) Recalibrar conversas antigas
Inbounds antigos não têm `sent_via_channel_id` salvo, então não há como consertar retroativamente — cada conversa só recalibra na próxima mensagem que o cliente mandar.

## Fora de escopo
- Envio de campanha.
- UI da inbox / seletor manual de canal (fica para depois, se ainda fizer falta).
- Mudança no `zionSendMessage`.
- Nenhuma migração de schema.