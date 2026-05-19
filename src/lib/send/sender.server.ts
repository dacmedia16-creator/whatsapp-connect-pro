import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zionSendMessage } from "@/lib/ziontalk.server";
import { isWithinBusinessHours, isWithinCampaignWindow } from "./rate-limit.server";
import {
  type SelectorContext, getSettings, pickChannel,
} from "./channel-selector.server";
import { logSendAttempt } from "./audit.server";

export type ProcessOutcome = "sent" | "failed" | "rescheduled" | "skipped";

export type SenderContext = SelectorContext & {
  secret: string | undefined;
  keyCache: Map<string, string | null>;
  mediaCache: Map<string, { url: string; filename: string; mime: string } | null>;
};

export function createSenderContext(secret: string | undefined): SenderContext {
  return {
    settingsCache: new Map(),
    channelsCache: new Map(),
    rrCursor: new Map(),
    today: new Date().toISOString().slice(0, 10),
    secret,
    keyCache: new Map(),
    mediaCache: new Map(),
  };
}

// Calcula o próximo instante (ms epoch) em que o canal pode disparar,
// aplicando delay_seconds com jitter (random_delay_min/max) se configurado.
function computeNextAvailable(settings: any): number {
  const min = Number(settings?.random_delay_min);
  const max = Number(settings?.random_delay_max);
  let delaySec = Number(settings?.delay_seconds ?? 0) || 0;
  if (Number.isFinite(min) && Number.isFinite(max) && max >= min && max > 0) {
    delaySec = Math.floor(min + Math.random() * (max - min + 1));
  }
  return Date.now() + Math.max(0, delaySec) * 1000;
}

// Empurra o próximo item pendente desse canal para não disparar antes do delay.
async function pushNextScheduledFor(channelId: string, nextAvailableMs: number) {
  const nextIso = new Date(nextAvailableMs).toISOString();
  const { data: next } = await supabaseAdmin
    .from("message_queue")
    .select("id, scheduled_for")
    .eq("channel_id", channelId)
    .eq("status", "pending")
    .lt("scheduled_for", nextIso)
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (next?.id) {
    await supabaseAdmin.from("message_queue")
      .update({ scheduled_for: nextIso }).eq("id", next.id);
  }
}

