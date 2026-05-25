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
import { ArrowUp, ArrowDown, Smartphone, Clock, Layers, AlertTriangle } from "lucide-react";
import { formatPhone } from "@/lib/phone";
import {
  SEND_SETTINGS_DEFAULTS as SHARED_DEFAULTS,
  type SendSettings,
  type RotationMode as SharedRotationMode,
} from "@/lib/send-settings-defaults";

// Re-exports da fonte única — qualquer consumidor deve usar os mesmos defaults
// que o servidor (send-panel.functions.ts) e o sender (sender.server.ts).
export type RotationMode = SharedRotationMode;
export type SendSettingsState = SendSettings;
export const SEND_SETTINGS_DEFAULTS: SendSettings = SHARED_DEFAULTS;

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
  // `business_hours` vem como Json do Supabase; tratamos defensivamente no
  // componente para extrair `days/start/end`.
  business_hours?: unknown;
};

export function validateSendSettings(form: SendSettingsState): string | null {
  if (!form.selected_channel_ids.length) return "Selecione ao menos 1 canal.";
  if (form.rotation_mode === "simple_call" && form.selected_channel_ids.length < 4) {
    return "Chama Simples requer no mínimo 4 canais selecionados.";
  }
  if (form.random_delay_min !== null && form.random_delay_max !== null
    && form.random_delay_min > form.random_delay_max) {
    return "Delay aleatório: mínimo não pode ser maior que máximo.";
  }
  if (form.allowed_start_time >= form.allowed_end_time) {
    return "Horário inicial deve ser menor que o final.";
  }
  if (!form.allowed_weekdays.length) return "Selecione ao menos 1 dia da semana.";
  if (form.batch_mode && (form.batch_pause_seconds == null || form.batch_pause_seconds < 0)) {
    return "Pausa entre lotes deve ser zero ou maior.";
  }
  return null;
}

type Props = {
  form: SendSettingsState;
  onChange: (next: SendSettingsState) => void;
  channels: ChannelOption[];
  showChannelSelection?: boolean;
  totalRecipients?: number;
};

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes < 1) return "menos de 1 min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

function estimateDuration(form: SendSettingsState, totalRecipients: number) {
  const n = Math.max(1, form.selected_channel_ids.length || 1);
  if (form.rotation_mode === "simple_call") {
    // 1 envio a cada delay_seconds, independente do número de chips
    const gap = Math.max(5, Number(form.delay_seconds) || 15);
    const ratePerMin = 60 / gap;
    return { minutes: totalRecipients / ratePerMin, ratePerMin, channels: n };
  }
  const min = Number(form.random_delay_min);
  const max = Number(form.random_delay_max);
  const delayMed = Number.isFinite(min) && Number.isFinite(max) && max >= min && max > 0
    ? (min + max) / 2
    : Math.max(0, form.delay_seconds);

  let ratePerMin: number;
  if (form.batch_mode) {
    // 1 lote = N envios (paralelos), espaçados por batch_pause_seconds
    const pause = Math.max(1, form.batch_pause_seconds ?? 60);
    ratePerMin = (60 / pause) * n;
  } else {
    const perChip = 60 / Math.max(delayMed, 1);
    ratePerMin = perChip * n;
  }
  // limite pelo teto de mensagens/min global
  ratePerMin = Math.min(ratePerMin, form.max_per_minute);
  if (ratePerMin <= 0) return { minutes: 0, ratePerMin: 0, channels: n };

  return {
    minutes: totalRecipients / ratePerMin,
    ratePerMin,
    channels: n,
  };
}

