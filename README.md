# ZionFlow

Plataforma multicanal de WhatsApp para campanhas em massa e atendimento, integrada à API ZionTalk.

## Stack
- TanStack Start v1 (React 19, Vite 7)
- Tailwind CSS v4 + shadcn/ui
- Lovable Cloud (Supabase) — Postgres + Auth + Realtime + pg_cron
- ZionTalk Send API (https://app.ziontalk.com)

## Variáveis de ambiente
Geridas automaticamente pelo Lovable Cloud:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (client)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server)
- `LOVABLE_API_KEY` (opcional, AI gateway)

Secret específico do projeto:
- `ZION_WEBHOOK_TOKEN` — token de validação do webhook de entrada da ZionTalk.

## Rodando localmente
```bash
bun install
bun run dev
```

## Configuração da Lovable Cloud
Todas as migrações ficam em `supabase/migrations/`. As tabelas principais:
- `profiles`, `user_roles` (admin / gestor / atendente)
- `channels` — canais WhatsApp (API key armazenada apenas server-side)
- `contacts` — base com consentimento, tags, opt-out
- `campaigns`, `campaign_recipients`, `campaign_events` — campanhas e auditoria
- `conversations`, `messages` — caixa de entrada
- `message_queue` — fila do worker
- `opt_out_keywords`, `quick_replies`, `send_logs`, `alerts`

Triggers automáticas:
- `fn_auto_opt_out_on_inbound` — marca opt-out ao receber palavras-chave.
- `fn_log_campaign_event` — log de eventos por status do destinatário.

## Configuração da ZionTalk
1. Cadastre um canal em **Canais** com a API key fornecida pela ZionTalk (armazenada de forma protegida; o front exibe apenas os 4 últimos dígitos).
2. Configure o webhook de entrada da ZionTalk apontando para:
   ```
   https://project--585204a2-74f0-449f-a6d0-bcdd43afa71b.lovable.app/api/public/webhooks/ziontalk
   ```
   incluindo o header `x-zion-token: <ZION_WEBHOOK_TOKEN>` ou query `?token=...`.
3. Em **Configurações → Horários comerciais** ajuste fuso, dias e janela por canal.

## Worker de fila
`pg_cron` chama `/api/public/hooks/process-queue` a cada minuto. O endpoint:
- reserva até 25 itens com update atômico (controle de concorrência);
- respeita consentimento, opt-out, limite diário e horário comercial (tz-aware);
- reagenda automaticamente fora da janela;
- registra cada tentativa em `send_logs` e dispara eventos em `campaign_events`.

O botão **Processar lote** na campanha permanece como ação administrativa de teste.

## Boas práticas de uso autorizado (LGPD)
- Envie apenas para contatos com **consent=true** e sem `opt_out_at`. A plataforma já bloqueia o resto.
- Mantenha base de prova de consentimento (origem, data, canal).
- Inclua identificação do remetente e instrução de descadastro em **toda** campanha — o wizard adiciona o rodapé "Responda SAIR…" automaticamente quando ausente.
- Respeite horários comerciais por canal e fuso (`business_hours.tz`).
- Atenda solicitações de opt-out em até 24h — o webhook + trigger `fn_auto_opt_out_on_inbound` faz isso automaticamente para palavras-chave configuradas.
- Nunca compartilhe a API key da ZionTalk; ela é criptografada (`pgp_sym_encrypt`) e versionada em `channel_api_keys`. Em caso de suspeita, **Revogar** + **Rotacionar** na tela de Canais.
- Monitore o painel **Relatórios** diariamente: taxa de falhas alta ou erros 401 indicam canal bloqueado.

## Checklist de produção
- [ ] `ZION_WEBHOOK_TOKEN` configurado em secrets.
- [ ] Pelo menos 1 canal cadastrado e testado (botão Testar em Canais).
- [ ] Horários comerciais e fuso revisados por canal.
- [ ] Palavras de opt-out cadastradas em Configurações.
- [ ] Usuários e funções (admin/gestor/atendente) atribuídos.
- [ ] Confirmar agendamento do cron: `select * from cron.job where jobname = 'zionflow-process-queue';`
- [ ] Webhook da ZionTalk apontando para o endpoint público acima.
- [ ] Campanha-piloto em público pequeno antes do envio em massa.