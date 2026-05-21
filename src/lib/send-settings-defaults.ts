// Fonte única de verdade para defaults de envio.
// Importado por servidor (server fns, sender) e cliente (forms, paineis).
// Mantém este arquivo livre de imports React / supabase para poder ser usado em qualquer contexto.

export type RotationMode = "round_robin" | "least_used" | "manual_priority";

export type SendSettings = {
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
  batch_mode: boolean;
  batch_pause_seconds: number | null;
};

export const SEND_SETTINGS_DEFAULTS: SendSettings = {
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
  batch_mode: false,
  batch_pause_seconds: 60,
};

// Normaliza um registro do banco aplicando defaults canônicos quando algum campo vier nulo.
export function normalizeSendSettings(row: Partial<SendSettings> | null | undefined): SendSettings {
  if (!row) return { ...SEND_SETTINGS_DEFAULTS };
  return {
    selected_channel_ids: row.selected_channel_ids ?? SEND_SETTINGS_DEFAULTS.selected_channel_ids,
    rotation_mode: (row.rotation_mode as RotationMode) ?? SEND_SETTINGS_DEFAULTS.rotation_mode,
    channel_priority: row.channel_priority ?? SEND_SETTINGS_DEFAULTS.channel_priority,
    delay_seconds: row.delay_seconds ?? SEND_SETTINGS_DEFAULTS.delay_seconds,
    random_delay_min: row.random_delay_min ?? SEND_SETTINGS_DEFAULTS.random_delay_min,
    random_delay_max: row.random_delay_max ?? SEND_SETTINGS_DEFAULTS.random_delay_max,
    max_per_minute: row.max_per_minute ?? SEND_SETTINGS_DEFAULTS.max_per_minute,
    max_per_hour: row.max_per_hour ?? SEND_SETTINGS_DEFAULTS.max_per_hour,
    max_per_day_per_channel: row.max_per_day_per_channel ?? SEND_SETTINGS_DEFAULTS.max_per_day_per_channel,
    allowed_start_time: (row.allowed_start_time ?? SEND_SETTINGS_DEFAULTS.allowed_start_time).slice(0, 5),
    allowed_end_time: (row.allowed_end_time ?? SEND_SETTINGS_DEFAULTS.allowed_end_time).slice(0, 5),
    allowed_weekdays: row.allowed_weekdays ?? SEND_SETTINGS_DEFAULTS.allowed_weekdays,
    timezone: row.timezone ?? SEND_SETTINGS_DEFAULTS.timezone,
    auto_pause_outside_hours: row.auto_pause_outside_hours ?? SEND_SETTINGS_DEFAULTS.auto_pause_outside_hours,
    auto_pause_on_all_channels_down: row.auto_pause_on_all_channels_down ?? SEND_SETTINGS_DEFAULTS.auto_pause_on_all_channels_down,
    batch_mode: row.batch_mode ?? SEND_SETTINGS_DEFAULTS.batch_mode,
    batch_pause_seconds: row.batch_pause_seconds ?? SEND_SETTINGS_DEFAULTS.batch_pause_seconds,
  };
}