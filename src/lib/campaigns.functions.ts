import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyRows, type RawRow, type ResolvedContact, type ResolveSummary, emptySummary } from "./recipient-resolver";
import { normalizePhoneE164 } from "./phone";

async function assertManager(userId: string) {
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  const roles = new Set((data ?? []).map((r) => r.role));
  if (!roles.has("admin") && !roles.has("gestor")) {
    throw new Error("Sem permissão para gerenciar campanhas");
  }
}

async function loadExistingByPhones(phones: string[]) {
  const map = new Map<string, { id: string; consent: boolean; opt_out_at: string | null; tags: string[] }>();
  if (phones.length === 0) return map;
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("id, phone_e164, consent, opt_out_at, tags")
    .in("phone_e164", phones);
  (data ?? []).forEach((c: any) => map.set(c.phone_e164, c));
  return map;
}

export const listContactListsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data: lists, error } = await supabaseAdmin
      .from("contact_lists")
      .select("id, name, description, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!lists?.length) return [] as Array<{ id: string; name: string; description: string | null; count: number }>;
    const ids = lists.map((l) => l.id);
    const { data: items } = await supabaseAdmin
      .from("contact_list_items")
      .select("list_id")
      .in("list_id", ids);
    const counts = new Map<string, number>();
    (items ?? []).forEach((it: any) => counts.set(it.list_id, (counts.get(it.list_id) ?? 0) + 1));
    return lists.map((l) => ({ ...l, count: counts.get(l.id) ?? 0 }));
  });

const rawRowSchema = z.object({
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().min(3).max(40),
  email: z.string().trim().max(255).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  consent: z.boolean().optional(),
});

const previewInput = z.discriminatedUnion("method", [
  z.object({ method: z.literal("list"), listIds: z.array(z.string().uuid()).min(1).max(50) }),
  z.object({
    method: z.literal("tags"),
    tags: z.array(z.string().min(1).max(60)).min(1).max(20),
    match: z.enum(["any", "all"]),
  }),
  z.object({ method: z.literal("import"), rows: z.array(rawRowSchema).min(1).max(5000) }),
  z.object({ method: z.literal("manual"), rows: z.array(rawRowSchema).min(1).max(500) }),
]);

export const previewRecipientsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => previewInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);

    if (data.method === "list") {
      const { data: items } = await supabaseAdmin
        .from("contact_list_items")
        .select("contact:contacts(id, name, phone_e164, tags, consent, opt_out_at)")
        .in("list_id", data.listIds);
      // Dedupe across multiple lists by contact id
      const byId = new Map<string, any>();
      (items ?? []).forEach((it: any) => {
        const c = it.contact;
        if (c && !byId.has(c.id)) byId.set(c.id, c);
      });
      return classifyExistingContacts(Array.from(byId.values()), "list");
    }

    if (data.method === "tags") {
      let q = supabaseAdmin
        .from("contacts")
        .select("id, name, phone_e164, tags, consent, opt_out_at")
        .limit(5000);
      if (data.match === "all") q = q.contains("tags", data.tags);
      else q = q.overlaps("tags", data.tags);
      const { data: contacts } = await q;
      return classifyExistingContacts(contacts ?? [], "tags");
    }

    const rows: RawRow[] = data.rows;
    const normalized = rows.map((r) => normalizePhoneE164(r.phone ?? "")).filter((x): x is string => !!x);
    const existing = await loadExistingByPhones(normalized);
    return classifyRows(rows, data.method, existing);
  });

function classifyExistingContacts(
  contacts: Array<{ id: string; name: string; phone_e164: string; tags: string[] | null; consent: boolean; opt_out_at: string | null }>,
  source: "list" | "tags",
): { contacts: ResolvedContact[]; summary: ResolveSummary } {
  const summary = emptySummary();
  const seen = new Set<string>();
  const out: ResolvedContact[] = [];
  for (const c of contacts) {
    summary.found++;
    if (!c.phone_e164) {
      summary.invalidPhone++;
      out.push({ id: c.id, name: c.name, phone_e164: null, rawPhone: "", tags: c.tags ?? [], consent: c.consent, optOut: !!c.opt_out_at, source, status: "invalid_phone" });
      continue;
    }
    if (seen.has(c.phone_e164)) {
      summary.duplicates++;
      out.push({ id: c.id, name: c.name, phone_e164: c.phone_e164, rawPhone: c.phone_e164, tags: c.tags ?? [], consent: c.consent, optOut: !!c.opt_out_at, source, status: "duplicate" });
      continue;
    }
    seen.add(c.phone_e164);
    let status: ResolvedContact["status"] = "eligible";
    if (c.opt_out_at) { status = "opt_out"; summary.blockedOptOut++; }
    else if (!c.consent) { status = "no_consent"; summary.blockedNoConsent++; }
    else { summary.eligible++; }
    out.push({ id: c.id, name: c.name, phone_e164: c.phone_e164, rawPhone: c.phone_e164, tags: c.tags ?? [], consent: c.consent, optOut: !!c.opt_out_at, source, status });
  }
  return { contacts: out, summary };
}

const createInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional().nullable(),
  channelId: z.string().uuid(),
  scheduledAt: z.string().datetime().nullable(),
  message: z.string().trim().min(5).max(4096),
  ratePerMin: z.number().int().min(1).max(120),
  autoPauseOnErrors: z.boolean().optional(),
  method: z.enum(["list", "tags", "import", "manual"]),
  methodSummary: z.object({
    listIds: z.array(z.string().uuid()).optional(),
    tags: z.array(z.string()).optional(),
    match: z.enum(["any", "all"]).optional(),
  }).optional(),
  recipients: z.array(z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200),
    phone_e164: z.string().trim().min(5).max(20),
    tags: z.array(z.string()).optional(),
    consent: z.boolean(),
  })).min(1).max(5000),
  initiate: z.boolean(),
});

const OPT_OUT_FOOTER = "\n\nResponda SAIR para não receber mais mensagens.";

export const createCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);

    const { data: channel, error: chErr } = await supabaseAdmin
      .from("channels")
      .select("id, status")
      .eq("id", data.channelId)
      .maybeSingle();
    if (chErr || !channel) throw new Error("Canal não encontrado");
    if (channel.status === "paused") throw new Error("Canal está pausado");

    if (data.scheduledAt) {
      const ts = new Date(data.scheduledAt).getTime();
      if (Number.isNaN(ts) || ts < Date.now() - 60_000) {
        throw new Error("Data de agendamento deve ser futura");
      }
    }

    const phones = data.recipients.map((r) => r.phone_e164);
    const { data: existing } = await supabaseAdmin
      .from("contacts")
      .select("id, phone_e164, opt_out_at, consent")
      .in("phone_e164", phones);
    const exMap = new Map<string, { id: string; opt_out_at: string | null; consent: boolean }>();
    (existing ?? []).forEach((c: any) => exMap.set(c.phone_e164, c));

    const contactIds: string[] = [];
    for (const r of data.recipients) {
      const ex = exMap.get(r.phone_e164);
      if (ex) {
        if (ex.opt_out_at) continue;
        contactIds.push(ex.id);
      } else {
        if (!r.consent) continue;
        const { data: ins, error } = await supabaseAdmin
          .from("contacts")
          .insert({
            name: r.name,
            phone_e164: r.phone_e164,
            consent: true,
            consent_at: new Date().toISOString(),
            tags: r.tags ?? [],
            source: data.method,
            created_by: context.userId,
          })
          .select("id")
          .single();
        if (error || !ins) continue;
        contactIds.push(ins.id);
      }
    }

    if (contactIds.length === 0) throw new Error("Nenhum contato elegível após validação");

    const message = /sair|descadastr|parar|remover/i.test(data.message)
      ? data.message
      : data.message.trimEnd() + OPT_OUT_FOOTER;

    const status: "draft" | "scheduled" | "running" = data.initiate
      ? (data.scheduledAt ? "scheduled" : "running")
      : "draft";

    const { data: campaign, error: cErr } = await supabaseAdmin
      .from("campaigns")
      .insert({
        name: data.name,
        description: data.description ?? null,
        message_template: message,
        audience_filter: {
          method: data.method,
          ...(data.methodSummary ?? {}),
          autoPauseOnErrors: !!data.autoPauseOnErrors,
        },
        channel_ids: [data.channelId],
        rate_per_min: data.ratePerMin,
        scheduled_at: data.scheduledAt,
        status,
        total_recipients: contactIds.length,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (cErr || !campaign) throw new Error(cErr?.message ?? "Falha ao criar campanha");

    const recipientRows = contactIds.map((cid) => ({
      campaign_id: campaign.id,
      contact_id: cid,
      channel_id: data.channelId,
      status: "queued" as const,
    }));
    const { error: rErr } = await supabaseAdmin.from("campaign_recipients").insert(recipientRows);
    if (rErr) throw new Error(rErr.message);

    return { id: campaign.id, status, eligible: contactIds.length };
  });
