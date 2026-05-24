// Helpers puros de janela de envio. Sem imports de servidor — pode ser
// importado pelo cliente para mostrar avisos no UI sem puxar supabaseAdmin.

function getTzOffsetMinutes(tz: string, atUtc: Date): number {
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

function nextDateInTz(tz: string, addDays: number, hour: number, minute: number): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const map: Record<string, string> = {};
  parts.forEach((p) => { map[p.type] = p.value; });
  const baseY = Number(map.year);
  const baseM = Number(map.month);
  const baseD = Number(map.day);
  const civilTarget = new Date(Date.UTC(baseY, baseM - 1, baseD + addDays, hour, minute, 0, 0));
  const offsetMin = getTzOffsetMinutes(tz, civilTarget);
  return new Date(civilTarget.getTime() - offsetMin * 60_000);
}

type WindowCheck = { ok: boolean; nextWindow: Date | null };

export function isWithinCampaignWindowPure(s: {
  timezone?: string;
  allowed_weekdays?: number[];
  allowed_start_time?: string;
  allowed_end_time?: string;
} | null | undefined): WindowCheck {
  if (!s) return { ok: true, nextWindow: null };
  const tz = s.timezone ?? "America/Sao_Paulo";
  const days = Array.isArray(s.allowed_weekdays) ? s.allowed_weekdays : [1, 2, 3, 4, 5];
  const start = (s.allowed_start_time ?? "09:00").slice(0, 5);
  const end = (s.allowed_end_time ?? "18:00").slice(0, 5);

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
      return { ok: false, nextWindow: nextDateInTz(tz, 0, h, m) };
    }
    if (i > 0) {
      const [h, m] = start.split(":").map(Number);
      return { ok: false, nextWindow: nextDateInTz(tz, i, h, m) };
    }
  }
  return { ok: false, nextWindow: new Date(Date.now() + 60 * 60 * 1000) };
}