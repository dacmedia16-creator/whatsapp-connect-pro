import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, Play, Pause, Send, Square, RefreshCw, Radio } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { enqueueCampaignFn, processQueueFn } from "@/lib/ziontalk.functions";
import { formatPhone } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/campaigns/$campaignId")({
  component: CampaignDetail,
  head: () => ({ meta: [{ title: "Campanha — ZionFlow" }] }),
});

function CampaignDetail() {
  const { campaignId } = Route.useParams();
  const { role } = useAuth();
  const canManage = role === "admin" || role === "gestor";
  const qc = useQueryClient();
  const enqueue = useServerFn(enqueueCampaignFn);
  const processBatch = useServerFn(processQueueFn);
  const [live, setLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const { data: campaign, isLoading } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", campaignId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: live ? false : 10000,
  });

  const { data: stats } = useQuery({
    queryKey: ["campaign-stats", campaignId],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_recipients")
        .select("status")
        .eq("campaign_id", campaignId);
      const counts = { queued: 0, sent: 0, failed: 0, opted_out: 0 };
      (data ?? []).forEach((r: any) => {
        if (r.status in counts) counts[r.status as keyof typeof counts]++;
      });
      return { ...counts, total: (data ?? []).length };
    },
    refetchInterval: live ? false : 10000,
  });

  const { data: recipients = [] } = useQuery({
    queryKey: ["campaign-recipients", campaignId],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_recipients")
        .select("id, status, error, sent_at, contact:contacts(name, phone_e164)")
        .eq("campaign_id", campaignId)
        .order("sent_at", { ascending: false, nullsFirst: false })
        .limit(200);
      return data ?? [];
    },
    refetchInterval: live ? false : 10000,
  });

  // Realtime: subscribe to changes for this campaign and invalidate queries
  useEffect(() => {
    const channel = supabase
      .channel(`campaign:${campaignId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaigns", filter: `id=eq.${campaignId}` },
        () => {
          setLastUpdate(new Date());
          qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaign_recipients", filter: `campaign_id=eq.${campaignId}` },
        () => {
          setLastUpdate(new Date());
          qc.invalidateQueries({ queryKey: ["campaign-stats", campaignId] });
          qc.invalidateQueries({ queryKey: ["campaign-recipients", campaignId] });
        },
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, qc]);

  const startMut = useMutation({
    mutationFn: async () => enqueue({ data: { campaignId } }),
    onSuccess: (r) => {
      toast.success(`${r.enqueued ?? 0} mensagens enfileiradas`);
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaign-stats", campaignId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendBatch = useMutation({
    mutationFn: async () => processBatch({}),
    onSuccess: (r) => {
      toast.success(`Lote processado: ${r.sent} enviadas, ${r.failed} falharam, ${r.skipped} adiadas`);
      qc.invalidateQueries({ queryKey: ["campaign-stats", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaign-recipients", campaignId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: async (next: "draft" | "scheduled" | "running" | "paused" | "done") => {
      const { error } = await supabase.from("campaigns").update({ status: next }).eq("id", campaignId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      toast.success("Status atualizado");
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!campaign) return <div className="p-6">Campanha não encontrada.</div>;

  const progress = stats && stats.total > 0
    ? Math.round(((stats.sent + stats.failed + stats.opted_out) / stats.total) * 100)
    : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/campaigns" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="h-3 w-3" /> Voltar para campanhas
        </Link>
        <PageHeader
          title={campaign.name}
          description={campaign.description ?? "Sem descrição"}
          actions={
            canManage && (
              <div className="flex gap-2">
                <Badge
                  variant="outline"
                  className={`gap-1 self-center ${live ? "border-success text-success" : "border-muted text-muted-foreground"}`}
                  title={lastUpdate ? `Última atualização: ${format(lastUpdate, "HH:mm:ss")}` : "Aguardando eventos"}
                >
                  <Radio className={`h-3 w-3 ${live ? "animate-pulse" : ""}`} />
                  {live ? "Ao vivo" : "Offline"}
                </Badge>
                {(campaign.status === "draft" || campaign.status === "scheduled") && (
                  <Button onClick={() => startMut.mutate()} disabled={startMut.isPending}>
                    <Play className="h-4 w-4 mr-1" /> Iniciar envio
                  </Button>
                )}
                {campaign.status === "running" && (
                  <>
                    <Button variant="outline" onClick={() => sendBatch.mutate()} disabled={sendBatch.isPending}>
                      <Send className="h-4 w-4 mr-1" /> Processar lote
                    </Button>
                    <Button variant="outline" onClick={() => statusMut.mutate("paused")}>
                      <Pause className="h-4 w-4 mr-1" /> Pausar
                    </Button>
                  </>
                )}
                {campaign.status === "paused" && (
                  <Button onClick={() => statusMut.mutate("running")}>
                    <Play className="h-4 w-4 mr-1" /> Retomar
                  </Button>
                )}
                {(campaign.status === "running" || campaign.status === "paused" || campaign.status === "scheduled") && (
                  <Button variant="outline" onClick={() => statusMut.mutate("done")}>
                    <Square className="h-4 w-4 mr-1" /> Finalizar
                  </Button>
                )}
              </div>
            )
          }
        />
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
        <StatCard label="Status" value={
          <Badge variant="outline">{campaign.status}</Badge>
        } />
        <StatCard label="Total" value={stats?.total ?? 0} />
        <StatCard label="Enviadas" value={stats?.sent ?? 0} cls="text-success" />
        <StatCard label="Falhas" value={stats?.failed ?? 0} cls="text-destructive" />
        <StatCard label="Opt-out" value={stats?.opted_out ?? 0} cls="text-warning" />
      </div>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progresso</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <Progress value={progress} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Agendada para</p>
              <p>{campaign.scheduled_at ? format(new Date(campaign.scheduled_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "Imediato"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Velocidade</p>
              <p>{campaign.rate_per_min} msg/min/canal</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Canais</p>
              <p>{(campaign.channel_ids as string[]).length}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Tags do público</p>
              <p>{((campaign.audience_filter as any)?.tags ?? []).join(", ") || "todos"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-2">
          <h3 className="font-medium">Mensagem</h3>
          <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded p-3 border">{campaign.message_template}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-medium">Destinatários (200 mais recentes)</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => qc.invalidateQueries({ queryKey: ["campaign-recipients", campaignId] })}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contato</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enviada em</TableHead>
                <TableHead>Erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Nenhum destinatário ainda. Inicie o envio para enfileirar.
                </TableCell></TableRow>
              )}
              {recipients.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.contact?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.contact?.phone_e164 ? formatPhone(r.contact.phone_e164) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        r.status === "sent" ? "border-success text-success"
                        : r.status === "failed" ? "border-destructive text-destructive"
                        : r.status === "opted_out" ? "border-warning text-warning"
                        : ""
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.sent_at ? format(new Date(r.sent_at), "dd/MM HH:mm:ss", { locale: ptBR }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-destructive max-w-xs truncate" title={r.error ?? ""}>
                    {r.error ?? ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, cls }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase">{label}</p>
        <p className={`text-2xl font-display mt-1 ${cls ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}