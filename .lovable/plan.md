
# Plataforma de Campanhas e Atendimento WhatsApp (ZionTalk)

SaaS completo, multiusuário, com painel SaaS moderno (paleta Emerald Prestige: verde profundo + dourado), backend em Lovable Cloud e integração real com a API ZionTalk.

## Observação importante sobre a API ZionTalk

A documentação pública (https://ziontalk.com.br/docs) cobre **apenas dois endpoints**:

- `POST /api/send_message/` — mensagem de texto + anexos (canal próprio, sem template)
- `POST /api/send_template_message/` — mensagem via template aprovado na Meta
- Autenticação: **Basic Auth** com a API Key do canal como username e senha vazia. Cada **canal = 1 número** = 1 API Key separada.

A documentação **não descreve publicamente**: webhook de mensagens recebidas, status de conexão do canal, histórico, opt-out automático ou eventos de entrega/leitura. Vou construir o sistema de forma que:

1. Os recursos documentados (envio texto + template, múltiplos canais via múltiplas API Keys) funcionem **de verdade** desde o dia 1.
2. Recursos não documentados (webhook de inbound, status de conexão em tempo real, deliveries) ficarão com uma **camada de integração pronta** (endpoint público `/api/public/ziontalk/webhook`, parser e schema preparados). Quando você me passar o formato real do webhook da Zion, eu plugo em poucos minutos.
3. Enquanto o webhook não chega, a Caixa de Entrada já funciona para mensagens internas, anotações, atribuição, status e respostas (que saem pela API real). Eu marco claramente no UI o que depende do webhook Zion estar configurado.

Se você tiver acesso a docs internas com webhook/status, me envia e ajusto o plano.

---

## Stack

- **Frontend**: TanStack Start (já configurado), React 19, Tailwind v4, shadcn/ui, Recharts, Motion.
- **Backend**: Lovable Cloud (Postgres + Auth + Storage + server functions). Toda integração com ZionTalk é server-side (Basic Auth nunca exposta ao browser).
- **Roles**: tabela `user_roles` separada + função `has_role` (admin/gestor/atendente).
- **Fila de envio**: tabela `message_queue` + server function `process_queue` invocada por `pg_cron` a cada minuto (respeita horário comercial, limite diário por canal, throttling).
- **Webhook ZionTalk**: rota pública `src/routes/api/public/ziontalk/webhook.ts` com verificação por token compartilhado.

## Identidade visual (Emerald Prestige)

- Background: off-white quente; superfícies: card branco com sombra suave.
- Primário: verde esmeralda `#0d7a5f`; primário-foreground branco.
- Accent/dourado: `#c9a84c` para badges de status, métricas-chave e CTAs secundários.
- Tipografia: par "instrument-serif-work-sans" (headings serifa elegante + Work Sans no corpo). Tudo via tokens em `src/styles.css` (oklch).
- Layout: shell com **sidebar fixa colapsável** (shadcn sidebar) + topbar com busca e avatar.

## Estrutura de rotas

```
/login, /signup, /reset-password           (públicas)
/_authenticated/
  ├── dashboard                            (KPIs + gráficos)
  ├── inbox                                (lista de conversas + thread)
  ├── inbox/$conversationId
  ├── contacts                             (tabela + import CSV)
  ├── contacts/$id
  ├── campaigns                            (lista + criar)
  ├── campaigns/$id                        (detalhes + métricas)
  ├── channels                             (números/canais Zion)
  ├── reports                              (campanha, canal, atendente)
  └── settings                             (perfil, equipe, integração Zion, opt-out)
```

## Schema do banco (Lovable Cloud)

- `profiles` (id → auth.users, full_name, avatar_url, created_at)
- `user_roles` (id, user_id, role enum: admin|gestor|atendente) + `has_role()` SECURITY DEFINER
- `channels` (id, label, zion_api_key [criptografada], phone_e164, status enum: connected|disconnected|error|paused, daily_limit, sent_today, last_error, business_hours jsonb)
- `contacts` (id, name, phone_e164, tags text[], source, consent boolean, consent_at, opt_out_at, custom_fields jsonb, created_at)
- `contact_imports` (id, file_name, total, success, failed, created_by)
- `campaigns` (id, name, description, status enum: draft|scheduled|running|paused|done, audience_filter jsonb, message_template, variables jsonb, channel_strategy enum: round_robin|specific, scheduled_at, rate_per_min, created_by)
- `campaign_recipients` (id, campaign_id, contact_id, status enum: queued|sent|delivered|failed|opted_out, channel_id, sent_at, error)
- `message_queue` (id, campaign_recipient_id, contact_id, channel_id, rendered_text, attachments jsonb, scheduled_for, attempts, status)
- `conversations` (id, contact_id, channel_id, status enum: novo|em_atendimento|aguardando_cliente|resolvido, assigned_to, last_message_at, tags text[])
- `messages` (id, conversation_id, direction enum: in|out, body, attachments jsonb, sent_via_channel_id, campaign_id, internal_note boolean, created_by, created_at)
- `quick_replies` (id, title, body, created_by)
- `opt_out_keywords` (palavra) — defaults: sair, parar, remover, cancelar
- `send_logs` (id, channel_id, contact_id, campaign_id, http_status, response_text, created_at)
- `alerts` (id, type, severity, message, resolved_at)

Todas com **RLS habilitada**. Políticas baseadas em `has_role()`:

- Admin: full access.
- Gestor: read/write em campanhas, contatos, relatórios; read em canais/usuários.
- Atendente: read em contatos; read/write apenas em conversations atribuídas a si + mensagens.

## Funcionalidades por módulo

### 1. Dashboard
Cards de KPI (enviadas, entregues, respostas, taxa de resposta, campanhas ativas, canais conectados) + gráfico de envios últimos 14 dias (Recharts area) + tabela de status dos canais com semáforo (verde/amarelo/vermelho).

### 2. Canais (Números)
- CRUD de canais com label, telefone E.164 e API Key (armazenada criptografada).
- Botão "Testar conexão" → server fn faz ping com envio fake validando 401/201.
- Pausar/ativar, limite diário, horários comerciais (json com dias e janelas).
- Distribuição round-robin entre canais ativos respeitando limite diário.

### 3. Contatos
- Tabela com filtros (etiqueta, consentimento, opt-out, origem).
- Cadastro manual + import CSV (parse client-side, envio em batches para server fn com validação Zod e dedupe por telefone).
- Validação E.164 e normalização (libphonenumber-js).
- Bloqueio de envio para `consent=false` ou `opt_out_at != null`.
- Detecção de palavras de opt-out em mensagens recebidas → marca contato e responde confirmação automática.

### 4. Campanhas
- Wizard: nome/descrição → público (filtro por tags/consentimento) → mensagem com variáveis `{{nome}}`, `{{empresa}}`, `{{cidade}}` (preview renderizado) → canais (todos ou subset) → agendamento + velocidade (msgs/min) → revisão final com contagem e estimativa.
- Engine: ao iniciar, materializa `campaign_recipients` e enfileira em `message_queue`.
- Worker (`process_queue` server fn, cron 1/min): pega N mensagens respeitando rate_per_min, horário comercial e limite diário do canal; chama `POST /api/send_message/`; registra `send_logs`; atualiza `campaign_recipients.status`.
- Pause/resume da campanha.
- Bloqueio automático se taxa de opt-out > 5% ou taxa de erro > 10% (cria `alert`).

### 5. Segurança e conformidade
- Política visível na tela de criar campanha (checklist de boas práticas).
- Linter de conteúdo: bloqueia palavras de uma blocklist (configurável em settings) — discurso enganoso, promessas de ganho, etc.
- Exige identificação do remetente no texto (regex simples + aviso).
- Tela de alertas em `/dashboard` e `/settings`.

### 6. Caixa de entrada
- Layout 3 colunas: filtros (canal, campanha, etiqueta, status), lista de conversas, thread + painel lateral do contato.
- Status drag-free (select): Novo / Em atendimento / Aguardando cliente / Resolvido.
- Atribuir atendente (admin/gestor) ou autoatribuir.
- Respostas rápidas (`/` abre menu).
- Anotações internas (mensagens com `internal_note=true`, fundo amarelo, não enviadas).
- Histórico completo + link para o contato.
- Realtime via Supabase Realtime para novas mensagens (quando webhook estiver ativo).

### 7. Usuários e permissões
- Settings → Equipe: admin convida por email (cria conta via Cloud), define role.
- Guardas nas rotas via `_authenticated` + checagens granulares com `has_role` no server.

### 8. Relatórios
- 3 abas: por campanha, por canal, por atendente.
- Filtro de período. KPIs + tabela detalhada + export CSV.
- Atendente: nº conversas atribuídas, abertas, resolvidas, tempo médio de primeira resposta.

### 9. Integração ZionTalk
Camada `src/lib/ziontalk.server.ts` + `src/lib/ziontalk.functions.ts`:
- `sendMessage(channelId, phone, msg, attachments?)` — Basic Auth com API Key do canal.
- `sendTemplate(channelId, phone, templateId, language, headerParams, bodyParams)`.
- `verifyChannel(channelId)` — heurística usando resposta 401 vs aceita.
- Webhook receiver em `/api/public/ziontalk/webhook` — valida `?token=` (secret `ZION_WEBHOOK_TOKEN`), faz upsert de inbound em `messages`, cria/atualiza `conversations`, processa opt-out.
- Settings → Integração Zion: campos para URL base (default `https://app.ziontalk.com`) e cópia da URL do webhook para colar no painel da Zion.

### 10. Interface visual
- Sidebar com ícones lucide (LayoutDashboard, MessageSquare, Users, Megaphone, Inbox, Smartphone, BarChart3, Settings).
- Topbar com busca global (contatos/conversas) + sino de alertas + avatar.
- Cards/Tabelas shadcn, gráficos Recharts, skeleton states, toasts (sonner), responsivo (collapsible sidebar em mobile).

## Secrets necessários (vou pedir após o plano aprovado)

- `ZION_WEBHOOK_TOKEN` — token que você define para validar o webhook recebido.

As API Keys de cada canal são guardadas no banco (criptografadas via pgcrypto), não como secret global, pois cada número tem a sua.

## Ordem de implementação (build único, mas organizada)

1. Ativar Lovable Cloud + schema + RLS + roles.
2. Auth (login/signup/reset) + shell com sidebar e tema Emerald Prestige.
3. Canais (CRUD + teste de conexão).
4. Contatos (CRUD + import CSV + opt-out).
5. Camada ZionTalk (server) + webhook público.
6. Caixa de entrada (conversas + mensagens + atribuição + status + quick replies + notas).
7. Campanhas (wizard + fila + worker `pg_cron` + bloqueios de conformidade).
8. Dashboard + Relatórios + Alertas.
9. Equipe & permissões + Settings de integração.
10. QA visual e responsivo.

## O que NÃO entra neste plano

- Integração com WhatsApp Cloud API direta (Meta) sem ZionTalk.
- Apps mobile nativos (apenas responsivo web).
- Templates aprovados pela Meta (UI deixará criar/registrar template_identifier; aprovação é feita no painel da Meta, fora do escopo).

Posso prosseguir com a implementação?
