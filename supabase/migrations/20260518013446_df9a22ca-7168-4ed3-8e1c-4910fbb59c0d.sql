-- Enable pgcrypto for symmetric encryption
create extension if not exists pgcrypto with schema extensions;

-- Encrypted column for the ZionTalk API key
alter table public.channels
  add column if not exists zion_api_key_encrypted bytea;

-- SECURITY DEFINER helpers. Secret is passed at call-time from the server (process.env.CHANNEL_KEY_SECRET).
create or replace function public.set_channel_api_key(
  p_channel_id uuid,
  p_plain_key text,
  p_secret text
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_plain_key is null or length(p_plain_key) < 4 then
    raise exception 'Chave inválida';
  end if;
  update public.channels
     set zion_api_key_encrypted = extensions.pgp_sym_encrypt(p_plain_key, p_secret),
         zion_api_key_hint = right(p_plain_key, 4),
         zion_api_key = '',
         updated_at = now()
   where id = p_channel_id;
end;
$$;

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
  select zion_api_key_encrypted, zion_api_key
    into v_enc, v_legacy
    from public.channels
   where id = p_channel_id;

  if v_enc is not null then
    return extensions.pgp_sym_decrypt(v_enc, p_secret);
  end if;

  -- Legacy fallback (pre-migration plaintext)
  return nullif(v_legacy, '');
end;
$$;

-- Restrict exec: only service_role may call these from server code
revoke all on function public.set_channel_api_key(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_channel_api_key(uuid, text) from public, anon, authenticated;
grant execute on function public.set_channel_api_key(uuid, text, text) to service_role;
grant execute on function public.get_channel_api_key(uuid, text) to service_role;
