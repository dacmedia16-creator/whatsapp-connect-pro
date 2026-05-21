
-- Audit consistency: rastreabilidade de canal e snapshot de configuração

-- 1) Alinhar default de rotation_mode com o default de código (least_used)
ALTER TABLE public.campaign_send_settings
  ALTER COLUMN rotation_mode SET DEFAULT 'least_used'::rotation_mode;

-- 2) Adicionar colunas de rastreabilidade em message_queue
ALTER TABLE public.message_queue
  ADD COLUMN IF NOT EXISTS planned_channel_id uuid,
  ADD COLUMN IF NOT EXISTS actual_channel_id uuid,
  ADD COLUMN IF NOT EXISTS channel_selection_reason text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settings_snapshot jsonb;

-- 3) Backfill: itens existentes mantêm o channel_id como planned e (se sent) actual
UPDATE public.message_queue
   SET planned_channel_id = channel_id
 WHERE planned_channel_id IS NULL;

UPDATE public.message_queue
   SET actual_channel_id = channel_id
 WHERE actual_channel_id IS NULL AND status = 'sent';

-- 4) Índice de apoio para queries do painel (planned vs actual)
CREATE INDEX IF NOT EXISTS idx_mq_planned_channel ON public.message_queue(planned_channel_id);
CREATE INDEX IF NOT EXISTS idx_mq_actual_channel ON public.message_queue(actual_channel_id);
