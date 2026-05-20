UPDATE public.campaigns SET status='done'
WHERE status IN ('running','scheduled','paused')
  AND NOT EXISTS (
    SELECT 1 FROM public.campaign_recipients cr
    WHERE cr.campaign_id = campaigns.id AND cr.status='queued'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.message_queue mq
    JOIN public.campaign_recipients cr ON cr.id = mq.campaign_recipient_id
    WHERE cr.campaign_id = campaigns.id
      AND mq.status IN ('pending','processing')
  );