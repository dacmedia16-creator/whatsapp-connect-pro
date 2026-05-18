
-- Auto opt-out: when an inbound message is recorded, scan its body against
-- public.opt_out_keywords. If any keyword appears as a whole word
-- (case/diacritic-insensitive), flag the contact as opt-out and log an alert.

create or replace function public.fn_auto_opt_out_on_inbound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
  v_matched text;
  v_body_norm text;
begin
  if new.direction <> 'in' or new.body is null or length(trim(new.body)) = 0 then
    return new;
  end if;

  select c.id into v_contact_id
  from public.conversations conv
  join public.contacts c on c.id = conv.contact_id
  where conv.id = new.conversation_id;

  if v_contact_id is null then
    return new;
  end if;

  -- normalize: lowercase + strip accents
  v_body_norm := lower(public.unaccent_safe(new.body));

  select k.keyword into v_matched
  from public.opt_out_keywords k
  where v_body_norm ~ ('(^|[^[:alnum:]])' || lower(public.unaccent_safe(k.keyword)) || '([^[:alnum:]]|$)')
  limit 1;

  if v_matched is not null then
    update public.contacts
       set opt_out_at = coalesce(opt_out_at, now()),
           consent = false,
           updated_at = now()
     where id = v_contact_id
       and opt_out_at is null;

    insert into public.alerts (type, severity, message, metadata)
    values (
      'auto_opt_out',
      'warning',
      'Contato marcado como opt-out automaticamente pela palavra "' || v_matched || '"',
      jsonb_build_object(
        'contact_id', v_contact_id,
        'conversation_id', new.conversation_id,
        'message_id', new.id,
        'keyword', v_matched
      )
    );
  end if;

  return new;
end;
$$;

-- Safe unaccent fallback: use extension if installed, otherwise identity.
create or replace function public.unaccent_safe(txt text)
returns text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_result text;
begin
  begin
    execute 'select extensions.unaccent($1)' into v_result using txt;
    return v_result;
  exception when others then
    return txt;
  end;
end;
$$;

create extension if not exists unaccent with schema extensions;

drop trigger if exists trg_auto_opt_out_on_inbound on public.messages;
create trigger trg_auto_opt_out_on_inbound
after insert on public.messages
for each row
execute function public.fn_auto_opt_out_on_inbound();
