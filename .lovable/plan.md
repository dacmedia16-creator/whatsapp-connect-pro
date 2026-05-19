## Problema

Ao clicar em **Excluir** na campanha "Teste", o backend tenta apagar a linha de `campaigns`, mas a tabela `messages` (histórico de conversas na caixa de entrada) tem uma FK `messages.campaign_id → campaigns.id` **sem `ON DELETE`**. Como existem mensagens enviadas vinculadas à campanha, o Postgres bloqueia:

```
update or delete on table "campaigns" violates foreign key constraint
"messages_campaign_id_fkey" on table "messages"
```

A rotina de exclusão hoje (`campaigns.index.tsx`) só limpa `message_queue`, `campaign_recipients` e `campaign_events` — esqueceu de `messages` (e provavelmente também de `send_logs`, que tem `campaign_id`).

## Decisão de design

Mensagens da caixa de entrada **não devem ser apagadas** junto com a campanha — elas pertencem à conversa do contato e o usuário precisa continuar vendo o histórico. Mesma lógica vale para `send_logs` (auditoria).

Solução: alterar as FKs para **`ON DELETE SET NULL`** nas tabelas que são "histórico/auditoria", e manter `DELETE` em cascata apenas para tabelas operacionais da campanha.

## Plano

### 1. Migration — ajustar FKs

| Tabela | Coluna | Ação atual | Ação nova |
|---|---|---|---|
| `messages` | `campaign_id` | (nada → bloqueia) | `ON DELETE SET NULL` |
| `send_logs` | `campaign_id` | verificar | `ON DELETE SET NULL` |
| `campaign_recipients` | `campaign_id` | já tratado no código | `ON DELETE CASCADE` (defesa em profundidade) |
| `campaign_events` | `campaign_id` | já tratado no código | `ON DELETE CASCADE` |
| `message_queue` | `campaign_id` (via recipient) | já tratado | manter |
| `campaign_send_settings` | `campaign_id` | verificar | `ON DELETE CASCADE` |

Drop + recreate de cada constraint com a regra apropriada.

### 2. Simplificar `deleteCampaign` no frontend

Com as FKs corretas, basta:

```ts
await supabase.from("campaigns").delete().eq("id", id);
```

Remover os `delete` manuais de `message_queue` / `campaign_recipients` / `campaign_events` (a cascata do banco cuida). Manter apenas o do `message_queue` se preferir limpeza imediata; o resto fica redundante.

### 3. Renomear botão (opcional, UX)

O título do diálogo é "Excluir campanha?" mas o usuário descreveu como "cancelar". Sugiro deixar claro na mensagem que a campanha será **excluída permanentemente** mas o **histórico de mensagens enviadas permanece na caixa de entrada**.

### 4. Validação

- Recriar uma campanha de teste, executar alguns envios, e clicar em Excluir → deve sumir da lista sem erro, e as mensagens continuam visíveis na Caixa de entrada (sem vínculo de campanha).

## Observação

Não vou tocar em RLS, lógica de envio, ou settings nesta entrega — só a cadeia de exclusão.