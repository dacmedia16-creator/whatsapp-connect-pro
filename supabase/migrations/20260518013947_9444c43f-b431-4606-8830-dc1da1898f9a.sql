-- Enum de status da chave
do $$ begin
  create type public.channel_key_status as enum ('active','superseded','revoked');
exception when duplicate_object then null; end $$;

-- Tabela de histórico
create table if not exists public.channel_api_keys (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  version integer not null,
  key_encrypted bytea not null,
  hint text not null,
  status public.channel_key_status not null default 'active',
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text,
  unique (channel_id, version)
);

create unique index if not exists channel_api_keys_one_active
  on public.channel_api_keys (channel_id)
  where status = 'active';

create index if not exists channel_api_keys_channel_idx
  on public.channel_api_keys (channel_id, created_at desc);

alter table public.channel_api_keys enable row level security;

drop policy if exists "channel_api_keys_admin_select" on public.channel_api_keys;
create policy "channel_api_keys_admin_select"
  on public.channel_api_keys for select
  using (public.has_role(auth.uid(), 'admin'::public.app_role));
-- Sem INSERT/UPDATE/DELETE para clientes; alteração via SECURITY DEFINER.

-- Rotaciona: marca atual como superseded, insere nova versão active, espelha em channels
create or replace function public.rotate_channel_api_key(
  p_channel_id uuid,
  p_plain_key text,
  p_secret text,
  p_user uuid
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_next_version int;
  v_enc bytea;
  v_id uuid;
begin
  if p_plain_key is null or length(p_plain_key) < 4 then
    raise exception 'Chave inválida';
  end if;

  v_enc := extensions.pgp_sym_encrypt(p_plain_key, p_secret);

  update public.channel_api_keys
     set status = 'superseded'
   where channel_id = p_channel_id and status = 'active';

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.channel_api_keys
   where channel_id = p_channel_id;

  insert into public.channel_api_keys
    (channel_id, version, key_encrypted, hint, status, created_by)
  values
    (p_channel_id, v_next_version, v_enc, right(p_plain_key, 4), 'active', p_user)
  returning id into v_id;

  update public.channels
     set zion_api_key_encrypted = v_enc,
         zion_api_key_hint = right(p_plain_key, 4),
         zion_api_key = '',
         last_error = null,
         updated_at = now()
   where id = p_channel_id;

  return v_id;
end;
$$;

-- Revoga: marca chave como revoked; se era ativa, desativa canal
create or replace function public.revoke_channel_api_key(
  p_key_id uuid,
  p_user uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel_id uuid;
  v_was_active boolean;
begin
  update public.channel_api_keys
     set status = 'revoked',
         revoked_at = now(),
         revoked_by = p_user,
         revoked_reason = p_reason
   where id = p_key_id and status <> 'revoked'
  returning channel_id, (status = 'active') into v_channel_id, v_was_active;

  if v_channel_id is null then
    raise exception 'Chave não encontrada ou já revogada';
  end if;

  if v_was_active then
    update public.channels
       set zion_api_key_encrypted = null,
           zion_api_key = '',
           zion_api_key_hint = null,
           status = 'disconnected'::public.channel_status,
           last_error = 'Chave revogada — rotacione para reativar envios',
           updated_at = now()
     where id = v_channel_id;
  end if;
end;
$$;

-- Atualiza leitura: prioriza histórico (versão ativa)
create or replace function public.get_channel_api_key(
  p_channel_id uuid,
  p_secret text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enc bytea;
  v_legacy text;
begin
  select key_encrypted into v_enc
    from public.channel_api_keys
   where channel_id = p_channel_id and status = 'active'
   limit 1;

  if v_enc is not null then
    return extensions.pgp_sym_decrypt(v_enc, p_secret);
  end if;

  -- Fallback de transição
  select zion_api_key_encrypted, zion_api_key
    into v_enc, v_legacy
    from public.channels
   where id = p_channel_id;
  if v_enc is not null then
    return extensions.pgp_sym_decrypt(v_enc, p_secret);
  end if;
  return nullif(v_legacy, '');
end;
$$;

-- Grants
revoke all on function public.rotate_channel_api_key(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.revoke_channel_api_key(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.get_channel_api_key(uuid, text) from public, anon, authenticated;
grant execute on function public.rotate_channel_api_key(uuid, text, text, uuid) to service_role;
grant execute on function public.revoke_channel_api_key(uuid, uuid, text) to service_role;
grant execute on function public.get_channel_api_key(uuid, text) to service_role;

-- Backfill: chaves cifradas existentes viram versão 1 ativa
insert into public.channel_api_keys (channel_id, version, key_encrypted, hint, status, created_by, created_at)
select c.id, 1, c.zion_api_key_encrypted, coalesce(c.zion_api_key_hint, '----'), 'active', c.created_by, c.created_at
  from public.channels c
 where c.zion_api_key_encrypted is not null
   and not exists (select 1 from public.channel_api_keys k where k.channel_id = c.id);
