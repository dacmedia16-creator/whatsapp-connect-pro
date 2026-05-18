
-- Fix search_path on tg_set_updated_at
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Revoke broad EXECUTE on internal/trigger-only functions
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated;
revoke execute on function public.current_user_role() from public, anon;

-- has_role is used inside RLS evaluation; authenticated must keep execute. Revoke anon.
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
