## Testar webhook ZionTalk → Inbox

Vou simular uma mensagem recebida chamando o endpoint do webhook diretamente (como o ZionTalk faria), usando um contato já cadastrado no banco, e depois confirmar que a mensagem apareceu no Inbox.

### Contato que vou usar

- **Denis** — `+5515981788214` (já existe, conversa ativa `5ef0fec0-...`, canal `Envio 1`).

### Passos

1. Localizar a rota do webhook (`src/routes/api/public/webhooks/ziontalk.*`) e confirmar o formato de payload aceito (campos esperados: telefone, texto, channel/instance, etc.).
2. Disparar um `POST` para:
   ```
   https://enviomassapro.lovable.app/api/public/webhooks/ziontalk?token=<ZION_WEBHOOK_TOKEN>
   ```
   com payload simulando mensagem inbound do Denis (ex.: `"Olá, mensagem de teste"`).
3. Verificar resposta HTTP (esperado 200). Se 401 → token errado. Se 4xx/5xx → checar logs do server function.
4. Consultar o banco (`messages` da conversa do Denis) para confirmar que a nova mensagem inbound foi inserida.
5. Conferir no preview `/inbox` que a mensagem aparece em tempo real.

### Observações

- Nenhuma mudança de código. É só execução de teste.
- Se o payload simulado não bater com o esperado pela rota, ajusto o JSON do teste (não o código) até refletir o que o ZionTalk envia.
- Caso o webhook devolva erro, te mostro o log e proponho a correção em uma nova rodada.

Aprovo para executar?