import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function getChannelApiKey(channelId: string): Promise<string> {
  const secret = process.env.CHANNEL_KEY_SECRET;
  if (!secret) throw new Error("CHANNEL_KEY_SECRET não configurado");
  const { data, error } = await supabaseAdmin.rpc("get_channel_api_key", {
    p_channel_id: channelId,
    p_secret: secret,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Chave de API do canal indisponível");
  return data as string;
}
import { zionSendMessage, logSend } from "./ziontalk.server";

/** Send a message via a specific channel. Used by admin actions and inbox replies. */
export const sendMessageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      channelId: z.string().uuid(),
      contactId: z.string().uuid(),
      message: z.string().min(1).max(4096),
      conversationId: z.string().uuid().optional(),
      campaignId: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // role check — only admin/gestor/atendente can send. Atendente only on assigned conversation.
    const { userId } = context;

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleSet = new Set((roles ?? []).map((r) => r.role));
    if (roleSet.size === 0) {
      throw new Error("Sem permissão");
    }

    // load channel + contact
    const { data: channel, error: chErr } = await supabaseAdmin
      .from("channels")
      .select("*")
      .eq("id", data.channelId)
      .maybeSingle();
    if (chErr || !channel) throw new Error("Canal não encontrado");
    if (channel.status === "paused") throw new Error("Canal está pausado");

    const { data: contact, error: ctErr } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("id", data.contactId)
      .maybeSingle();
    if (ctErr || !contact) throw new Error("Contato não encontrado");
    if (contact.opt_out_at) throw new Error("Contato fez opt-out — envio bloqueado");
    if (!contact.consent) throw new Error("Contato sem consentimento — envio bloqueado");

    // If atendente only, verify conversation assignment
    if (!roleSet.has("admin") && !roleSet.has("gestor")) {
      if (!data.conversationId) throw new Error("Conversa não informada");
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("assigned_to")
        .eq("id", data.conversationId)
        .maybeSingle();
      if (!conv || conv.assigned_to !== userId) {
        throw new Error("Conversa não atribuída a você");
      }
    }

    // reset daily counter if date changed
    const today = new Date().toISOString().slice(0, 10);
    let sentToday = channel.sent_today;
    if (channel.sent_today_date !== today) {
      sentToday = 0;
    }
    if (sentToday >= channel.daily_limit) {
      throw new Error("Limite diário do canal atingido");
    }

    const result = await zionSendMessage({
      apiKey: await getChannelApiKey(channel.id),
      phone: contact.phone_e164,
      msg: data.message,
    });

    await logSend({
      channel_id: channel.id,
      contact_id: contact.id,
      campaign_id: data.campaignId ?? null,
      http_status: result.status,
      response_text: result.body.slice(0, 2000),
    });

    if (result.ok) {
      await supabaseAdmin
        .from("channels")
        .update({
          status: "connected",
          sent_today: sentToday + 1,
          sent_today_date: today,
          last_error: null,
        })
        .eq("id", channel.id);

      // Get or create conversation
      let conversationId = data.conversationId;
      if (!conversationId) {
        const { data: existing } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("contact_id", contact.id)
          .eq("channel_id", channel.id)
          .maybeSingle();
        if (existing) {
          conversationId = existing.id;
        } else {
          const { data: newConv } = await supabaseAdmin
            .from("conversations")
            .insert({
              contact_id: contact.id,
              channel_id: channel.id,
              status: "em_atendimento",
            })
            .select("id")
            .single();
          conversationId = newConv!.id;
        }
      }

      await supabaseAdmin.from("messages").insert({
        conversation_id: conversationId!,
        direction: "out",
        body: data.message,
        sent_via_channel_id: channel.id,
        campaign_id: data.campaignId ?? null,
        created_by: userId,
      });

      await supabaseAdmin
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId!);

      return { ok: true, status: result.status };
    } else {
      await supabaseAdmin
        .from("channels")
        .update({
          status: result.status === 401 ? "error" : channel.status,
          last_error: result.body.slice(0, 500),
        })
        .eq("id", channel.id);
      throw new Error(`Falha no envio (${result.status}): ${result.body.slice(0, 200)}`);
    }
  });

