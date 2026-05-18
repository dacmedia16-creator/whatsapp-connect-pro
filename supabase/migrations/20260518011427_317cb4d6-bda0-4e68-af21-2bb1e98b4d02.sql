-- Event type enum
do $$ begin
  create type public.campaign_event_type as enum ('queued','sent','delivered','failed','opted_out');
exception when duplicate_object then null; end $$;

create table if not exists public.campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  recipient_id uuid,
  contact_id uuid,
  channel_id uuid,
  event_type public.campaign_event_type not null,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_campaign_events_campaign_created
  on public.campaign_events (campaign_id, created_at desc);
create index if not exists idx_campaign_events_type
  on public.campaign_events (campaign_id, event_type);

alter table public.campaign_events enable row level security;

drop policy if exists campaign_events_read on public.campaign_events;
create policy campaign_events_read on public.campaign_events
  for select using (auth.uid() is not null);

drop policy if exists campaign_events_manage on public.campaign_events;
create policy campaign_events_manage on public.campaign_events
  for all using (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'gestor'::app_role))
  with check (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'gestor'::app_role));

-- Trigger function: log on recipient insert + status change
create or replace function public.fn_log_campaign_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_type public.campaign_event_type;
begin
  if tg_op = 'INSERT' then
    insert into public.campaign_events (campaign_id, recipient_id, contact_id, channel_id, event_type, error)
    values (new.campaign_id, new.id, new.contact_id, new.channel_id, 'queued'::public.campaign_event_type, null);
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.status is distinct from old.status) then
    begin
      v_type := new.status::text::public.campaign_event_type;
    exception when others then
      return new;
    end;
    insert into public.campaign_events (campaign_id, recipient_id, contact_id, channel_id, event_type, error)
    values (new.campaign_id, new.id, new.contact_id, new.channel_id, v_type, new.error);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_log_campaign_event_ins on public.campaign_recipients;
create trigger trg_log_campaign_event_ins
  after insert on public.campaign_recipients
  for each row execute function public.fn_log_campaign_event();

drop trigger if exists trg_log_campaign_event_upd on public.campaign_recipients;
create trigger trg_log_campaign_event_upd
  after update on public.campaign_recipients
  for each row execute function public.fn_log_campaign_event();

-- Realtime
alter table public.campaign_events replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.campaign_events;
exception when duplicate_object then null; end $$;