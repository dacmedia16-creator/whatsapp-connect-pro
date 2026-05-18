# Aceitar payload aninhado da ZionTalk

## Problema

O webhook atual (`/api/public/webhooks/ziontalk`) só aceita campos no formato plano (`from`, `body`, `to`, `channel`). A ZionTalk envia no formato aninhado:

```json
{
  "evento": "mensagem_recebida",
  "contato": { "nome": "...", "telefone": "(46) 99999-9999" },
  "mensagem": { "texto": "Olá", "canal": "(46) 3032-1500" },
  "timestamp": "..."
}
```

Resultado: HTTP 400 "Payload inválido".

## Solução

Atualizar `src/routes/api/public/webhooks/ziontalk.ts` para aceitar **ambos** os formatos (plano + aninhado), achatando o aninhado antes da validação.

### Mudanças

1. **Pré-processar o JSON** antes do `PayloadSchema.safeParse`:
   - Se vier `contato.telefone` → mapeia para `from`
   - Se vier `contato.nome` → mapeia para `name`
   - Se vier `mensagem.texto` → mapeia para `body`
   - Se vier `mensagem.canal` → mapeia para `to` (já passa pelo `normalize()` existente)
   - `evento` e `timestamp` são ignorados

2. **Manter** toda a lógica existente (token, normalização de telefone, criação de contato/conversa, inserção da mensagem, trigger de opt-out).

3. **Sem mudanças** em schema do banco, secrets ou outras rotas.

## Teste pós-deploy

1. POST para `https://enviomassapro.lovable.app/api/public/webhooks/ziontalk?token=<TOKEN>` com payload aninhado real da ZionTalk → esperado HTTP 200.
2. Verificar nova linha em `messages` (direction=`in`) na conversa do Denis.
3. Confirmar aparição em `/inbox`.

## Detalhes técnicos

```text
src/routes/api/public/webhooks/ziontalk.ts
└── função flattenZionPayload(raw) chamada antes de PayloadSchema.safeParse
```

Sem novos pacotes, sem migrations.
