import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { ArrowUp, ArrowDown, Smartphone } from "lucide-react";
import { formatPhone } from "@/lib/phone";

export type RotationMode = "round_robin" | "least_used" | "manual_priority";

export type SendSettingsState = {
  selected_channel_ids: string[];
  rotation_mode: RotationMode;
  channel_priority: string[];
  delay_seconds: number;
  random_delay_min: number | null;
  random_delay_max: number | null;
  max_per_minute: number;
  max_per_hour: number;
  max_per_day_per_channel: number;
  allowed_start_time: string;
  allowed_end_time: string;
  allowed_weekdays: number[];
  timezone: string;
  auto_pause_outside_hours: boolean;
  auto_pause_on_all_channels_down: boolean;
};

export const SEND_SETTINGS_DEFAULTS: SendSettingsState = {
  selected_channel_ids: [],
  rotation_mode: "least_used",
  channel_priority: [],
  delay_seconds: 30,
  random_delay_min: null,
  random_delay_max: null,
  max_per_minute: 20,
  max_per_hour: 200,
  max_per_day_per_channel: 500,
  allowed_start_time: "09:00",
  allowed_end_time: "18:00",
  allowed_weekdays: [1, 2, 3, 4, 5],
  timezone: "America/Sao_Paulo",
  auto_pause_outside_hours: true,
  auto_pause_on_all_channels_down: true,
};

export const WEEKDAYS = [
  { id: 0, label: "Dom" },
  { id: 1, label: "Seg" },
  { id: 2, label: "Ter" },
  { id: 3, label: "Qua" },
  { id: 4, label: "Qui" },
  { id: 5, label: "Sex" },
  { id: 6, label: "Sáb" },
];

export const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Recife",
  "America/Belem",
  "America/Fortaleza",
  "America/Cuiaba",
  "America/Bahia",
  "America/Argentina/Buenos_Aires",
  "UTC",
];

export type ChannelOption = {
  id: string;
  label: string;
  phone_e164: string;
  status: string;
};

export function validateSendSettings(form: SendSettingsState): string | null {
  if (!form.selected_channel_ids.length) return "Selecione ao menos 1 canal.";
  if (form.random_delay_min !== null && form.random_delay_max !== null
    && form.random_delay_min > form.random_delay_max) {
    return "Delay aleatório: mínimo não pode ser maior que máximo.";
  }
  if (form.allowed_start_time >= form.allowed_end_time) {
    return "Horário inicial deve ser menor que o final.";
  }
  if (!form.allowed_weekdays.length) return "Selecione ao menos 1 dia da semana.";
  return null;
}

type Props = {
  form: SendSettingsState;
  onChange: (next: SendSettingsState) => void;
  channels: ChannelOption[];
  showChannelSelection?: boolean;
};

