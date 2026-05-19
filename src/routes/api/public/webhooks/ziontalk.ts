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

function flattenZionPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, any>;
  // já está plano
  if (r.from || r.mobile_phone || r.message || r.msg || r.body) return r;
  const contato = r.contato ?? r.contact ?? {};
  const mensagem = r.mensagem ?? r.message_data ?? {};
  return {
    ...r,
    from: contato.telefone ?? contato.phone ?? contato.numero,
    name: contato.nome ?? contato.name,
    body: typeof r.mensagem === "string" ? r.mensagem : (mensagem.texto ?? mensagem.text ?? mensagem.body),
    to: mensagem.canal ?? mensagem.channel ?? mensagem.destino,
    external_id: r.external_id ?? r.id ?? mensagem.id,
  };
}

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
        const url = new URL(request.url);
        const token = request.headers.get("x-zion-token") ?? url.searchParams.get("token");
        if (token !== expected) return new Response("Unauthorized", { status: 401 });
        const queryChannelId = url.searchParams.get("channel_id");

        let raw: unknown;
        try { raw = await request.json(); } catch { return new Response("JSON inválido", { status: 400 }); }
        try { console.log("[ziontalk webhook] payload:", JSON.stringify(raw)); } catch {}
        const flat = flattenZionPayload(raw);
        const parsed = PayloadSchema.safeParse(flat);
        if (!parsed.success) return new Response("Payload inválido", { status: 400 });
        const p = parsed.data;

        const fromPhoneRaw = p.from ?? p.mobile_phone;
        const toPhoneRaw = p.to ?? p.channel;
        const body = p.message ?? p.msg ?? p.body ?? "";
        if (!fromPhoneRaw || !body) return new Response("Faltam from/body", { status: 400 });

        const fromPhone = normalize(fromPhoneRaw);
        const toPhone = toPhoneRaw ? normalize(toPhoneRaw) : null;

        // Identifica canal: 1) query param channel_id (mais confiável), 2) número de destino do payload
        let channelId: string | null = null;
        if (queryChannelId) {
          const { data: ch } = await supabaseAdmin
            .from("channels").select("id").eq("id", queryChannelId).maybeSingle();
          channelId = ch?.id ?? null;
        }
        if (!channelId && toPhone) {
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

        // Identifica/cria conversa — busca a mais recente do contato (tolerante
        // a duplicatas e a conversas antigas com channel_id null)
        const { data: convs } = await supabaseAdmin
          .from("conversations")
          .select("id, unread_count, channel_id")
          .eq("contact_id", contactId)
          .order("last_message_at", { ascending: false })
          .limit(1);
        const existingConv = convs?.[0];
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
          const patch: {
            last_message_at: string;
            unread_count: number;
            channel_id?: string;
          } = {
            last_message_at: new Date().toISOString(),
            unread_count: (existingConv?.unread_count ?? 0) + 1,
          };
          // Sempre alinhar canal da conversa com o canal do último inbound,
          // para que respostas saiam pelo mesmo número.
          if (channelId && channelId !== existingConv?.channel_id) {
            patch.channel_id = channelId;
          }
          await supabaseAdmin.from("conversations").update(patch).eq("id", conversationId);
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