import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createSenderContext, processQueueItem } from "@/lib/send/sender.server";
import { lastCampaignSendAt } from "@/lib/send/rate-limit.server";

// Runner do cron job: claim atômico de até 25 itens e despacho para o sender.
// Toda a lógica de negócio vive em src/lib/send/*.
export const Route = createFileRoute("/api/public/hooks/process-queue")({
  server: {
    handlers: {
      POST: async () => {
        const nowIso = new Date().toISOString();

        // Reaper: solta leases órfãos parados em "processing" há mais de 5 min.
        const staleCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
        await supabaseAdmin
          .from("message_queue")
          .update({
            status: "pending",
            processing_started_at: null,
            last_error: "Reset automático: lease expirado (worker não concluiu em 5 min)",
          })
          .eq("status", "processing")
          .lt("processing_started_at", staleCutoff);
        // Também reseta processing antigos SEM timestamp (legado, pré-reaper).
        await supabaseAdmin
          .from("message_queue")
          .update({
            status: "pending",
            last_error: "Reset automático: lease órfão sem timestamp",
          })
          .eq("status", "processing")
          .is("processing_started_at", null)
          .lt("created_at", staleCutoff);

        // Claim atômico: marca pending -> processing num único UPDATE.
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from("message_queue")
          .update({ status: "processing", processing_started_at: nowIso })
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

        const ctx = createSenderContext(process.env.CHANNEL_KEY_SECRET);
        let sent = 0, failed = 0, rescheduled = 0, skipped = 0;

        // Descobre quais campanhas envolvidas usam o modo "Chama Simples".
        // Nesse modo, dentro do mesmo tick processamos itens em série com sleep
        // para respeitar o gap global de 15s (cron roda só 1×/min).
        const campaignIds = Array.from(new Set(
          (items ?? [])
            .map((it: any) => it?.recipient?.campaign_id)
            .filter(Boolean) as string[],
        ));
        const simpleCallCampaigns = new Set<string>();
        if (campaignIds.length) {
          const { data: settings } = await supabaseAdmin
            .from("campaign_send_settings")
            .select("campaign_id, rotation_mode")
            .in("campaign_id", campaignIds);
          for (const s of settings ?? []) {
            if ((s as any).rotation_mode === "simple_call") {
              simpleCallCampaigns.add((s as any).campaign_id);
            }
          }
        }

        const SIMPLE_CALL_GAP_MS = 15_000;
        const TICK_BUDGET_MS = 50_000; // teto de segurança (reaper = 5min)
        const tickStart = Date.now();
        const processedIds: string[] = [];

        for (const item of items ?? []) {
          const campaignId: string | null = item?.recipient?.campaign_id ?? null;
          const isSimpleCall = campaignId ? simpleCallCampaigns.has(campaignId) : false;

          if (isSimpleCall && campaignId) {
            const last = await lastCampaignSendAt(campaignId);
            if (last) {
              const elapsed = Date.now() - last.getTime();
              const waitMs = SIMPLE_CALL_GAP_MS - elapsed;
              if (waitMs > 0) {
                // Se esperar estourar o orçamento do tick, libera os restantes
                // (incluindo este) e deixa o próximo tick pegar.
                if (Date.now() - tickStart + waitMs > TICK_BUDGET_MS) {
                  break;
                }
                await new Promise((r) => setTimeout(r, waitMs));
              }
            }
          }

          const outcome = await processQueueItem(item, ctx);
          processedIds.push(item.id);
          if (outcome === "sent") sent++;
          else if (outcome === "failed") failed++;
          else if (outcome === "rescheduled") rescheduled++;
          else skipped++;

          if (Date.now() - tickStart > TICK_BUDGET_MS) break;
        }

        // Libera o lease dos itens que reclamamos mas não processamos neste tick,
        // para que o próximo tick possa pegá-los.
        const releaseIds = ids.filter((id) => !processedIds.includes(id));
        if (releaseIds.length) {
          await supabaseAdmin
            .from("message_queue")
            .update({ status: "pending", processing_started_at: null })
            .in("id", releaseIds)
            .eq("status", "processing");
        }

        return Response.json({
          processed: processedIds.length,
          released: releaseIds.length,
          sent, failed, rescheduled, skipped,
        });
      },
    },
  },
});