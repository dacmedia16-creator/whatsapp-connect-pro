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

export const Route = createFileRoute("/api/public/hooks/process-queue")({
  server: {
    handlers: {
      POST: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const nowIso = new Date().toISOString();

        // Concorrência: pegamos N itens, marcamos para 'processing' atomicamente via update returning
        const { data: claimed, error: claimErr } = await supabaseAdmin.rpc("noop", {} as any).then(
          async () => {
            // Update direto com filtro de status='pending', retornando ids reservados
            return await supabaseAdmin
              .from("message_queue")
              .update({ status: "processing", attempts: 1 })
              .lte("scheduled_for", nowIso)
              .eq("status", "pending")
              .select("id")
              .limit(25);
          },
        ).catch((e) => ({ data: null, error: e }));

        if (claimErr) return Response.json({ error: claimErr.message }, { status: 500 });
        const ids = (claimed ?? []).map((r: any) => r.id);
        if (!ids.length) return Response.json({ processed: 0 });

        const { data: items } = await supabaseAdmin
          .from("message_queue")
          .select("*, channel:channels(*), contact:contacts(*)")
          .in("id", ids);

        let sent = 0, failed = 0, rescheduled = 0, skipped = 0;

        for (const item of items ?? []) {
          const ch: any = item.channel;
          const ct: any = item.contact;
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
          if (ch.status === "paused") {
            await supabaseAdmin.from("message_queue").update({ status: "pending", scheduled_for: new Date(Date.now() + 15 * 60 * 1000).toISOString() }).eq("id", item.id);
            rescheduled++; continue;
          }
          let sentToday = ch.sent_today_date === today ? ch.sent_today : 0;
          if (sentToday >= ch.daily_limit) {
            // tentar amanhã
            const nextDay = new Date(); nextDay.setUTCDate(nextDay.getUTCDate() + 1); nextDay.setUTCHours(12, 0, 0, 0);
            await supabaseAdmin.from("message_queue").update({ status: "pending", scheduled_for: nextDay.toISOString() }).eq("id", item.id);
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

          const result = await zionSendMessage({
            apiKey: ch.zion_api_key, phone: ct.phone_e164, msg: item.rendered_text,
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
            const tooMany = (item.attempts ?? 1) >= 3;
            await supabaseAdmin.from("message_queue").update({
              status: tooMany ? "failed" : "pending",
              last_error: result.body.slice(0, 500),
              scheduled_for: new Date(Date.now() + 60_000 * (item.attempts ?? 1)).toISOString(),
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