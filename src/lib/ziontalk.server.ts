import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const ZION_BASE = "https://app.ziontalk.com";

function basicAuth(apiKey: string) {
  return "Basic " + Buffer.from(`${apiKey.trim()}:`).toString("base64");
}

export async function zionSendMessage(opts: {
  apiKey: string;
  phone: string;
  msg: string;
  media?: { url: string; filename: string; mime: string } | null;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const form = new FormData();
  form.append("msg", opts.msg);
  form.append("mobile_phone", opts.phone);

  if (opts.media?.url) {
    try {
      const r = await fetch(opts.media.url);
      if (!r.ok) {
        return { ok: false, status: r.status, body: `Falha ao baixar mídia (${r.status})` };
      }
      const buf = await r.arrayBuffer();
      const blob = new Blob([buf], { type: opts.media.mime || r.headers.get("content-type") || "application/octet-stream" });
      // ZionTalk espera o campo "attachments" (multipart) para arquivos.
      form.append("attachments", blob, opts.media.filename);
    } catch (e: any) {
      return { ok: false, status: 0, body: `Erro de mídia: ${e?.message ?? "desconhecido"}` };
    }
  }

  const res = await fetch(`${ZION_BASE}/api/send_message/`, {
    method: "POST",
    headers: { Authorization: basicAuth(opts.apiKey) },
    body: form,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

export async function logSend(args: {
  channel_id: string | null;
  contact_id: string | null;
  campaign_id?: string | null;
  http_status: number;
  response_text: string;
}) {
  await supabaseAdmin.from("send_logs").insert(args);
}