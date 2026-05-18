import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function rotateKey(channelId: string, plainKey: string, userId: string) {
  const secret = process.env.CHANNEL_KEY_SECRET;
  if (!secret) throw new Error("CHANNEL_KEY_SECRET não configurado");
  const { error } = await supabaseAdmin.rpc("rotate_channel_api_key", {
    p_channel_id: channelId,
    p_plain_key: plainKey,
    p_secret: secret,
    p_user: userId,
  });
  if (error) throw new Error(error.message);
}

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Apenas administradores podem gerenciar canais");
}

export const createChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      label: z.string().trim().min(1).max(80),
      phone_e164: z.string().regex(/^\+\d{8,15}$/),
      zion_api_key: z.string().min(8).max(200),
      daily_limit: z.number().int().min(1).max(100000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: inserted, error } = await supabaseAdmin.from("channels").insert({
      label: data.label,
      phone_e164: data.phone_e164,
      zion_api_key: "",
      zion_api_key_hint: data.zion_api_key.slice(-4),
      daily_limit: data.daily_limit,
      created_by: context.userId,
    }).select("id").single();
    if (error) throw new Error(error.message);
    await rotateKey(inserted.id, data.zion_api_key, context.userId);
    return { ok: true };
  });

export const rotateChannelKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      channelId: z.string().uuid(),
      zion_api_key: z.string().min(8).max(200),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    await rotateKey(data.channelId, data.zion_api_key, context.userId);
    return { ok: true };
  });

// Backwards-compat alias
export const updateChannelKeyFn = rotateChannelKeyFn;

export const revokeChannelKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      keyId: z.string().uuid(),
      reason: z.string().trim().max(240).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.rpc("revoke_channel_api_key", {
      p_key_id: data.keyId,
      p_user: context.userId,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listChannelKeysFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ channelId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("channel_api_keys")
      .select("id, version, hint, status, created_by, created_at, revoked_at, revoked_by, revoked_reason")
      .eq("channel_id", data.channelId)
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return { keys: rows ?? [] };
  });