import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PayloadSchema = z.object({
  // ZionTalk pode enviar campos variados; aceitamos os mais comuns
  from: z.string().min(5).max(32).optional(),
  mobile_phone: z.string().min(5).max(32).optional(),
  to: z.string().min(5).max(32).optional(),
  channel: z.string().max(64).optional(),
  message: z.string().max(8192).optional(),
  msg: z.string().max(8192).optional(),
  body: z.string().max(8192).optional(),
  external_id: z.string().max(128).optional(),
  name: z.string().max(120).optional(),
}).passthrough();

function normalize(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("+") ? phone : `+${digits}`;
}

export const Route = createFileRoute("/api/public/webhooks/ziontalk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.ZION_WEBHOOK_TOKEN;
        if (!expected) return new Response("Webhook não configurado", { status: 503 });
        const token = request.headers.get("x-zion-token")
          ?? new URL(request.url).searchParams.get("token");
        if (token !== expected) return new Response("Unauthorized", { status: 401 });

        let raw: unknown;
        try { raw = await request.json(); } catch { return new Response("JSON inválido", { status: 400 }); }
        const parsed = PayloadSchema.safeParse(raw);
        if (!parsed.success) return new Response("Payload inválido", { status: 400 });
        const p = parsed.data;

        const fromPhoneRaw = p.from ?? p.mobile_phone;
        const toPhoneRaw = p.to ?? p.channel;
        const body = p.message ?? p.msg ?? p.body ?? "";
        if (!fromPhoneRaw || !body) return new Response("Faltam from/body", { status: 400 });

        const fromPhone = normalize(fromPhoneRaw);
        const toPhone = toPhoneRaw ? normalize(toPhoneRaw) : null;

        // Identifica canal pelo número de destino quando informado
        let channelId: string | null = null;
        if (toPhone) {
          const { data: ch } = await supabaseAdmin
            .from("channels").select("id").eq("phone_e164", toPhone).maybeSingle();
          channelId = ch?.id ?? null;
        }

        // Identifica/cria contato
        const { data: existingContact } = await supabaseAdmin
          .from("contacts").select("id").eq("phone_e164", fromPhone).maybeSingle();
        let contactId = existingContact?.id;
        if (!contactId) {
          const { data: newContact, error } = await supabaseAdmin
            .from("contacts").insert({
              name: p.name ?? fromPhone,
              phone_e164: fromPhone,
              consent: false,
              source: "webhook",
            }).select("id").single();
          if (error || !newContact) {
            return new Response("Erro ao criar contato: " + error?.message, { status: 500 });
          }
          contactId = newContact.id;
        }

        // Identifica/cria conversa
        let conversationQ = supabaseAdmin
          .from("conversations").select("id, unread_count").eq("contact_id", contactId);
        if (channelId) conversationQ = conversationQ.eq("channel_id", channelId);
        const { data: existingConv } = await conversationQ.maybeSingle();
        let conversationId = existingConv?.id;
        if (!conversationId) {
          const { data: newConv, error } = await supabaseAdmin
            .from("conversations").insert({
              contact_id: contactId,
              channel_id: channelId,
              status: "novo",
              unread_count: 1,
              last_message_at: new Date().toISOString(),
            }).select("id").single();
          if (error || !newConv) {
            return new Response("Erro ao criar conversa: " + error?.message, { status: 500 });
          }
          conversationId = newConv.id;
        } else {
          await supabaseAdmin
            .from("conversations")
            .update({
              last_message_at: new Date().toISOString(),
              unread_count: (existingConv?.unread_count ?? 0) + 1,
            })
            .eq("id", conversationId);
        }

        const { error: msgErr } = await supabaseAdmin.from("messages").insert({
          conversation_id: conversationId,
          direction: "in",
          body,
          external_id: p.external_id ?? null,
          sent_via_channel_id: channelId,
        });
        if (msgErr) return new Response("Erro ao gravar mensagem: " + msgErr.message, { status: 500 });

        return new Response(JSON.stringify({ ok: true, conversation_id: conversationId }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});