export function SendSettingsForm({
  form, onChange, channels, showChannelSelection = true, totalRecipients,
}: Props) {
  const set = <K extends keyof SendSettingsState>(k: K, v: SendSettingsState[K]) =>
    onChange({ ...form, [k]: v });

  const isSimpleCall = form.rotation_mode === "simple_call";
  const simpleCallTooFew = isSimpleCall && form.selected_channel_ids.length < 4;

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

  const showEstimate = typeof totalRecipients === "number" && totalRecipients > 0;
  const est = showEstimate ? estimateDuration(form, totalRecipients!) : null;

  // Detecta chips selecionados cujo horário comercial (configurado em
  // "Canais") é mais restrito do que a janela da campanha. O sender ignora
  // o horário do chip quando a campanha tem settings — o banner é
  // informativo, apenas para o usuário entender o comportamento.
  type BH = { tz?: string; start?: string; end?: string; days?: number[] };
  const parseBH = (raw: unknown): BH | null => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    return {
      tz: typeof r.tz === "string" ? r.tz : undefined,
      start: typeof r.start === "string" ? r.start : undefined,
      end: typeof r.end === "string" ? r.end : undefined,
      days: Array.isArray(r.days) ? (r.days as unknown[]).filter((x): x is number => typeof x === "number") : undefined,
    };
  };
  const channelHoursConflicts = form.selected_channel_ids
    .map((id) => channels.find((c) => c.id === id))
    .filter((c): c is ChannelOption => !!c)
    .map((c) => ({ c, bh: parseBH(c.business_hours) }))
    .filter(({ bh }) => {
      if (!bh) return false;
      const days = bh.days ?? [];
      const missingDay = form.allowed_weekdays.some((d) => !days.includes(d));
      const startConflict = !!bh.start && bh.start > form.allowed_start_time;
      const endConflict = !!bh.end && bh.end < form.allowed_end_time;
      return missingDay || startConflict || endConflict;
    });

  return (
    <div className="space-y-5">
      {channelHoursConflicts.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Atenção: horário comercial do chip
            </CardTitle>
            <CardDescription className="text-amber-800/80 dark:text-amber-300/80">
              {channelHoursConflicts.length === 1 ? "O canal abaixo tem" : "Os canais abaixo têm"} um horário comercial mais restrito do que a janela desta campanha. <b>A janela da campanha será usada nos disparos</b> — o horário do chip será ignorado aqui.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
              {channelHoursConflicts.map(({ c, bh }) => {
                const days = bh?.days ?? [];
                const labels = WEEKDAYS.filter((d) => days.includes(d.id)).map((d) => d.label).join(", ") || "—";
                return (
                  <li key={c.id}>
                    <b>{c.label}</b>: {labels} · {bh?.start || "00:00"}–{bh?.end || "23:59"}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {showEstimate && est && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Estimativa de envio
            </CardTitle>
            <CardDescription>
              Tempo corrido (não considera pausas fora do horário).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">
              ≈ {formatDuration(est.minutes)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ~ {est.ratePerMin.toFixed(1)} msg/min · {est.channels} {est.channels === 1 ? "chip" : "chips"} · {totalRecipients} destinatários
              {form.batch_mode && " · modo lote sincronizado"}
            </div>
          </CardContent>
        </Card>
      )}

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
            <label className="flex items-start gap-3 p-3 border rounded-md cursor-pointer">
              <RadioGroupItem value="simple_call" />
              <div>
                <div className="text-sm font-medium">Chama Simples</div>
                <div className="text-xs text-muted-foreground">
                  1 envio por canal em sequência, <b>{Math.max(5, Number(form.delay_seconds) || 15)} segundos</b> entre canais (configurável abaixo). Requer no mínimo 4 canais selecionados.
                  Ignora delays, limites por minuto/hora e modo lote.
                </div>
              </div>
            </label>
          </RadioGroup>

          {simpleCallTooFew && (
            <div className="flex items-start gap-2 p-3 border border-destructive/40 bg-destructive/10 rounded-md text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>Chama Simples requer no mínimo 4 canais selecionados. Atualmente: {form.selected_channel_ids.length}.</span>
            </div>
          )}

          {(form.rotation_mode === "manual_priority"
            || form.rotation_mode === "round_robin"
            || form.rotation_mode === "simple_call") && (
            <div className="space-y-2">
              <Label>
                {form.rotation_mode === "manual_priority" && "Ordem de prioridade"}
                {form.rotation_mode === "round_robin" && "Ordem da rotação"}
                {form.rotation_mode === "simple_call" && "Ordem dos canais"}
              </Label>
              <p className="text-xs text-muted-foreground">
                {form.rotation_mode === "manual_priority"
                  && "O canal nº 1 é usado enquanto disponível; os demais entram como fallback."}
                {form.rotation_mode === "round_robin"
                  && "Os canais são usados em ciclo, do 1 para o último."}
                {form.rotation_mode === "simple_call"
                  && "1 envio por canal, em sequência, respeitando esta ordem."}
              </p>
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
          <CardDescription>
            {isSimpleCall
              ? "No modo Chama Simples, apenas o intervalo entre canais é usado (mínimo 5s). Demais campos são ignorados."
              : "Controle a cadência de envios para evitar bloqueios."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>{isSimpleCall ? "Segundos entre canais" : "Delay entre envios (segundos)"}</Label>
            <Input
              type="number"
              min={isSimpleCall ? 5 : 0}
              value={form.delay_seconds}
              onChange={(e) => set("delay_seconds", Number(e.target.value) || 0)}
            />
            {isSimpleCall && (
              <p className="text-xs text-muted-foreground">Mínimo 5 segundos. Aplica-se a cada novo envio (em qualquer canal).</p>
            )}
          </div>
          <div />
          <div className={`space-y-1 ${isSimpleCall ? "opacity-50 pointer-events-none" : ""}`}>
            <Label>Delay aleatório mínimo (s)</Label>
            <Input type="number" min={0} value={form.random_delay_min ?? ""}
              onChange={(e) => set("random_delay_min", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <div className={`space-y-1 ${isSimpleCall ? "opacity-50 pointer-events-none" : ""}`}>
            <Label>Delay aleatório máximo (s)</Label>
            <Input type="number" min={0} value={form.random_delay_max ?? ""}
              onChange={(e) => set("random_delay_max", e.target.value === "" ? null : Number(e.target.value))} />
          </div>
          <Separator className={`sm:col-span-2 ${isSimpleCall ? "opacity-50" : ""}`} />
          <div className={`space-y-1 ${isSimpleCall ? "opacity-50 pointer-events-none" : ""}`}>
            <Label>Máximo por minuto</Label>
            <Input type="number" min={1} value={form.max_per_minute}
              onChange={(e) => set("max_per_minute", Number(e.target.value) || 1)} />
          </div>
          <div className={`space-y-1 ${isSimpleCall ? "opacity-50 pointer-events-none" : ""}`}>
            <Label>Máximo por hora</Label>
            <Input type="number" min={1} value={form.max_per_hour}
              onChange={(e) => set("max_per_hour", Number(e.target.value) || 1)} />
          </div>
          <div className={`space-y-1 sm:col-span-2 ${isSimpleCall ? "opacity-50 pointer-events-none" : ""}`}>
            <Label>Máximo por dia (por canal)</Label>
            <Input type="number" min={1} value={form.max_per_day_per_channel}
              onChange={(e) => set("max_per_day_per_channel", Number(e.target.value) || 1)} />
            <p className="text-xs text-muted-foreground">Aplica-se a cada canal selecionado individualmente.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" /> Lotes sincronizados
          </CardTitle>
          <CardDescription>
            {isSimpleCall
              ? "Desativado no modo Chama Simples."
              : "Quando ligado, todos os canais disparam ao mesmo tempo (1 mensagem cada), aguardam a pausa, e disparam o próximo lote. Quando desligado, cada chip segue seu próprio relógio (throughput máximo)."}
          </CardDescription>
        </CardHeader>
        <CardContent className={`space-y-4 ${isSimpleCall ? "opacity-50 pointer-events-none" : ""}`}>
          <div className="flex items-center justify-between p-3 border rounded-md">
            <div>
              <Label className="text-sm">Sincronizar lotes paralelos</Label>
              <p className="text-xs text-muted-foreground">
                Padrão desligado. Ligar dá ritmo previsível, mas reduz a velocidade total.
              </p>
            </div>
            <Switch
              checked={form.batch_mode}
              onCheckedChange={(v) => set("batch_mode", v)}
            />
          </div>
          {form.batch_mode && (
            <div className="space-y-1">
              <Label>Pausa entre lotes (segundos)</Label>
              <Input
                type="number"
                min={0}
                value={form.batch_pause_seconds ?? 60}
                onChange={(e) => set("batch_pause_seconds", e.target.value === "" ? null : Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Tempo de espera entre uma rajada e a próxima. Com {form.selected_channel_ids.length || "N"} chips, cada rajada envia {form.selected_channel_ids.length || "N"} mensagens ao mesmo tempo.
              </p>
            </div>
          )}
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