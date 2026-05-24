import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { getSendSettingsFn, upsertSendSettingsFn } from "@/lib/send-panel.functions";
import {
  SendSettingsForm,
  SEND_SETTINGS_DEFAULTS,
  validateSendSettings,
  type SendSettingsState,
  type RotationMode,
} from "@/components/campaign/send-settings-form";

function normalizeTime(t: string) {
  return (t ?? "").slice(0, 5);
}

interface SendSettingsDialogProps {
  campaignId: string;
  campaignName?: string;
  totalRecipients?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SendSettingsDialog({
  campaignId,
  campaignName,
  totalRecipients = 0,
  open,
  onOpenChange,
}: SendSettingsDialogProps) {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getSendSettingsFn);
  const upsertSettings = useServerFn(upsertSendSettingsFn);

  const [form, setForm] = useState<SendSettingsState>(SEND_SETTINGS_DEFAULTS);
  const [baseline, setBaseline] = useState<SendSettingsState>(SEND_SETTINGS_DEFAULTS);

  const { data: channels = [] } = useQuery({
    queryKey: ["sp-all-channels"],
    queryFn: async () => {
      const { data } = await supabase
        .from("channels")
        .select("id, label, phone_e164, status, business_hours")
        .order("label", { ascending: true });
      return data ?? [];
    },
    enabled: open,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ["send-settings", campaignId],
    queryFn: () => fetchSettings({ data: { campaignId } }),
    enabled: open,
  });

  useEffect(() => {
    if (!settings) return;
    const normalized: SendSettingsState = {
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
      batch_mode: settings.batch_mode ?? false,
      batch_pause_seconds: settings.batch_pause_seconds ?? 60,
    };
    setForm(normalized);
    setBaseline(normalized);
  }, [settings]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline),
    [form, baseline],
  );

  const saveMut = useMutation({
    mutationFn: async () => {
      const err = validateSendSettings(form);
      if (err) throw new Error(err);
      await upsertSettings({ data: { campaignId, ...form } });
    },
    onSuccess: () => {
      toast.success("Configurações salvas");
      setBaseline(form);
      qc.invalidateQueries({ queryKey: ["send-settings", campaignId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleOpenChange = (next: boolean) => {
    if (!next && dirty) {
      const ok = window.confirm("Há alterações não salvas. Deseja descartar?");
      if (!ok) return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Configurar envios{campaignName ? ` — ${campaignName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Defina canais, rotação, velocidade e janela de envio para esta campanha.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <SendSettingsForm
            form={form}
            onChange={setForm}
            channels={channels}
            totalRecipients={totalRecipients}
          />
        )}

        <DialogFooter className="flex items-center justify-between gap-3 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {dirty ? "Alterações não salvas" : "Tudo salvo"}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setForm(SEND_SETTINGS_DEFAULTS)}
              disabled={saveMut.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Restaurar padrão
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!dirty || saveMut.isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}