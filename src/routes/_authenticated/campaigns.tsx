import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { audiencePreviewFn } from "@/lib/inbox.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Megaphone, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/campaigns")({
  component: CampaignsPage,
  head: () => ({ meta: [{ title: "Campanhas — ZionFlow" }] }),
});

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "scheduled" | "running" | "paused" | "done";
  message_template: string;
  audience_filter: { tags?: string[] };
  channel_ids: string[];
  rate_per_min: number;
  scheduled_at: string | null;
  total_recipients: number;
  created_at: string;
};

const STATUS_LABELS: Record<Campaign["status"], { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "border-muted-foreground/40 text-muted-foreground" },
  scheduled: { label: "Agendada", cls: "border-gold text-gold" },
  running: { label: "Em execução", cls: "border-success text-success" },
  paused: { label: "Pausada", cls: "border-warning text-warning" },
  done: { label: "Concluída", cls: "border-primary text-primary" },
};

function CampaignsPage() {
  const { role } = useAuth();
  const canManage = role === "admin" || role === "gestor";
  const qc = useQueryClient();

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Campaign[];
    },
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Campanhas"
        description="Crie envios em massa com agendamento, throttling e distribuição por canais."
        actions={canManage && <CampaignWizard onDone={() => qc.invalidateQueries({ queryKey: ["campaigns"] })} />}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Destinatários</TableHead>
                <TableHead>Agendamento</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>
              )}
              {!isLoading && campaigns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <Megaphone className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    Nenhuma campanha ainda. Crie a primeira para começar.
                  </TableCell>
                </TableRow>
              )}
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      to="/campaigns/$campaignId"
                      params={{ campaignId: c.id }}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{c.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_LABELS[c.status]?.cls}>
                      {STATUS_LABELS[c.status]?.label ?? c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.total_recipients}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.scheduled_at
                      ? format(new Date(c.scheduled_at), "dd/MM/yyyy HH:mm", { locale: ptBR })
                      : "Imediato"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(c.created_at), "dd/MM/yyyy", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      to="/campaigns/$campaignId"
                      params={{ campaignId: c.id }}
                      className="text-sm text-primary hover:underline"
                    >
                      Abrir
                    </Link>
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

