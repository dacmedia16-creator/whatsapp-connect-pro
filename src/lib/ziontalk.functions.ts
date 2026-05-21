import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zionSendMessage, logSend } from "./ziontalk.server";
import { createSenderContext, processQueueItem } from "@/lib/send/sender.server";
import { normalizeSendSettings, SEND_SETTINGS_DEFAULTS } from "@/lib/send-settings-defaults";
import { pickChannelForEnqueue } from "@/lib/send/channel-selector.server";

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

// (helpers legados nextDateInTz/getBusinessHoursWindow removidos — usar
// src/lib/send/rate-limit.server.ts, que respeita timezone real via Intl.)

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

    const nowIso = new Date().toISOString();

    // Claim atômico até 50 pending vencidos (mesmo padrão do cron).
    const { data: claimed } = await supabaseAdmin
      .from("message_queue")
      .update({ status: "processing" })
      .lte("scheduled_for", nowIso)
      .eq("status", "pending")
      .select("id")
      .limit(50);

    const ids = (claimed ?? []).map((r: any) => r.id);
    if (!ids.length) {
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

    const { data: items } = await supabaseAdmin
      .from("message_queue")
      .select("*, channel:channels(*), contact:contacts(*), recipient:campaign_recipients(id, campaign_id)")
      .in("id", ids);

    const ctx = createSenderContext(process.env.CHANNEL_KEY_SECRET);
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let rescheduled = 0;

    for (const item of items ?? []) {
      const outcome = await processQueueItem(item, ctx);
      if (outcome === "sent") sent++;
      else if (outcome === "failed") failed++;
      else if (outcome === "rescheduled") rescheduled++;
      else skipped++;
    }

    return { sent, failed, skipped, rescheduled, totalProcessed: (items ?? []).length };
  });

