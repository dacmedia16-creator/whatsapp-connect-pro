ALTER TABLE public.campaign_send_settings
ADD COLUMN IF NOT EXISTS rotation_cursor integer NOT NULL DEFAULT 0;