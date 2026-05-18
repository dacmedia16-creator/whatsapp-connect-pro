
alter table public.campaigns replica identity full;
alter table public.campaign_recipients replica identity full;
alter table public.message_queue replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.campaigns;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.campaign_recipients;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.message_queue;
  exception when duplicate_object then null;
  end;
end $$;
