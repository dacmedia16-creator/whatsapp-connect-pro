
-- Rotation modes
DO $$ BEGIN
  CREATE TYPE public.rotation_mode AS ENUM ('round_robin','least_used','manual_priority');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.campaign_send_settings (
  campaign_id uuid PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  selected_channel_ids uuid[] NOT NULL DEFAULT '{}',
  rotation_mode public.rotation_mode NOT NULL DEFAULT 'round_robin',
  channel_priority uuid[] NOT NULL DEFAULT '{}',
  delay_seconds integer NOT NULL DEFAULT 30 CHECK (delay_seconds >= 0 AND delay_seconds <= 3600),
  random_delay_min integer CHECK (random_delay_min IS NULL OR random_delay_min >= 0),
  random_delay_max integer CHECK (random_delay_max IS NULL OR random_delay_max >= 0),
  max_per_minute integer NOT NULL DEFAULT 20 CHECK (max_per_minute >= 1 AND max_per_minute <= 600),
  max_per_hour integer NOT NULL DEFAULT 200 CHECK (max_per_hour >= 1 AND max_per_hour <= 10000),
  max_per_day_per_channel integer NOT NULL DEFAULT 500 CHECK (max_per_day_per_channel >= 1 AND max_per_day_per_channel <= 100000),
  allowed_start_time time NOT NULL DEFAULT '09:00',
  allowed_end_time time NOT NULL DEFAULT '18:00',
  allowed_weekdays integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  auto_pause_outside_hours boolean NOT NULL DEFAULT true,
  auto_pause_on_all_channels_down boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_send_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS css_manage ON public.campaign_send_settings;
CREATE POLICY css_manage ON public.campaign_send_settings
  FOR ALL TO public
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gestor'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gestor'));

DROP POLICY IF EXISTS css_read ON public.campaign_send_settings;
CREATE POLICY css_read ON public.campaign_send_settings
  FOR SELECT TO public USING (auth.uid() IS NOT NULL);

DROP TRIGGER IF EXISTS css_set_updated_at ON public.campaign_send_settings;
CREATE TRIGGER css_set_updated_at BEFORE UPDATE ON public.campaign_send_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_message_queue_status_sched
  ON public.message_queue(status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_message_queue_channel_status
  ON public.message_queue(channel_id, status);

CREATE INDEX IF NOT EXISTS idx_send_logs_channel_created
  ON public.send_logs(channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_status
  ON public.campaign_recipients(campaign_id, status);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_send_settings;