/** Enqueue all recipients of a campaign into message_queue. */
export async function enqueueCampaignCore(campaignId: string): Promise<{ enqueued: number; message?: string }> {
  const { data: campaign, error } = await supabaseAdmin
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .maybeSingle();
    if (error || !campaign) throw new Error("Campanha não encontrada");

    // Carrega APENAS os destinatários já resolvidos no momento da criação.
    // NÃO re-consulta `contacts` — isso vazaria contatos fora do método
    // escolhido (lista/etiquetas/import/manual). createCampaignFn é
    // autoritativo na seleção; o enqueue só agenda o que já existe.
    const { data: existingRecs } = await supabaseAdmin
      .from("campaign_recipients")
      .select("id, contact_id, contact:contacts(id, name, phone_e164, custom_fields, tags, consent, opt_out_at)")
      .eq("campaign_id", campaign.id);
    if (!existingRecs || !existingRecs.length) {
      return { enqueued: 0, message: "Nenhum destinatário na campanha" };
    }
    const contacts = existingRecs
      .map((r: any) => r.contact)
      .filter((c: any): c is { id: string; name: string; phone_e164: string; custom_fields: any; tags: string[] | null; consent: boolean; opt_out_at: string | null } => !!c && !!c.phone_e164 && !c.opt_out_at);
    if (!contacts.length) {
      return { enqueued: 0, message: "Nenhum contato elegível" };
    }

    // Lê configurações por campanha (canais, rotação, delays, janela).
    const { data: settingsRow } = await supabaseAdmin
      .from("campaign_send_settings")
      .select("*")
      .eq("campaign_id", campaign.id)
      .maybeSingle();
    // Se não existe linha, semeia defaults canônicos antes de prosseguir.
    if (!settingsRow) {
      await supabaseAdmin.from("campaign_send_settings")
        .upsert({ campaign_id: campaign.id, ...normalizeSendSettings(null) }, { onConflict: "campaign_id" });
    }
    const settings = normalizeSendSettings(settingsRow ?? null);

    // Fonte única: campaign_send_settings.selected_channel_ids.
    // Sem fallback: se settings está vazio, erro explícito (não silencioso).
    const channelIds = settings.selected_channel_ids ?? [];
    if (!channelIds.length) {
      throw new Error("Nenhum canal selecionado em campaign_send_settings — configure no painel antes de iniciar");
    }
    let channelsQ = supabaseAdmin
      .from("channels")
      .select("id, status, daily_limit, sent_today, sent_today_date")
      .neq("status", "paused");
    if (channelIds.length) channelsQ = channelsQ.in("id", channelIds);
    const { data: channels } = await channelsQ;
    if (!channels || !channels.length) throw new Error("Nenhum canal disponível");
    const channelList = channels;

    // Usa os recipients já existentes (não inserir novos aqui).
    const eligibleContactIds = new Set(contacts.map((c) => c.id));
    const recs = existingRecs
      .filter((r: any) => eligibleContactIds.has(r.contact_id))
      .map((r: any) => ({ id: r.id, contact_id: r.contact_id }));

    // Distribuição inicial conforme settings (rotação + delays) — usa a MESMA
    // função que o sender (pickChannelForEnqueue), para que o canal planejado
    // bata com o canal que vai realmente disparar.
    const startAt = campaign.scheduled_at ? new Date(campaign.scheduled_at).getTime() : Date.now();
    const contactMap = new Map(contacts.map((c) => [c.id, c]));
    const today = new Date().toISOString().slice(0, 10);
    const delaySeconds = Math.max(0, settings.delay_seconds);
    const jitterMin = settings.random_delay_min ?? 0;
    const jitterMax = settings.random_delay_max ?? 0;
    const batchMode = settings.batch_mode;

    // Snapshot canônico das configurações no momento do enqueue.
    // Itens já enfileirados não devem mudar de comportamento se settings mudar depois.
    const settingsSnapshot = {
      rotation_mode: settings.rotation_mode,
      selected_channel_ids: settings.selected_channel_ids,
      channel_priority: settings.channel_priority,
      delay_seconds: settings.delay_seconds,
      random_delay_min: settings.random_delay_min,
      random_delay_max: settings.random_delay_max,
      max_per_minute: settings.max_per_minute,
      max_per_hour: settings.max_per_hour,
      max_per_day_per_channel: settings.max_per_day_per_channel,
      allowed_start_time: settings.allowed_start_time,
      allowed_end_time: settings.allowed_end_time,
      allowed_weekdays: settings.allowed_weekdays,
      timezone: settings.timezone,
      batch_mode: settings.batch_mode,
      batch_pause_seconds: settings.batch_pause_seconds,
      snapshotted_at: new Date().toISOString(),
    };

    // Estado mutável do round-robin / least_used durante o enqueue.
    const enqueueCursor = { value: Number((settingsRow as any)?.rotation_cursor ?? 0) || 0 };
    const localUsage = new Map<string, number>();
    const channelsForPick = channelList.map((c: any) => ({
      id: c.id, status: c.status, daily_limit: c.daily_limit,
      sent_today: c.sent_today ?? 0, sent_today_date: c.sent_today_date,
    }));

    const queueRows = (recs ?? []).map((r, idx) => {
      const picked = pickChannelForEnqueue({
        settings: { ...SEND_SETTINGS_DEFAULTS, ...settings, rotation_cursor: enqueueCursor.value } as any,
        channels: channelsForPick,
        today,
        cursor: enqueueCursor.value,
        localUsage,
      });
      // Se nenhum canal disponível, registra com null para o sender decidir depois.
      // Mantém um chip "default" para satisfazer a constraint NOT NULL de channel_id.
      const chId = picked?.channel_id ?? channelList[idx % channelList.length].id;
      if (picked) enqueueCursor.value = picked.next_cursor;
      const contact = contactMap.get(r.contact_id)!;
      const vars: Record<string, string> = {
        nome: contact.name,
        ...(contact.custom_fields as Record<string, string>),
      };
      const rendered = campaign.message_template.replace(
        /\{\{\s*([\w.]+)\s*\}\}/g,
        (_: string, k: string) => vars[k] ?? "",
      );
      // batch_mode: sender controla o pacing via pushBatchScheduledFor;
      // todos os itens entram com scheduled_for=startAt e o sender empurra.
      const baseOffsetMs = batchMode ? 0 : idx * delaySeconds * 1000;
      const jitterMs = !batchMode && jitterMax > jitterMin
        ? Math.floor((jitterMin + Math.random() * (jitterMax - jitterMin)) * 1000)
        : (!batchMode && jitterMin ? jitterMin * 1000 : 0);
      const scheduledFor = new Date(startAt + baseOffsetMs + jitterMs);
      return {
        campaign_recipient_id: r.id,
        contact_id: r.contact_id,
        channel_id: chId,
        planned_channel_id: chId,
        channel_selection_reason: picked?.reason ?? "no_channel_available_at_enqueue",
        fallback_used: picked?.fallback ?? false,
        settings_snapshot: settingsSnapshot,
        rendered_text: rendered,
        scheduled_for: scheduledFor.toISOString(),
      };
    });
    // Persiste cursor final no banco para o runtime começar do mesmo ponto.
    if (enqueueCursor.value !== Number((settingsRow as any)?.rotation_cursor ?? 0)) {
      await supabaseAdmin
        .from("campaign_send_settings")
        .update({ rotation_cursor: enqueueCursor.value })
        .eq("campaign_id", campaign.id);
    }

    const recipientIds = (recs ?? []).map((r) => r.id);
    const { data: existingQueue } = recipientIds.length
      ? await supabaseAdmin
        .from("message_queue")
        .select("campaign_recipient_id")
        .in("campaign_recipient_id", recipientIds)
        .in("status", ["pending", "processing", "sent"])
      : { data: [] };
    const alreadyQueued = new Set((existingQueue ?? []).map((r) => r.campaign_recipient_id));
    const newQueueRows = queueRows.filter((row) => !alreadyQueued.has(row.campaign_recipient_id));

    if (newQueueRows.length) {
      await supabaseAdmin.from("message_queue").insert(newQueueRows);
    }

    await supabaseAdmin
      .from("campaigns")
      .update({
        status: campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() > Date.now() ? "scheduled" : "running",
      })
      .eq("id", campaign.id);

    return { enqueued: newQueueRows.length };
}

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
    return enqueueCampaignCore(data.campaignId);
  });