/** Test channel credentials by attempting a no-op auth check. */
export const testChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ channelId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: isAdmin } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!isAdmin) throw new Error("Apenas administradores podem testar canais");

    const { data: channel } = await supabaseAdmin
      .from("channels")
      .select("*")
      .eq("id", data.channelId)
      .maybeSingle();
    if (!channel) throw new Error("Canal não encontrado");

    // Hit endpoint with invalid params to verify auth works (expect 400/422, NOT 401)
    const form = new FormData();
    form.append("msg", "__test__");
    form.append("mobile_phone", "+0000000000");
    const apiKey = await getChannelApiKey(channel.id);
    const res = await fetch("https://app.ziontalk.com/api/send_message/", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${apiKey.trim()}:`).toString("base64") },
      body: form,
    });
    const text = await res.text();

    const newStatus = res.status === 401 ? "error" : "connected";
    await supabaseAdmin
      .from("channels")
      .update({ status: newStatus, last_error: res.status === 401 ? "API key inválida" : null })
      .eq("id", channel.id);

    return { status: res.status, ok: res.status !== 401, body: text.slice(0, 200) };
  });

/** Process the message queue — pull pending messages and send them respecting rate + daily limits + business hours. */
export const processQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleSet = new Set((roles ?? []).map((r) => r.role));
    if (!roleSet.has("admin") && !roleSet.has("gestor")) {
      throw new Error("Sem permissão");
    }

    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    // Pull up to 50 pending items due now
    const { data: items } = await supabaseAdmin
      .from("message_queue")
      .select("*, channel:channels(*), contact:contacts(*)")
      .eq("status", "pending")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(50);

    if (!items?.length) {
      const { data: nextItem } = await supabaseAdmin
        .from("message_queue")
        .select("scheduled_for, last_error")
        .eq("status", "pending")
        .order("scheduled_for", { ascending: true })
        .limit(1)
        .maybeSingle();
      return {
        sent: 0,
        failed: 0,
        skipped: 0,
        rescheduled: 0,
        totalProcessed: 0,
        pending: nextItem ? 1 : 0,
        nextScheduledFor: nextItem?.scheduled_for ?? null,
        message: nextItem
          ? "Nenhuma mensagem vencida para processar agora"
          : "Não há mensagens pendentes na fila",
      };
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let rescheduled = 0;

    for (const item of items ?? []) {
      const ch = item.channel as any;
      const ct = item.contact as any;
      if (!ch || !ct) {
        await supabaseAdmin
          .from("message_queue")
          .update({ status: "failed", last_error: "Canal ou contato ausente" })
          .eq("id", item.id);
        failed++;
        continue;
      }
      if (ct.opt_out_at || !ct.consent) {
        await supabaseAdmin
          .from("message_queue")
          .update({ status: "failed", last_error: "Sem consentimento" })
          .eq("id", item.id);
        if (item.campaign_recipient_id) {
          await supabaseAdmin
            .from("campaign_recipients")
            .update({ status: "opted_out" })
            .eq("id", item.campaign_recipient_id);
        }
        skipped++;
        continue;
      }
      if (ch.status === "paused") {
        await supabaseAdmin
          .from("message_queue")
          .update({ status: "pending", scheduled_for: new Date(Date.now() + 15 * 60 * 1000).toISOString() })
          .eq("id", item.id);
        rescheduled++;
        continue;
      }
      // daily limit check
      let sentToday = ch.sent_today_date === today ? ch.sent_today : 0;
      if (sentToday >= ch.daily_limit) {
        const nextDay = new Date();
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        nextDay.setUTCHours(12, 0, 0, 0);
        await supabaseAdmin
          .from("message_queue")
          .update({ status: "pending", scheduled_for: nextDay.toISOString() })
          .eq("id", item.id);
        rescheduled++;
        continue;
      }
      // business hours (tz-aware)
      const bh = ch.business_hours || {};
      const tz: string = bh.tz ?? "UTC";
      const days: number[] = Array.isArray(bh.days) ? bh.days : [0, 1, 2, 3, 4, 5, 6];
      const start: string = bh.start ?? "00:00";
      const end: string = bh.end ?? "23:59";
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
      }).formatToParts(new Date());
      const map: Record<string, string> = {};
      parts.forEach((p) => { map[p.type] = p.value; });
      const wdNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const wd = wdNames[map.weekday] ?? 1;
      const hhmm = `${map.hour}:${map.minute}`;
      if (!days.includes(wd) || hhmm < start || hhmm > end) {
        await supabaseAdmin
          .from("message_queue")
          .update({ status: "pending", scheduled_for: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
          .eq("id", item.id);
        rescheduled++;
        continue;
      }

      const attempts = (item.attempts ?? 0) + 1;
      await supabaseAdmin
        .from("message_queue")
        .update({ status: "processing", attempts })
        .eq("id", item.id);

      let apiKey: string;
      try {
        apiKey = await getChannelApiKey(ch.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Chave da Ziontalk indisponível";
        await supabaseAdmin
          .from("message_queue")
          .update({ status: "failed", last_error: message })
          .eq("id", item.id);
        if (item.campaign_recipient_id) {
          await supabaseAdmin
            .from("campaign_recipients")
            .update({ status: "failed", error: message })
            .eq("id", item.campaign_recipient_id);
        }
        await supabaseAdmin
          .from("channels")
          .update({ status: "error", last_error: message })
          .eq("id", ch.id);
        failed++;
        continue;
      }

      const result = await zionSendMessage({
        apiKey,
        phone: ct.phone_e164,
        msg: item.rendered_text,
      });

      await logSend({
        channel_id: ch.id,
        contact_id: ct.id,
        campaign_id: null,
        http_status: result.status,
        response_text: result.body.slice(0, 2000),
      });

      if (result.ok) {
        sent++;
        await supabaseAdmin
          .from("message_queue")
          .update({ status: "sent", processed_at: new Date().toISOString() })
          .eq("id", item.id);
        await supabaseAdmin
          .from("channels")
          .update({
            status: "connected",
            sent_today: sentToday + 1,
            sent_today_date: today,
            last_error: null,
          })
          .eq("id", ch.id);
        if (item.campaign_recipient_id) {
          await supabaseAdmin
            .from("campaign_recipients")
            .update({ status: "sent", sent_at: new Date().toISOString(), channel_id: ch.id })
            .eq("id", item.campaign_recipient_id);
        }

        // Ensure conversation + message
        const { data: existing } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("contact_id", ct.id)
          .eq("channel_id", ch.id)
          .maybeSingle();
        let convId = existing?.id;
        if (!convId) {
          const { data: newConv } = await supabaseAdmin
            .from("conversations")
            .insert({ contact_id: ct.id, channel_id: ch.id, status: "novo" })
            .select("id")
            .single();
          convId = newConv!.id;
        }
        await supabaseAdmin.from("messages").insert({
          conversation_id: convId!,
          direction: "out",
          body: item.rendered_text,
          sent_via_channel_id: ch.id,
        });
      } else {
        failed++;
        const tooMany = attempts >= 3;
        const backoffMs = Math.min(60_000 * Math.pow(2, attempts), 60 * 60_000);
        await supabaseAdmin
          .from("message_queue")
          .update({
            status: tooMany ? "failed" : "pending",
            attempts,
            last_error: result.body.slice(0, 500),
            scheduled_for: new Date(Date.now() + backoffMs).toISOString(),
          })
          .eq("id", item.id);
        if (item.campaign_recipient_id && tooMany) {
          await supabaseAdmin
            .from("campaign_recipients")
            .update({ status: "failed", error: result.body.slice(0, 300) })
            .eq("id", item.campaign_recipient_id);
        }
        await supabaseAdmin
          .from("channels")
          .update({ status: result.status === 401 ? "error" : ch.status, last_error: result.body.slice(0, 500) })
          .eq("id", ch.id);
      }
    }

    return { sent, failed, skipped, rescheduled, totalProcessed: (items ?? []).length };
  });

/** Enqueue all recipients of a campaign into message_queue. */
export const enqueueCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ campaignId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roleSet = new Set((roles ?? []).map((r) => r.role));
    if (!roleSet.has("admin") && !roleSet.has("gestor")) {
      throw new Error("Sem permissão");
    }

    const { data: campaign, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", data.campaignId)
      .maybeSingle();
    if (error || !campaign) throw new Error("Campanha não encontrada");

    // Resolve recipients via audience_filter (tags include / consent required)
    const filter = (campaign.audience_filter || {}) as { tags?: string[] };
    let q = supabaseAdmin
      .from("contacts")
      .select("id, name, phone_e164, custom_fields, tags")
      .eq("consent", true)
      .is("opt_out_at", null);
    if (filter.tags?.length) {
      q = q.contains("tags", filter.tags);
    }
    const { data: contacts } = await q;
    if (!contacts || !contacts.length) {
      return { enqueued: 0, message: "Nenhum contato elegível" };
    }

    // Resolve channels
    const channelIds = (campaign.channel_ids as string[]) ?? [];
    let channelsQ = supabaseAdmin.from("channels").select("id, daily_limit").neq("status", "paused");
    if (channelIds.length) channelsQ = channelsQ.in("id", channelIds);
    const { data: channels } = await channelsQ;
    if (!channels || !channels.length) throw new Error("Nenhum canal disponível");

    // Insert campaign_recipients (skip duplicates via ON CONFLICT)
    const recipientRows = contacts.map((c) => ({
      campaign_id: campaign.id,
      contact_id: c.id,
      status: "queued" as const,
    }));
    await supabaseAdmin.from("campaign_recipients").upsert(recipientRows, {
      onConflict: "campaign_id,contact_id",
      ignoreDuplicates: true,
    });
    const { data: recs } = await supabaseAdmin
      .from("campaign_recipients")
      .select("id, contact_id")
      .eq("campaign_id", campaign.id)
      .eq("status", "queued");

    // Build queue with round-robin channel and stagger by rate_per_min
    const ratePerMin = Math.max(1, campaign.rate_per_min || 20);
    const startAt = campaign.scheduled_at ? new Date(campaign.scheduled_at).getTime() : Date.now();
    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    const queueRows = (recs ?? []).map((r, idx) => {
      const ch = channels[idx % channels.length];
      const contact = contactMap.get(r.contact_id)!;
      const vars: Record<string, string> = {
        nome: contact.name,
        ...(contact.custom_fields as Record<string, string>),
      };
      const rendered = campaign.message_template.replace(
        /\{\{\s*([\w.]+)\s*\}\}/g,
        (_: string, k: string) => vars[k] ?? "",
      );
      const scheduledFor = new Date(startAt + (idx * 60_000) / ratePerMin);
      return {
        campaign_recipient_id: r.id,
        contact_id: r.contact_id,
        channel_id: ch.id,
        rendered_text: rendered,
        scheduled_for: scheduledFor.toISOString(),
      };
    });

    if (queueRows.length) {
      await supabaseAdmin.from("message_queue").insert(queueRows);
    }

    await supabaseAdmin
      .from("campaigns")
      .update({
        status: campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() > Date.now() ? "scheduled" : "running",
        total_recipients: queueRows.length,
      })
      .eq("id", campaign.id);

    return { enqueued: queueRows.length };
  });