import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SEND_SETTINGS_DEFAULTS, normalizeSendSettings } from "./send-settings-defaults";
import { pickChannelForEnqueue } from "@/lib/send/channel-selector.server";

async function assertManager(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const roles = new Set((data ?? []).map((r) => r.role));
  if (!roles.has("admin") && !roles.has("gestor")) {
    throw new Error("Sem permissão");
  }
}

export const getSendSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("campaign_send_settings")
      .select("*")
      .eq("campaign_id", data.campaignId)
      .maybeSingle();
    // Fonte única: se não existe linha, materializa defaults canônicos no banco
    // para que sender/enqueue/UI leiam exatamente os mesmos valores.
    if (!row) {
      const seeded = { campaign_id: data.campaignId, ...SEND_SETTINGS_DEFAULTS };
      await supabaseAdmin
        .from("campaign_send_settings")
        .upsert(seeded, { onConflict: "campaign_id" });
      return { campaign_id: data.campaignId, ...SEND_SETTINGS_DEFAULTS };
    }
    // Nunca devolve rotation_cursor para o cliente (estado interno do sender).
    const normalized = normalizeSendSettings(row);
    return { campaign_id: data.campaignId, ...normalized };
  });

const settingsInput = z.object({
  campaignId: z.string().uuid(),
  selected_channel_ids: z.array(z.string().uuid()).max(50),
  rotation_mode: z.enum(["round_robin", "least_used", "manual_priority", "simple_call"]),
  channel_priority: z.array(z.string().uuid()).max(50),
  delay_seconds: z.number().int().min(0).max(3600),
  random_delay_min: z.number().int().min(0).max(3600).nullable(),
  random_delay_max: z.number().int().min(0).max(3600).nullable(),
  max_per_minute: z.number().int().min(1).max(600),
  max_per_hour: z.number().int().min(1).max(10000),
  max_per_day_per_channel: z.number().int().min(1).max(100000),
  allowed_start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  allowed_end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  allowed_weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  timezone: z.string().min(1).max(64),
  auto_pause_outside_hours: z.boolean(),
  auto_pause_on_all_channels_down: z.boolean(),
  batch_mode: z.boolean(),
  batch_pause_seconds: z.number().int().min(0).max(86400).nullable(),
});

