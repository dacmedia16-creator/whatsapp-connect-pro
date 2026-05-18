import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
    const hint = data.zion_api_key.slice(-4);
    const { error } = await supabaseAdmin.from("channels").insert({
      label: data.label,
      phone_e164: data.phone_e164,
      zion_api_key: data.zion_api_key,
      zion_api_key_hint: hint,
      daily_limit: data.daily_limit,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
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
    const { error } = await supabaseAdmin
      .from("channels")
      .update({
        zion_api_key: data.zion_api_key,
        zion_api_key_hint: data.zion_api_key.slice(-4),
        last_error: null,
      })
      .eq("id", data.channelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });