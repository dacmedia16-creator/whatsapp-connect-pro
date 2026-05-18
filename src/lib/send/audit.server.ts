import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Wrapper centralizado para registrar tentativas de envio no log de auditoria.
// O trigger fn_log_campaign_event cuida automaticamente de campaign_events.
export async function logSendAttempt(params: {
  channel_id: string;
  contact_id: string;
  campaign_id?: string | null;
  http_status: number;
  response_text: string;
}): Promise<void> {
  await supabaseAdmin.from("send_logs").insert({
    channel_id: params.channel_id,
    contact_id: params.contact_id,
    campaign_id: params.campaign_id ?? null,
    http_status: params.http_status,
    response_text: params.response_text.slice(0, 2000),
  });
}