export const upsertSendSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => settingsInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    const { campaignId, ...fields } = data;
    // Garante que channel_priority é subconjunto de selected_channel_ids e mantém a ordem.
    const selected = new Set(fields.selected_channel_ids);
    const filteredPriority = fields.channel_priority.filter((id) => selected.has(id));
    const missing = fields.selected_channel_ids.filter((id) => !filteredPriority.includes(id));
    const safePriority = [...filteredPriority, ...missing];
    // random_delay coerência
    if (fields.random_delay_min != null && fields.random_delay_max != null
      && fields.random_delay_min > fields.random_delay_max) {
      throw new Error("Delay aleatório: mínimo não pode ser maior que máximo");
    }
    if (fields.allowed_start_time >= fields.allowed_end_time) {
      throw new Error("Horário inicial deve ser menor que o final");
    }
    const { error } = await supabaseAdmin
      .from("campaign_send_settings")
      .upsert({ campaign_id: campaignId, ...fields, channel_priority: safePriority }, { onConflict: "campaign_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSendPanelOverviewFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid().nullable().optional() }).parse(i))
  .handler(async ({ data }) => {
    const campaignId = data.campaignId ?? null;
    // Fonte única de verdade: campaign_recipients (mesmo que Dashboard e Relatórios).
    // message_queue é detalhe de processamento; recipients é o que conta.
    const counts = { pending: 0, sent: 0, failed: 0, processing: 0 };
    let total = 0;
    if (campaignId) {
      const [totalQ, sentQ, failedQ, queuedQ] = await Promise.all([
        supabaseAdmin.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId),
        supabaseAdmin.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "sent"),
        supabaseAdmin.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "failed"),
        supabaseAdmin.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "queued"),
      ]);
      total = totalQ.count ?? 0;
      counts.sent = sentQ.count ?? 0;
      counts.failed = failedQ.count ?? 0;
      counts.pending = queuedQ.count ?? 0;
      // "processing" = itens da fila em andamento agora para essa campanha
      const { data: recs } = await supabaseAdmin
        .from("campaign_recipients").select("id").eq("campaign_id", campaignId).eq("status", "queued");
      const recIds = (recs ?? []).map((r) => r.id);
      if (recIds.length) {
        const { count: proc } = await supabaseAdmin
          .from("message_queue").select("*", { count: "exact", head: true })
          .eq("status", "processing").in("campaign_recipient_id", recIds);
        counts.processing = proc ?? 0;
      }
    } else {
      const [totalQ, sentQ, failedQ, queuedQ] = await Promise.all([
        supabaseAdmin.from("campaign_recipients").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("status", "sent"),
        supabaseAdmin.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("status", "failed"),
        supabaseAdmin.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("status", "queued"),
      ]);
      total = totalQ.count ?? 0;
      counts.sent = sentQ.count ?? 0;
      counts.failed = failedQ.count ?? 0;
      counts.pending = queuedQ.count ?? 0;
    }

    const { count: activeChannels } = await supabaseAdmin
      .from("channels").select("*", { count: "exact", head: true })
      .eq("status", "connected");

    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    let logsQ = supabaseAdmin.from("send_logs").select("*", { count: "exact", head: true })
      .gte("created_at", oneMinAgo).gte("http_status", 200).lt("http_status", 300);
    if (campaignId) logsQ = logsQ.eq("campaign_id", campaignId);
    const { count: ratePerMin } = await logsQ;

    return { total, ...counts, activeChannels: activeChannels ?? 0, ratePerMin: ratePerMin ?? 0 };
  });

export const getChannelsHealthFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid().nullable().optional() }).optional().parse(i ?? {}))
  .handler(async ({ data }) => {
    const campaignId = data?.campaignId ?? null;
    const { data: channels } = await supabaseAdmin
      .from("channels")
      .select("id, label, phone_e164, status, daily_limit, sent_today, sent_today_date, last_error")
      .order("label");
    if (!channels?.length) return [];
    const ids = channels.map((c) => c.id);
    let lastLogsQ = supabaseAdmin
      .from("send_logs")
      .select("channel_id, created_at")
      .in("channel_id", ids)
      .order("created_at", { ascending: false })
      .limit(500);
    if (campaignId) lastLogsQ = lastLogsQ.eq("campaign_id", campaignId);
    const { data: lastLogs } = await lastLogsQ;
    const lastByCh = new Map<string, string>();
    (lastLogs ?? []).forEach((l) => {
      if (l.channel_id && !lastByCh.has(l.channel_id)) lastByCh.set(l.channel_id, l.created_at);
    });
    const today = new Date().toISOString().slice(0, 10);
    // Quando há campanha, calcula consumo de hoje por (canal, campanha) via send_logs 2xx.
    const usageByChannel = new Map<string, number>();
    if (campaignId) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const { data: usageRows } = await supabaseAdmin
        .from("send_logs")
        .select("channel_id")
        .eq("campaign_id", campaignId)
        .in("channel_id", ids)
        .gte("created_at", todayStart.toISOString())
        .gte("http_status", 200)
        .lt("http_status", 300);
      (usageRows ?? []).forEach((r: any) => {
        if (r.channel_id) usageByChannel.set(r.channel_id, (usageByChannel.get(r.channel_id) ?? 0) + 1);
      });
    }
    return channels.map((c) => {
      const sentToday = c.sent_today_date === today ? c.sent_today : 0;
      const sentTodayCampaign = campaignId ? (usageByChannel.get(c.id) ?? 0) : null;
      return {
        ...c,
        sent_today_effective: sentToday,
        sent_today_campaign: sentTodayCampaign,
        remaining_today: Math.max(0, c.daily_limit - sentToday),
        last_sent_at: lastByCh.get(c.id) ?? null,
        scope: campaignId ? ("campaign" as const) : ("global" as const),
      };
    });
  });

