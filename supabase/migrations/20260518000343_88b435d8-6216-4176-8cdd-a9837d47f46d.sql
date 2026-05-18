
-- Extensions
create extension if not exists pgcrypto;

-- =========================================================================
-- ENUMS
-- =========================================================================
create type public.app_role as enum ('admin', 'gestor', 'atendente');
create type public.channel_status as enum ('connected', 'disconnected', 'error', 'paused');
create type public.campaign_status as enum ('draft', 'scheduled', 'running', 'paused', 'done');
create type public.recipient_status as enum ('queued', 'sent', 'delivered', 'failed', 'opted_out');
create type public.queue_status as enum ('pending', 'processing', 'sent', 'failed');
create type public.conversation_status as enum ('novo', 'em_atendimento', 'aguardando_cliente', 'resolvido');
create type public.message_direction as enum ('in', 'out');
create type public.channel_strategy as enum ('round_robin', 'specific');

-- =========================================================================
-- PROFILES
-- =========================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- =========================================================================
-- USER ROLES (separate table — never on profiles)
-- =========================================================================
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles
  where user_id = auth.uid()
  order by case role
    when 'admin' then 1 when 'gestor' then 2 when 'atendente' then 3
  end
  limit 1
$$;

-- =========================================================================
-- HANDLE NEW USER (auto-create profile + default role)
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  -- profile
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );

  -- first user becomes admin, others become gestor
  select count(*) = 0 into is_first from public.user_roles;
  insert into public.user_roles (user_id, role)
  values (new.id, case when is_first then 'admin'::public.app_role else 'gestor'::public.app_role end);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- UPDATED_AT trigger generic
-- =========================================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- CHANNELS (números WhatsApp via ZionTalk)
-- =========================================================================
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  phone_e164 text not null,
  zion_api_key text not null, -- stored as-is; access protected by RLS (admin only)
  status public.channel_status not null default 'disconnected',
  daily_limit integer not null default 500,
  sent_today integer not null default 0,
  sent_today_date date not null default current_date,
  last_error text,
  business_hours jsonb not null default '{"days":[1,2,3,4,5],"start":"09:00","end":"18:00","tz":"America/Sao_Paulo"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
alter table public.channels enable row level security;
create trigger channels_updated_at before update on public.channels
  for each row execute function public.tg_set_updated_at();

-- =========================================================================
-- CONTACTS
-- =========================================================================
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_e164 text not null unique,
  tags text[] not null default '{}',
  source text,
  consent boolean not null default false,
  consent_at timestamptz,
  opt_out_at timestamptz,
  custom_fields jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.contacts enable row level security;
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.tg_set_updated_at();
create index contacts_phone_idx on public.contacts(phone_e164);
create index contacts_tags_idx on public.contacts using gin(tags);

create table public.contact_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  total integer not null default 0,
  success integer not null default 0,
  failed integer not null default 0,
  errors jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.contact_imports enable row level security;

-- =========================================================================
-- CAMPAIGNS
-- =========================================================================
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status public.campaign_status not null default 'draft',
  audience_filter jsonb not null default '{}'::jsonb,
  message_template text not null,
  variables jsonb not null default '[]'::jsonb,
  channel_strategy public.channel_strategy not null default 'round_robin',
  channel_ids uuid[] not null default '{}',
  scheduled_at timestamptz,
  rate_per_min integer not null default 20,
  total_recipients integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.campaigns enable row level security;
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.tg_set_updated_at();

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel_id uuid references public.channels(id),
  status public.recipient_status not null default 'queued',
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
alter table public.campaign_recipients enable row level security;
create index campaign_recipients_campaign_idx on public.campaign_recipients(campaign_id);
create index campaign_recipients_status_idx on public.campaign_recipients(status);

create table public.message_queue (
  id uuid primary key default gen_random_uuid(),
  campaign_recipient_id uuid references public.campaign_recipients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel_id uuid not null references public.channels(id),
  rendered_text text not null,
  attachments jsonb not null default '[]'::jsonb,
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0,
  status public.queue_status not null default 'pending',
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.message_queue enable row level security;
create index message_queue_pending_idx on public.message_queue(status, scheduled_for) where status = 'pending';

-- =========================================================================
-- CONVERSATIONS + MESSAGES (inbox)
-- =========================================================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel_id uuid references public.channels(id),
  status public.conversation_status not null default 'novo',
  assigned_to uuid references auth.users(id),
  tags text[] not null default '{}',
  last_message_at timestamptz not null default now(),
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, channel_id)
);
alter table public.conversations enable row level security;
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.tg_set_updated_at();
create index conversations_status_idx on public.conversations(status);
create index conversations_assigned_idx on public.conversations(assigned_to);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction public.message_direction not null,
  body text,
  attachments jsonb not null default '[]'::jsonb,
  sent_via_channel_id uuid references public.channels(id),
  campaign_id uuid references public.campaigns(id),
  internal_note boolean not null default false,
  external_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index messages_conversation_idx on public.messages(conversation_id, created_at);

