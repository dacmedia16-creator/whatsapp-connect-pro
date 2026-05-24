ALTER TABLE public.campaign_send_settings
  ADD COLUMN IF NOT EXISTS bypass_window_until timestamptz;