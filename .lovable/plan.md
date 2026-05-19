## Diagnóstico

O anexo está sendo salvo corretamente na campanha e o arquivo público está acessível. A campanha REMAX foi processada com sucesso (`201`), mas a mensagem registrada ficou sem anexo.

A causa provável está no payload enviado para a ZionTalk: o código está anexando o arquivo no `FormData` com o campo `file`, mas a documentação da ZionTalk usa o campo `attachments` para envio de arquivos.

## Plano de ajuste

1. Atualizar o envio para a ZionTalk em `src/lib/ziontalk.server.ts`
   - Trocar `form.append("file", ...)` para `form.append("attachments", ...)`.
   - Manter `msg` e `mobile_phone` como estão.
   - Preservar o download do arquivo a partir da URL pública e o envio via `multipart/form-data`.

2. Melhorar a auditoria local do envio
   - Quando a mensagem for registrada em `messages`, salvar também o anexo no campo `attachments` com URL, nome, MIME e tipo básico.
   - Isso ajuda a confirmar dentro do sistema que aquele disparo foi feito com mídia, mesmo quando a API externa retorna corpo vazio.

3. Validar após a implementação
   - Verificar que a campanha com mídia continua chegando na fila.
   - Processar/inspecionar um item de teste e confirmar que o `send_logs` registra sucesso e `messages.attachments` deixa de ficar vazio para campanhas com anexo.

## Arquivos previstos

- `src/lib/ziontalk.server.ts`
- `src/lib/send/sender.server.ts`