-- =========================================================================
-- QUICK REPLIES
-- =========================================================================
create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.quick_replies enable row level security;

-- =========================================================================
-- OPT-OUT KEYWORDS
-- =========================================================================
create table public.opt_out_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null unique,
  created_at timestamptz not null default now()
);
alter table public.opt_out_keywords enable row level security;
insert into public.opt_out_keywords (keyword) values ('sair'), ('parar'), ('remover'), ('cancelar'), ('descadastrar');

-- =========================================================================
-- SEND LOGS
-- =========================================================================
create table public.send_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  http_status integer,
  response_text text,
  created_at timestamptz not null default now()
);
alter table public.send_logs enable row level security;
create index send_logs_created_idx on public.send_logs(created_at desc);

-- =========================================================================
-- ALERTS
-- =========================================================================
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null default 'info',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.alerts enable row level security;

-- =========================================================================
-- RLS POLICIES
-- =========================================================================

-- PROFILES
create policy "profiles_select_own_or_admin" on public.profiles for select
  using (id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "profiles_update_own" on public.profiles for update
  using (id = auth.uid());
create policy "profiles_admin_all" on public.profiles for all
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- USER ROLES
create policy "user_roles_select_self_or_admin" on public.user_roles for select
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "user_roles_admin_all" on public.user_roles for all
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- CHANNELS — admin full, gestor read
create policy "channels_admin_all" on public.channels for all
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "channels_gestor_read" on public.channels for select
  using (public.has_role(auth.uid(), 'gestor') or public.has_role(auth.uid(), 'atendente'));

-- CONTACTS — admin + gestor full, atendente read
create policy "contacts_manage" on public.contacts for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));
create policy "contacts_read_all_authed" on public.contacts for select
  using (auth.uid() is not null);

-- CONTACT IMPORTS
create policy "contact_imports_manage" on public.contact_imports for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));

-- CAMPAIGNS — admin + gestor full
create policy "campaigns_manage" on public.campaigns for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));
create policy "campaigns_read_all_authed" on public.campaigns for select
  using (auth.uid() is not null);

-- CAMPAIGN RECIPIENTS
create policy "campaign_recipients_manage" on public.campaign_recipients for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));
create policy "campaign_recipients_read" on public.campaign_recipients for select
  using (auth.uid() is not null);

-- MESSAGE QUEUE — admin/gestor manage
create policy "message_queue_manage" on public.message_queue for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));

-- CONVERSATIONS — admin/gestor full, atendente only assigned
create policy "conversations_admin_gestor_all" on public.conversations for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));
create policy "conversations_atendente_assigned" on public.conversations for select
  using (assigned_to = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));
create policy "conversations_atendente_update_assigned" on public.conversations for update
  using (assigned_to = auth.uid());

-- MESSAGES — admin/gestor full; atendente on assigned conversations
create policy "messages_admin_gestor_all" on public.messages for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));
create policy "messages_atendente_read" on public.messages for select
  using (
    exists (select 1 from public.conversations c
            where c.id = messages.conversation_id and c.assigned_to = auth.uid())
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'gestor')
  );
create policy "messages_atendente_insert" on public.messages for insert
  with check (
    exists (select 1 from public.conversations c
            where c.id = messages.conversation_id and c.assigned_to = auth.uid())
    or public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'gestor')
  );

-- QUICK REPLIES — all authed read, admin/gestor manage
create policy "quick_replies_read" on public.quick_replies for select
  using (auth.uid() is not null);
create policy "quick_replies_manage" on public.quick_replies for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));

-- OPT-OUT KEYWORDS — read all, admin manage
create policy "opt_out_keywords_read" on public.opt_out_keywords for select
  using (auth.uid() is not null);
create policy "opt_out_keywords_admin" on public.opt_out_keywords for all
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- SEND LOGS — admin/gestor read
create policy "send_logs_read" on public.send_logs for select
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));

-- ALERTS — admin/gestor
create policy "alerts_manage" on public.alerts for all
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'))
  with check (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'gestor'));

-- =========================================================================
-- REALTIME
-- =========================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
