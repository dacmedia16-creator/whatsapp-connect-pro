import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertManager(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const roles = new Set((data ?? []).map((r) => r.role));
  if (!roles.has("admin") && !roles.has("gestor")) {
    throw new Error("Sem permissão");
  }
}

const DEFAULTS = {
  rotation_mode: "round_robin" as const,
  selected_channel_ids: [] as string[],
  channel_priority: [] as string[],
  delay_seconds: 30,
  random_delay_min: null as number | null,
  random_delay_max: null as number | null,
  max_per_minute: 20,
  max_per_hour: 200,
  max_per_day_per_channel: 500,
  allowed_start_time: "09:00",
  allowed_end_time: "18:00",
  allowed_weekdays: [1, 2, 3, 4, 5],
  timezone: "America/Sao_Paulo",
  auto_pause_outside_hours: true,
  auto_pause_on_all_channels_down: true,
  batch_mode: false,
  batch_pause_seconds: 60 as number | null,
};

export const getSendSettingsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { data: row } = await supabaseAdmin
      .from("campaign_send_settings")
      .select("*")
      .eq("campaign_id", data.campaignId)
      .maybeSingle();
    return row ?? { campaign_id: data.campaignId, ...DEFAULTS };
  });

const settingsInput = z.object({
  campaignId: z.string().uuid(),
  selected_channel_ids: z.array(z.string().uuid()).max(50),
  rotation_mode: z.enum(["round_robin", "least_used", "manual_priority"]),
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
    const { error } = await supabaseAdmin
      .from("campaign_send_settings")
      .upsert({ campaign_id: campaignId, ...fields }, { onConflict: "campaign_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getSendPanelOverviewFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid().nullable().optional() }).parse(i))
  .handler(async ({ data }) => {
    const campaignId = data.campaignId ?? null;
    let queueQ = supabaseAdmin.from("message_queue").select("status", { count: "exact", head: false });
    if (campaignId) {
      // join via campaign_recipient -> campaign filter
      const { data: recs } = await supabaseAdmin
        .from("campaign_recipients")
        .select("id")
        .eq("campaign_id", campaignId);
      const ids = (recs ?? []).map((r) => r.id);
      if (!ids.length) {
        return { total: 0, pending: 0, sent: 0, failed: 0, processing: 0, activeChannels: 0, ratePerMin: 0 };
      }
      queueQ = queueQ.in("campaign_recipient_id", ids);
    }
    const { data: rows } = await queueQ.limit(10000);
    const counts = { pending: 0, sent: 0, failed: 0, processing: 0 };
    (rows ?? []).forEach((r: { status: string }) => {
      if (r.status in counts) counts[r.status as keyof typeof counts]++;
    });

    const { count: activeChannels } = await supabaseAdmin
      .from("channels").select("*", { count: "exact", head: true })
      .eq("status", "connected");

    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    let logsQ = supabaseAdmin.from("send_logs").select("*", { count: "exact", head: true })
      .gte("created_at", oneMinAgo).gte("http_status", 200).lt("http_status", 300);
    if (campaignId) logsQ = logsQ.eq("campaign_id", campaignId);
    const { count: ratePerMin } = await logsQ;

    const total = counts.pending + counts.sent + counts.failed + counts.processing;
    return { total, ...counts, activeChannels: activeChannels ?? 0, ratePerMin: ratePerMin ?? 0 };
  });

export const getChannelsHealthFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: channels } = await supabaseAdmin
      .from("channels")
      .select("id, label, phone_e164, status, daily_limit, sent_today, sent_today_date, last_error")
      .order("label");
    if (!channels?.length) return [];
    const ids = channels.map((c) => c.id);
    const { data: lastLogs } = await supabaseAdmin
      .from("send_logs")
      .select("channel_id, created_at")
      .in("channel_id", ids)
      .order("created_at", { ascending: false })
      .limit(500);
    const lastByCh = new Map<string, string>();
    (lastLogs ?? []).forEach((l) => {
      if (l.channel_id && !lastByCh.has(l.channel_id)) lastByCh.set(l.channel_id, l.created_at);
    });
    const today = new Date().toISOString().slice(0, 10);
    return channels.map((c) => {
      const sentToday = c.sent_today_date === today ? c.sent_today : 0;
      return {
        ...c,
        sent_today_effective: sentToday,
        remaining_today: Math.max(0, c.daily_limit - sentToday),
        last_sent_at: lastByCh.get(c.id) ?? null,
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

    // Quando pausa/finaliza, drena a fila para parar envios imediatamente.
    if (data.status === "paused" || data.status === "done") {
      const { data: recs } = await supabaseAdmin
        .from("campaign_recipients").select("id").eq("campaign_id", data.campaignId);
      const ids = (recs ?? []).map((r) => r.id);
      if (ids.length) {
        const reason = data.status === "paused"
          ? "Campanha pausada pelo gestor"
          : "Campanha finalizada pelo gestor";
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
    const { data: recs } = await supabaseAdmin.from("campaign_recipients").select("id").eq("campaign_id", data.campaignId);
    const ids = (recs ?? []).map((r) => r.id);
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
      .select("campaign_recipient_id, status, attempts, scheduled_for, processed_at, last_error")
      .in("campaign_recipient_id", ids);
    const qMap = new Map<string, any>();
    (queue ?? []).forEach((q) => { if (q.campaign_recipient_id) qMap.set(q.campaign_recipient_id, q); });
    return recs.map((r) => {
      const q = qMap.get(r.id);
      return {
        id: r.id,
        name: (r.contact as any)?.name ?? "—",
        phone: (r.contact as any)?.phone_e164 ?? "",
        channel: (r.channel as any)?.label ?? "—",
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
