import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recentSends, lastSendAt } from "./rate-limit.server";
import { normalizeSendSettings, type SendSettings } from "@/lib/send-settings-defaults";

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

// Tipos de retorno detalhados para podermos registrar motivo da escolha.
export type PickResult = {
  channel: any;
  reason: string;       // "rotation:round_robin" | "rotation:least_used" | "rotation:manual_priority"
  fallback: boolean;    // true quando o canal escolhido NÃO foi o que a regra principal indicava
  intended_id: string | null; // canal que a regra principal indicava (pode estar bloqueado por limite/status)
};

// Quando pickChannel não consegue escolher canal, devolvemos o MOTIVO em vez
// de null plano, para o sender decidir se pausa a campanha (chip caído/limite
// atingido) ou só reagenda o item (pacing temporário — esperando delay).
export type PickFailure = {
  channel: null;
  failure: "all_channels_down" | "pacing_wait";
  retryAfterMs: number; // sugestão de quando tentar de novo (mínimo entre os candidatos em pacing)
};

export type PickOutcome = PickResult | PickFailure;

// Seleciona um canal válido respeitando settings (rotação, limites/min, /hora, /dia, status).
// Retorna PickResult com motivo e fallback. NÃO altera estado se já estávamos no canal
// intended; quando precisamos pular para um secundário, marca fallback=true.
export async function pickChannel(
  ctx: SelectorContext,
  settings: any,
  currentChannelId: string,
  campaignId: string,
): Promise<PickOutcome> {
  // Modo "Chama Simples": ciclo fixo 1-por-canal, 15s entre canais,
  // ignora max_per_minute/max_per_hour/batch_mode/random_delay.
  if (settings?.rotation_mode === "simple_call") {
    settings = {
      ...settings,
      rotation_mode: "round_robin",
      delay_seconds: 15,
      random_delay_min: null,
      random_delay_max: null,
      max_per_minute: null,
      max_per_hour: null,
      batch_mode: false,
    };
  }
  const selected: string[] = (settings?.selected_channel_ids ?? []).filter(Boolean);
  const allowed = selected.length ? selected : [currentChannelId];
  const mode = settings?.rotation_mode ?? "round_robin";
  const candidates: string[] = [];
  let intendedId: string | null = null;

  if (mode === "manual_priority" && Array.isArray(settings?.channel_priority) && settings.channel_priority.length) {
    const ordered = settings.channel_priority.filter((id: string) => allowed.includes(id));
    intendedId = ordered[0] ?? null;
    candidates.push(...ordered);
  } else if (mode === "round_robin") {
    // Cursor persistido por campanha: na primeira chamada do batch, lê do banco
    // (settings.rotation_cursor); chamadas seguintes usam o cache em memória.
    let cursor = ctx.rrCursor.get(campaignId);
    if (cursor === undefined) {
      cursor = Number(settings?.rotation_cursor ?? 0) || 0;
    }
    const idx = ((cursor % allowed.length) + allowed.length) % allowed.length;
    intendedId = allowed[idx] ?? null;
    candidates.push(...allowed.slice(idx), ...allowed.slice(0, idx));
  } else {
    // least_used: ordena por sent_today crescente
    const withUsage = await Promise.all(
      allowed.map(async (id) => ({ id, used: ((await getChannel(ctx, id))?.sent_today) ?? 0 })),
    );
    withUsage.sort((a, b) => a.used - b.used);
    intendedId = withUsage[0]?.id ?? null;
    candidates.push(...withUsage.map((x) => x.id));
  }

  // Rastreia, entre os candidatos rejeitados, se TODOS foram bloqueados por
  // motivos "duros" (status/limite diário/limites por minuto/hora) ou se algum
  // foi bloqueado apenas por pacing (delay_seconds). Isso decide se devemos
  // pausar a campanha ou apenas reagendar o item.
  let anyPacingOnly = false;
  let minPacingWaitMs = Number.POSITIVE_INFINITY;

  for (const cid of candidates) {
    const ch = await getChannel(ctx, cid);
    if (!ch) continue;
    if (ch.status === "paused" || ch.status === "error") continue;
    const maxDay = settings?.max_per_day_per_channel ?? ch.daily_limit;
    const sentToday = ch.sent_today_date === ctx.today ? ch.sent_today : 0;
    if (sentToday >= Math.min(maxDay, ch.daily_limit)) continue;
    // Limites são POR CAMPANHA — escopa send_logs para não vazar entre campanhas.
    // Atingir max_per_minute/hour é considerado pacing temporário (não pausa).
    if (settings?.max_per_minute && (await recentSends(cid, 60_000, campaignId)) >= settings.max_per_minute) {
      anyPacingOnly = true;
      minPacingWaitMs = Math.min(minPacingWaitMs, 60_000);
      continue;
    }
    if (settings?.max_per_hour && (await recentSends(cid, 3_600_000, campaignId)) >= settings.max_per_hour) {
      anyPacingOnly = true;
      minPacingWaitMs = Math.min(minPacingWaitMs, 5 * 60_000);
      continue;
    }
    // Pacing por chip: respeita delay_seconds (com jitter, se configurado)
    const minGapSec = Math.max(
      Number(settings?.delay_seconds ?? 0) || 0,
      Number(settings?.random_delay_min ?? 0) || 0,
    );
    if (minGapSec > 0) {
      const last = await lastSendAt(cid);
      if (last && Date.now() - last.getTime() < minGapSec * 1000) {
        anyPacingOnly = true;
        const waitMs = minGapSec * 1000 - (Date.now() - last.getTime());
        minPacingWaitMs = Math.min(minPacingWaitMs, Math.max(1000, waitMs));
        continue;
      }
    }
    // Avança cursor apenas no modo round_robin e somente quando um chip
    // é efetivamente retornado (evita pular posições em retries vazios).
    if (mode === "round_robin") {
      const pickedIdx = allowed.indexOf(cid);
      const nextCursor = (pickedIdx + 1) % allowed.length;
      ctx.rrCursor.set(campaignId, nextCursor);
      // Persiste no banco para sobreviver entre execuções do cron.
      await supabaseAdmin
        .from("campaign_send_settings")
        .update({ rotation_cursor: nextCursor })
        .eq("campaign_id", campaignId);
      // Mantém o settingsCache em sincronia para chamadas seguintes neste batch.
      const cached = ctx.settingsCache.get(campaignId);
      if (cached) cached.rotation_cursor = nextCursor;
    }
    return {
      channel: ch,
      reason: `rotation:${mode}`,
      fallback: intendedId !== null && cid !== intendedId,
      intended_id: intendedId,
    };
  }
  if (anyPacingOnly) {
    return {
      channel: null,
      failure: "pacing_wait",
      retryAfterMs: Number.isFinite(minPacingWaitMs) ? minPacingWaitMs : 30_000,
    };
  }
  return { channel: null, failure: "all_channels_down", retryAfterMs: 10 * 60_000 };
}

