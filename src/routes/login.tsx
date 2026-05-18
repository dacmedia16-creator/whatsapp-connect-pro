import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { MessageSquareText } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Entrar — ZionFlow" }] }),
});

function LoginPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) nav({ to: "/dashboard" });
  }, [user, nav]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bem-vindo de volta!");
    nav({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-6 w-6 text-gold" />
          <span className="font-display text-2xl">ZionFlow</span>
        </div>
        <div className="space-y-3">
          <h1 className="font-display text-4xl leading-tight">
            Conversas que respeitam quem está do outro lado.
          </h1>
          <p className="text-sidebar-foreground/70 max-w-md">
            Campanhas autorizadas, atendimento centralizado e relatórios — com a API ZionTalk integrada de ponta a ponta.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© ZionFlow</p>
      </div>

      <div className="flex items-center justify-center p-8">
        <Card className="w-full max-w-md border-border/60">
          <CardHeader>
            <CardTitle className="font-display text-3xl">Entrar</CardTitle>
            <CardDescription>Acesse sua conta para gerenciar campanhas.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Entrando…" : "Entrar"}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                Ainda não tem conta?{" "}
                <Link to="/signup" className="text-primary font-medium hover:underline">
                  Criar conta
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}