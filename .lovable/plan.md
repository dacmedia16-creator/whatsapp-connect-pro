## Problema

A cada mensagem recebida do mesmo contato, uma nova conversa é criada na caixa de entrada em vez de agrupar tudo numa só thread.

Diagnóstico (banco confirma): o contato `7cc2…ccefd` já tem **6 conversas** duplicadas, sendo 4 criadas hoje em poucos minutos.

## Causa raiz no webhook (`src/routes/api/public/webhooks/ziontalk.ts`)

1. A busca por conversa existente usa `.maybeSingle()`. Quando já existem 2+ conversas para o mesmo contato, o Postgres retorna erro de "multiple rows", `existingConv` vira `null` e o handler **cria mais uma** — efeito bola de neve.
2. O filtro é `eq("channel_id", channelId)` quando `channelId` existe. Se a conversa antiga foi salva com `channel_id = null` (payload sem `to`/`channel`) e a nova mensagem chega com canal identificado, não casa → nova conversa.
3. Quando o payload não traz `to`/`channel`, `channelId` é `null` e não tentamos descobrir o canal por outro meio.

## Plano de correção

### 1. Corrigir lookup de conversa no webhook
Trocar a query por uma busca tolerante:
- Buscar **a conversa mais recente** do contato (`order by last_message_at desc limit 1`), independentemente de `channel_id`, em vez de `maybeSingle()` com filtro estrito.
- Se a conversa encontrada tiver `channel_id = null` e o webhook agora identificou o canal, fazer `update` preenchendo `channel_id`.
- Só criar nova conversa se realmente não existir nenhuma para aquele contato.

Isso elimina duplicação tanto pelo erro do `maybeSingle` quanto pelo descasamento de canal.

### 2. Migração de limpeza (dados já duplicados)
Criar migração que, para cada `contact_id` com múltiplas conversas:
- Escolhe a conversa mais antiga como "canônica".
- `UPDATE messages SET conversation_id = canônica` movendo todas as mensagens.
- Soma `unread_count` na canônica e atualiza `last_message_at` para o maior valor.
- Preenche `channel_id` da canônica se estiver null e alguma duplicata tiver.
- `DELETE` das conversas duplicadas.

### 3. (Opcional, recomendado) Índice único parcial
Adicionar `CREATE UNIQUE INDEX conversations_one_per_contact ON conversations(contact_id);` para impedir nova duplicação no nível do banco. **Confirmar antes de aplicar** — isso bloqueia o caso "mesmo contato em 2 canais diferentes ter 2 conversas". Se você quiser manter conversas separadas por canal no futuro, pulamos este passo e ficamos só com (1)+(2).

## Fora de escopo
- Não mexer no envio de campanhas.
- Não mexer no schema de `messages`.
- Não alterar UI da caixa de entrada — ela já agrupa por `conversation_id`, o bug é só na criação.