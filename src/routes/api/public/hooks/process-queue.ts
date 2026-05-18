import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zionSendMessage, logSend } from "@/lib/ziontalk.server";

// Verifica se "agora" está dentro do horário comercial do canal usando o tz configurado.
function isWithinBusinessHours(bh: any): { ok: boolean; nextWindow: Date | null } {
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

  // próximo slot: hoje no start (se cedo) ou amanhã no start (até 7 dias)
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const cand = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, weekday: "short",
    }).formatToParts(cand);
    const wdc = wdNames[(p.find((x) => x.type === "weekday")?.value ?? "Mon")] ?? 1;
    if (!days.includes(wdc)) continue;
    // se for hoje e ainda não passou o start
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
  // aproximação: somar dias, setar HH:MM em UTC -3 (sao paulo) é overkill;
  // como fallback, agendamos para addDays * 24h + horário relativo
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + addDays);
  d.setUTCHours(hour + 3, minute, 0, 0); // ajuste BRT
  return d;
}

// Verifica janela de envio configurada por campanha (campaign_send_settings).
function isWithinCampaignWindow(s: any): { ok: boolean; nextWindow: Date | null } {
  if (!s) return { ok: true, nextWindow: null };
  const tz: string = s.timezone ?? "America/Sao_Paulo";
  const days: number[] = Array.isArray(s.allowed_weekdays) ? s.allowed_weekdays : [1, 2, 3, 4, 5];
  const start: string = (s.allowed_start_time ?? "09:00").slice(0, 5);
  const end: string = (s.allowed_end_time ?? "18:00").slice(0, 5);
  return isWithinBusinessHours({ tz, days, start, end });
}

