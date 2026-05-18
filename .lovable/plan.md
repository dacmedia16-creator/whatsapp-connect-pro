## Gerar novo ZION_WEBHOOK_TOKEN

Vou rotacionar o segredo `ZION_WEBHOOK_TOKEN` com um novo valor aleatório (32 caracteres, seguro) e te mostrar o valor aqui no chat para você copiar.

### Passos

1. Gerar um token aleatório seguro (ex.: `openssl rand -hex 24`).
2. Atualizar o segredo `ZION_WEBHOOK_TOKEN` no backend (Lovable Cloud) com esse valor.
3. Te mostrar o token completo + a URL pronta para colar no ZionTalk:
   ```
   https://enviomassapro.lovable.app/api/public/webhooks/ziontalk?token=NOVO_TOKEN
   ```
4. Você cola essa URL no campo **"URL de destino"** do ZionTalk e envia uma mensagem de teste.

### Observações

- O token antigo deixa de funcionar imediatamente após a rotação.
- Nenhum código será alterado — só o valor do segredo.
- Depois do teste, confirmamos no Inbox que a mensagem chegou.

Aprove para eu gerar e aplicar.