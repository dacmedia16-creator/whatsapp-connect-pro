ALTER TABLE public.message_queue
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_message_queue_processing_started_at
  ON public.message_queue (processing_started_at)
  WHERE status = 'processing';