export const Route = createFileRoute("/api/public/hooks/process-queue")({
  server: {
    handlers: {
      POST: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const nowIso = new Date().toISOString();

        // Concorrência: update atômico com filtro status='pending' reserva os ids para este worker.
        // attempts é incrementado depois (após carregar o valor atual).
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from("message_queue")
          .update({ status: "processing" })
          .lte("scheduled_for", nowIso)
          .eq("status", "pending")
          .select("id")
          .limit(25);

        if (claimErr) return Response.json({ error: claimErr.message }, { status: 500 });
        const ids = (claimed ?? []).map((r: any) => r.id);
        if (!ids.length) return Response.json({ processed: 0 });

        const { data: items } = await supabaseAdmin
          .from("message_queue")
          .select("*, channel:channels(*), contact:contacts(*), recipient:campaign_recipients(id, campaign_id)")
          .in("id", ids);

        let sent = 0, failed = 0, rescheduled = 0, skipped = 0;
        const secret = process.env.CHANNEL_KEY_SECRET;
        const keyCache = new Map<string, string | null>();
        const settingsCache = new Map<string, any>();
        const channelsCache = new Map<string, any>();
        const rrCursor = new Map<string, number>(); // round-robin por campanha

        async function getSettings(campaignId: string | null) {
          if (!campaignId) return null;
          if (settingsCache.has(campaignId)) return settingsCache.get(campaignId);
          const { data } = await supabaseAdmin
            .from("campaign_send_settings").select("*").eq("campaign_id", campaignId).maybeSingle();
          settingsCache.set(campaignId, data ?? null);
          return data ?? null;
        }

        async function getChannel(id: string) {
          if (channelsCache.has(id)) return channelsCache.get(id);
          const { data } = await supabaseAdmin.from("channels").select("*").eq("id", id).maybeSingle();
          channelsCache.set(id, data);
          return data;
        }

        // Conta envios recentes de um canal via send_logs (status 2xx).
        async function recentSends(channelId: string, sinceMs: number) {
          const since = new Date(Date.now() - sinceMs).toISOString();
          const { count } = await supabaseAdmin
            .from("send_logs")
            .select("id", { count: "exact", head: true })
            .eq("channel_id", channelId)
            .gte("created_at", since)
            .gte("http_status", 200).lt("http_status", 300);
          return count ?? 0;
        }

        // Seleciona um canal válido respeitando a configuração da campanha.
        async function pickChannel(settings: any, currentChannelId: string, campaignId: string) {
          const selected: string[] = (settings?.selected_channel_ids ?? []).filter(Boolean);
          const allowed = selected.length ? selected : [currentChannelId];
          // se o canal atual ainda é elegível e ok, usa ele
          const candidates: string[] = [];
          const mode = settings?.rotation_mode ?? "round_robin";
          if (mode === "manual_priority" && Array.isArray(settings?.channel_priority) && settings.channel_priority.length) {
            candidates.push(...settings.channel_priority.filter((id: string) => allowed.includes(id)));
          } else if (mode === "round_robin") {
            const idx = (rrCursor.get(campaignId) ?? 0) % allowed.length;
            candidates.push(...allowed.slice(idx), ...allowed.slice(0, idx));
            rrCursor.set(campaignId, idx + 1);
          } else {
            // least_used: ordena por sent_today
            const withUsage = await Promise.all(allowed.map(async (id) => ({ id, used: ((await getChannel(id))?.sent_today) ?? 0 })));
            withUsage.sort((a, b) => a.used - b.used);
            candidates.push(...withUsage.map((x) => x.id));
          }
          for (const cid of candidates) {
            const ch = await getChannel(cid);
            if (!ch) continue;
            if (ch.status === "paused" || ch.status === "error") continue;
            const maxDay = settings?.max_per_day_per_channel ?? ch.daily_limit;
            const sentToday = ch.sent_today_date === today ? ch.sent_today : 0;
            if (sentToday >= Math.min(maxDay, ch.daily_limit)) continue;
            if (settings?.max_per_minute && (await recentSends(cid, 60_000)) >= settings.max_per_minute) continue;
            if (settings?.max_per_hour && (await recentSends(cid, 3_600_000)) >= settings.max_per_hour) continue;
            return ch;
          }
          return null;
        }

        for (const item of items ?? []) {
          let ch: any = item.channel;
          const ct: any = item.contact;
          const campaignId: string | null = (item as any).recipient?.campaign_id ?? null;
          const settings = await getSettings(campaignId);
          if (!ch || !ct) {
            await supabaseAdmin.from("message_queue").update({ status: "failed", last_error: "canal ou contato ausente" }).eq("id", item.id);
            failed++; continue;
          }
          if (ct.opt_out_at || !ct.consent) {
            await supabaseAdmin.from("message_queue").update({ status: "failed", last_error: "sem consentimento" }).eq("id", item.id);
            if (item.campaign_recipient_id) {
              await supabaseAdmin.from("campaign_recipients").update({ status: "opted_out" }).eq("id", item.campaign_recipient_id);
            }
            skipped++; continue;
          }

          // Janela da campanha (se configurada)
          if (settings) {
            const cw = isWithinCampaignWindow(settings);
            if (!cw.ok) {
              await supabaseAdmin.from("message_queue").update({
                status: "pending",
                scheduled_for: (cw.nextWindow ?? new Date(Date.now() + 30 * 60 * 1000)).toISOString(),
              }).eq("id", item.id);
              rescheduled++; continue;
            }
          }

          // Seleção / rotação de canal segundo settings
          if (campaignId && settings) {
            const picked = await pickChannel(settings, ch.id, campaignId);
            if (!picked) {
              // todos canais indisponíveis: reagenda + opcional auto-pause
              await supabaseAdmin.from("message_queue").update({
                status: "pending",
                scheduled_for: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                last_error: "todos os canais indisponíveis (limite/status)",
              }).eq("id", item.id);
              if (settings.auto_pause_on_all_channels_down) {
                await supabaseAdmin.from("campaigns").update({ status: "paused" }).eq("id", campaignId);
              }
              rescheduled++; continue;
            }
            if (picked.id !== ch.id) {
              ch = picked;
              await supabaseAdmin.from("message_queue").update({ channel_id: ch.id }).eq("id", item.id);
            }
          }

          let sentToday = ch.sent_today_date === today ? ch.sent_today : 0;
          const dayCap = settings?.max_per_day_per_channel
            ? Math.min(settings.max_per_day_per_channel, ch.daily_limit)
            : ch.daily_limit;
          if (ch.status === "paused" || sentToday >= dayCap) {
            const wait = ch.status === "paused" ? 15 * 60 * 1000 : 60 * 60 * 1000;
            await supabaseAdmin.from("message_queue").update({
              status: "pending", scheduled_for: new Date(Date.now() + wait).toISOString(),
            }).eq("id", item.id);
            rescheduled++; continue;
          }
          const bh = isWithinBusinessHours(ch.business_hours);
          if (!bh.ok) {
            await supabaseAdmin.from("message_queue").update({
              status: "pending",
              scheduled_for: (bh.nextWindow ?? new Date(Date.now() + 30 * 60 * 1000)).toISOString(),
            }).eq("id", item.id);
            rescheduled++; continue;
          }

          if (!secret) {
            await supabaseAdmin.from("message_queue").update({
              status: "failed", last_error: "CHANNEL_KEY_SECRET ausente no servidor",
            }).eq("id", item.id);
            if (item.campaign_recipient_id) {
              await supabaseAdmin.from("campaign_recipients").update({
                status: "failed", error: "CHANNEL_KEY_SECRET ausente",
              }).eq("id", item.campaign_recipient_id);
            }
            failed++; continue;
          }

          let apiKey = keyCache.get(ch.id) ?? null;
          if (!keyCache.has(ch.id)) {
            const { data: keyData, error: keyErr } = await supabaseAdmin
              .rpc("get_channel_api_key", { p_channel_id: ch.id, p_secret: secret });
            apiKey = keyErr ? null : (((keyData as unknown as string) || "").trim() || null);
            keyCache.set(ch.id, apiKey);
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
            failed++; continue;
          }

          const result = await zionSendMessage({
            apiKey, phone: ct.phone_e164, msg: item.rendered_text,
          });
          await logSend({
            channel_id: ch.id, contact_id: ct.id, campaign_id: null,
            http_status: result.status, response_text: result.body.slice(0, 2000),
          });

          if (result.ok) {
            sent++;
            await supabaseAdmin.from("message_queue")
              .update({ status: "sent", processed_at: new Date().toISOString() }).eq("id", item.id);
            await supabaseAdmin.from("channels").update({
              status: "connected",
              sent_today: sentToday + 1,
              sent_today_date: today,
              last_error: null,
            }).eq("id", ch.id);
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
              conversation_id: convId, direction: "out", body: item.rendered_text, sent_via_channel_id: ch.id,
            });
          } else {
            failed++;
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
          }
        }
        return Response.json({ processed: ids.length, sent, failed, rescheduled, skipped });
      },
    },
  },
});