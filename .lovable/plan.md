## Plano

**Eu não consigo publicar o projeto sozinho** — o botão Publish precisa ser clicado por você. Mas posso validar tudo imediatamente depois.

### Passos

1. **Você publica** o projeto (botão Publish no topo direito → Update). Isso sobe a versão atual do `src/routes/api/public/webhooks/ziontalk.ts`, que já lê `channel_id` da query string e tem os `console.log` de debug.

2. **Você envia 1 mensagem de teste para cada um dos 4 números** (WhatsApp), na ordem:
   - Envio 1 → +55 15 99634-6760 — texto: `teste 1`
   - Envio 2 → +55 15 99665-9107 — texto: `teste 2`
   - Envio 3 → +55 15 99835-9675 — texto: `teste 3`
   - Envio 4 → +55 15 99651-2656 — texto: `teste 4`

3. **Você me avisa "mandei"** e eu, em build mode, faço:
   - Leio os logs do worker (`stack_modern--server-function-logs`) — espero ver 4 POSTs `200` e 4 linhas `[ziontalk webhook] channel lookup result: <uuid>` com IDs distintos.
   - Consulto o banco:
     ```sql
     SELECT m.created_at, left(m.body,20) body, m.sent_via_channel_id, c.phone_e164
     FROM messages m LEFT JOIN channels c ON c.id = m.sent_via_channel_id
     WHERE m.direction='in' ORDER BY m.created_at DESC LIMIT 4;
     ```
   - **Critério de sucesso:** as 4 mensagens novas devem ter `sent_via_channel_id` preenchido e bater 1-para-1 com o número que recebeu (`teste 2` ↔ `+5515996659107`, etc.). Também verifico que a `conversations.channel_id` foi atualizado para o canal correto, garantindo que sua resposta sai pelo mesmo número.

4. **Se algum canal continuar falhando**, eu uso os logs novos (`queryChannelId` vs `channel lookup result`) para diagnosticar exatamente onde quebra (URL chegando errada, lookup retornando null, etc.) e proponho a correção.

5. **Cleanup final** (após confirmação): removo os `console.log` de debug do arquivo de webhook.

Nenhuma alteração de código é necessária antes de publicar. Pode publicar e mandar os 4 testes.
