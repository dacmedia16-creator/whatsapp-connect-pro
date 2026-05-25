## Causa

O schema Zod do fluxo "Nova Campanha" (`campaigns.functions.ts:158`) ainda valida `rotation_mode` contra `["round_robin", "least_used", "manual_priority"]` — sem `simple_call`. Quando o usuário escolhe "Chama Simples" no wizard e clica em **Enviar agora**, a validação rejeita o valor antes mesmo de gravar a campanha.

O painel de envios (`send-panel.functions.ts`) já tinha sido corrigido, mas esqueci de propagar o mesmo enum para o create-campaign.

## Correção

Alinhar o enum de `rotation_mode` em `src/lib/campaigns.functions.ts` à fonte única (`SEND_SETTINGS_DEFAULTS` / `send-panel.functions.ts`):

```ts
rotation_mode: z.enum(["round_robin", "least_used", "manual_priority", "simple_call"]),
```

Nenhuma migração de banco é necessária — a coluna já aceita o valor (o painel de envios grava com sucesso). É apenas o validador do wizard que está desatualizado.

## Verificação

- Criar nova campanha com "Chama Simples" selecionado → deve salvar e iniciar envio sem erro de validação.