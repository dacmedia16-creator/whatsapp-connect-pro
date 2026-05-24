import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createSenderContext, processQueueItem } from "@/lib/send/sender.server";

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

        for (const item of items ?? []) {
          const outcome = await processQueueItem(item, ctx);
          if (outcome === "sent") sent++;
          else if (outcome === "failed") failed++;
          else if (outcome === "rescheduled") rescheduled++;
          else skipped++;
        }

        return Response.json({ processed: ids.length, sent, failed, rescheduled, skipped });
      },
    },
  },
});