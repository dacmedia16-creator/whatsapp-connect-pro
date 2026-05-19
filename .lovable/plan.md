## Verificação — resultado

Rodei o cruzamento de `conversations.channel_id` com o `sent_via_channel_id` do último inbound de cada conversa:

| Conversas | Resultado |
|---|---|
| 17 conversas analisadas | nenhuma com inbound carregando canal |
| Único caso com inbounds reais (contato Denis, 10 mensagens recentes) | **todas com `sent_via_channel_id = NULL`** |
| Conversa do Denis | marcada como "Envio 1" desde a criação, nunca foi recalibrada |

Ou seja: a correção do webhook **não falhou**, mas também **não tem efeito hoje**, porque o webhook nunca consegue identificar o canal de destino do payload da ZionTalk — todos os inbounds entram com `channelId = null`. Como o código só atualiza `conversations.channel_id` quando o canal vem identificado, ele sempre mantém o canal antigo (o da campanha original).

## Causa provável

Em `src/routes/api/public/webhooks/ziontalk.ts`, o `flattenZionPayload` procura o canal de destino em:
- `r.to`, `r.channel`, `r.mobile_phone` (formato plano)
- `mensagem.canal`, `mensagem.channel`, `mensagem.destino` (formato aninhado)

Se a ZionTalk envia o número de destino em outra chave (ex.: `to_number`, `destination`, `instance`, `connectedPhone`, `receiver`), nada bate e `toPhone` fica `null` → `channelId` fica `null` → a conversa nunca é recalibrada.

Não temos como adivinhar a chave certa sem ver o payload real.

## Plano

### 1. Logar o payload bruto recebido
Adicionar `console.log("[ziontalk webhook] payload:", JSON.stringify(raw))` no início do handler (após o `request.json()`, antes do flatten). Os logs aparecem em `stack_modern--server-function-logs` filtrando por `ziontalk webhook`.

### 2. Você dispara uma mensagem de teste
Cliente manda 1 mensagem para cada um dos 4 números (Envio 1 a 4). Eu leio os logs e identifico qual chave traz o número de destino.

### 3. Atualizar `flattenZionPayload`
Adicionar as chaves descobertas no fallback, garantindo que `to` seja preenchido. A partir daí:
- novos inbounds salvam `messages.sent_via_channel_id` correto;
- `conversations.channel_id` é atualizado para o canal que recebeu a mensagem;
- sua resposta sai pelo mesmo número.

### 4. (Opcional, após validação) Recalibrar conversas antigas
Como inbounds antigos não têm `sent_via_channel_id`, não dá para "consertar retroativamente" — esse dado se perdeu. Conversas existentes continuam com o canal antigo até o cliente escrever de novo (aí o webhook recalibra).

## Fora de escopo
- Mudanças no envio de campanha.
- UI da inbox.
- Nenhuma migração de schema.