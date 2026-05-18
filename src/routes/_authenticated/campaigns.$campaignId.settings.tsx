import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { getSendSettingsFn, upsertSendSettingsFn } from "@/lib/send-panel.functions";
import {
  SendSettingsForm,
  SEND_SETTINGS_DEFAULTS,
  validateSendSettings,
  type SendSettingsState,
  type RotationMode,
} from "@/components/campaign/send-settings-form";

export const Route = createFileRoute("/_authenticated/campaigns/$campaignId/settings")({
  component: CampaignSendSettingsPage,
  head: () => ({ meta: [{ title: "Configurações de Envio — ZionFlow" }] }),
});

type FormState = SendSettingsState;
const DEFAULTS = SEND_SETTINGS_DEFAULTS;

function normalizeTime(t: string) {
  return (t ?? "").slice(0, 5);
}

function CampaignSendSettingsPage() {
  const { campaignId } = Route.useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canManage = role === "admin" || role === "gestor";

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [baseline, setBaseline] = useState<FormState>(DEFAULTS);

  const fetchSettings = useServerFn(getSendSettingsFn);
  const upsertSettings = useServerFn(upsertSendSettingsFn);

  const { data: campaign } = useQuery({
    queryKey: ["sp-campaign", campaignId],
    queryFn: async () => {
      const { data } = await supabase.from("campaigns")
        .select("id, name, description, status, total_recipients")
        .eq("id", campaignId).maybeSingle();
      return data;
    },
  });

  const { data: channels = [] } = useQuery({
    queryKey: ["sp-all-channels"],
    queryFn: async () => {
      const { data } = await supabase.from("channels")
        .select("id, label, phone_e164, status")
        .order("label", { ascending: true });
      return data ?? [];
    },
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ["send-settings", campaignId],
    queryFn: () => fetchSettings({ data: { campaignId } }),
  });

  useEffect(() => {
    if (!settings) return;
    const normalized: FormState = {
      selected_channel_ids: settings.selected_channel_ids ?? [],
      rotation_mode: (settings.rotation_mode ?? "round_robin") as RotationMode,
      channel_priority: settings.channel_priority ?? [],
      delay_seconds: settings.delay_seconds ?? 30,
      random_delay_min: settings.random_delay_min ?? null,
      random_delay_max: settings.random_delay_max ?? null,
      max_per_minute: settings.max_per_minute ?? 20,
      max_per_hour: settings.max_per_hour ?? 200,
      max_per_day_per_channel: settings.max_per_day_per_channel ?? 500,
      allowed_start_time: normalizeTime(settings.allowed_start_time ?? "09:00"),
      allowed_end_time: normalizeTime(settings.allowed_end_time ?? "18:00"),
      allowed_weekdays: settings.allowed_weekdays ?? [1, 2, 3, 4, 5],
      timezone: settings.timezone ?? "America/Sao_Paulo",
      auto_pause_outside_hours: settings.auto_pause_outside_hours ?? true,
      auto_pause_on_all_channels_down: settings.auto_pause_on_all_channels_down ?? true,
    };
    setForm(normalized);
    setBaseline(normalized);
  }, [settings]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [form, baseline]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const err = validateSendSettings(form);
      if (err) throw new Error(err);
      await upsertSettings({ data: { campaignId, ...form } });
    },
    onSuccess: () => {
      toast.success("Configurações salvas");
      setBaseline(form);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!canManage) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Você não tem permissão para editar as configurações de envio desta campanha.
          </CardContent>
        </Card>
      </div>
    );
  }

  const orderedPriority = form.channel_priority.filter((id) => form.selected_channel_ids.includes(id));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 pb-28">
      <div>
        <Link
          to="/campaigns/$campaignId"
          params={{ campaignId }}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para a campanha
        </Link>
        <PageHeader
          title={`Configurações de envio${campaign?.name ? ` — ${campaign.name}` : ""}`}
          description="Defina canais, rotação, velocidade e janela de envio para esta campanha."
          actions={
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/sending-panel", search: { campaignId } })}
            >
              <Send className="h-4 w-4 mr-1" /> Abrir painel de envios
            </Button>
          }
        />
      </div>

      {isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Carregando…</CardContent></Card>
      ) : (
        <>
          {/* Canais */}
          <Card>
            <CardHeader>
              <CardTitle>Canais selecionados</CardTitle>
              <CardDescription>Apenas os canais marcados serão usados nos disparos desta campanha.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  onClick={() => setForm((f) => ({
                    ...f,
                    selected_channel_ids: channels.map((c) => c.id),
                    channel_priority: channels.map((c) => c.id),
                  }))}>
                  Selecionar todos
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => setForm((f) => ({ ...f, selected_channel_ids: [], channel_priority: [] }))}>
                  Limpar
                </Button>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {channels.length === 0 && (
                  <div className="text-sm text-muted-foreground">Nenhum canal cadastrado.</div>
                )}
                {channels.map((ch) => {
                  const checked = form.selected_channel_ids.includes(ch.id);
                  return (
                    <label key={ch.id}
                      className="flex items-center gap-3 p-3 border rounded-md hover:bg-accent/40 cursor-pointer">
                      <Checkbox checked={checked} onCheckedChange={(v) => toggleChannel(ch.id, !!v)} />
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{ch.label}</div>
                        <div className="text-xs text-muted-foreground">{formatPhone(ch.phone_e164)}</div>
                      </div>
                      <Badge variant="outline" className="text-xs">{ch.status}</Badge>
                    </label>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Rotação */}
          <Card>
            <CardHeader>
              <CardTitle>Estratégia de rotação</CardTitle>
              <CardDescription>Como distribuir os envios entre os canais selecionados.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup
                value={form.rotation_mode}
                onValueChange={(v) => setForm((f) => ({ ...f, rotation_mode: v as RotationMode }))}
              >
                <label className="flex items-start gap-3 p-3 border rounded-md cursor-pointer">
                  <RadioGroupItem value="round_robin" />
                  <div>
                    <div className="text-sm font-medium">Round-robin</div>
                    <div className="text-xs text-muted-foreground">Alterna em ordem entre os canais.</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 border rounded-md cursor-pointer">
                  <RadioGroupItem value="least_used" />
                  <div>
                    <div className="text-sm font-medium">Menos usado</div>
                    <div className="text-xs text-muted-foreground">Prioriza canais com menos envios no dia.</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 border rounded-md cursor-pointer">
                  <RadioGroupItem value="manual_priority" />
                  <div>
                    <div className="text-sm font-medium">Prioridade manual</div>
                    <div className="text-xs text-muted-foreground">Use o canal de maior prioridade enquanto disponível.</div>
                  </div>
                </label>
              </RadioGroup>

              {form.rotation_mode === "manual_priority" && (
                <div className="space-y-2">
                  <Label>Ordem de prioridade</Label>
                  {orderedPriority.length === 0 && (
                    <div className="text-sm text-muted-foreground">Selecione canais acima.</div>
                  )}
                  <div className="space-y-1">
                    {orderedPriority.map((id, idx) => {
                      const ch = channels.find((c) => c.id === id);
                      if (!ch) return null;
                      return (
                        <div key={id} className="flex items-center gap-2 p-2 border rounded-md">
                          <Badge variant="outline" className="w-8 justify-center">{idx + 1}</Badge>
                          <div className="flex-1 text-sm">{ch.label}</div>
                          <Button size="icon" variant="ghost" disabled={idx === 0}
                            onClick={() => moveChannel(id, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" disabled={idx === orderedPriority.length - 1}
                            onClick={() => moveChannel(id, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Velocidade */}
          <Card>
            <CardHeader>
              <CardTitle>Velocidade e limites</CardTitle>
              <CardDescription>Controle a cadência de envios para evitar bloqueios.</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Delay entre envios (segundos)</Label>
                <Input type="number" min={0} value={form.delay_seconds}
                  onChange={(e) => setForm((f) => ({ ...f, delay_seconds: Number(e.target.value) || 0 }))} />
              </div>
              <div />
              <div className="space-y-1">
                <Label>Delay aleatório mínimo (s)</Label>
                <Input type="number" min={0} value={form.random_delay_min ?? ""}
                  onChange={(e) => setForm((f) => ({
                    ...f, random_delay_min: e.target.value === "" ? null : Number(e.target.value),
                  }))} />
              </div>
              <div className="space-y-1">
                <Label>Delay aleatório máximo (s)</Label>
                <Input type="number" min={0} value={form.random_delay_max ?? ""}
                  onChange={(e) => setForm((f) => ({
                    ...f, random_delay_max: e.target.value === "" ? null : Number(e.target.value),
                  }))} />
              </div>
              <Separator className="sm:col-span-2" />
              <div className="space-y-1">
                <Label>Máximo por minuto</Label>
                <Input type="number" min={1} value={form.max_per_minute}
                  onChange={(e) => setForm((f) => ({ ...f, max_per_minute: Number(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-1">
                <Label>Máximo por hora</Label>
                <Input type="number" min={1} value={form.max_per_hour}
                  onChange={(e) => setForm((f) => ({ ...f, max_per_hour: Number(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Máximo por dia (por canal)</Label>
                <Input type="number" min={1} value={form.max_per_day_per_channel}
                  onChange={(e) => setForm((f) => ({ ...f, max_per_day_per_channel: Number(e.target.value) || 1 }))} />
                <p className="text-xs text-muted-foreground">Aplica-se a cada canal selecionado individualmente.</p>
              </div>
            </CardContent>
          </Card>

          {/* Janela */}
          <Card>
            <CardHeader>
              <CardTitle>Janela de envio</CardTitle>
              <CardDescription>Horário e dias da semana em que os envios podem ocorrer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>Horário inicial</Label>
                  <Input type="time" value={form.allowed_start_time}
                    onChange={(e) => setForm((f) => ({ ...f, allowed_start_time: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Horário final</Label>
                  <Input type="time" value={form.allowed_end_time}
                    onChange={(e) => setForm((f) => ({ ...f, allowed_end_time: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Fuso horário</Label>
                  <Select value={form.timezone}
                    onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Dias da semana</Label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => {
                    const on = form.allowed_weekdays.includes(d.id);
                    return (
                      <Button key={d.id} type="button" size="sm"
                        variant={on ? "default" : "outline"}
                        onClick={() => toggleWeekday(d.id, !on)}>
                        {d.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between p-3 border rounded-md">
                <div>
                  <Label className="text-sm">Pausar fora do horário</Label>
                  <p className="text-xs text-muted-foreground">Reagenda mensagens para o próximo horário permitido.</p>
                </div>
                <Switch checked={form.auto_pause_outside_hours}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, auto_pause_outside_hours: v }))} />
              </div>
            </CardContent>
          </Card>

          {/* Segurança */}
          <Card>
            <CardHeader>
              <CardTitle>Segurança</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-3 border rounded-md">
                <div>
                  <Label className="text-sm">Pausar campanha se todos os canais ficarem indisponíveis</Label>
                  <p className="text-xs text-muted-foreground">Útil quando os canais atingem limite ou entram em erro.</p>
                </div>
                <Switch checked={form.auto_pause_on_all_channels_down}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, auto_pause_on_all_channels_down: v }))} />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Rodapé sticky */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur z-40">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {dirty ? "Alterações não salvas" : "Tudo salvo"}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setForm(DEFAULTS)} disabled={saveMut.isPending}>
              <RotateCcw className="h-4 w-4 mr-1" /> Restaurar padrão
            </Button>
            <Button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending}>
              <Save className="h-4 w-4 mr-1" /> {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}