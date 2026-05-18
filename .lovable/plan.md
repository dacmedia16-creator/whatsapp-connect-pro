## Diagnóstico

As mensagens enviadas pelo app chegam ao destinatário, mas as **respostas dos contatos não aparecem** no Inbox porque a ZionTalk **nunca chamou o nosso endpoint de webhook**. Confirmado por dois sinais:

- Nenhum registro recebido no endpoint `/api/public/webhooks/ziontalk` na última hora.
- Na tabela `messages`, só existem mensagens com `direction = 'out'` (enviadas por você). Nenhuma `direction = 'in'`.

O endpoint já está pronto e protegido por um token (`ZION_WEBHOOK_TOKEN`). Falta apenas **cadastrar a URL do webhook dentro do painel da ZionTalk** para aquele canal.

## Plano (sem mudança de código)

Como você respondeu “não sei” se cadastrou o webhook, o caminho é configurar lá. Não precisa alterar nada na aplicação.

### 1. URL do webhook a cadastrar na ZionTalk

Use a URL pública estável do projeto, com o token na query string:

```text
https://enviomassapro.lovable.app/api/public/webhooks/ziontalk?token=SEU_ZION_WEBHOOK_TOKEN
```

O valor de `SEU_ZION_WEBHOOK_TOKEN` é o secret `ZION_WEBHOOK_TOKEN` já cadastrado no Lovable Cloud (você definiu quando configurou o projeto).

Alternativa equivalente: cadastrar a URL sem `?token=` e enviar o token no header `x-zion-token`. Use a opção que o painel da ZionTalk oferecer.

### 2. Onde cadastrar no painel da ZionTalk

1. Acesse `https://app.ziontalk.com` e entre na conta do canal **Envio 1**.
2. Vá em **Configurações / Integrações / Webhook** (o nome exato pode variar: “Postback”, “Callback de mensagens recebidas”, “Webhook de entrada”).
3. Cole a URL acima no campo de webhook de **mensagens recebidas (inbound)**.
4. Salve.

### 3. Teste de ponta a ponta

1. Pelo seu celular, envie uma mensagem qualquer para o número conectado ao canal **Envio 1**.
2. Em 1–2 segundos, a mensagem deve aparecer no Inbox do app, dentro da conversa do contato.
3. Se aparecer: pronto, fluxo de entrada funcionando.
4. Se não aparecer: me avise e eu olho os logs do endpoint para identificar se foi token inválido, payload diferente do esperado, ou algum erro do nosso lado.

### 4. (Opcional, próximo passo se necessário)

Se a ZionTalk enviar o payload com nomes de campos diferentes do que o webhook aceita hoje (`from`, `mobile_phone`, `to`, `channel`, `message`, `msg`, `body`), abrimos um ajuste pequeno no parser do endpoint para mapear os campos novos. Mas isso só faz sentido depois do teste acima.

## Resumo

- Nada para mudar no código agora.
- Ação está do seu lado: cadastrar a URL `https://enviomassapro.lovable.app/api/public/webhooks/ziontalk?token=...` no painel da ZionTalk para o canal **Envio 1** e mandar uma mensagem de teste.
