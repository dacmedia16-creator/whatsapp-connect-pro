import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhoneE164 } from "./phone";

async function assertManager(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const roles = new Set((data ?? []).map((r) => r.role));
  if (!roles.has("admin") && !roles.has("gestor")) {
    throw new Error("Sem permissão para gerenciar listas");
  }
}

const rowSchema = z.object({
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().min(3).max(40),
  email: z.string().trim().max(255).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  consent: z.boolean().optional(),
});

const inputSchema = z.object({
  listId: z.string().uuid(),
  source: z.enum(["import", "manual"]),
  rows: z.array(rowSchema).min(1).max(5000),
});

export const addContactsToListFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);

    const { data: list, error: lErr } = await supabaseAdmin
      .from("contact_lists")
      .select("id")
      .eq("id", data.listId)
      .maybeSingle();
    if (lErr) throw new Error(lErr.message);
    if (!list) throw new Error("Lista não encontrada");

    const summary = {
      added: 0,
      alreadyInList: 0,
      invalid: 0,
      duplicate: 0,
      optOut: 0,
    };

    // Normalize + dedupe input rows
    const seen = new Set<string>();
    const normalized: Array<{ phone: string; name: string; tags: string[] }> = [];
    for (const r of data.rows) {
      const phone = normalizePhoneE164(r.phone ?? "");
      if (!phone) { summary.invalid++; continue; }
      if (seen.has(phone)) { summary.duplicate++; continue; }
      seen.add(phone);
      normalized.push({
        phone,
        name: (r.name ?? "").trim() || phone,
        tags: r.tags ?? [],
      });
    }

    if (normalized.length === 0) {
      return summary;
    }

    const phones = normalized.map((n) => n.phone);

    // Find existing contacts
    const { data: existing } = await supabaseAdmin
      .from("contacts")
      .select("id, phone_e164, opt_out_at")
      .in("phone_e164", phones);
    const exMap = new Map<string, { id: string; opt_out_at: string | null }>();
    (existing ?? []).forEach((c: any) => exMap.set(c.phone_e164, c));

    const sourceLabel = data.source === "import" ? "list_import" : "list_manual";

    const contactIds: string[] = [];
    for (const n of normalized) {
      const ex = exMap.get(n.phone);
      if (ex) {
        if (ex.opt_out_at) { summary.optOut++; continue; }
        contactIds.push(ex.id);
      } else {
        const { data: ins, error } = await supabaseAdmin
          .from("contacts")
          .insert({
            name: n.name,
            phone_e164: n.phone,
            consent: true,
            consent_at: new Date().toISOString(),
            tags: n.tags,
            source: sourceLabel,
            created_by: context.userId,
          })
          .select("id")
          .single();
        if (error || !ins) continue;
        contactIds.push(ins.id);
      }
    }

    if (contactIds.length === 0) return summary;

    // Find which are already in the list
    const { data: present } = await supabaseAdmin
      .from("contact_list_items")
      .select("contact_id")
      .eq("list_id", data.listId)
      .in("contact_id", contactIds);
    const presentSet = new Set((present ?? []).map((p: any) => p.contact_id));

    const toInsert = contactIds
      .filter((id) => !presentSet.has(id))
      .map((cid) => ({ list_id: data.listId, contact_id: cid }));
    summary.alreadyInList = contactIds.length - toInsert.length;

    if (toInsert.length > 0) {
      const { error: iErr } = await supabaseAdmin
        .from("contact_list_items")
        .insert(toInsert);
      if (iErr) throw new Error(iErr.message);
      summary.added = toInsert.length;
    }

    return summary;
  });