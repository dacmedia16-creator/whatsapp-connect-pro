-- Ajustar FKs para permitir excluir campanhas sem quebrar histórico/auditoria
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_campaign_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;

ALTER TABLE public.send_logs DROP CONSTRAINT IF EXISTS send_logs_campaign_id_fkey;
ALTER TABLE public.send_logs
  ADD CONSTRAINT send_logs_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;

ALTER TABLE public.campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_campaign_id_fkey;
ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;

ALTER TABLE public.campaign_events DROP CONSTRAINT IF EXISTS campaign_events_campaign_id_fkey;
ALTER TABLE public.campaign_events
  ADD CONSTRAINT campaign_events_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;

ALTER TABLE public.campaign_events DROP CONSTRAINT IF EXISTS campaign_events_recipient_id_fkey;
ALTER TABLE public.campaign_events
  ADD CONSTRAINT campaign_events_recipient_id_fkey
  FOREIGN KEY (recipient_id) REFERENCES public.campaign_recipients(id) ON DELETE CASCADE;

ALTER TABLE public.campaign_send_settings DROP CONSTRAINT IF EXISTS campaign_send_settings_campaign_id_fkey;
ALTER TABLE public.campaign_send_settings
  ADD CONSTRAINT campaign_send_settings_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;

ALTER TABLE public.message_queue DROP CONSTRAINT IF EXISTS message_queue_campaign_recipient_id_fkey;
ALTER TABLE public.message_queue
  ADD CONSTRAINT message_queue_campaign_recipient_id_fkey
  FOREIGN KEY (campaign_recipient_id) REFERENCES public.campaign_recipients(id) ON DELETE CASCADE;