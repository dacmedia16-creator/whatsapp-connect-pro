import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Activity, AlertCircle, ArrowDown, ArrowUp, CheckCircle2, Clock, Gauge, Inbox, Pause, Play,
  RefreshCw, Send, Square, Radio, Smartphone, XCircle, Zap, TestTube, Save,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  getSendSettingsFn, upsertSendSettingsFn, getSendPanelOverviewFn,
  getChannelsHealthFn, pauseChannelFn, setCampaignStatusFn,
  requeueFailedFn, requeueRecipientFn, markIgnoredFn,
  getQueueRowsFn, getLiveActivityFn,
} from "@/lib/send-panel.functions";
import { enqueueCampaignFn, processQueueFn, testChannelFn } from "@/lib/ziontalk.functions";
import { formatPhone } from "@/lib/phone";

export const Route = createFileRoute("/_authenticated/sending-panel")({
  component: SendingPanel,
  head: () => ({ meta: [{ title: "Painel de Envios — ZionFlow" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    campaignId: typeof s.campaignId === "string" ? s.campaignId : undefined,
  }),
});

function SendingPanel() {
  const { campaignId: initialId } = Route.useSearch();
  const { role } = useAuth();
  const canManage = role === "admin" || role === "gestor";
  const qc = useQueryClient();
  const [campaignId, setCampaignId] = useState<string | null>(initialId ?? null);
  const [rtStatus, setRtStatus] = useState<"connecting" | "live" | "offline">("connecting");

  const { data: campaigns = [] } = useQuery({
    queryKey: ["sp-campaigns"],
    queryFn: async () => {
      const { data } = await supabase.from("campaigns")
        .select("id, name, status, total_recipients, scheduled_at, message_template, created_at")
        .order("created_at", { ascending: false }).limit(100);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!campaignId && campaigns.length) setCampaignId(campaigns[0].id);
  }, [campaigns, campaignId]);

  const campaign = campaigns.find((c) => c.id === campaignId);

  // Realtime
  useEffect(() => {
    if (!campaignId) return;
    const channel = supabase
      .channel(`sp:${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_queue" }, () => {
        qc.invalidateQueries({ queryKey: ["sp-overview", campaignId] });
        qc.invalidateQueries({ queryKey: ["sp-queue", campaignId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "send_logs" }, () => {
        qc.invalidateQueries({ queryKey: ["sp-overview", campaignId] });
        qc.invalidateQueries({ queryKey: ["sp-activity", campaignId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "channels" }, () => {
        qc.invalidateQueries({ queryKey: ["sp-channels"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "campaigns", filter: `id=eq.${campaignId}` }, () => {
        qc.invalidateQueries({ queryKey: ["sp-campaigns"] });
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setRtStatus("live");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setRtStatus("offline");
        else setRtStatus("connecting");
      });
    return () => { supabase.removeChannel(channel); };
  }, [campaignId, qc]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="Painel de Controle de Envios"
          description="Gerencie canais, velocidade, alternância e segurança dos disparos."
        />
        <Badge variant="outline" className={`gap-1 mt-2 ${rtStatus === "live" ? "border-success text-success" : rtStatus === "offline" ? "border-destructive text-destructive" : "border-muted text-muted-foreground"}`}>
          <Radio className={`h-3 w-3 ${rtStatus === "live" ? "animate-pulse" : ""}`} />
          {rtStatus === "live" ? "Tempo real" : rtStatus === "offline" ? "Offline" : "Conectando…"}
        </Badge>
      </div>

      <OverviewSection campaignId={campaignId} />

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 md:items-end">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Campanha</Label>
            <Select value={campaignId ?? ""} onValueChange={setCampaignId}>
              <SelectTrigger><SelectValue placeholder="Selecione uma campanha" /></SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {campaign && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">Status: </span><Badge variant="outline">{campaign.status}</Badge></div>
              <div><span className="text-muted-foreground">Total: </span><strong>{campaign.total_recipients}</strong></div>
              <div><span className="text-muted-foreground">Agendamento: </span>{campaign.scheduled_at ? format(new Date(campaign.scheduled_at), "dd/MM HH:mm", { locale: ptBR }) : "Imediato"}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {campaign && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Mensagem</p>
            <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded p-3 border max-h-32 overflow-auto">{campaign.message_template}</p>
          </CardContent>
        </Card>
      )}

      {campaignId && canManage && (
        <PanelTabs campaignId={campaignId} campaignStatus={campaign?.status ?? "draft"} />
      )}
      {campaignId && !canManage && (
        <Card><CardContent className="p-6 text-center text-muted-foreground">
          Apenas administradores e gestores podem operar o painel de envios.
        </CardContent></Card>
      )}
    </div>
  );
}

function OverviewSection({ campaignId }: { campaignId: string | null }) {
  const getOverview = useServerFn(getSendPanelOverviewFn);
  const { data: ov } = useQuery({
    queryKey: ["sp-overview", campaignId],
    queryFn: () => getOverview({ data: { campaignId } }),
    refetchInterval: 10000,
  });
  const items = [
    { label: "Total na fila", value: ov?.total ?? 0, icon: Inbox, cls: "" },
    { label: "Enviados", value: ov?.sent ?? 0, icon: CheckCircle2, cls: "text-success" },
    { label: "Pendentes", value: ov?.pending ?? 0, icon: Clock, cls: "text-warning" },
    { label: "Falhas", value: ov?.failed ?? 0, icon: XCircle, cls: "text-destructive" },
    { label: "Canais ativos", value: ov?.activeChannels ?? 0, icon: Smartphone, cls: "" },
    { label: "Velocidade (msg/min)", value: ov?.ratePerMin ?? 0, icon: Zap, cls: "text-primary" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{it.label}</p>
              <it.icon className={`h-4 w-4 ${it.cls || "text-muted-foreground"}`} />
            </div>
            <p className={`text-2xl font-display mt-1 ${it.cls}`}>{it.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PanelTabs({ campaignId, campaignStatus }: { campaignId: string; campaignStatus: string }) {
  return (
    <Tabs defaultValue="channels">
      <TabsList className="grid grid-cols-3 md:grid-cols-6 w-full">
        <TabsTrigger value="channels">Canais</TabsTrigger>
        <TabsTrigger value="speed">Velocidade & Horário</TabsTrigger>
        <TabsTrigger value="controls">Controles</TabsTrigger>
        <TabsTrigger value="progress">Progresso</TabsTrigger>
        <TabsTrigger value="queue">Fila</TabsTrigger>
        <TabsTrigger value="activity">Atividade</TabsTrigger>
      </TabsList>

      <TabsContent value="channels" className="mt-4 space-y-4">
        <ChannelsAndRotation campaignId={campaignId} />
      </TabsContent>

      <TabsContent value="speed" className="mt-4">
        <SpeedAndHours campaignId={campaignId} />
      </TabsContent>

      <TabsContent value="controls" className="mt-4">
        <ControlsBar campaignId={campaignId} campaignStatus={campaignStatus} />
      </TabsContent>

      <TabsContent value="progress" className="mt-4">
        <ProgressSection campaignId={campaignId} />
      </TabsContent>

      <TabsContent value="queue" className="mt-4">
        <QueueTable campaignId={campaignId} />
      </TabsContent>

      <TabsContent value="activity" className="mt-4">
        <LiveActivity campaignId={campaignId} />
      </TabsContent>
    </Tabs>
  );
}

// ---------- Settings shared loader ----------
function useSettings(campaignId: string) {
  const getSettings = useServerFn(getSendSettingsFn);
  return useQuery({
    queryKey: ["sp-settings", campaignId],
    queryFn: () => getSettings({ data: { campaignId } }),
  });
}
function useSaveSettings(campaignId: string) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertSendSettingsFn);
  return useMutation({
    mutationFn: async (s: any) => upsert({ data: { campaignId, ...s } }),
    onSuccess: () => {
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["sp-settings", campaignId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ---------- Channels + Rotation ----------
function ChannelsAndRotation({ campaignId }: { campaignId: string }) {
  const { data: settings } = useSettings(campaignId);
  const saveMut = useSaveSettings(campaignId);
  const getChannels = useServerFn(getChannelsHealthFn);
  const { data: channels = [] } = useQuery({
    queryKey: ["sp-channels"],
    queryFn: () => getChannels(),
    refetchInterval: 15000,
  });
  const pauseCh = useServerFn(pauseChannelFn);
  const testCh = useServerFn(testChannelFn);
  const qc = useQueryClient();

  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"round_robin" | "least_used" | "manual_priority">("round_robin");
  const [priority, setPriority] = useState<string[]>([]);

  useEffect(() => {
    if (settings) {
      setSelected(settings.selected_channel_ids ?? []);
      setMode((settings.rotation_mode as any) ?? "round_robin");
      setPriority(settings.channel_priority ?? []);
    }
  }, [settings]);

  const toggle = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const movePriority = (idx: number, dir: -1 | 1) => {
    setPriority((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  // keep priority in sync with selected
  useEffect(() => {
    setPriority((prev) => {
      const filtered = prev.filter((id) => selected.includes(id));
      const missing = selected.filter((id) => !filtered.includes(id));
      return [...filtered, ...missing];
    });
  }, [selected]);

  const save = () => saveMut.mutate({
    ...settings,
    selected_channel_ids: selected,
    rotation_mode: mode,
    channel_priority: priority,
  });

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Canais disponíveis</h3>
              <p className="text-xs text-muted-foreground">Selecione quais números participam do envio.</p>
            </div>
            <Button size="sm" onClick={save} disabled={saveMut.isPending}>
              <Save className="h-4 w-4 mr-1" /> Salvar
            </Button>
          </div>
          <div className="grid gap-2">
            {channels.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Nenhum canal cadastrado.</p>}
            {channels.map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 p-3 border rounded-md">
                <Checkbox checked={selected.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{c.label}</span>
                    <span className="text-xs font-mono text-muted-foreground">{formatPhone(c.phone_e164)}</span>
                    <ChannelStatusBadge status={c.status} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                    <span>Enviados hoje: <strong>{c.sent_today_effective}</strong> / {c.daily_limit}</span>
                    <span>Saldo: <strong>{c.remaining_today}</strong></span>
                    <span>Último envio: {c.last_sent_at ? formatDistanceToNow(new Date(c.last_sent_at), { locale: ptBR, addSuffix: true }) : "—"}</span>
                    {c.last_error && <span className="text-destructive truncate" title={c.last_error}>Erro: {c.last_error.slice(0, 60)}</span>}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={async () => {
                  await pauseCh({ data: { channelId: c.id, pause: c.status !== "paused" } });
                  qc.invalidateQueries({ queryKey: ["sp-channels"] });
                  toast.success(c.status === "paused" ? "Canal retomado" : "Canal pausado");
                }}>
                  {c.status === "paused" ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                </Button>
                <Button size="sm" variant="outline" onClick={async () => {
                  try {
                    const r = await testCh({ data: { channelId: c.id } });
                    qc.invalidateQueries({ queryKey: ["sp-channels"] });
                    toast[r.ok ? "success" : "error"](`Teste: HTTP ${r.status}`);
                  } catch (e) { toast.error((e as Error).message); }
                }}>
                  <TestTube className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <h3 className="font-medium">Distribuição dos envios</h3>
            <p className="text-xs text-muted-foreground">Como alternar entre os canais selecionados.</p>
          </div>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <div className="flex items-start gap-3 p-3 border rounded-md">
              <RadioGroupItem value="round_robin" id="rm-rr" />
              <Label htmlFor="rm-rr" className="flex-1 cursor-pointer">
                <span className="font-medium">Round-robin</span>
                <p className="text-xs text-muted-foreground font-normal">Alterna igualmente. Ex.: Canal 1, 2, 3, 1, 2…</p>
              </Label>
            </div>
            <div className="flex items-start gap-3 p-3 border rounded-md">
              <RadioGroupItem value="least_used" id="rm-lu" />
              <Label htmlFor="rm-lu" className="flex-1 cursor-pointer">
                <span className="font-medium">Menor uso</span>
                <p className="text-xs text-muted-foreground font-normal">Escolhe sempre o canal com menos envios no dia.</p>
              </Label>
            </div>
            <div className="flex items-start gap-3 p-3 border rounded-md">
              <RadioGroupItem value="manual_priority" id="rm-mp" />
              <Label htmlFor="rm-mp" className="flex-1 cursor-pointer">
                <span className="font-medium">Prioridade manual</span>
                <p className="text-xs text-muted-foreground font-normal">Use a ordem abaixo. Primeiro da fila é usado até atingir o limite.</p>
              </Label>
            </div>
          </RadioGroup>

          {mode === "manual_priority" && priority.length > 0 && (
            <div className="space-y-1 pt-2">
              <p className="text-xs text-muted-foreground">Ordem (1 = mais prioritário)</p>
              {priority.map((id, i) => {
                const ch = channels.find((c: any) => c.id === id);
                if (!ch) return null;
                return (
                  <div key={id} className="flex items-center gap-2 p-2 border rounded">
                    <span className="text-xs w-6 text-muted-foreground">#{i + 1}</span>
                    <span className="flex-1 text-sm">{ch.label} <span className="text-muted-foreground font-mono text-xs">{formatPhone(ch.phone_e164)}</span></span>
                    <Button size="icon" variant="ghost" onClick={() => movePriority(i, -1)} disabled={i === 0}><ArrowUp className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => movePriority(i, 1)} disabled={i === priority.length - 1}><ArrowDown className="h-3 w-3" /></Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ChannelStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    connected: { cls: "border-success text-success", label: "Ativo" },
    paused: { cls: "border-warning text-warning", label: "Pausado" },
    error: { cls: "border-destructive text-destructive", label: "Erro" },
    disconnected: { cls: "border-muted text-muted-foreground", label: "Desconectado" },
  };
  const m = map[status] ?? map.disconnected;
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
}

// ---------- Speed + Hours ----------
function SpeedAndHours({ campaignId }: { campaignId: string }) {
  const { data: settings } = useSettings(campaignId);
  const save = useSaveSettings(campaignId);
  const [s, setS] = useState<any>(null);

  useEffect(() => { if (settings) setS({ ...settings }); }, [settings]);
  if (!s) return <p className="text-muted-foreground">Carregando…</p>;

  const upd = (k: string, v: any) => setS({ ...s, [k]: v });
  const toggleDay = (d: number) => {
    const days: number[] = s.allowed_weekdays ?? [];
    upd("allowed_weekdays", days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
  };
  const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium flex items-center gap-2"><Gauge className="h-4 w-4" /> Velocidade</h3>
          </div>
          <div>
            <Label className="text-xs">Tempo entre envios (segundos)</Label>
            <Input type="number" min={0} max={3600} value={s.delay_seconds} onChange={(e) => upd("delay_seconds", +e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Variação min (s)</Label>
              <Input type="number" value={s.random_delay_min ?? ""} placeholder="opcional" onChange={(e) => upd("random_delay_min", e.target.value === "" ? null : +e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Variação max (s)</Label>
              <Input type="number" value={s.random_delay_max ?? ""} placeholder="opcional" onChange={(e) => upd("random_delay_max", e.target.value === "" ? null : +e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Máx por minuto</Label>
            <Input type="number" min={1} value={s.max_per_minute} onChange={(e) => upd("max_per_minute", +e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Máx por hora</Label>
            <Input type="number" min={1} value={s.max_per_hour} onChange={(e) => upd("max_per_hour", +e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Máx por dia por canal</Label>
            <Input type="number" min={1} value={s.max_per_day_per_channel} onChange={(e) => upd("max_per_day_per_channel", +e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-medium flex items-center gap-2"><Clock className="h-4 w-4" /> Horário permitido</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Início</Label>
              <Input type="time" value={s.allowed_start_time?.slice(0, 5)} onChange={(e) => upd("allowed_start_time", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Fim</Label>
              <Input type="time" value={s.allowed_end_time?.slice(0, 5)} onChange={(e) => upd("allowed_end_time", e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Dias da semana</Label>
            <div className="flex gap-1 flex-wrap">
              {dayNames.map((n, d) => (
                <Button key={d} size="sm" type="button"
                  variant={s.allowed_weekdays?.includes(d) ? "default" : "outline"}
                  onClick={() => toggleDay(d)}>{n}</Button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Fuso horário</Label>
            <Input value={s.timezone} onChange={(e) => upd("timezone", e.target.value)} />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Switch checked={s.auto_pause_outside_hours} onCheckedChange={(v) => upd("auto_pause_outside_hours", v)} />
            <Label className="text-sm">Pausar automaticamente fora do horário</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={s.auto_pause_on_all_channels_down} onCheckedChange={(v) => upd("auto_pause_on_all_channels_down", v)} />
            <Label className="text-sm">Pausar se todos os canais ficarem indisponíveis</Label>
          </div>
        </CardContent>
      </Card>

      <div className="md:col-span-2 flex justify-end">
        <Button onClick={() => save.mutate(s)} disabled={save.isPending}><Save className="h-4 w-4 mr-1" /> Salvar configurações</Button>
      </div>
    </div>
  );
}

// ---------- Controls ----------
function ControlsBar({ campaignId, campaignStatus }: { campaignId: string; campaignStatus: string }) {
  const qc = useQueryClient();
  const enqueue = useServerFn(enqueueCampaignFn);
  const processBatch = useServerFn(processQueueFn);
  const setStatus = useServerFn(setCampaignStatusFn);
  const requeue = useServerFn(requeueFailedFn);
  const { data: settings } = useSettings(campaignId);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["sp-overview", campaignId] });
    qc.invalidateQueries({ queryKey: ["sp-campaigns"] });
    qc.invalidateQueries({ queryKey: ["sp-queue", campaignId] });
  };

  const start = useMutation({
    mutationFn: async () => enqueue({ data: { campaignId } }),
    onSuccess: (r) => { toast.success(`${r.enqueued ?? 0} mensagens enfileiradas`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const batch = useMutation({
    mutationFn: async () => processBatch({}),
    onSuccess: (r: any) => { toast.success(`Lote: ${r.sent} enviadas, ${r.failed} falhas`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const status = useMutation({
    mutationFn: async (next: "running" | "paused" | "done") => setStatus({ data: { campaignId, status: next } }),
    onSuccess: () => { toast.success("Status atualizado"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const requeueMut = useMutation({
    mutationFn: async () => requeue({ data: { campaignId } }),
    onSuccess: (r) => { toast.success(`${r.requeued} mensagem(ns) reprocessada(s)`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const channelCount = settings?.selected_channel_ids?.length ?? 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(campaignStatus === "draft" || campaignStatus === "scheduled") && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="lg" disabled={channelCount === 0}>
                  <Play className="h-4 w-4 mr-1" /> Iniciar envios
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Iniciar envios?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm">
                      <p>Você está prestes a iniciar os envios desta campanha. Resumo:</p>
                      <ul className="list-disc pl-5">
                        <li>{channelCount} canal(is) selecionado(s)</li>
                        <li>Delay: {settings?.delay_seconds}s {settings?.random_delay_min != null && `(±${settings?.random_delay_min}-${settings?.random_delay_max}s)`}</li>
                        <li>Limite: {settings?.max_per_day_per_channel}/dia por canal</li>
                        <li>Horário: {settings?.allowed_start_time?.slice(0, 5)}–{settings?.allowed_end_time?.slice(0, 5)} ({settings?.timezone})</li>
                      </ul>
                      <p className="text-xs text-muted-foreground">Apenas contatos com consentimento serão incluídos.</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => start.mutate()}>Confirmar e iniciar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {campaignStatus === "running" && (
            <>
              <Button size="lg" variant="outline" onClick={() => batch.mutate()} disabled={batch.isPending}>
                <Send className="h-4 w-4 mr-1" /> Processar próximo lote
              </Button>
              <Button size="lg" variant="outline" onClick={() => status.mutate("paused")}>
                <Pause className="h-4 w-4 mr-1" /> Pausar
              </Button>
            </>
          )}
          {campaignStatus === "paused" && (
            <Button size="lg" onClick={() => status.mutate("running")}>
              <Play className="h-4 w-4 mr-1" /> Retomar
            </Button>
          )}
          {(campaignStatus === "running" || campaignStatus === "paused") && (
            <Button size="lg" variant="outline" onClick={() => status.mutate("done")}>
              <Square className="h-4 w-4 mr-1" /> Interromper
            </Button>
          )}
          <Button size="lg" variant="outline" onClick={() => requeueMut.mutate()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Reprocessar falhas
          </Button>
        </div>
        {channelCount === 0 && (
          <p className="text-xs text-warning flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Selecione ao menos 1 canal na aba "Canais" antes de iniciar.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Progress ----------
function ProgressSection({ campaignId }: { campaignId: string }) {
  const getOverview = useServerFn(getSendPanelOverviewFn);
  const { data: ov } = useQuery({
    queryKey: ["sp-overview", campaignId],
    queryFn: () => getOverview({ data: { campaignId } }),
    refetchInterval: 5000,
  });
  if (!ov) return <p className="text-muted-foreground">Carregando…</p>;
  const completed = ov.sent + ov.failed;
  const pct = ov.total > 0 ? Math.round((completed / ov.total) * 100) : 0;
  const eta = ov.ratePerMin > 0 ? Math.ceil(ov.pending / ov.ratePerMin) : null;
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Progresso da campanha</h3>
          <span className="text-2xl font-display">{pct}%</span>
        </div>
        <Progress value={pct} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Enviados</p><p className="font-medium text-success">{ov.sent}</p></div>
          <div><p className="text-xs text-muted-foreground">Pendentes</p><p className="font-medium">{ov.pending}</p></div>
          <div><p className="text-xs text-muted-foreground">Falhas</p><p className="font-medium text-destructive">{ov.failed}</p></div>
          <div><p className="text-xs text-muted-foreground">Estimativa</p><p className="font-medium">{eta != null ? `${Math.floor(eta / 60)}h${eta % 60}min` : "—"}</p></div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Queue Table ----------
function QueueTable({ campaignId }: { campaignId: string }) {
  const getQueue = useServerFn(getQueueRowsFn);
  const requeueOne = useServerFn(requeueRecipientFn);
  const ignoreOne = useServerFn(markIgnoredFn);
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["sp-queue", campaignId],
    queryFn: () => getQueue({ data: { campaignId, limit: 200 } }),
    refetchInterval: 8000,
  });
  const inv = () => qc.invalidateQueries({ queryKey: ["sp-queue", campaignId] });
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Tentativas</TableHead>
              <TableHead>Última</TableHead>
              <TableHead>Próxima</TableHead>
              <TableHead>Erro</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Sem destinatários ainda.</TableCell></TableRow>
            )}
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="font-mono text-xs">{r.phone ? formatPhone(r.phone) : "—"}</TableCell>
                <TableCell className="text-sm">{r.channel}</TableCell>
                <TableCell><QueueStatusBadge status={r.status} /></TableCell>
                <TableCell className="text-center text-xs">{r.attempts}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.last_attempt_at ? format(new Date(r.last_attempt_at), "dd/MM HH:mm") : "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.next_attempt_at ? format(new Date(r.next_attempt_at), "dd/MM HH:mm") : "—"}</TableCell>
                <TableCell className="text-xs text-destructive max-w-xs truncate" title={r.error ?? ""}>{r.error ?? ""}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" onClick={async () => { await requeueOne({ data: { recipientId: r.id } }); toast.success("Reenfileirado"); inv(); }}>
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await ignoreOne({ data: { recipientId: r.id } }); toast.success("Marcado como ignorado"); inv(); }}>
                      <XCircle className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function QueueStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "border-warning text-warning",
    processing: "border-primary text-primary",
    sent: "border-success text-success",
    failed: "border-destructive text-destructive",
    queued: "border-muted text-muted-foreground",
    delivered: "border-success text-success",
    opted_out: "border-destructive text-destructive",
  };
  return <Badge variant="outline" className={map[status] ?? ""}>{status}</Badge>;
}

// ---------- Live Activity ----------
function LiveActivity({ campaignId }: { campaignId: string }) {
  const getLive = useServerFn(getLiveActivityFn);
  const { data: events = [] } = useQuery({
    queryKey: ["sp-activity", campaignId],
    queryFn: () => getLive({ data: { campaignId } }),
    refetchInterval: 4000,
  });
  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-medium flex items-center gap-2 mb-3"><Activity className="h-4 w-4" /> Atividade em tempo real</h3>
        <div className="space-y-1 max-h-[500px] overflow-auto">
          {events.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Sem atividade ainda.</p>}
          {events.map((e: any) => {
            const ok = e.http_status >= 200 && e.http_status < 300;
            return (
              <div key={e.id} className="flex items-start gap-2 text-xs py-1.5 border-b last:border-0">
                {ok ? <CheckCircle2 className="h-3 w-3 mt-0.5 text-success shrink-0" /> : <XCircle className="h-3 w-3 mt-0.5 text-destructive shrink-0" />}
                <span className="text-muted-foreground whitespace-nowrap">{format(new Date(e.created_at), "HH:mm:ss")}</span>
                <span className="flex-1">
                  {ok ? "Enviado" : `Falha (${e.http_status})`} para <strong>{e.contact?.name ?? "—"}</strong>
                  {e.channel?.label && <> via {e.channel.label}</>}
                  {!ok && e.response_text && <span className="text-destructive"> — {e.response_text.slice(0, 80)}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}