// ===========================================================================
// pickChannelForEnqueue: versão "previsão" usada no momento do enqueue.
// NÃO consulta send_logs (custoso) e NÃO persiste cursor — apenas decide o
// canal planejado a partir das mesmas regras que pickChannel usaria em
// runtime. Recebe um cursor local (mantido pelo chamador) para round-robin.
// Retorna o id do canal escolhido + motivo. Se nenhum candidato passar nos
// filtros básicos (status/limite diário), devolve null.
// ===========================================================================
export type EnqueuePickInput = {
  settings: SendSettings & { rotation_cursor?: number };
  channels: Array<{ id: string; status: string; daily_limit: number; sent_today: number; sent_today_date: string | null }>;
  today: string;       // YYYY-MM-DD em UTC, igual ao usado no sender
  cursor: number;      // posição atual para round_robin (mutável fora; o chamador atualiza)
  localUsage: Map<string, number>; // contador local para least_used
};

export type EnqueuePickOutput = {
  channel_id: string;
  reason: string;
  intended_channel_id: string | null;
  fallback: boolean;
  next_cursor: number; // novo cursor (igual ao recebido se modo != round_robin)
};

export function pickChannelForEnqueue(input: EnqueuePickInput): EnqueuePickOutput | null {
  const s = normalizeSendSettings(input.settings);
  const selected = s.selected_channel_ids.length
    ? s.selected_channel_ids
    : input.channels.map((c) => c.id);
  const allowed = input.channels.filter((c) => selected.includes(c.id));
  if (!allowed.length) return null;

  const isAvailable = (c: typeof allowed[number]) => {
    if (c.status === "paused" || c.status === "error") return false;
    const sentToday = c.sent_today_date === input.today ? c.sent_today : 0;
    const cap = Math.min(s.max_per_day_per_channel, c.daily_limit);
    return sentToday < cap;
  };

  const mode = s.rotation_mode;
  let intendedId: string | null = null;
  let ordered: string[] = [];

  if (mode === "manual_priority") {
    ordered = s.channel_priority.filter((id) => allowed.some((c) => c.id === id));
    if (!ordered.length) ordered = allowed.map((c) => c.id);
    intendedId = ordered[0] ?? null;
  } else if (mode === "round_robin") {
    const ids = allowed.map((c) => c.id);
    const idx = ((input.cursor % ids.length) + ids.length) % ids.length;
    intendedId = ids[idx];
    ordered = [...ids.slice(idx), ...ids.slice(0, idx)];
  } else {
    // least_used: usa contador local + sent_today efetivo do banco
    const withUsage = allowed.map((c) => ({
      id: c.id,
      used: (input.localUsage.get(c.id) ?? 0) + (c.sent_today_date === input.today ? c.sent_today : 0),
    }));
    withUsage.sort((a, b) => a.used - b.used);
    intendedId = withUsage[0]?.id ?? null;
    ordered = withUsage.map((x) => x.id);
  }

  for (const cid of ordered) {
    const ch = allowed.find((c) => c.id === cid)!;
    if (!isAvailable(ch)) continue;
    // atualiza cursor/usage
    let nextCursor = input.cursor;
    if (mode === "round_robin") {
      const ids = allowed.map((c) => c.id);
      nextCursor = (ids.indexOf(cid) + 1) % ids.length;
    }
    if (mode === "least_used") {
      input.localUsage.set(cid, (input.localUsage.get(cid) ?? 0) + 1);
    }
    return {
      channel_id: cid,
      reason: `rotation:${mode}`,
      intended_channel_id: intendedId,
      fallback: intendedId !== null && cid !== intendedId,
      next_cursor: nextCursor,
    };
  }
  return null;
}