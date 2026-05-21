import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import {
  Inbox,
  MessageSquareText,
  Send,
  CheckCheck,
  Megaphone,
  Smartphone,
  TrendingUp,
} from "lucide-react";
import { pct } from "@/lib/utils-format";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard — Denis Envia Flow" }] }),
});

function DashboardPage() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      // 14-day window for chart + response rate, in São Paulo time
      const SP_TZ = "America/Sao_Paulo";
      const dayKey = (iso: string) =>
        new Date(iso).toLocaleDateString("en-CA", { timeZone: SP_TZ });
      const today = new Date();
      const since = new Date(today);
      since.setDate(today.getDate() - 13);
      since.setHours(0, 0, 0, 0);
      const sinceIso = since.toISOString();

      const [sentRecsWindow, channels, campaigns, inMsgs, deliveredCount, failedCount, attemptedCount] = await Promise.all([
        // Destinatários efetivamente entregues nos últimos 14 dias (para o gráfico)
        supabase
          .from("campaign_recipients")
          .select("sent_at")
          .eq("status", "sent")
          .gte("sent_at", sinceIso)
          .limit(10000),
        supabase.from("channels").select("id, label, status, sent_today, daily_limit"),
        supabase.from("campaigns").select("id, name, status").in("status", ["running", "scheduled"]),
        supabase.from("messages").select("conversation_id, created_at").eq("direction", "in").gte("created_at", sinceIso).limit(10000),
        // Totais reais por destinatário (fonte única — bate com Painel e Relatórios)
        supabase.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("status", "sent"),
        supabase.from("campaign_recipients").select("*", { count: "exact", head: true }).eq("status", "failed"),
        // Tentativas de API (apenas hint informativo)
        supabase.from("send_logs").select("*", { count: "exact", head: true }).not("http_status", "is", null),
      ]);
      return {
        sentRecsWindow: sentRecsWindow.data ?? [],
        channels: channels.data ?? [],
        campaigns: campaigns.data ?? [],
        inMsgs: inMsgs.data ?? [],
        delivered: deliveredCount.count ?? 0,
        attempted: attemptedCount.count ?? 0,
        failed: failedCount.count ?? 0,
        dayKey,
        sinceIso,
      };
    },
  });

  // Métrica de "Mensagens enviadas" = destinatários efetivamente entregues
  // (mesma fonte do painel de envios e dos relatórios)
  const delivered = data?.delivered ?? 0;
  const attempted = data?.attempted ?? 0;
  const failed = data?.failed ?? 0;
  // Taxa de entrega usa a MESMA fonte (campaign_recipients): sent / (sent + failed)
  const totalProcessed = delivered + failed;
  const deliveryRate = totalProcessed > 0 ? Math.round((delivered / totalProcessed) * 100) : null;

  // Respostas únicas (por conversa) nos últimos 14 dias
  const uniqueReplyConvs = new Set(
    (data?.inMsgs ?? []).map((m: any) => m.conversation_id).filter(Boolean),
  );
  const replies = uniqueReplyConvs.size;
  const responseRate = pct(replies, delivered);

  // chart: last 14 days of sends
  const today = new Date();
  const dayKey = data?.dayKey ?? ((iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (13 - i));
    const key = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return { date: key, label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), sent: 0, in: 0 };
  });
  const idx = new Map(days.map((d) => [d.date, d]));
  (data?.sentRecsWindow ?? []).forEach((r: any) => {
    if (!r.sent_at) return;
    const k = dayKey(r.sent_at as string);
    const row = idx.get(k);
    if (row) row.sent++;
  });
  (data?.inMsgs ?? []).forEach((m) => {
    const k = dayKey(m.created_at as string);
    const row = idx.get(k);
    if (row) row.in++;
  });

  const connected = (data?.channels ?? []).filter((c) => c.status === "connected").length;
  const totalChannels = data?.channels.length ?? 0;

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Visão geral"
        title="Bem-vindo de volta"
        description="Acompanhe envios, atendimento e a saúde dos canais conectados ao seu workspace."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Send} label="Mensagens enviadas" value={delivered} tone="info" hint={`${attempted.toLocaleString("pt-BR")} tentativas de API (inclui retries)`} />
        <StatCard
          icon={CheckCheck}
          label="Taxa de entrega"
          value={deliveryRate === null ? "—" : `${deliveryRate}%`}
          tone={deliveryRate !== null && deliveryRate >= 90 ? "success" : "warning"}
          hint={`${delivered.toLocaleString("pt-BR")} entregues · ${failed.toLocaleString("pt-BR")} falhas`}
        />
        <StatCard
          icon={MessageSquareText}
          label="Taxa de resposta"
          value={responseRate}
          tone="default"
          hint={`${replies} contatos · 14 dias`}
        />
        <StatCard
          icon={Smartphone}
          label="Canais conectados"
          value={`${connected}/${totalChannels}`}
          tone={connected === totalChannels && totalChannels > 0 ? "success" : "warning"}
          hint={totalChannels === 0 ? "Nenhum canal" : "online agora"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="font-display text-xl tracking-tight">
                Atividade dos últimos 14 dias
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Envios vs. mensagens recebidas por dia.
              </p>
            </div>
            <Badge variant="info" className="hidden sm:inline-flex">
              <TrendingUp className="h-3 w-3" />
              14 dias
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={days} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-chart-2)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                  <RTooltip
                    contentStyle={{
                      backgroundColor: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area type="monotone" dataKey="sent" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#g1)" name="Enviadas" />
                  <Area type="monotone" dataKey="in" stroke="var(--color-chart-2)" strokeWidth={2} fill="url(#g2)" name="Recebidas" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-xl tracking-tight">
              Campanhas em andamento
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {data?.campaigns.length ?? 0} ativa(s) ou agendada(s)
            </p>
          </CardHeader>
          <CardContent>
            {(data?.campaigns.length ?? 0) === 0 ? (
              <EmptyState
                icon={Megaphone}
                title="Nada por enquanto"
                description="Quando você iniciar uma campanha ela aparece aqui."
              />
            ) : (
              <ul className="divide-y divide-border">
                {data?.campaigns.map((c: any) => (
                  <li key={c.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <span className="text-sm font-medium truncate">{c.name ?? c.id.slice(0, 8)}</span>
                    <Badge variant={c.status === "running" ? "success" : "info"} className="capitalize">
                      {c.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="font-display text-xl tracking-tight">
              Saúde dos canais
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Limite diário, status de conexão e utilização atual.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {data?.channels.length ? (
            <ul className="divide-y divide-border">
              {data.channels.map((c) => {
                const used = c.daily_limit > 0 ? Math.round((c.sent_today / c.daily_limit) * 100) : 0;
                return (
                  <li key={c.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0 gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        aria-hidden="true"
                        className={
                          "h-2.5 w-2.5 rounded-full shrink-0 " +
                          (c.status === "connected"
                            ? "bg-success ring-4 ring-success/15"
                            : c.status === "paused"
                            ? "bg-warning ring-4 ring-warning/15"
                            : "bg-destructive ring-4 ring-destructive/15")
                        }
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{c.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.sent_today.toLocaleString("pt-BR")} de {c.daily_limit.toLocaleString("pt-BR")} envios hoje
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="hidden sm:flex flex-col items-end gap-1">
                        <span className="text-xs text-muted-foreground">{used}% usado</span>
                        <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                          <div
                            className={
                              "h-full transition-all " +
                              (used > 90 ? "bg-destructive" : used > 70 ? "bg-warning" : "bg-success")
                            }
                            style={{ width: `${Math.min(used, 100)}%` }}
                          />
                        </div>
                      </div>
                      <Badge
                        variant={
                          c.status === "connected"
                            ? "success"
                            : c.status === "paused"
                            ? "warning"
                            : "destructive"
                        }
                        className="capitalize"
                      >
                        {c.status}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={Smartphone}
              title="Nenhum canal conectado"
              description="Conecte seu primeiro número WhatsApp para começar a enviar mensagens."
              action={
                <a
                  href="/channels"
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Ir para Canais
                </a>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}