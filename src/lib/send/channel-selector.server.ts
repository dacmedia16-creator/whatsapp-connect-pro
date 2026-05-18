import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recentSends } from "./rate-limit.server";

// Contexto compartilhado entre iterações de um mesmo batch: caches e cursor de RR.
export type SelectorContext = {
  settingsCache: Map<string, any>;
  channelsCache: Map<string, any>;
  rrCursor: Map<string, number>;
  today: string;
};

export function createSelectorContext(): SelectorContext {
  return {
    settingsCache: new Map(),
    channelsCache: new Map(),
    rrCursor: new Map(),
    today: new Date().toISOString().slice(0, 10),
  };
}

export async function getSettings(ctx: SelectorContext, campaignId: string | null) {
  if (!campaignId) return null;
  if (ctx.settingsCache.has(campaignId)) return ctx.settingsCache.get(campaignId);
  const { data } = await supabaseAdmin
    .from("campaign_send_settings").select("*").eq("campaign_id", campaignId).maybeSingle();
  ctx.settingsCache.set(campaignId, data ?? null);
  return data ?? null;
}

export async function getChannel(ctx: SelectorContext, id: string) {
  if (ctx.channelsCache.has(id)) return ctx.channelsCache.get(id);
  const { data } = await supabaseAdmin.from("channels").select("*").eq("id", id).maybeSingle();
  ctx.channelsCache.set(id, data);
  return data;
}

// Seleciona um canal válido respeitando settings (rotação, limites/min, /hora, /dia, status).
export async function pickChannel(
  ctx: SelectorContext,
  settings: any,
  currentChannelId: string,
  campaignId: string,
) {
  const selected: string[] = (settings?.selected_channel_ids ?? []).filter(Boolean);
  const allowed = selected.length ? selected : [currentChannelId];
  const mode = settings?.rotation_mode ?? "round_robin";
  const candidates: string[] = [];

  if (mode === "manual_priority" && Array.isArray(settings?.channel_priority) && settings.channel_priority.length) {
    candidates.push(...settings.channel_priority.filter((id: string) => allowed.includes(id)));
  } else if (mode === "round_robin") {
    const idx = (ctx.rrCursor.get(campaignId) ?? 0) % allowed.length;
    candidates.push(...allowed.slice(idx), ...allowed.slice(0, idx));
    ctx.rrCursor.set(campaignId, idx + 1);
  } else {
    // least_used: ordena por sent_today crescente
    const withUsage = await Promise.all(
      allowed.map(async (id) => ({ id, used: ((await getChannel(ctx, id))?.sent_today) ?? 0 })),
    );
    withUsage.sort((a, b) => a.used - b.used);
    candidates.push(...withUsage.map((x) => x.id));
  }

  for (const cid of candidates) {
    const ch = await getChannel(ctx, cid);
    if (!ch) continue;
    if (ch.status === "paused" || ch.status === "error") continue;
    const maxDay = settings?.max_per_day_per_channel ?? ch.daily_limit;
    const sentToday = ch.sent_today_date === ctx.today ? ch.sent_today : 0;
    if (sentToday >= Math.min(maxDay, ch.daily_limit)) continue;
    if (settings?.max_per_minute && (await recentSends(cid, 60_000)) >= settings.max_per_minute) continue;
    if (settings?.max_per_hour && (await recentSends(cid, 3_600_000)) >= settings.max_per_hour) continue;
    return ch;
  }
  return null;
}