export const pauseChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ channelId: z.string().uuid(), pause: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    const { error } = await supabaseAdmin
      .from("channels")
      .update({ status: data.pause ? "paused" : "connected" })
      .eq("id", data.channelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setCampaignStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    campaignId: z.string().uuid(),
    status: z.enum(["draft", "scheduled", "running", "paused", "done"]),
  }).parse(i))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    const { error } = await supabaseAdmin.from("campaigns").update({ status: data.status }).eq("id", data.campaignId);
    if (error) throw new Error(error.message);

    if (data.status === "paused") {
      // Pause REAL: NÃO marca failed. Reagenda itens pending para +5min
      // para tirar pressão do worker; itens "processing" já estão em mid-flight.
      // O sender também checa status='paused' como defesa em profundidade.
      const { data: recs } = await supabaseAdmin
        .from("campaign_recipients").select("id").eq("campaign_id", data.campaignId);
      const ids = (recs ?? []).map((r) => r.id);
      if (ids.length) {
        await supabaseAdmin.from("message_queue")
          .update({
            scheduled_for: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            last_error: "Campanha pausada — reagendado",
          })
          .eq("status", "pending")
          .in("campaign_recipient_id", ids);
      }
    } else if (data.status === "running") {
      // Retomar: traz itens reagendados para a frente.
      const { data: recs } = await supabaseAdmin
        .from("campaign_recipients").select("id").eq("campaign_id", data.campaignId);
      const ids = (recs ?? []).map((r) => r.id);
      if (ids.length) {
        await supabaseAdmin.from("message_queue")
          .update({ scheduled_for: new Date().toISOString(), last_error: null })
          .eq("status", "pending")
          .in("campaign_recipient_id", ids);
      }
    } else if (data.status === "done") {
      // Cancelar/finalizar: drena fila e marca recipients restantes como failed.
      const { data: recs } = await supabaseAdmin
        .from("campaign_recipients").select("id").eq("campaign_id", data.campaignId);
      const ids = (recs ?? []).map((r) => r.id);
      if (ids.length) {
        const reason = "Campanha finalizada pelo gestor";
        await supabaseAdmin.from("message_queue")
          .update({ status: "failed", last_error: reason })
          .in("status", ["pending", "processing"])
          .in("campaign_recipient_id", ids);
        await supabaseAdmin.from("campaign_recipients")
          .update({ status: "failed", error: reason })
          .eq("campaign_id", data.campaignId)
          .eq("status", "queued");
      }
    }
    return { ok: true };
  });

export const requeueFailedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    // Revalida consent/opt-out antes de reenfileirar: contato pode ter saído depois.
    const { data: recs } = await supabaseAdmin
      .from("campaign_recipients")
      .select("id, contact:contacts(consent, opt_out_at)")
      .eq("campaign_id", data.campaignId);
    const eligible = (recs ?? []).filter((r: any) => {
      const c = r.contact;
      return c && c.consent && !c.opt_out_at;
    });
    const blocked = (recs ?? []).filter((r: any) => {
      const c = r.contact;
      return !c || !c.consent || c.opt_out_at;
    });
    const ids = eligible.map((r: any) => r.id);
    // Marca os bloqueados como opted_out explicitamente para não voltarem.
    if (blocked.length) {
      await supabaseAdmin.from("campaign_recipients")
        .update({ status: "opted_out", error: "Sem consentimento ou opt-out — bloqueado no requeue" })
        .in("id", blocked.map((r: any) => r.id));
    }
    if (!ids.length) return { requeued: 0 };
    const { data: updated, error } = await supabaseAdmin
      .from("message_queue")
      .update({ status: "pending", attempts: 0, scheduled_for: new Date().toISOString(), last_error: null })
      .eq("status", "failed")
      .in("campaign_recipient_id", ids)
      .select("id");
    if (error) throw new Error(error.message);
    return { requeued: updated?.length ?? 0 };
  });