export function SendSettingsForm({ form, onChange, channels, showChannelSelection = true }: Props) {
  const set = <K extends keyof SendSettingsState>(k: K, v: SendSettingsState[K]) =>
    onChange({ ...form, [k]: v });

  function toggleChannel(id: string, on: boolean) {
    const selected = on
      ? Array.from(new Set([...form.selected_channel_ids, id]))
      : form.selected_channel_ids.filter((x) => x !== id);
    const priority = form.channel_priority.filter((x) => selected.includes(x));
    const missing = selected.filter((x) => !priority.includes(x));
    onChange({ ...form, selected_channel_ids: selected, channel_priority: [...priority, ...missing] });
  }

  function moveChannel(id: string, dir: -1 | 1) {
    const arr = [...form.channel_priority];
    const i = arr.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("channel_priority", arr);
  }

  function toggleWeekday(d: number, on: boolean) {
    const next = on
      ? Array.from(new Set([...form.allowed_weekdays, d])).sort()
      : form.allowed_weekdays.filter((x) => x !== d);
    set("allowed_weekdays", next);
  }

  const orderedPriority = form.channel_priority.filter((id) => form.selected_channel_ids.includes(id));

  return (
    <div className="space-y-5">
      {showChannelSelection && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canais selecionados</CardTitle>
            <CardDescription>Apenas os canais marcados serão usados nos disparos desta campanha.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" type="button"
                onClick={() => onChange({
                  ...form,
                  selected_channel_ids: channels.map((c) => c.id),
                  channel_priority: channels.map((c) => c.id),
                })}>
                Selecionar todos
              </Button>
              <Button size="sm" variant="outline" type="button"
                onClick={() => onChange({ ...form, selected_channel_ids: [], channel_priority: [] })}>
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
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estratégia de rotação</CardTitle>
          <CardDescription>Como distribuir os envios entre os canais selecionados.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={form.rotation_mode}
            onValueChange={(v) => set("rotation_mode", v as RotationMode)}
          >
            <label className="flex items-start gap-3 p-3 border rounded-md cursor-pointer">
              <RadioGroupItem value="least_used" />
              <div>
                <div className="text-sm font-medium flex items-center gap-2">
                  Menos usado
                  <Badge variant="secondary" className="text-[10px]">Recomendado</Badge>
                </div>
                <div className="text-xs text-muted-foreground">Distribui igualmente: sempre escolhe o chip com menos envios no dia.</div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 border rounded-md cursor-pointer">
              <RadioGroupItem value="round_robin" />
              <div>
                <div className="text-sm font-medium">Round-robin</div>
                <div className="text-xs text-muted-foreground">Alterna em ordem entre os canais. Pode ficar desigual quando há limites ou pacing.</div>
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
                      <Button size="icon" variant="ghost" type="button" disabled={idx === 0}
                        onClick={() => moveChannel(id, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" type="button" disabled={idx === orderedPriority.length - 1}
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Velocidade e limites</CardTitle>
          <CardDescription>Controle a cadência de envios para evitar bloqueios.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Delay entre envios (segundos)</Label>
            <Input type="number" min={0} value={form.delay_seconds}
              onChange={(e) => set("delay_seconds", Number(e.target.value) || 0)} />
          </div>
          <div />
          <div className="space-y-1">
            <Label>Delay aleatório mínimo (s)</Label>
            <Input type="number" min={0} value={form.random_delay_min ?? ""}
              onChange={(e) => set("random_delay_min", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Delay aleatório máximo (s)</Label>
            <Input type="number" min={0} value={form.random_delay_max ?? ""}
              onChange={(e) => set("random_delay_max", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <Separator className="sm:col-span-2" />
          <div className="space-y-1">
            <Label>Máximo por minuto</Label>
            <Input type="number" min={1} value={form.max_per_minute}
              onChange={(e) => set("max_per_minute", Number(e.target.value) || 1)} />
          </div>
          <div className="space-y-1">
            <Label>Máximo por hora</Label>
            <Input type="number" min={1} value={form.max_per_hour}
              onChange={(e) => set("max_per_hour", Number(e.target.value) || 1)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Máximo por dia (por canal)</Label>
            <Input type="number" min={1} value={form.max_per_day_per_channel}
              onChange={(e) => set("max_per_day_per_channel", Number(e.target.value) || 1)} />
            <p className="text-xs text-muted-foreground">Aplica-se a cada canal selecionado individualmente.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Janela de envio</CardTitle>
          <CardDescription>Horário e dias da semana em que os envios podem ocorrer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Horário inicial</Label>
              <Input type="time" value={form.allowed_start_time}
                onChange={(e) => set("allowed_start_time", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Horário final</Label>
              <Input type="time" value={form.allowed_end_time}
                onChange={(e) => set("allowed_end_time", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Fuso horário</Label>
              <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
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
              onCheckedChange={(v) => set("auto_pause_outside_hours", v)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Segurança</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 border rounded-md">
            <div>
              <Label className="text-sm">Pausar campanha se todos os canais ficarem indisponíveis</Label>
              <p className="text-xs text-muted-foreground">Útil quando os canais atingem limite ou entram em erro.</p>
            </div>
            <Switch checked={form.auto_pause_on_all_channels_down}
              onCheckedChange={(v) => set("auto_pause_on_all_channels_down", v)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}