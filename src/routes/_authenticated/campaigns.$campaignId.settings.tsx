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
        <SendSettingsForm form={form} onChange={setForm} channels={channels} />
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