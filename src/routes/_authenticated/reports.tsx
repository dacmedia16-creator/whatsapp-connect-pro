import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Relatórios — ZionFlow" }] }),
});

function ReportsPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Relatórios" description="Métricas por campanha, canal e atendente." />
      <Tabs defaultValue="campaigns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
          <TabsTrigger value="channels">Canais</TabsTrigger>
          <TabsTrigger value="agents">Atendentes</TabsTrigger>
        </TabsList>
        <TabsContent value="campaigns"><CampaignsReport /></TabsContent>
        <TabsContent value="channels"><ChannelsReport /></TabsContent>
        <TabsContent value="agents"><AgentsReport /></TabsContent>
      </Tabs>
    </div>
  );
}

function CampaignsReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-campaigns"],
    queryFn: async () => {
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, name, status, created_at, total_recipients")
        .order("created_at", { ascending: false })
        .limit(50);
      const ids = (campaigns ?? []).map((c) => c.id);
      const { data: recs } = await supabase
        .from("campaign_recipients")
        .select("campaign_id, status")
        .in("campaign_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const { data: replies } = await supabase
        .from("messages")
        .select("campaign_id, direction")
        .in("campaign_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
        .eq("direction", "in");
      const byCamp: Record<string, { queued: number; sent: number; failed: number; opted_out: number; replies: number }> = {};
      (recs ?? []).forEach((r: any) => {
        const o = (byCamp[r.campaign_id] ??= { queued: 0, sent: 0, failed: 0, opted_out: 0, replies: 0 });
        if (r.status in o) (o as any)[r.status]++;
      });
      (replies ?? []).forEach((m: any) => {
        if (!m.campaign_id) return;
        const o = (byCamp[m.campaign_id] ??= { queued: 0, sent: 0, failed: 0, opted_out: 0, replies: 0 });
        o.replies++;
      });
      return (campaigns ?? []).map((c: any) => {
        const m = byCamp[c.id] ?? { queued: 0, sent: 0, failed: 0, opted_out: 0, replies: 0 };
        const responseRate = m.sent > 0 ? Math.round((m.replies / m.sent) * 100) : 0;
        return { ...c, ...m, responseRate };
      });
    },
  });
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Campanha</TableHead><TableHead>Status</TableHead>
          <TableHead className="text-right">Na fila</TableHead><TableHead className="text-right">Enviadas</TableHead>
          <TableHead className="text-right">Falhas</TableHead><TableHead className="text-right">Opt-out</TableHead>
          <TableHead className="text-right">Respostas</TableHead><TableHead className="text-right">Taxa resp.</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>}
          {!isLoading && (data ?? []).length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhuma campanha.</TableCell></TableRow>}
          {(data ?? []).map((c: any) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
              <TableCell className="text-right">{c.queued}</TableCell>
              <TableCell className="text-right text-success">{c.sent}</TableCell>
              <TableCell className="text-right text-destructive">{c.failed}</TableCell>
              <TableCell className="text-right text-warning">{c.opted_out}</TableCell>
              <TableCell className="text-right">{c.replies}</TableCell>
              <TableCell className="text-right">{c.responseRate}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function ChannelsReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-channels"],
    queryFn: async () => {
      const { data: channels } = await supabase
        .from("channels")
        .select("id, label, phone_e164, status, sent_today, daily_limit, last_error");
      const ids = (channels ?? []).map((c) => c.id);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { data: logs } = await supabase
        .from("send_logs")
        .select("channel_id, http_status, created_at")
        .gte("created_at", today.toISOString())
        .in("channel_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const errCount: Record<string, number> = {};
      (logs ?? []).forEach((l: any) => {
        if (l.http_status >= 300 && l.channel_id) errCount[l.channel_id] = (errCount[l.channel_id] ?? 0) + 1;
      });
      return (channels ?? []).map((c: any) => ({ ...c, errors_today: errCount[c.id] ?? 0 }));
    },
  });
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Canal</TableHead><TableHead>Status</TableHead>
          <TableHead className="text-right">Enviadas hoje</TableHead><TableHead className="text-right">Limite</TableHead>
          <TableHead className="text-right">Erros hoje</TableHead><TableHead>Último erro</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>}
          {!isLoading && (data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum canal.</TableCell></TableRow>}
          {(data ?? []).map((c: any) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.label}</TableCell>
              <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
              <TableCell className="text-right">{c.sent_today}</TableCell>
              <TableCell className="text-right">{c.daily_limit}</TableCell>
              <TableCell className="text-right text-destructive">{c.errors_today}</TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={c.last_error ?? ""}>{c.last_error ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function AgentsReport() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-agents"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["admin", "gestor", "atendente"]);
      const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
      if (!ids.length) return [];
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      const { data: convs } = await supabase
        .from("conversations")
        .select("assigned_to, status, created_at, updated_at")
        .in("assigned_to", ids);
      const { data: msgs } = await supabase
        .from("messages")
        .select("created_by, created_at, conversation_id, direction")
        .in("created_by", ids)
        .eq("direction", "out");

      // average response time per agent: time between an inbound msg and the agent's next outbound on same conv
      const { data: inMsgs } = await supabase
        .from("messages")
        .select("conversation_id, created_at")
        .eq("direction", "in")
        .order("created_at", { ascending: true })
        .limit(2000);
      const lastInByConv = new Map<string, Date>();
      (inMsgs ?? []).forEach((m: any) => lastInByConv.set(m.conversation_id, new Date(m.created_at)));

      const stats: Record<string, { assigned: number; resolved: number; respSum: number; respN: number }> = {};
      (convs ?? []).forEach((c: any) => {
        const s = (stats[c.assigned_to] ??= { assigned: 0, resolved: 0, respSum: 0, respN: 0 });
        s.assigned++;
        if (c.status === "resolvido") s.resolved++;
      });
      (msgs ?? []).forEach((m: any) => {
        const inAt = lastInByConv.get(m.conversation_id);
        if (!inAt) return;
        const out = new Date(m.created_at);
        if (out <= inAt) return;
        const s = (stats[m.created_by] ??= { assigned: 0, resolved: 0, respSum: 0, respN: 0 });
        s.respSum += (out.getTime() - inAt.getTime()) / 60000; // minutes
        s.respN++;
      });

      return (profs ?? []).map((p: any) => {
        const s = stats[p.id] ?? { assigned: 0, resolved: 0, respSum: 0, respN: 0 };
        return {
          ...p,
          assigned: s.assigned,
          resolved: s.resolved,
          avgResponse: s.respN > 0 ? Math.round(s.respSum / s.respN) : null,
        };
      });
    },
  });

  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Atendente</TableHead>
          <TableHead className="text-right">Atribuídas</TableHead>
          <TableHead className="text-right">Resolvidas</TableHead>
          <TableHead className="text-right">Tempo médio resp.</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>}
          {!isLoading && (data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum atendente.</TableCell></TableRow>}
          {(data ?? []).map((a: any) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.full_name ?? a.email}</TableCell>
              <TableCell className="text-right">{a.assigned}</TableCell>
              <TableCell className="text-right">{a.resolved}</TableCell>
              <TableCell className="text-right">{a.avgResponse !== null ? `${a.avgResponse} min` : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}