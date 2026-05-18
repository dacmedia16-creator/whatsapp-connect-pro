-- 1) Realtime para inbox
alter table public.messages replica identity full;
alter table public.conversations replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.conversations;
  exception when duplicate_object then null;
  end;
end$$;

-- 2) Hint da API key + remover acesso à chave crua para roles client-side
alter table public.channels add column if not exists zion_api_key_hint text;
update public.channels
   set zion_api_key_hint = right(zion_api_key, 4)
 where zion_api_key_hint is null and zion_api_key is not null;

revoke select (zion_api_key) on public.channels from anon, authenticated;

-- 3) Extensões para o worker de fila
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 4) Índices úteis para o inbox e a fila
create index if not exists idx_conversations_last_message_at on public.conversations (last_message_at desc);
create index if not exists idx_conversations_status on public.conversations (status);
create index if not exists idx_messages_conversation_created on public.messages (conversation_id, created_at desc);
create index if not exists idx_queue_pending_scheduled on public.message_queue (status, scheduled_for) where status = 'pending';