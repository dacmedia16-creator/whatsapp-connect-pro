## Por que não enviou

O worker `process-queue` tentou despachar a mensagem da campanha "Teste" mas a Ziontalk respondeu **"API Key not informed"**. A mensagem voltou para `pending` com `attempts=1` e o canal "Envio 1" ficou com `last_error="API Key not informed"`.

## Causa raiz

A chave da Ziontalk do canal está armazenada **cifrada** (coluna `channels.zion_api_key_encrypted` + tabela `channel_api_keys` com versão ativa). A coluna em texto plano `channels.zion_api_key` foi zerada quando o canal foi criado/rotacionado (comportamento correto da migração).

Mas o worker `src/routes/api/public/hooks/process-queue.ts` lê **diretamente** `ch.zion_api_key` (string vazia) e manda para `zionSendMessage`:

```ts
apiKey: ch.zion_api_key, // sempre "" desde a migração de cifragem
```

Como o campo está vazio, a Ziontalk rejeita com 401/erro e nenhuma campanha consegue enviar.

Já existe no banco a função `public.get_channel_api_key(p_channel_id, p_secret)` (SECURITY DEFINER, grant para `service_role`) que devolve a chave decifrada usando `CHANNEL_KEY_SECRET`. O secret `CHANNEL_KEY_SECRET` já está configurado no ambiente do servidor.

## Correção

Em `src/routes/api/public/hooks/process-queue.ts`, antes do `zionSendMessage`:

1. Ler `process.env.CHANNEL_KEY_SECRET`. Se faltar, marcar a mensagem como `failed` com erro claro ("CHANNEL_KEY_SECRET ausente no servidor") em vez de gastar tentativas chamando a Ziontalk.
2. Chamar `supabaseAdmin.rpc("get_channel_api_key", { p_channel_id: ch.id, p_secret: secret })`.
3. Se o retorno for nulo/vazio, marcar mensagem como `failed`, atualizar `channels.last_error = "Chave da Ziontalk não configurada"` e seguir.
4. Passar a chave decifrada para `zionSendMessage({ apiKey, ... })`.

Cache opcional por execução: usar um `Map<channelId, string>` dentro do handler para não chamar a RPC uma vez por item quando vários da mesma fila são do mesmo canal.

Após o deploy, re-tentar (o item `5a01c5a9…` está agendado para 02:45 e será reprocessado automaticamente; alternativamente, o usuário pode clicar "Processar fila agora" na tela da campanha).

Sem mudanças em UI, schema ou outras rotas.