function CampaignWizard({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const OPT_OUT_FOOTER = "\n\nResponda SAIR para não receber mais mensagens.";
  const [template, setTemplate] = useState("Olá {{nome}}, " + OPT_OUT_FOOTER);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [ratePerMin, setRatePerMin] = useState(20);
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState<string>("");

  const reset = () => {
    setStep(1); setName(""); setDescription(""); setTemplate("Olá {{nome}}, " + OPT_OUT_FOOTER);
    setSelectedTags([]); setSelectedChannels([]); setRatePerMin(20);
    setScheduleNow(true); setScheduledAt("");
  };

  const { data: tagOptions = [] } = useQuery({
    queryKey: ["all-tags"],
    queryFn: async () => {
      const { data } = await supabase.from("contacts").select("tags").limit(2000);
      const s = new Set<string>();
      (data ?? []).forEach((c) => (c.tags ?? []).forEach((t: string) => s.add(t)));
      return Array.from(s).sort();
    },
    enabled: open,
  });

  const { data: channels = [] } = useQuery({
    queryKey: ["channels-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("channels")
        .select("id, label, phone_e164, status, daily_limit")
        .neq("status", "paused");
      return data ?? [];
    },
    enabled: open,
  });

  const { data: audienceCount } = useQuery({
    queryKey: ["audience-count", selectedTags],
    queryFn: async () => {
      let q = supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("consent", true)
        .is("opt_out_at", null);
      if (selectedTags.length) q = q.contains("tags", selectedTags);
      const { count } = await q;
      return count ?? 0;
    },
    enabled: open && step >= 2,
  });

  const audiencePreview = useServerFn(audiencePreviewFn);
  const { data: preview } = useQuery({
    queryKey: ["audience-preview", selectedTags],
    queryFn: () => audiencePreview({ data: { tags: selectedTags } }),
    enabled: open && step >= 2,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome obrigatório");
      if (template.trim().length < 5) throw new Error("Mensagem muito curta");
      if (!selectedChannels.length) throw new Error("Selecione ao menos um canal");
      if (!scheduleNow && !scheduledAt) throw new Error("Defina a data de agendamento");
      const finalTemplate = /sair|descadastr|parar|remover/i.test(template)
        ? template
        : template.trimEnd() + OPT_OUT_FOOTER;
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        message_template: finalTemplate,
        audience_filter: { tags: selectedTags },
        channel_ids: selectedChannels,
        rate_per_min: ratePerMin,
        scheduled_at: scheduleNow ? null : new Date(scheduledAt).toISOString(),
        status: "draft" as const,
      };
      const { error } = await supabase.from("campaigns").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campanha criada como rascunho");
      onDone();
      setOpen(false);
      reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-1" /> Nova campanha</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova campanha — Etapa {step} de 4</DialogTitle>
          <DialogDescription>
            {step === 1 && "Defina nome, descrição e mensagem (use {{nome}} e variáveis dos campos custom)."}
            {step === 2 && "Selecione o público pelas tags. Apenas contatos com consentimento são incluídos."}
            {step === 3 && "Distribua os envios em um ou mais canais com throttle por minuto."}
            {step === 4 && "Envie agora ou agende para uma data futura."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[260px]">
          {step === 1 && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </div>
              <div className="space-y-1">
                <Label>Descrição (opcional)</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} />
              </div>
              <div className="space-y-1">
                <Label>Mensagem</Label>
                <Textarea
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  rows={6}
                  maxLength={1024}
                  placeholder="Ex: Olá {{nome}}, temos uma novidade para você!"
                />
                <p className="text-xs text-muted-foreground">
                  Variáveis: <code>{`{{nome}}`}</code> e quaisquer chaves de <em>custom_fields</em>.
                </p>
                <p className="text-xs text-muted-foreground">
                  Um rodapé de descadastro (<em>“Responda SAIR…”</em>) é adicionado automaticamente quando não houver palavra de opt-out no texto.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <Label>Tags do público</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Vazio = todos os contatos elegíveis. Múltiplas tags = contatos que contenham TODAS.
                </p>
                <div className="flex flex-wrap gap-2">
                  {tagOptions.length === 0 && (
                    <p className="text-sm text-muted-foreground">Sem tags cadastradas.</p>
                  )}
                  {tagOptions.map((t) => {
                    const on = selectedTags.includes(t);
                    return (
                      <Badge
                        key={t}
                        variant={on ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() =>
                          setSelectedTags((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))
                        }
                      >
                        {t}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-md border p-3 bg-muted/30 text-sm">
                Público estimado: <strong>{audienceCount ?? "…"}</strong> contato(s) elegível(is)
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div>
                <Label>Canais</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Envios são distribuídos em round-robin entre os canais selecionados.
                </p>
                <div className="space-y-2">
                  {channels.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nenhum canal ativo. Cadastre um em Canais.</p>
                  )}
                  {channels.map((c) => {
                    const on = selectedChannels.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-3 p-2 rounded border hover:bg-muted/30 cursor-pointer"
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(v) =>
                            setSelectedChannels((prev) =>
                              v ? [...prev, c.id] : prev.filter((x) => x !== c.id),
                            )
                          }
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{c.label}</p>
                          <p className="text-xs text-muted-foreground">{c.phone_e164} • limite {c.daily_limit}/dia</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <Label>Velocidade (mensagens por minuto, por canal)</Label>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={ratePerMin}
                  onChange={(e) => setRatePerMin(parseInt(e.target.value || "1", 10))}
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <Checkbox checked={scheduleNow} onCheckedChange={(v) => setScheduleNow(!!v)} />
                Enviar imediatamente após iniciar
              </label>
              {!scheduleNow && (
                <div className="space-y-1">
                  <Label>Data e hora</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </div>
              )}
              <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1">
                <p><strong>Resumo</strong></p>
                <p>Nome: {name || "—"}</p>
                <p>Público estimado: {audienceCount ?? "—"} contato(s)</p>
                <p>Canais: {selectedChannels.length}</p>
                <p>Velocidade: {ratePerMin} msg/min/canal</p>
                <p>Envio: {scheduleNow ? "imediato" : scheduledAt || "—"}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            variant="ghost"
            disabled={step === 1}
            onClick={() => setStep((s) => s - 1)}
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          {step < 4 ? (
            <Button onClick={() => setStep((s) => s + 1)}>
              Próximo <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Criar campanha
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
