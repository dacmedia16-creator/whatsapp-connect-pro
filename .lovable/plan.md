Vou corrigir o webhook da ZionTalk assim:

1. Gerar um token novo e seguro para o webhook.
2. Atualizar o secret `ZION_WEBHOOK_TOKEN` no backend com esse novo valor.
3. Montar a URL final no formato:

```txt
https://enviomassapro.lovable.app/api/public/webhooks/ziontalk?token=NOVO_TOKEN
```

4. Te entregar a URL pronta para colar no campo de webhook/POST da ZionTalk.
5. Depois que você testar, conferir os logs para confirmar se saiu de `401 Unauthorized` para `200 OK` ou, se aparecer outro erro, diagnosticar o payload enviado pela ZionTalk.