export const requeueRecipientFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ recipientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    // Revalida consent/opt-out antes de reenfileirar.
    const { data: rec } = await supabaseAdmin
      .from("campaign_recipients")
      .select("id, contact:contacts(consent, opt_out_at)")
      .eq("id", data.recipientId)
      .maybeSingle();
    const c = (rec as any)?.contact;
    if (!c || !c.consent || c.opt_out_at) {
      await supabaseAdmin.from("campaign_recipients")
        .update({ status: "opted_out", error: "Sem consentimento ou opt-out — bloqueado no requeue" })
        .eq("id", data.recipientId);
      throw new Error("Contato sem consentimento ou com opt-out — requeue bloqueado");
    }
    const { error } = await supabaseAdmin
      .from("message_queue")
      .update({ status: "pending", attempts: 0, scheduled_for: new Date().toISOString(), last_error: null })
      .eq("campaign_recipient_id", data.recipientId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("campaign_recipients").update({ status: "queued", error: null }).eq("id", data.recipientId);
    return { ok: true };
  });

export const markIgnoredFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ recipientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    await supabaseAdmin.from("campaign_recipients").update({ status: "opted_out", error: "Marcado como ignorado" }).eq("id", data.recipientId);
    await supabaseAdmin.from("message_queue").update({ status: "failed", last_error: "Ignorado pelo gestor" }).eq("campaign_recipient_id", data.recipientId).in("status", ["pending", "processing"]);
    return { ok: true };
  });

export const getQueueRowsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    campaignId: z.string().uuid(),
    limit: z.number().int().min(1).max(500).optional(),
  }).parse(i))
  .handler(async ({ data }) => {
    const { data: recs } = await supabaseAdmin
      .from("campaign_recipients")
      .select("id, status, error, sent_at, channel_id, contact:contacts(name, phone_e164), channel:channels(label)")
      .eq("campaign_id", data.campaignId)
      .order("sent_at", { ascending: false, nullsFirst: true })
      .limit(data.limit ?? 200);
    if (!recs?.length) return [];
    const ids = recs.map((r) => r.id);
    const { data: queue } = await supabaseAdmin
      .from("message_queue")
      .select("campaign_recipient_id, status, attempts, scheduled_for, processed_at, last_error, planned_channel_id, actual_channel_id, channel_selection_reason, fallback_used")
      .in("campaign_recipient_id", ids);
    const qMap = new Map<string, any>();
    (queue ?? []).forEach((q) => { if (q.campaign_recipient_id) qMap.set(q.campaign_recipient_id, q); });
    // Resolve labels para planned/actual em uma única query.
    const channelIds = new Set<string>();
    (queue ?? []).forEach((q: any) => {
      if (q.planned_channel_id) channelIds.add(q.planned_channel_id);
      if (q.actual_channel_id) channelIds.add(q.actual_channel_id);
    });
    const labelMap = new Map<string, string>();
    if (channelIds.size) {
      const { data: chs } = await supabaseAdmin
        .from("channels").select("id, label").in("id", Array.from(channelIds));
      (chs ?? []).forEach((c: any) => labelMap.set(c.id, c.label));
    }
    return recs.map((r) => {
      const q = qMap.get(r.id);
      const plannedId = q?.planned_channel_id ?? null;
      const actualId = q?.actual_channel_id ?? r.channel_id ?? null;
      return {
        id: r.id,
        name: (r.contact as any)?.name ?? "—",
        phone: (r.contact as any)?.phone_e164 ?? "",
        channel: (r.channel as any)?.label ?? "—",
        planned_channel: plannedId ? (labelMap.get(plannedId) ?? "—") : null,
        actual_channel: actualId ? (labelMap.get(actualId) ?? (r.channel as any)?.label ?? "—") : null,
        selection_reason: q?.channel_selection_reason ?? null,
        fallback_used: !!q?.fallback_used,
        chip_diverged: !!(plannedId && actualId && plannedId !== actualId),
        status: q?.status ?? r.status,
        attempts: q?.attempts ?? 0,
        last_attempt_at: q?.processed_at ?? r.sent_at ?? null,
        next_attempt_at: q?.scheduled_for ?? null,
        error: q?.last_error ?? r.error ?? null,
      };
    });
  });

