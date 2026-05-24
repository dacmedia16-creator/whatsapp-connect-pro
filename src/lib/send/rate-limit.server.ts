import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Constrói uma data UTC que, projetada no `tz`, cai no dia `addDays` (a partir
// de hoje no tz) com `hour:minute`. Usa busca binária para resolver o offset
// do tz, evitando assumir BRT/UTC. Funciona para qualquer fuso suportado por Intl.
function nextDateInTz(_base: Date, tz: string, addDays: number, hour: number, minute: number): Date {
  // Pega a "data civil" atual no tz desejado.
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const map: Record<string, string> = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  // Soma os dias no calendário civil do tz.
  const baseY = Number(map.year);
  const baseM = Number(map.month);
  const baseD = Number(map.day);
  // Aproxima inicial como UTC midnight da data civil destino + offset hora desejada.
  const civilTarget = new Date(Date.UTC(baseY, baseM - 1, baseD + addDays, hour, minute, 0, 0));
  // Calcula o offset real do tz para esse instante e corrige.
  const offsetMin = getTzOffsetMinutes(tz, civilTarget);
  return new Date(civilTarget.getTime() - offsetMin * 60_000);
}

function getTzOffsetMinutes(tz: string, atUtc: Date): number {
  // Diferença entre "hora local no tz" e "UTC" para o instante atUtc.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(atUtc);
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  const asUtc = Date.UTC(
    Number(m.year), Number(m.month) - 1, Number(m.day),
    Number(m.hour) % 24, Number(m.minute), Number(m.second),
  );
  return Math.round((asUtc - atUtc.getTime()) / 60_000);
}

// Verifica se "agora" está dentro do horário comercial do canal usando o tz configurado.
export function isWithinBusinessHours(bh: any): { ok: boolean; nextWindow: Date | null } {
  if (!bh || typeof bh !== "object") return { ok: true, nextWindow: null };
  const tz: string = bh.tz ?? "UTC";
  const days: number[] = Array.isArray(bh.days) ? bh.days : [0, 1, 2, 3, 4, 5, 6];
  const start: string = bh.start ?? "00:00";
  const end: string = bh.end ?? "23:59";

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const map: Record<string, string> = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const wdNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wd = wdNames[map.weekday] ?? 1;
  const hhmm = `${map.hour}:${map.minute}`;

  const dayOk = days.includes(wd);
  const hourOk = hhmm >= start && hhmm <= end;
  if (dayOk && hourOk) return { ok: true, nextWindow: null };

  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const cand = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, weekday: "short",
    }).formatToParts(cand);
    const wdc = wdNames[(p.find((x) => x.type === "weekday")?.value ?? "Mon")] ?? 1;
    if (!days.includes(wdc)) continue;
    if (i === 0 && hhmm < start) {
      const [h, m] = start.split(":").map(Number);
      return { ok: false, nextWindow: nextDateInTz(now, tz, 0, h, m) };
    }
    if (i > 0) {
      const [h, m] = start.split(":").map(Number);
      return { ok: false, nextWindow: nextDateInTz(now, tz, i, h, m) };
    }
  }
  return { ok: false, nextWindow: new Date(Date.now() + 60 * 60 * 1000) };
}

// Verifica janela de envio configurada por campanha (campaign_send_settings).
export function isWithinCampaignWindow(s: any): { ok: boolean; nextWindow: Date | null } {
  if (!s) return { ok: true, nextWindow: null };
  const tz: string = s.timezone ?? "America/Sao_Paulo";
  const days: number[] = Array.isArray(s.allowed_weekdays) ? s.allowed_weekdays : [1, 2, 3, 4, 5];
  const start: string = (s.allowed_start_time ?? "09:00").slice(0, 5);
  const end: string = (s.allowed_end_time ?? "18:00").slice(0, 5);
  return isWithinBusinessHours({ tz, days, start, end });
}

// Conta envios recentes de um canal via send_logs (status 2xx) dentro de uma janela em ms.
// Se `campaignId` for informado, escopa a contagem para aquela campanha — assim os
// limites por campanha (max_per_minute/hour) não vazam entre campanhas no mesmo chip.
export async function recentSends(channelId: string, sinceMs: number, campaignId?: string | null): Promise<number> {
  const since = new Date(Date.now() - sinceMs).toISOString();
  let q = supabaseAdmin
    .from("send_logs")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .gte("created_at", since)
    .gte("http_status", 200).lt("http_status", 300);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { count } = await q;
  return count ?? 0;
}

// Retorna o timestamp do último envio bem-sucedido do canal (ou null).
export async function lastSendAt(channelId: string): Promise<Date | null> {
  const { data } = await supabaseAdmin
    .from("send_logs")
    .select("created_at")
    .eq("channel_id", channelId)
    .gte("http_status", 200).lt("http_status", 300)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? new Date(data.created_at) : null;
}

// Último envio bem-sucedido da campanha em QUALQUER canal.
// Usado pelo modo "Chama Simples" para impor pacing global (delay entre
// quaisquer dois disparos da campanha, não por canal).
export async function lastCampaignSendAt(campaignId: string): Promise<Date | null> {
  const { data } = await supabaseAdmin
    .from("send_logs")
    .select("created_at")
    .eq("campaign_id", campaignId)
    .gte("http_status", 200).lt("http_status", 300)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? new Date(data.created_at) : null;
}