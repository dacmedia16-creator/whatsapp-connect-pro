import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Inbox, MessageSquareText, Send, CheckCheck, Megaphone, Smartphone } from "lucide-react";
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
  head: () => ({ meta: [{ title: "Dashboard — ZionFlow" }] }),
});

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Inbox;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="font-display text-3xl text-foreground mt-2">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [logs, channels, campaigns, inMsgs] = await Promise.all([
        supabase.from("send_logs").select("http_status, created_at"),
        supabase.from("channels").select("id, label, status, sent_today, daily_limit"),
        supabase.from("campaigns").select("id, status").in("status", ["running", "scheduled"]),
        supabase.from("messages").select("id, created_at").eq("direction", "in"),
      ]);
      return {
        logs: logs.data ?? [],
        channels: channels.data ?? [],
        campaigns: campaigns.data ?? [],
        inMsgs: inMsgs.data ?? [],
      };
    },
  });

  const sent = (data?.logs ?? []).filter((l) => l.http_status && l.http_status < 300).length;
  const delivered = sent;
  const replies = data?.inMsgs.length ?? 0;
  const responseRate = pct(replies, sent);

  // chart: last 14 days of sends
  const today = new Date();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return { date: key, label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), sent: 0, in: 0 };
  });
  const idx = new Map(days.map((d) => [d.date, d]));
  (data?.logs ?? []).forEach((l) => {
    const k = (l.created_at as string).slice(0, 10);
    const row = idx.get(k);
    if (row && l.http_status && l.http_status < 300) row.sent++;
  });
  (data?.inMsgs ?? []).forEach((m) => {
    const k = (m.created_at as string).slice(0, 10);
    const row = idx.get(k);
    if (row) row.in++;
  });

  const connected = (data?.channels ?? []).filter((c) => c.status === "connected").length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Visão geral"
        description="Métricas de envio, atendimento e saúde dos canais conectados."
      />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard icon={Send} label="Enviadas" value={sent} />
        <StatCard icon={CheckCheck} label="Entregues" value={delivered} sub="≈ status HTTP 2xx" />
        <StatCard icon={MessageSquareText} label="Respostas" value={replies} />
        <StatCard icon={Inbox} label="Taxa de resposta" value={responseRate} />
        <StatCard icon={Megaphone} label="Campanhas ativas" value={data?.campaigns.length ?? 0} />
        <StatCard icon={Smartphone} label="Canais conectados" value={connected} sub={`${data?.channels.length ?? 0} total`} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-display text-xl">Atividade últimos 14 dias</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={days}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chart-2)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <RTooltip />
                <Area type="monotone" dataKey="sent" stroke="var(--color-chart-1)" fill="url(#g1)" name="Enviadas" />
                <Area type="monotone" dataKey="in" stroke="var(--color-chart-2)" fill="url(#g2)" name="Recebidas" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-xl">Status dos canais</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.channels.length ? (
            <div className="divide-y">
              {data.channels.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        "h-2.5 w-2.5 rounded-full " +
                        (c.status === "connected"
                          ? "bg-success"
                          : c.status === "paused"
                          ? "bg-warning"
                          : "bg-destructive")
                      }
                    />
                    <span className="font-medium">{c.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      {c.sent_today}/{c.daily_limit} hoje
                    </span>
                    <Badge variant="outline" className="capitalize">
                      {c.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum canal cadastrado. Vá para <a href="/channels" className="text-primary hover:underline">Canais</a> para adicionar.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}