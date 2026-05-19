-- Colunas de mídia na campanha
alter table public.campaigns
  add column if not exists media_url text,
  add column if not exists media_type text,
  add column if not exists media_mime text,
  add column if not exists media_filename text;

alter table public.campaigns
  drop constraint if exists campaigns_media_type_check;
alter table public.campaigns
  add constraint campaigns_media_type_check
    check (media_type is null or media_type in ('image','video','audio','document'));

-- Bucket público para mídia de campanha
insert into storage.buckets (id, name, public)
values ('campaign-media', 'campaign-media', true)
on conflict (id) do update set public = true;

-- Policies do bucket
drop policy if exists "campaign_media_public_read" on storage.objects;
create policy "campaign_media_public_read"
  on storage.objects for select
  using (bucket_id = 'campaign-media');

drop policy if exists "campaign_media_managers_insert" on storage.objects;
create policy "campaign_media_managers_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'campaign-media'
    and (public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'gestor'::public.app_role))
  );

drop policy if exists "campaign_media_managers_update" on storage.objects;
create policy "campaign_media_managers_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'campaign-media'
    and (public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'gestor'::public.app_role))
  );

drop policy if exists "campaign_media_managers_delete" on storage.objects;
create policy "campaign_media_managers_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'campaign-media'
    and (public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'gestor'::public.app_role))
  );