// Processa um item da fila, aplicando todos os 10 passos descritos na especificação.
export async function processQueueItem(item: any, ctx: SenderContext): Promise<ProcessOutcome> {
  let ch: any = item.channel;
  const ct: any = item.contact;
  const campaignId: string | null = item.recipient?.campaign_id ?? null;
  const settings = await getSettings(ctx, campaignId);

  // Defesa em profundidade: se a campanha foi pausada/finalizada, não envia.
  if (campaignId) {
    const { data: camp } = await supabaseAdmin
      .from("campaigns").select("status").eq("id", campaignId).maybeSingle();
    if (camp?.status === "done") {
      await supabaseAdmin.from("message_queue")
        .update({ status: "failed", last_error: "Campanha finalizada" }).eq("id", item.id);
      if (item.campaign_recipient_id) {
        await supabaseAdmin.from("campaign_recipients")
          .update({ status: "failed", error: "Campanha finalizada" })
          .eq("id", item.campaign_recipient_id).eq("status", "queued");
      }
      return "skipped";
    }
    if (camp?.status === "paused") {
      await supabaseAdmin.from("message_queue").update({
        status: "pending",
        scheduled_for: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        last_error: "Campanha pausada — reagendado",
      }).eq("id", item.id);
      return "rescheduled";
    }
  }

  // (1+2) Dados básicos + consentimento
  if (!ch || !ct) {
    await supabaseAdmin.from("message_queue")
      .update({ status: "failed", last_error: "canal ou contato ausente" }).eq("id", item.id);
    return "failed";
  }
  if (ct.opt_out_at || !ct.consent) {
    await supabaseAdmin.from("message_queue")
      .update({ status: "failed", last_error: "sem consentimento" }).eq("id", item.id);
    if (item.campaign_recipient_id) {
      await supabaseAdmin.from("campaign_recipients")
        .update({ status: "opted_out" }).eq("id", item.campaign_recipient_id);
    }
    return "skipped";
  }

  // (5/9 — janela da campanha) Se fora da janela configurada, reagenda.
  if (settings) {
    const cw = isWithinCampaignWindow(settings);
    if (!cw.ok) {
      await supabaseAdmin.from("message_queue").update({
        status: "pending",
        scheduled_for: (cw.nextWindow ?? new Date(Date.now() + 30 * 60 * 1000)).toISOString(),
      }).eq("id", item.id);
      return "rescheduled";
    }
  }

  // (3) Seleção/rotação de canal + (10) auto-pause se todos indisponíveis
  if (campaignId && settings) {
    const picked = await pickChannel(ctx, settings, ch.id, campaignId);
    if (!picked) {
      await supabaseAdmin.from("message_queue").update({
        status: "pending",
        scheduled_for: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        last_error: "todos os canais indisponíveis (limite/status)",
      }).eq("id", item.id);
      if (settings.auto_pause_on_all_channels_down) {
        await supabaseAdmin.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
      }
      return "rescheduled";
    }
    if (picked.id !== ch.id) {
      ch = picked;
      await supabaseAdmin.from("message_queue").update({ channel_id: ch.id }).eq("id", item.id);
    }
  }

  // (4) Canal ativo + limite diário
  const sentToday = ch.sent_today_date === ctx.today ? ch.sent_today : 0;
  const dayCap = settings?.max_per_day_per_channel
    ? Math.min(settings.max_per_day_per_channel, ch.daily_limit)
    : ch.daily_limit;
  if (ch.status === "paused" || sentToday >= dayCap) {
    const wait = ch.status === "paused" ? 15 * 60 * 1000 : 60 * 60 * 1000;
    await supabaseAdmin.from("message_queue").update({
      status: "pending", scheduled_for: new Date(Date.now() + wait).toISOString(),
    }).eq("id", item.id);
    return "rescheduled";
  }
  const bh = isWithinBusinessHours(ch.business_hours);
  if (!bh.ok) {
    await supabaseAdmin.from("message_queue").update({
      status: "pending",
      scheduled_for: (bh.nextWindow ?? new Date(Date.now() + 30 * 60 * 1000)).toISOString(),
    }).eq("id", item.id);
    return "rescheduled";
  }

  // Carrega API key (com cache por canal)
  if (!ctx.secret) {
    await supabaseAdmin.from("message_queue").update({
      status: "failed", last_error: "CHANNEL_KEY_SECRET ausente no servidor",
    }).eq("id", item.id);
    if (item.campaign_recipient_id) {
      await supabaseAdmin.from("campaign_recipients").update({
        status: "failed", error: "CHANNEL_KEY_SECRET ausente",
      }).eq("id", item.campaign_recipient_id);
    }
    return "failed";
  }

  let apiKey = ctx.keyCache.get(ch.id) ?? null;
  if (!ctx.keyCache.has(ch.id)) {
    const { data: keyData, error: keyErr } = await supabaseAdmin
      .rpc("get_channel_api_key", { p_channel_id: ch.id, p_secret: ctx.secret });
    apiKey = keyErr ? null : (((keyData as unknown as string) || "").trim() || null);
    ctx.keyCache.set(ch.id, apiKey);
  }
  if (!apiKey) {
    await supabaseAdmin.from("message_queue").update({
      status: "failed", last_error: "Chave da Ziontalk não configurada para este canal",
    }).eq("id", item.id);
    await supabaseAdmin.from("channels").update({
      status: "error", last_error: "Chave da Ziontalk não configurada",
    }).eq("id", ch.id);
    if (item.campaign_recipient_id) {
      await supabaseAdmin.from("campaign_recipients").update({
        status: "failed", error: "Chave da Ziontalk não configurada",
      }).eq("id", item.campaign_recipient_id);
    }
    return "failed";
  }

  // Carrega mídia da campanha (se houver) com cache por campanha
  let media: { url: string; filename: string; mime: string } | null = null;
  if (campaignId) {
    if (ctx.mediaCache.has(campaignId)) {
      media = ctx.mediaCache.get(campaignId) ?? null;
    } else {
      const { data: camp } = await supabaseAdmin
        .from("campaigns")
        .select("media_url, media_filename, media_mime")
        .eq("id", campaignId)
        .maybeSingle();
      media = camp?.media_url
        ? {
            url: camp.media_url as string,
            filename: (camp.media_filename as string) || "anexo",
            mime: (camp.media_mime as string) || "application/octet-stream",
          }
        : null;
      ctx.mediaCache.set(campaignId, media);
    }
  }

  // (6) Envio
  const result = await zionSendMessage({
    apiKey, phone: ct.phone_e164, msg: item.rendered_text, media,
  });

  // (8) Auditoria
  await logSendAttempt({
    channel_id: ch.id, contact_id: ct.id, campaign_id: campaignId,
    http_status: result.status, response_text: result.body,
  });

  if (result.ok) {
    // (7) Atualiza status da fila + canal + recipient
    await supabaseAdmin.from("message_queue")
      .update({ status: "sent", processed_at: new Date().toISOString() }).eq("id", item.id);
    await supabaseAdmin.from("channels").update({
      status: "connected",
      sent_today: sentToday + 1,
      sent_today_date: ctx.today,
      last_error: null,
    }).eq("id", ch.id);
    ctx.channelsCache.set(ch.id, { ...ch, sent_today: sentToday + 1, sent_today_date: ctx.today });

    // Pacing: empurra o próximo item pendente desse chip para respeitar o delay.
    if (settings && (settings.delay_seconds > 0 || settings.random_delay_max > 0)) {
      await pushNextScheduledFor(ch.id, computeNextAvailable(settings));
    }

    if (item.campaign_recipient_id) {
      await supabaseAdmin.from("campaign_recipients").update({
        status: "sent", sent_at: new Date().toISOString(), channel_id: ch.id,
      }).eq("id", item.campaign_recipient_id);
    }
    // garante conversa + mensagem
    const { data: existing } = await supabaseAdmin
      .from("conversations").select("id")
      .eq("contact_id", ct.id).eq("channel_id", ch.id).maybeSingle();
    let convId = existing?.id;
    if (!convId) {
      const { data: newConv } = await supabaseAdmin
        .from("conversations").insert({ contact_id: ct.id, channel_id: ch.id, status: "novo" })
        .select("id").single();
      convId = newConv!.id;
    }
    await supabaseAdmin.from("messages").insert({
      conversation_id: convId, direction: "out", body: item.rendered_text,
      sent_via_channel_id: ch.id, campaign_id: campaignId,
    });
    return "sent";
  }

  // (9) Reagendamento com backoff exponencial
  const attempts = (item.attempts ?? 0) + 1;
  const tooMany = attempts >= 3;
  const backoffMs = Math.min(60_000 * Math.pow(2, attempts), 60 * 60_000);
  await supabaseAdmin.from("message_queue").update({
    status: tooMany ? "failed" : "pending",
    attempts,
    last_error: result.body.slice(0, 500),
    scheduled_for: new Date(Date.now() + backoffMs).toISOString(),
  }).eq("id", item.id);
  if (tooMany && item.campaign_recipient_id) {
    await supabaseAdmin.from("campaign_recipients").update({
      status: "failed", error: result.body.slice(0, 300),
    }).eq("id", item.campaign_recipient_id);
  }
  await supabaseAdmin.from("channels").update({
    status: result.status === 401 ? "error" : ch.status,
    last_error: result.body.slice(0, 500),
  }).eq("id", ch.id);
  return "failed";
}