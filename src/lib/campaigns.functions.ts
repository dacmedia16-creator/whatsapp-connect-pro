import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyRows, type RawRow, type ResolvedContact, type ResolveSummary, emptySummary } from "./recipient-resolver";
import { normalizePhoneE164 } from "./phone";
import { enqueueCampaignCore } from "./ziontalk.functions";
import { SEND_SETTINGS_DEFAULTS } from "./send-settings-defaults";

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
  channelId: z.string().uuid().optional(),
  channelIds: z.array(z.string().uuid()).min(1).max(50).optional(),
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
  sendSettings: z.object({
    selected_channel_ids: z.array(z.string().uuid()).max(50),
    rotation_mode: z.enum(["round_robin", "least_used", "manual_priority", "simple_call"]),
    channel_priority: z.array(z.string().uuid()).max(50),
    delay_seconds: z.number().int().min(0).max(3600),
    random_delay_min: z.number().int().min(0).max(3600).nullable(),
    random_delay_max: z.number().int().min(0).max(3600).nullable(),
    max_per_minute: z.number().int().min(1).max(600),
    max_per_hour: z.number().int().min(1).max(10000),
    max_per_day_per_channel: z.number().int().min(1).max(100000),
    allowed_start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    allowed_end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    allowed_weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    timezone: z.string().min(1).max(64),
    auto_pause_outside_hours: z.boolean(),
    auto_pause_on_all_channels_down: z.boolean(),
    batch_mode: z.boolean().optional(),
    batch_pause_seconds: z.number().int().min(0).max(86400).nullable().optional(),
  }).optional(),
  media: z.object({
    url: z.string().url().max(2048),
    type: z.enum(["image", "video", "audio", "document"]),
    mime: z.string().min(1).max(120),
    filename: z.string().min(1).max(255),
  }).nullable().optional(),
});

const OPT_OUT_FOOTER = "\n\nResponda SAIR para não receber mais mensagens.";

