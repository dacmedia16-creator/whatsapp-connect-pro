## Diagnóstico

O anexo está sendo salvo corretamente na campanha: a campanha `Teste` tem `media_url`, `media_filename` e `media_mime`, e seus itens foram enviados pela fila.

O problema provável está no caminho de processamento manual usado pelo painel (`processQueueFn` em `src/lib/ziontalk.functions.ts`): ele envia `item.rendered_text` sem carregar nem passar a mídia da campanha para `zionSendMessage`. Já existe uma rotina mais nova em `src/lib/send/sender.server.ts` que carrega a mídia, mas o painel ainda chama o processamento antigo em algumas telas.

## Plano de correção

1. **Centralizar o envio da fila**
   - Alterar `processQueueFn` para usar `createSenderContext` + `processQueueItem`, a mesma lógica usada pelo endpoint automático `/api/public/hooks/process-queue`.
   - Isso evita dois caminhos diferentes de envio e garante que mídia, rotação de canais, limites e auditoria sigam uma única regra.

2. **Preservar o comportamento do painel**
   - Manter o retorno com `sent`, `failed`, `skipped`, `rescheduled` e `totalProcessed`, para não quebrar `sending-panel.tsx` nem `campaigns.$campaignId.tsx`.
   - Não alterar criação de campanhas, contatos, consentimento, autenticação, banco de dados ou regras de negócio.

3. **Garantir anexo no envio**
   - Confirmar que `processQueueItem` busca `campaign.media_url/media_filename/media_mime` via `campaign_recipient_id -> campaign_id` e passa `media` para `zionSendMessage`.
   - Se necessário, ajustar apenas o select da fila para incluir `recipient:campaign_recipients(id, campaign_id)`.

4. **Melhorar observabilidade do anexo**
   - Ajustar o log de envio para registrar de forma segura quando houve tentativa com mídia, sem expor chave de API.
   - Manter o corpo de resposta limitado como já está.

5. **Validação**
   - Rodar uma checagem focada nos arquivos alterados e consultar logs/dados da fila para confirmar que campanhas com `media_url` passam pelo caminho que inclui mídia.

## Arquivos previstos

- `src/lib/ziontalk.functions.ts`
- Possivelmente `src/lib/send/sender.server.ts` ou `src/lib/ziontalk.server.ts`, somente se for necessário para logging/compatibilidade do anexo.