import { supabase } from "@/integrations/supabase/client";

/**
 * Garante que o access_token está válido por pelo menos `leewaySec` segundos.
 * Se estiver perto do vencimento, força refresh. Silencioso em falha — a
 * próxima chamada autenticada vai responder 401 e o handler de erro cuida.
 */
export async function ensureFreshSession(leewaySec = 60): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s?.expires_at) return;
    const nowSec = Math.floor(Date.now() / 1000);
    if (s.expires_at - nowSec < leewaySec) {
      await supabase.auth.refreshSession();
    }
  } catch {
    /* noop */
  }
}

const AUTH_ERROR_PATTERNS = [
  "jwt expired",
  "jwt has expired",
  "unauthorized",
  "no authorization header",
  "invalid jwt",
  "token is expired",
];

export function isAuthError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => msg.includes(p));
}