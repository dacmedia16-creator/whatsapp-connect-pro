ALTER TABLE public.campaign_send_settings
  ADD COLUMN IF NOT EXISTS batch_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS batch_pause_seconds integer;