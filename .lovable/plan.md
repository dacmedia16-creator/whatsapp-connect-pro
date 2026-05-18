## Diagnóstico

A campanha ainda não enviou porque o botão **Processar fila agora** chama `processQueueFn` em `src/lib/ziontalk.functions.ts`, mas essa função ainda usa a versão antiga do processamento:

- ela tenta enviar com a chave antiga do canal;
- a tentativa falhou com `API Key not informed`;
- a mensagem voltou para `pending` com `attempts = 2` e `scheduled_for = 02:50:00Z`;
- quando você clicou antes desse horário, retornou `0` porque não havia item vencido para processar naquele momento.

O endpoint público `src/routes/api/public/hooks/process-queue.ts` já recebeu a correção para descriptografar a chave, mas o botão manual ainda não.

## Plano

1. **Unificar o processamento manual com o processamento corrigido**
   - Atualizar `processQueueFn` em `src/lib/ziontalk.functions.ts` para também buscar a chave via `get_channel_api_key`/`CHANNEL_KEY_SECRET`.
   - Evitar voltar a usar o campo antigo `channels.zion_api_key`.

2. **Melhorar o comportamento quando o item ainda não está no horário**
   - Manter a regra de `scheduled_for`, mas retornar uma resposta mais clara quando não houver item vencido.
   - Assim o botão não parecerá “não fez nada”.

3. **Preservar status e erros corretamente**
   - Se a chave estiver ausente/inválida, marcar fila e destinatário como `failed` com erro claro.
   - Se enviar com sucesso, atualizar `message_queue`, `campaign_recipients`, `channels` e criar a mensagem/conversa como já faz hoje.

4. **Validar no banco após a mudança**
   - Conferir que o item da campanha sai de `pending/queued` para `sent` ou mostra um erro real da Ziontalk.
   - Verificar que o botão manual passa a processar a mesma lógica corrigida do worker.