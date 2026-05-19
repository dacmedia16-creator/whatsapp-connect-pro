import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function rolesFor(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return new Set((data ?? []).map((r) => r.role));
}

async function canEditConversation(userId: string, conversationId: string) {
  const roles = await rolesFor(userId);
  if (roles.has("admin") || roles.has("gestor")) return true;
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("assigned_to")
    .eq("id", conversationId)
    .maybeSingle();
  return !!data && data.assigned_to === userId;
}

export const assignConversationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      conversationId: z.string().uuid(),
      assignedTo: z.string().uuid().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const roles = await rolesFor(context.userId);
    if (!roles.has("admin") && !roles.has("gestor")) {
      throw new Error("Sem permissão para atribuir conversas");
    }
    const { error } = await supabaseAdmin
      .from("conversations")
      .update({
        assigned_to: data.assignedTo,
        status: data.assignedTo ? "em_atendimento" : "novo",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateConversationStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      conversationId: z.string().uuid(),
      status: z.enum(["novo", "em_atendimento", "aguardando_cliente", "resolvido"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await canEditConversation(context.userId, data.conversationId))) {
      throw new Error("Sem permissão para esta conversa");
    }
    const { error } = await supabaseAdmin
      .from("conversations")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addInternalNoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      conversationId: z.string().uuid(),
      body: z.string().trim().min(1).max(4096),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await canEditConversation(context.userId, data.conversationId))) {
      throw new Error("Sem permissão para esta conversa");
    }
    const { error } = await supabaseAdmin.from("messages").insert({
      conversation_id: data.conversationId,
      direction: "out",
      body: data.body,
      internal_note: true,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markConversationReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await canEditConversation(context.userId, data.conversationId))) {
      return { ok: false };
    }
    await supabaseAdmin
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", data.conversationId);
    return { ok: true };
  });

export const setContactConsentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      contactId: z.string().uuid(),
      consent: z.boolean(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const roles = await rolesFor(context.userId);
    if (!roles.has("admin") && !roles.has("gestor")) {
      throw new Error("Apenas admin ou gestor pode alterar o consentimento");
    }
    const { data: contact, error: cErr } = await supabaseAdmin
      .from("contacts")
      .select("id, opt_out_at")
      .eq("id", data.contactId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!contact) throw new Error("Contato não encontrado");

    if (data.consent && contact.opt_out_at) {
      throw new Error("Contato fez opt-out. Remova o opt-out antes de liberar o consentimento.");
    }

    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({
        consent: data.consent,
        consent_at: data.consent ? nowIso : null,
        updated_at: nowIso,
      })
      .eq("id", data.contactId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const audiencePreviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ tags: z.array(z.string()).max(20).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    let elig = supabaseAdmin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("consent", true)
      .is("opt_out_at", null);
    let optedOut = supabaseAdmin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .not("opt_out_at", "is", null);
    let noConsent = supabaseAdmin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("consent", false)
      .is("opt_out_at", null);
    if (data.tags?.length) {
      elig = elig.contains("tags", data.tags);
      optedOut = optedOut.contains("tags", data.tags);
      noConsent = noConsent.contains("tags", data.tags);
    }
    const [{ count: eligible }, { count: blockedOptOut }, { count: blockedConsent }] = await Promise.all([
      elig, optedOut, noConsent,
    ]);
    return {
      eligible: eligible ?? 0,
      blockedOptOut: blockedOptOut ?? 0,
      blockedConsent: blockedConsent ?? 0,
    };
  });