export const getLiveActivityFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid().nullable().optional() }).parse(i))
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("send_logs")
      .select("id, http_status, response_text, created_at, channel:channels(label), contact:contacts(name, phone_e164), campaign_id")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.campaignId) q = q.eq("campaign_id", data.campaignId);
    const { data: rows } = await q;
    return rows ?? [];
  });

// =============================================================================
// Dry-run / simulação. NÃO envia, NÃO grava em message_queue.
// Para cada destinatário elegível, executa pickChannelForEnqueue e relata o que
// aconteceria, ajudando o gestor a auditar antes de iniciar a campanha real.
// =============================================================================
export const simulateCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);
    const { data: settingsRow } = await supabaseAdmin
      .from("campaign_send_settings").select("*").eq("campaign_id", data.campaignId).maybeSingle();
    const settings = normalizeSendSettings(settingsRow);
    if (!settings.selected_channel_ids.length) {
      return { ok: false, reason: "Nenhum canal selecionado em campaign_send_settings", rows: [], summary: null };
    }
    const { data: channels } = await supabaseAdmin
      .from("channels")
      .select("id, label, status, daily_limit, sent_today, sent_today_date")
      .in("id", settings.selected_channel_ids);
    const channelsForPick = (channels ?? []).map((c: any) => ({
      id: c.id, status: c.status, daily_limit: c.daily_limit,
      sent_today: c.sent_today ?? 0, sent_today_date: c.sent_today_date,
    }));
    const labelById = new Map<string, string>((channels ?? []).map((c: any) => [c.id, c.label]));
    const { data: recs } = await supabaseAdmin
      .from("campaign_recipients")
      .select("id, status, contact:contacts(id, name, phone_e164, consent, opt_out_at)")
      .eq("campaign_id", data.campaignId)
      .limit(2000);
    const today = new Date().toISOString().slice(0, 10);
    const cursor = { value: Number((settingsRow as any)?.rotation_cursor ?? 0) || 0 };
    const localUsage = new Map<string, number>();

    const summary = { total: 0, would_send: 0, blocked_no_consent: 0, blocked_opt_out: 0, blocked_no_channel: 0 };
    const rows = (recs ?? []).map((r: any) => {
      summary.total++;
      const c = r.contact;
      if (!c) {
        summary.blocked_no_channel++;
        return { id: r.id, name: "—", phone: "—", status: "blocked_no_channel", planned_channel: null, reason: "contato ausente" };
      }
      if (c.opt_out_at) {
        summary.blocked_opt_out++;
        return { id: r.id, name: c.name, phone: c.phone_e164, status: "blocked_opt_out", planned_channel: null, reason: "opt-out" };
      }
      if (!c.consent) {
        summary.blocked_no_consent++;
        return { id: r.id, name: c.name, phone: c.phone_e164, status: "blocked_no_consent", planned_channel: null, reason: "sem consentimento" };
      }
      const picked = pickChannelForEnqueue({
        settings: { ...SEND_SETTINGS_DEFAULTS, ...settings, rotation_cursor: cursor.value } as any,
        channels: channelsForPick, today, cursor: cursor.value, localUsage,
      });
      if (!picked) {
        summary.blocked_no_channel++;
        return { id: r.id, name: c.name, phone: c.phone_e164, status: "blocked_no_channel", planned_channel: null, reason: "nenhum canal disponível" };
      }
      cursor.value = picked.next_cursor;
      summary.would_send++;
      return {
        id: r.id, name: c.name, phone: c.phone_e164,
        status: "would_send",
        planned_channel: labelById.get(picked.channel_id) ?? picked.channel_id,
        reason: picked.reason + (picked.fallback ? " (fallback)" : ""),
      };
    });
    return { ok: true, reason: null, rows, summary };
  });
