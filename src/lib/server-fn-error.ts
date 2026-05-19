import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isAuthError } from "./auth-session";

let handlingAuthError = false;

/**
 * Trata erros de serverFn de forma consistente. Para erros de sessão
 * expirada/inválida, desloga e redireciona pro login com toast amigável.
 * Para qualquer outro erro, mostra o `fallback` (ou a mensagem original).
 * Retorna `true` se foi tratado como erro de auth.
 */
export function handleServerFnError(e: unknown, fallback?: string): boolean {
  if (isAuthError(e)) {
    if (!handlingAuthError) {
      handlingAuthError = true;
      toast.error("Sua sessão expirou. Faça login novamente.");
      void supabase.auth.signOut().finally(() => {
        if (typeof window !== "undefined") {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.replace(`/login?next=${next}`);
        }
      });
    }
    return true;
  }
  const msg = e instanceof Error ? e.message : String(e ?? "");
  toast.error(msg || fallback || "Ocorreu um erro inesperado");
  return false;
}