export const createCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertManager(context.userId);

    const channelIds = data.channelIds && data.channelIds.length
      ? data.channelIds
      : (data.channelId ? [data.channelId] : []);
    if (!channelIds.length) throw new Error("Selecione ao menos 1 canal");

    const { data: chs, error: chErr } = await supabaseAdmin
      .from("channels")
      .select("id, status")
      .in("id", channelIds);
    if (chErr) throw new Error(chErr.message);
    if (!chs || chs.length !== channelIds.length) throw new Error("Canal não encontrado");
    if (chs.some((c) => c.status === "paused")) throw new Error("Há canais pausados na seleção");
    const primaryChannelId = channelIds[0];

    if (data.scheduledAt) {
      const ts = new Date(data.scheduledAt).getTime();
      if (Number.isNaN(ts) || ts < Date.now() - 60_000) {
        throw new Error("Data de agendamento deve ser futura");
      }
    }

    // ============================================================
    // Resolução autoritativa de destinatários no servidor.
    // Para "list" e "tags" RECARREGAMOS a fonte do banco — ignoramos
    // o array do cliente para impedir vazamento de contatos antigos
    // que tenham ficado no estado da UI.
    // ============================================================
    const clientPhones = new Set(data.recipients.map((r) => r.phone_e164));
    let contactIds: string[] = [];
    let serverFound = 0;
    let serverEligible = 0;

    if (data.method === "list") {
      const listIds = data.methodSummary?.listIds ?? [];
      if (!listIds.length) throw new Error("Nenhuma lista selecionada");
      const { data: items, error: itErr } = await supabaseAdmin
        .from("contact_list_items")
        .select("contact:contacts(id, phone_e164, consent, opt_out_at)")
        .in("list_id", listIds);
      if (itErr) throw new Error(itErr.message);
      const byId = new Map<string, { id: string; phone_e164: string | null; consent: boolean; opt_out_at: string | null }>();
      (items ?? []).forEach((it: any) => {
        const c = it.contact;
        if (c && c.id && !byId.has(c.id)) byId.set(c.id, c);
      });
      serverFound = byId.size;
      for (const c of byId.values()) {
        if (!c.phone_e164) continue;
        if (c.opt_out_at) continue;
        if (!c.consent) continue;
        // Honra a subseleção do cliente: só inclui telefones que o usuário
        // marcou na UI. Servidor continua autoritativo para consent/opt-out.
        if (!clientPhones.has(c.phone_e164)) continue;
        serverEligible++;
        contactIds.push(c.id);
      }
    } else if (data.method === "tags") {
      const tags = data.methodSummary?.tags ?? [];
      const match = data.methodSummary?.match ?? "any";
      if (!tags.length) throw new Error("Nenhuma etiqueta selecionada");
      let q = supabaseAdmin
        .from("contacts")
        .select("id, phone_e164, consent, opt_out_at")
        .limit(5000);
      if (match === "all") q = q.contains("tags", tags);
      else q = q.overlaps("tags", tags);
      const { data: contacts, error: ctErr } = await q;
      if (ctErr) throw new Error(ctErr.message);
      const byId = new Map<string, any>();
      (contacts ?? []).forEach((c: any) => { if (c?.id && !byId.has(c.id)) byId.set(c.id, c); });
      serverFound = byId.size;
      for (const c of byId.values()) {
        if (!c.phone_e164) continue;
        if (c.opt_out_at) continue;
        if (!c.consent) continue;
        if (!clientPhones.has(c.phone_e164)) continue;
        serverEligible++;
        contactIds.push(c.id);
      }
    } else {
      // import / manual: não há fonte canônica no banco — usamos o que
      // veio do cliente, mas garantindo que cada telefone foi explicitamente
      // listado (já está, por construção) e validando consent/opt-out
      // contra registros existentes.
      const phones = data.recipients.map((r) => r.phone_e164);
      const { data: existing } = await supabaseAdmin
        .from("contacts")
        .select("id, phone_e164, opt_out_at, consent")
        .in("phone_e164", phones);
      const exMap = new Map<string, { id: string; opt_out_at: string | null; consent: boolean }>();
      (existing ?? []).forEach((c: any) => exMap.set(c.phone_e164, c));
      serverFound = data.recipients.length;
      for (const r of data.recipients) {
        const ex = exMap.get(r.phone_e164);
        if (ex) {
          if (ex.opt_out_at) continue;
          serverEligible++;
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
          serverEligible++;
          contactIds.push(ins.id);
        }
      }
    }

    // dedupe final por contact_id
    contactIds = Array.from(new Set(contactIds));
    const clientCount = clientPhones.size;

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
          server_resolved: {
            found: serverFound,
            eligible: serverEligible,
            client_submitted: clientCount,
            diff_from_client: contactIds.length - clientCount,
          },
        },
        // channel_ids e rate_per_min são LEGADOS — fonte única agora é
        // campaign_send_settings. Mantemos as colunas no banco por compat
        // mas não gravamos mais aqui. Os primeiros canais entram via
        // settingsRow.selected_channel_ids abaixo.
        channel_ids: [],
        rate_per_min: 0,
        scheduled_at: data.scheduledAt,
        status,
        total_recipients: contactIds.length,
        created_by: context.userId,
        media_url: data.media?.url ?? null,
        media_type: data.media?.type ?? null,
        media_mime: data.media?.mime ?? null,
        media_filename: data.media?.filename ?? null,
      })
      .select("id")
      .single();
    if (cErr || !campaign) throw new Error(cErr?.message ?? "Falha ao criar campanha");

    const recipientRows = contactIds.map((cid) => ({
      campaign_id: campaign.id,
      contact_id: cid,
      channel_id: primaryChannelId,
      status: "queued" as const,
    }));
    const { error: rErr } = await supabaseAdmin.from("campaign_recipients").insert(recipientRows);
    if (rErr) throw new Error(rErr.message);

    // Persistir campaign_send_settings — usa defaults quando não fornecido.
    const s = data.sendSettings;
    const settingsRow = {
      campaign_id: campaign.id,
      // Defaults canônicos compartilhados com servidor/cliente.
      // O array de canais cai para os canais selecionados na criação quando o usuário
      // não passou um array explícito no formulário avançado.
      selected_channel_ids: s?.selected_channel_ids?.length ? s.selected_channel_ids : channelIds,
      rotation_mode: s?.rotation_mode ?? SEND_SETTINGS_DEFAULTS.rotation_mode,
      channel_priority: s?.channel_priority?.length ? s.channel_priority : channelIds,
      delay_seconds: s?.delay_seconds ?? SEND_SETTINGS_DEFAULTS.delay_seconds,
      random_delay_min: s?.random_delay_min ?? SEND_SETTINGS_DEFAULTS.random_delay_min,
      random_delay_max: s?.random_delay_max ?? SEND_SETTINGS_DEFAULTS.random_delay_max,
      max_per_minute: s?.max_per_minute ?? SEND_SETTINGS_DEFAULTS.max_per_minute,
      max_per_hour: s?.max_per_hour ?? SEND_SETTINGS_DEFAULTS.max_per_hour,
      max_per_day_per_channel: s?.max_per_day_per_channel ?? SEND_SETTINGS_DEFAULTS.max_per_day_per_channel,
      allowed_start_time: s?.allowed_start_time ?? SEND_SETTINGS_DEFAULTS.allowed_start_time,
      allowed_end_time: s?.allowed_end_time ?? SEND_SETTINGS_DEFAULTS.allowed_end_time,
      allowed_weekdays: s?.allowed_weekdays ?? SEND_SETTINGS_DEFAULTS.allowed_weekdays,
      timezone: s?.timezone ?? SEND_SETTINGS_DEFAULTS.timezone,
      auto_pause_outside_hours: s?.auto_pause_outside_hours ?? SEND_SETTINGS_DEFAULTS.auto_pause_outside_hours,
      auto_pause_on_all_channels_down: s?.auto_pause_on_all_channels_down ?? SEND_SETTINGS_DEFAULTS.auto_pause_on_all_channels_down,
      batch_mode: s?.batch_mode ?? SEND_SETTINGS_DEFAULTS.batch_mode,
      batch_pause_seconds: s?.batch_pause_seconds ?? SEND_SETTINGS_DEFAULTS.batch_pause_seconds,
    };
    const { error: sErr } = await supabaseAdmin
      .from("campaign_send_settings")
      .upsert(settingsRow, { onConflict: "campaign_id" });
    if (sErr) throw new Error(sErr.message);

    // Se "Iniciar agora" foi marcado e não há agendamento, já alimenta a fila.
    // Sem isso a campanha fica em "running" mas nada chega ao ZionTalk porque
    // o cron só lê message_queue.
    let enqueued = 0;
    if (data.initiate && !data.scheduledAt) {
      try {
        const r = await enqueueCampaignCore(campaign.id);
        enqueued = r.enqueued;
      } catch (e: any) {
        await supabaseAdmin
          .from("campaigns")
          .update({ status: "draft" })
          .eq("id", campaign.id);
        throw new Error(`Falha ao enfileirar campanha: ${e?.message ?? e}`);
      }
    }

    return { id: campaign.id, status, eligible: contactIds.length, enqueued };
  });
