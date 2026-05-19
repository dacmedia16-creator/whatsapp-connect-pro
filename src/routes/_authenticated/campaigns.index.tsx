import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Megaphone, List, Tag, Users, FileSpreadsheet, UserPlus, X, ArrowLeft, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ensureFreshSession } from "@/lib/auth-session";
import { handleServerFnError } from "@/lib/server-fn-error";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MethodCard } from "@/components/campaign/method-card";
import { RecipientTable } from "@/components/campaign/recipient-table";
import { ComplianceSummary } from "@/components/campaign/compliance-summary";
import { CampaignMediaPicker, type CampaignMedia } from "@/components/campaign/media-picker";
import { listContactListsFn, previewRecipientsFn, createCampaignFn } from "@/lib/campaigns.functions";
import { emptySummary, renderTemplate, type ResolvedContact, type ResolveSummary } from "@/lib/recipient-resolver";
import { normalizePhoneE164 } from "@/lib/phone";
import {
  SendSettingsForm,
  SEND_SETTINGS_DEFAULTS,
  validateSendSettings,
  type SendSettingsState,
} from "@/components/campaign/send-settings-form";

export const Route = createFileRoute("/_authenticated/campaigns/")({
  component: CampaignsPage,
  head: () => ({ meta: [{ title: "Campanhas — ZionFlow" }] }),
});

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "scheduled" | "running" | "paused" | "done";
  message_template: string;
  audience_filter: any;
  channel_ids: string[];
  rate_per_min: number;
  scheduled_at: string | null;
  total_recipients: number;
  created_at: string;
  media_url?: string | null;
  media_type?: string | null;
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

  const deleteCampaign = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaigns").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campanha excluída");
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Campanhas"
        description="Crie envios em massa com agendamento, throttling e distribuição por canais."
        actions={canManage && <NewCampaignWizard onDone={() => qc.invalidateQueries({ queryKey: ["campaigns"] })} />}
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
                    <Link to="/campaigns/$campaignId" params={{ campaignId: c.id }} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.media_url && (
                      <span className="ml-2 text-xs text-muted-foreground" title={`Anexo: ${c.media_type}`}>📎</span>
                    )}
                    {c.description && <p className="text-xs text-muted-foreground line-clamp-1">{c.description}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_LABELS[c.status]?.cls}>
                      {STATUS_LABELS[c.status]?.label ?? c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{c.total_recipients}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.scheduled_at ? format(new Date(c.scheduled_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "Imediato"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(c.created_at), "dd/MM/yyyy", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link to="/campaigns/$campaignId" params={{ campaignId: c.id }} className="text-sm text-primary hover:underline">
                        Abrir
                      </Link>
                      {canManage && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta ação remove a campanha "{c.name}", seus destinatários, eventos e mensagens enfileiradas. Não é possível desfazer.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteCampaign.mutate(c.id)}
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
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

// ============================ Wizard ============================

type Method = "list" | "tags" | "groups" | "import" | "manual";

function NewCampaignWizard({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // step 1
  const [name, setName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [method, setMethod] = useState<Method | null>(null);

  // method state
  const [listIds, setListIds] = useState<string[]>([]);
  const [listsPage, setListsPage] = useState(0);
  const [tagSelection, setTagSelection] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<"any" | "all">("any");
  const [manualRows, setManualRows] = useState<Array<{ name: string; phone: string; consent: boolean; tags: string[] }>>([]);
  const [importedRows, setImportedRows] = useState<Array<{ name: string; phone: string; consent: boolean; tags: string[] }>>([]);

  // results
  const [resolved, setResolved] = useState<ResolvedContact[]>([]);
  const [summary, setSummary] = useState<ResolveSummary>(emptySummary());
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  const [recipientsPage, setRecipientsPage] = useState(0);
  const RECIPIENTS_PAGE_SIZE = 10;
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewReqIdRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);

  // step 2
  const [message, setMessage] = useState("Olá {{nome}}, ");
  const [media, setMedia] = useState<CampaignMedia | null>(null);
  const [initiate, setInitiate] = useState(true);

  // step 3 — configurações avançadas de envio
  const [sendSettings, setSendSettings] = useState<SendSettingsState>(SEND_SETTINGS_DEFAULTS);

  const previewFn = useServerFn(previewRecipientsFn);
  const createFn = useServerFn(createCampaignFn);

  const reset = () => {
    setStep(1); setName(""); setScheduledAt(""); setChannelIds([]); setMethod(null);
    setListIds([]); setTagSelection([]); setTagMatch("any");
    setManualRows([]); setImportedRows([]);
    setResolved([]); setSummary(emptySummary());
    setExcludedKeys(new Set()); setRecipientsPage(0);
    setMessage("Olá {{nome}}, "); setMedia(null); setInitiate(true);
    setSendSettings(SEND_SETTINGS_DEFAULTS);
  };

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

  // Sincroniza canais selecionados na etapa 1 com sendSettings na etapa 3
  // (quando o usuário muda a seleção no topo, reflete imediatamente nas configs).
  useMemo(() => {
    setSendSettings((prev) => {
      if (
        prev.selected_channel_ids.length === channelIds.length &&
        prev.selected_channel_ids.every((id) => channelIds.includes(id))
      ) return prev;
      const priority = prev.channel_priority.filter((id) => channelIds.includes(id));
      const missing = channelIds.filter((id) => !priority.includes(id));
      return { ...prev, selected_channel_ids: channelIds, channel_priority: [...priority, ...missing] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelIds.join("|")]);

  const { data: lists = [] } = useQuery({
    queryKey: ["contact-lists"],
    queryFn: () => listContactListsFn(),
    enabled: open && method === "list",
  });

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(lists.length / 10));
    if (listsPage >= pageCount) setListsPage(0);
  }, [lists.length, listsPage]);

  const { data: tagOptions = [] } = useQuery({
    queryKey: ["all-tags"],
    queryFn: async () => {
      const { data } = await supabase.from("contacts").select("tags").limit(2000);
      const s = new Set<string>();
      (data ?? []).forEach((c) => (c.tags ?? []).forEach((t: string) => s.add(t)));
      return Array.from(s).sort();
    },
    enabled: open && method === "tags",
  });

  async function runPreview() {
    // Token para descartar respostas obsoletas + abort da chamada anterior.
    const myReq = ++previewReqIdRef.current;
    if (previewAbortRef.current) {
      try { previewAbortRef.current.abort(); } catch {}
    }
    const ac = new AbortController();
    previewAbortRef.current = ac;
    try {
      setPreviewLoading(true);
      await ensureFreshSession();
      let res: { contacts: ResolvedContact[]; summary: ResolveSummary } | null = null;
      if (method === "list" && listIds.length) {
        res = await previewFn({ data: { method: "list", listIds }, signal: ac.signal });
      } else if (method === "tags" && tagSelection.length) {
        res = await previewFn({ data: { method: "tags", tags: tagSelection, match: tagMatch }, signal: ac.signal });
      } else if (method === "manual" && manualRows.length) {
        res = await previewFn({ data: { method: "manual", rows: manualRows }, signal: ac.signal });
      } else if (method === "import" && importedRows.length) {
        res = await previewFn({ data: { method: "import", rows: importedRows }, signal: ac.signal });
      }
      if (myReq !== previewReqIdRef.current) return; // stale, ignora
      if (res) {
        setResolved(res.contacts);
        setSummary(res.summary);
        setExcludedKeys(new Set());
        setRecipientsPage(0);
      } else {
        setResolved([]);
        setSummary(emptySummary());
        setExcludedKeys(new Set());
        setRecipientsPage(0);
      }
    } catch (e: any) {
      if (myReq !== previewReqIdRef.current) return; // stale, silencia
      if (e?.name === "AbortError" || ac.signal.aborted) return;
      handleServerFnError(e, "Falha ao calcular destinatários");
    } finally {
      if (myReq === previewReqIdRef.current) setPreviewLoading(false);
    }
  }

  // Auto-carregar contatos quando a seleção de listas mudar (modo "list").
  useEffect(() => {
    if (method !== "list") return;
    if (listIds.length === 0) {
      previewReqIdRef.current++;
      if (previewAbortRef.current) { try { previewAbortRef.current.abort(); } catch {} }
      setPreviewLoading(false);
      setResolved([]);
      setSummary(emptySummary());
      setExcludedKeys(new Set());
      setRecipientsPage(0);
      return;
    }
    const t = setTimeout(() => { runPreview(); }, 250);
    return () => {
      clearTimeout(t);
      // invalida qualquer resposta em voo desta seleção
      previewReqIdRef.current++;
      if (previewAbortRef.current) { try { previewAbortRef.current.abort(); } catch {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, listIds.join("|")]);

  // Cleanup ao desmontar.
  useEffect(() => {
    return () => {
      previewReqIdRef.current++;
      if (previewAbortRef.current) { try { previewAbortRef.current.abort(); } catch {} }
    };
  }, []);

  // Manual form
  const [mName, setMName] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mConsent, setMConsent] = useState(true);

  function addManual() {
    if (!mName.trim() || !mPhone.trim()) return toast.error("Nome e telefone obrigatórios");
    const norm = normalizePhoneE164(mPhone);
    if (!norm) return toast.error("Telefone inválido");
    setManualRows((rows) => [...rows, { name: mName.trim(), phone: norm, consent: mConsent, tags: [] }]);
    setMName(""); setMPhone(""); setMConsent(true);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const parsed = rows.map((r) => {
        const name = String(r.nome ?? r.name ?? r.Nome ?? "").trim();
        const phone = String(r.telefone ?? r.phone ?? r.Telefone ?? r.celular ?? "").trim();
        const tagsRaw = String(r.etiquetas ?? r.tags ?? r.Etiquetas ?? "").trim();
        const tags = tagsRaw ? tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : [];
        const consentRaw = String(r.consentimento ?? r.consent ?? "true").toLowerCase();
        const consent = !["false", "0", "nao", "não", "n"].includes(consentRaw);
        return { name: name || phone, phone, consent, tags };
      }).filter((r) => r.phone);
      if (!parsed.length) return toast.error("Nenhuma linha válida encontrada");
      setImportedRows(parsed);
      toast.success(`${parsed.length} linhas lidas da planilha`);
    } catch (err: any) {
      toast.error("Falha ao ler planilha: " + (err.message ?? "erro"));
    } finally {
      e.target.value = "";
    }
  }

  const keyFor = (c: ResolvedContact, i: number) =>
    c.id ?? c.phone_e164 ?? `${c.rawPhone}-${i}`;

  const eligibleRecipients = useMemo(
    () =>
      resolved.filter(
        (r, i) =>
          r.status === "eligible" &&
          r.phone_e164 &&
          !excludedKeys.has(keyFor(r, i)),
      ),
    [resolved, excludedKeys],
  );

  const eligibleCount = eligibleRecipients.length;
  const scheduledValid = !scheduledAt || new Date(scheduledAt).getTime() > Date.now() - 60_000;
  const canAdvance = !!name.trim() && channelIds.length > 0 && scheduledValid && eligibleCount >= 1;
  const canAdvanceFromStep2 = canAdvance && message.trim().length >= 5;
  const settingsError = useMemo(() => validateSendSettings(sendSettings), [sendSettings]);
  const canSubmit = canAdvanceFromStep2 && !settingsError;

  const previewMsg = useMemo(() => {
    const first = eligibleRecipients[0];
    if (!first) return message;
    return renderTemplate(message, { name: first.name, phone: first.phone_e164!, empresa: "" });
  }, [message, eligibleRecipients]);

  const warnings: string[] = [];
  if (message.trim().length > 0 && message.trim().length < 20) warnings.push("Mensagem muito curta.");
  if (!/\{\{\s*nome\s*\}\}/i.test(message)) warnings.push("Personalize com {{nome}} para melhor engajamento.");

  const submit = useMutation({
    mutationFn: async () => {
      const recipients = eligibleRecipients.map((r) => ({
        id: r.id,
        name: r.name,
        phone_e164: r.phone_e164!,
        tags: r.tags,
        consent: true,
      }));
      const methodSummary: any = {};
      if (method === "list") methodSummary.listIds = listIds;
      if (method === "tags") { methodSummary.tags = tagSelection; methodSummary.match = tagMatch; }
      return createFn({
        data: {
          name: name.trim(),
          description: null,
          channelIds,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          message: message.trim(),
          ratePerMin: Math.max(1, Math.min(120, Math.round(60 / Math.max(1, sendSettings.delay_seconds)))),
          autoPauseOnErrors: sendSettings.auto_pause_on_all_channels_down,
          method: method as Exclude<Method, "groups">,
          methodSummary,
          recipients,
          initiate,
          sendSettings,
          media: media
            ? { url: media.url, type: media.type, mime: media.mime, filename: media.filename }
            : null,
        },
      });
    },
    onSuccess: (r) => {
      toast.success(`Campanha ${r.status === "running" ? "iniciada" : r.status === "scheduled" ? "agendada" : "salva"} com ${r.eligible} destinatário(s)`);
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
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0 gap-0">
        <header className="px-6 pt-6 pb-4 border-b">
          <h2 className="text-xl font-semibold">Nova Campanha</h2>
          <p className="text-sm text-muted-foreground">Configure sua campanha, escolha os destinatários e revise antes de enviar.</p>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {step === 1 && (
            <>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Nome da campanha *</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Digite o nome da campanha" maxLength={160} />
                </div>
                <div className="space-y-1.5">
                  <Label>Agendamento</Label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">Vazio = envio imediato ao iniciar</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Canal *</Label>
                  <div className="max-h-32 overflow-y-auto border rounded-md divide-y">
                    {channels.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">Nenhum canal ativo</div>
                    )}
                    {channels.map((c: any) => {
                      const checked = channelIds.includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/40 text-sm">
                          <Checkbox checked={checked} onCheckedChange={(v) =>
                            setChannelIds((prev) => v ? Array.from(new Set([...prev, c.id])) : prev.filter((x) => x !== c.id))
                          } />
                          <span className="truncate">{c.label}</span>
                          <span className="text-muted-foreground text-xs ml-auto">{c.status}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{channelIds.length} canal(is) selecionado(s)</p>
                </div>
              </div>

              <Card>
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Destinatários</h3>
                      <p className="text-xs text-muted-foreground">Escolha como selecionar os contatos da campanha</p>
                    </div>
                    <Badge variant="outline" className={eligibleCount > 0 ? "border-success text-success" : ""}>
                      {eligibleCount === 1 ? "1 contato" : `${eligibleCount} contatos`}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <MethodCard icon={List} title="Listas de Contatos" subtitle="Usar listas pré-definidas"
                      active={method === "list"} onClick={() => { setMethod("list"); setResolved([]); setSummary(emptySummary()); }} />
                    <MethodCard icon={Tag} title="Filtrar por Etiquetas" subtitle="Selecionar por etiquetas"
                      active={method === "tags"} onClick={() => { setMethod("tags"); setResolved([]); setSummary(emptySummary()); }} />
                    <MethodCard icon={Users} title="Grupos do Sistema" subtitle="Disponível apenas para WhatsApp Web"
                      disabled tooltip="Disponível apenas para WhatsApp Web" />
                    <MethodCard icon={FileSpreadsheet} title="Importar Planilha" subtitle="Upload de arquivo CSV/Excel"
                      active={method === "import"} onClick={() => { setMethod("import"); setResolved([]); setSummary(emptySummary()); }} />
                    <MethodCard icon={UserPlus} title="Adicionar Manualmente" subtitle="Incluir contatos um a um"
                      active={method === "manual"} onClick={() => { setMethod("manual"); setResolved([]); setSummary(emptySummary()); }} />
                  </div>

                  {method && (
                    <div className="rounded-lg border bg-muted/10 p-4 space-y-3">
                      {method === "list" && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label>Selecione uma ou mais listas</Label>
                            <div className="flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                className="text-primary hover:underline"
                                onClick={() => setListIds(lists.map((l: any) => l.id))}
                                disabled={lists.length === 0}
                              >
                                Selecionar todas
                              </button>
                              <span className="text-muted-foreground">·</span>
                              <button
                                type="button"
                                className="text-primary hover:underline"
                                onClick={() => {
                                  const pageIds = lists.slice(listsPage * 10, listsPage * 10 + 10).map((l: any) => l.id);
                                  setListIds((prev) => Array.from(new Set([...prev, ...pageIds])));
                                }}
                                disabled={lists.length === 0}
                              >
                                Selecionar página
                              </button>
                              <span className="text-muted-foreground">·</span>
                              <button
                                type="button"
                                className="text-muted-foreground hover:underline"
                                onClick={() => setListIds([])}
                                disabled={listIds.length === 0}
                              >
                                Limpar
                              </button>
                            </div>
                          </div>
                          <div className="border rounded-md divide-y">
                            {lists.length === 0 && (
                              <div className="px-3 py-4 text-sm text-muted-foreground">Nenhuma lista cadastrada. Crie listas em Contatos → Listas.</div>
                            )}
                            {lists.slice(listsPage * 10, listsPage * 10 + 10).map((l: any) => {
                              const checked = listIds.includes(l.id);
                              return (
                                <label
                                  key={l.id}
                                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(v) => {
                                      setListIds((prev) =>
                                        v ? Array.from(new Set([...prev, l.id])) : prev.filter((x) => x !== l.id),
                                      );
                                    }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{l.name}</div>
                                    {l.description && (
                                      <div className="text-xs text-muted-foreground truncate">{l.description}</div>
                                    )}
                                  </div>
                                  <Badge variant="secondary" className="text-xs">{l.count} contato(s)</Badge>
                                </label>
                              );
                            })}
                          </div>
                          {lists.length > 10 && (
                            <div className="flex items-center justify-between text-xs">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => setListsPage((p) => Math.max(0, p - 1))}
                                disabled={listsPage === 0}
                              >
                                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Anterior
                              </Button>
                              <span className="text-muted-foreground">
                                Página {listsPage + 1} de {Math.max(1, Math.ceil(lists.length / 10))} · {lists.length} listas
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() =>
                                  setListsPage((p) =>
                                    Math.min(Math.max(0, Math.ceil(lists.length / 10) - 1), p + 1),
                                  )
                                }
                                disabled={listsPage >= Math.ceil(lists.length / 10) - 1}
                              >
                                Próxima <ChevronRight className="h-3.5 w-3.5 ml-1" />
                              </Button>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">
                              {listIds.length === 0
                                ? "Selecione ao menos uma lista"
                                : `${listIds.length} lista(s) · ${lists.filter((l: any) => listIds.includes(l.id)).reduce((a: number, l: any) => a + (l.count ?? 0), 0)} contato(s) na soma bruta (antes de dedupe e validação)`}
                            </p>
                            <Button onClick={runPreview} disabled={listIds.length === 0}>
                              {previewLoading
                                ? "Carregando…"
                                : resolved.length > 0
                                  ? "Recalcular"
                                  : "Calcular destinatários"}
                            </Button>
                          </div>
                        </div>
                      )}

                      {method === "tags" && (
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label>Etiquetas</Label>
                            <div className="flex flex-wrap gap-2">
                              {tagOptions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma etiqueta cadastrada</p>}
                              {tagOptions.map((t) => {
                                const on = tagSelection.includes(t);
                                return (
                                  <Badge key={t} variant={on ? "default" : "outline"} className="cursor-pointer"
                                    onClick={() => setTagSelection((prev) => on ? prev.filter((x) => x !== t) : [...prev, t])}>
                                    {t}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                          <RadioGroup value={tagMatch} onValueChange={(v) => setTagMatch(v as "any" | "all")} className="flex gap-4">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                              <RadioGroupItem value="any" /> Contém qualquer etiqueta
                            </label>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                              <RadioGroupItem value="all" /> Contém todas as etiquetas
                            </label>
                          </RadioGroup>
                          <Button onClick={runPreview} disabled={tagSelection.length === 0}>Buscar contatos</Button>
                        </div>
                      )}

                      {method === "import" && (
                        <div className="space-y-2">
                          <Label>Arquivo CSV ou Excel</Label>
                          <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} />
                          <p className="text-[11px] text-muted-foreground">
                            Colunas esperadas: <code>nome</code>, <code>telefone</code>, <code>email</code> (opcional), <code>etiquetas</code> (separadas por vírgula), <code>consentimento</code> (true/false).
                          </p>
                          {importedRows.length > 0 && (
                            <Button onClick={runPreview}>Validar {importedRows.length} linha(s)</Button>
                          )}
                        </div>
                      )}

                      {method === "manual" && (
                        <div className="space-y-3">
                          <div className="grid md:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
                            <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Nome do contato" /></div>
                            <div className="space-y-1"><Label className="text-xs">Telefone</Label><Input value={mPhone} onChange={(e) => setMPhone(e.target.value)} placeholder="+55 11 99999-9999" /></div>
                            <label className="flex items-center gap-2 text-xs h-9"><Checkbox checked={mConsent} onCheckedChange={(v) => setMConsent(!!v)} />Consentimento</label>
                            <Button onClick={addManual} type="button">Adicionar</Button>
                          </div>
                          {manualRows.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs text-muted-foreground">{manualRows.length} contato(s) adicionado(s)</div>
                              <div className="flex flex-wrap gap-2">
                                {manualRows.map((r, i) => (
                                  <Badge key={i} variant="outline" className="gap-1">
                                    {r.name} · {r.phone}
                                    <button onClick={() => setManualRows((rows) => rows.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                                  </Badge>
                                ))}
                              </div>
                              <Button onClick={runPreview}>Validar contatos</Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(resolved.length > 0 || method) && (
                    <>
                      <ComplianceSummary summary={summary} />
                      {resolved.length === 0 ? (
                        <RecipientTable contacts={resolved} />
                      ) : (
                        <SelectableRecipients
                          resolved={resolved}
                          excludedKeys={excludedKeys}
                          setExcludedKeys={setExcludedKeys}
                          page={recipientsPage}
                          setPage={setRecipientsPage}
                          pageSize={RECIPIENTS_PAGE_SIZE}
                          keyFor={keyFor}
                        />
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label>Mensagem da campanha *</Label>
                    <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} maxLength={4096} />
                    <div className="flex flex-wrap gap-2">
                      {["{{nome}}", "{{telefone}}", "{{empresa}}"].map((v) => (
                        <Badge key={v} variant="outline" className="cursor-pointer font-mono text-xs"
                          onClick={() => setMessage((m) => m + " " + v)}>+ {v}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Anexo (opcional)</Label>
                    <CampaignMediaPicker value={media} onChange={setMedia} />
                  </div>
                  {warnings.length > 0 && (
                    <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning space-y-1">
                      {warnings.map((w) => <p key={w}>⚠ {w}</p>)}
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">Pré-visualização (1º elegível)</Label>
                    <p className="text-sm whitespace-pre-wrap bg-muted/40 rounded p-3 border mt-1">{previewMsg}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-2 text-sm">
                  <h3 className="font-medium">Resumo final</h3>
                  <div className="grid md:grid-cols-2 gap-y-1 gap-x-4">
                    <p><span className="text-muted-foreground">Nome:</span> {name}</p>
                    <p><span className="text-muted-foreground">Canais:</span> {channels.filter((c: any) => channelIds.includes(c.id)).map((c: any) => c.label).join(", ") || "—"}</p>
                    <p><span className="text-muted-foreground">Agendamento:</span> {scheduledAt ? format(new Date(scheduledAt), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "Imediato"}</p>
                    <p><span className="text-muted-foreground">Método:</span> {method}</p>
                    <p className="text-success"><span className="text-muted-foreground">Elegíveis:</span> {summary.eligible}</p>
                    <p className="text-warning"><span className="text-muted-foreground">Bloqueados:</span> {summary.blockedOptOut + summary.blockedNoConsent + summary.invalidPhone + summary.duplicates}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <SendSettingsForm
                form={sendSettings}
                onChange={setSendSettings}
                channels={channels.filter((c: any) => channelIds.includes(c.id))}
                showChannelSelection={false}
              />
              {settingsError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                  ⚠ {settingsError}
                </div>
              )}
              <Card>
                <CardContent className="p-4 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox checked={initiate} onCheckedChange={(v) => setInitiate(!!v)} />
                    Iniciar/agendar imediatamente após criar (desmarque para salvar como rascunho)
                  </label>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        <footer className="px-6 py-4 border-t flex items-center justify-between gap-3 bg-muted/10">
          <span className="text-xs text-muted-foreground">Etapa {step} de 3</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancelar</Button>
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep((s) => (s === 3 ? 2 : 1))}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
            )}
            {step === 1 && (
              <Button disabled={!canAdvance} onClick={() => setStep(2)}>Próxima</Button>
            )}
            {step === 2 && (
              <Button disabled={!canAdvanceFromStep2} onClick={() => setStep(3)}>Próxima</Button>
            )}
            {step === 3 && (
              <Button disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()}>
                {!initiate ? "Salvar rascunho" : scheduledAt ? "Agendar campanha" : "Iniciar campanha"}
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function SelectableRecipients({
  resolved,
  excludedKeys,
  setExcludedKeys,
  page,
  setPage,
  pageSize,
  keyFor,
}: {
  resolved: ResolvedContact[];
  excludedKeys: Set<string>;
  setExcludedKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;
  keyFor: (c: ResolvedContact, i: number) => string;
}) {
  const total = resolved.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page >= pageCount) setPage(0);
  }, [pageCount, page, setPage]);

  const start = page * pageSize;
  const pageRows = resolved.slice(start, start + pageSize);
  const selectableKeys = resolved
    .map((c, i) => ({ c, k: keyFor(c, i) }))
    .filter(({ c }) => c.status === "eligible" && c.phone_e164)
    .map(({ k }) => k);
  const selectedCount = selectableKeys.filter((k) => !excludedKeys.has(k)).length;

  const toggle = (k: string, on: boolean) => {
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      if (on) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const pageKeysSelectable = pageRows
    .map((c, i) => ({ c, k: keyFor(c, start + i) }))
    .filter(({ c }) => c.status === "eligible" && c.phone_e164)
    .map(({ k }) => k);

  const markPage = (on: boolean) => {
    setExcludedKeys((prev) => {
      const next = new Set(prev);
      pageKeysSelectable.forEach((k) => {
        if (on) next.delete(k);
        else next.add(k);
      });
      return next;
    });
  };

  const markAll = (on: boolean) => {
    if (on) setExcludedKeys(new Set());
    else setExcludedKeys(new Set(selectableKeys));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">
          {selectedCount} de {selectableKeys.length} elegíveis selecionados
          {total !== selectableKeys.length && ` · ${total} no total`}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" className="text-primary hover:underline" onClick={() => markPage(true)}>
            Marcar página
          </button>
          <span className="text-muted-foreground">·</span>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => markPage(false)}>
            Desmarcar página
          </button>
          <span className="text-muted-foreground">·</span>
          <button type="button" className="text-primary hover:underline" onClick={() => markAll(true)}>
            Marcar todos
          </button>
          <span className="text-muted-foreground">·</span>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => markAll(false)}>
            Desmarcar todos
          </button>
        </div>
      </div>
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Etiquetas</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((c, i) => {
              const idx = start + i;
              const k = keyFor(c, idx);
              const selectable = c.status === "eligible" && !!c.phone_e164;
              const checked = selectable && !excludedKeys.has(k);
              return (
                <TableRow key={k} className={!selectable ? "opacity-60" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={checked}
                      disabled={!selectable}
                      onCheckedChange={(v) => toggle(k, !!v)}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-sm">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.phone_e164 ?? <span className="text-destructive">{c.rawPhone}</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
                      ))}
                      {c.tags.length > 3 && (
                        <span className="text-muted-foreground">+{c.tags.length - 3}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs capitalize text-muted-foreground">{c.status.replace("_", " ")}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {total > pageSize && (
        <div className="flex items-center justify-between text-xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Anterior
          </Button>
          <span className="text-muted-foreground">
            Página {page + 1} de {pageCount} · {total} contato(s)
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
          >
            Próxima <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
