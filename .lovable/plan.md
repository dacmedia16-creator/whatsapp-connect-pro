## ZionFlow — Evolução para Produção

Plano dividido em fases entregáveis. Cada fase é independente e termina com o app funcional.

### Fase 1 — Rotas faltantes + Inbox completo
- Criar `/inbox` (`src/routes/_authenticated/inbox.tsx`)
  - Lista de conversas (esquerda) com busca, filtro por status, badge de não-lidas
  - Painel central: mensagens da conversa selecionada, com bolhas inbound/outbound, notas internas destacadas
  - Composer: textarea + botão enviar (via novo `sendInboxMessageFn`), toggle "nota interna", dropdown de respostas rápidas (`quick_replies`)
  - Painel direito: dados do contato, atribuição (dropdown de atendentes), status (novo/em_atendimento/aguardando_cliente/resolvido), tags
  - Realtime: subscribe em `messages` e `conversations`
- Criar `/reports` (`src/routes/_authenticated/reports.tsx`) — abas: Campanhas, Canais, Atendentes; cards de métricas + tabelas
- Criar `/settings` (`src/routes/_authenticated/settings.tsx`) — abas: Horários comerciais (por canal), Palavras opt-out (CRUD), Usuários & permissões (lista + alterar role, admin only)
- Garantir links no `app-sidebar.tsx`

### Fase 2 — Backend de mensageria
- **Server fns** (`src/lib/inbox.functions.ts`):
  - `sendInboxMessageFn` — envia via ZionTalk, insere em `messages`, atualiza `conversations.last_message_at`
  - `assignConversationFn`, `updateConversationStatusFn`
- **Webhook ZionTalk** (`src/routes/api/public/webhooks/ziontalk.ts`):
  - Valida header `x-zion-token` contra `ZION_WEBHOOK_TOKEN`
  - Identifica canal por número destino
  - Upsert de contato (consent=false), upsert de conversa, insert de mensagem inbound
  - Trigger de opt-out já existente dispara automaticamente

### Fase 3 — Segurança de canais
- Migration: nova coluna `zion_api_key_encrypted` (bytea), `zion_api_key_hint` (text, últimos 4)
- Função `pgp_sym_encrypt`/`pgp_sym_decrypt` com secret `CHANNEL_KEY_SECRET`
- Server fns `createChannelFn` / `updateChannelKeyFn` substituem insert direto pelo browser
- Refatorar `channels.tsx` para não enviar a key crua; só mostrar hint + status
- Worker lê key descriptografada via server fn

### Fase 4 — Worker automático de fila
- Endpoint `src/routes/api/public/hooks/process-queue.ts` — processa N mensagens da `message_queue`
- Usa `SELECT ... FOR UPDATE SKIP LOCKED` para concorrência
- Respeita horário comercial do canal (tz-aware via `business_hours`); se fora, reagenda `scheduled_for`
- Bloqueia contatos sem `consent` ou com `opt_out_at`
- pg_cron a cada minuto chamando o endpoint
- Botão manual mantido apenas como ação admin

### Fase 5 — Compliance & UX
- Diálogo de confirmação ao iniciar campanha com resumo: total, com consent, opt-outs excluídos
- Filtro automático na criação de recipients
- Footer opcional de descadastro no template
- Estados vazios, loaders, toasts de erro padronizados
- Responsividade mobile no inbox (drawer para lista em <md)

### Fase 6 — Documentação
- `README.md` com visão geral, stack, env vars, setup local, configuração Supabase/ZionTalk, checklist de produção

### Detalhes técnicos
- Stack: TanStack Start + Supabase + Realtime + pg_cron
- Secrets novos necessários: `CHANNEL_KEY_SECRET` (criptografia das API keys)
- Extensões PG: `pgcrypto` (já vem), `pg_cron`, `pg_net`
- Todas as server fns sensíveis usam `requireSupabaseAuth`; webhook usa token

### Ordem de execução
Vou executar Fases 1→6 em sequência, em mensagens separadas se necessário, mas começando agora pela **Fase 1 (Inbox + rotas)** que é a maior lacuna funcional visível ao usuário. Confirma para eu seguir, ou quer reordenar/recortar o escopo?
