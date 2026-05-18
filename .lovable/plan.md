## O que descobri

A chamada publicada com o token novo ainda retorna `401 Unauthorized` quando testada diretamente no backend. Isso confirma que o problema não é a ZionTalk: o endpoint publicado ainda está comparando contra outro valor em `ZION_WEBHOOK_TOKEN` ou não recarregou o secret corretamente.

## Plano de correção

1. Atualizar novamente o secret `ZION_WEBHOOK_TOKEN` com o token correto.
2. Testar diretamente o endpoint publicado com a URL final:

```text
https://enviomassapro.lovable.app/api/public/webhooks/ziontalk?token=2bdff5f6caefb5c8f48e80833f3117c408a0d337c00985c1c776f54dc39a6190
```

3. Considerar o token aceito quando o endpoint deixar de retornar `401` e passar a retornar `400` para payload vazio, ou `200` para payload válido.
4. Se continuar `401`, adicionar um diagnóstico temporário seguro no webhook para registrar apenas metadados do token, sem expor o valor completo, e remover esse diagnóstico depois.

## Resultado esperado

Depois da atualização/reload do secret, a ZionTalk deve parar de receber `401` e o webhook deve começar a processar as mensagens recebidas.