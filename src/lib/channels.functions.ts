import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function storeChannelKey(channelId: string, plainKey: string) {
  const secret = process.env.CHANNEL_KEY_SECRET;
  if (!secret) throw new Error("CHANNEL_KEY_SECRET não configurado");
  const { error } = await supabaseAdmin.rpc("set_channel_api_key", {
    p_channel_id: channelId,
    p_plain_key: plainKey,
    p_secret: secret,
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
    await storeChannelKey(inserted.id, data.zion_api_key);
    return { ok: true };
  });

export const updateChannelKeyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      channelId: z.string().uuid(),
      zion_api_key: z.string().min(8).max(200),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    await storeChannelKey(data.channelId, data.zion_api_key);
    const { error } = await supabaseAdmin
      .from("channels")
      .update({ last_error: null })
      .eq("id", data.channelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });