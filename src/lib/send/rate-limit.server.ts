import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

function nextDateInTz(base: Date, _tz: string, addDays: number, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + addDays);
  d.setUTCHours(hour + 3, minute, 0, 0); // ajuste BRT (aproximação)
  return d;
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
export async function recentSends(channelId: string, sinceMs: number): Promise<number> {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const { count } = await supabaseAdmin
    .from("send_logs")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .gte("created_at", since)
    .gte("http_status", 200).lt("http_status", 300);
  return count ?? 0;
}