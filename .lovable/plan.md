
## Tela dedicada de Configurações de Envio por Campanha

Hoje as configurações já existem dentro do `Painel de Envios` misturadas com operação (start/pause/fila/atividade). Vou criar uma **tela dedicada só para configurar** o `campaign_send_settings` da campanha selecionada, com formulário focado, validação e ação "Salvar".

### 1. Nova rota
`src/routes/_authenticated/campaigns.$campaignId.settings.tsx` → `/campaigns/:campaignId/settings`

- Carrega settings via `getSendSettingsFn` (já existe, retorna defaults se não houver linha).
- Carrega lista de canais (`channels`) para o seletor.
- Salva via `upsertSendSettingsFn` (já existe).
- Acessível por `admin` e `gestor`; demais perfis veem aviso.

### 2. Estrutura da tela

Cabeçalho com nome da campanha + botões "Voltar para campanha" e "Abrir no Painel de Envios".

Formulário em cards/seções:

**a) Canais selecionados**
- Lista de canais com Checkbox (label + telefone + status).
- "Selecionar todos / limpar".
- Validação: pelo menos 1 canal.

**b) Rotação**
- RadioGroup: `round_robin` | `least_used` | `manual_priority`.
- Se `manual_priority`: lista ordenável simples (botões ↑/↓) com `channel_priority` filtrada por canais selecionados.

**c) Velocidade**
- `delay_seconds` (Input number, segundos entre envios).
- `random_delay_min` / `random_delay_max` (opcionais; validar min ≤ max).
- `max_per_minute`, `max_per_hour`, `max_per_day_per_channel`.

**d) Janela de envio**
- `allowed_start_time` / `allowed_end_time` (`<input type="time">`).
- `allowed_weekdays`: 7 toggles (Dom–Sáb).
- `timezone`: Select com presets brasileiros + outros comuns (default `America/Sao_Paulo`).
- Switch `auto_pause_outside_hours`.

**e) Segurança**
- Switch `auto_pause_on_all_channels_down`.

Rodapé sticky com:
- Botão **Salvar** (mutation `upsertSendSettingsFn` + toast + `qc.invalidate(["send-settings", id])`).
- Botão **Restaurar padrão** (preenche estado local com `DEFAULTS` sem salvar).
- Estado "alterações não salvas" (compara estado atual com último salvo).

### 3. Integração com telas existentes

- **`campaigns.$campaignId.tsx`**: adicionar botão "Configurar envios" linkando para `/campaigns/$id/settings`.
- **`sending-panel.tsx`**: substituir as abas de configuração por um link "Editar configurações" que abre `/campaigns/$id/settings` (mantendo o painel focado em operação). Operação (Controles, Fila, Atividade, Progresso) permanece no painel.
- **Sidebar**: nenhuma alteração (acesso via campanha/painel).

### 4. Validação cliente

Reusar a forma do `settingsInput` Zod existente em `send-panel.functions.ts`:
- min ≤ max para random delay.
- start_time < end_time (com aviso, mas permitido se atravessar meia-noite? — bloquear por simplicidade nessa V1).
- ≥1 canal selecionado.
- Se `manual_priority`, lista de prioridade deve conter exatamente os canais selecionados.

### 5. Detalhes técnicos

- Form state local (`useState`) inicializado de `getSendSettingsFn`.
- TanStack Query para fetch; `useMutation` para salvar.
- Sem mudanças de schema, sem nova migration, sem alterar o processador (`process-queue.ts` já lê `campaign_send_settings`).
- Realtime opcional na configuração: pular (configuração é manual, não precisa de WS).

### Arquivos

- **novo**: `src/routes/_authenticated/campaigns.$campaignId.settings.tsx`
- **editado**: `src/routes/_authenticated/campaigns.$campaignId.tsx` (botão de acesso)
- **editado**: `src/routes/_authenticated/sending-panel.tsx` (remover abas de configuração, adicionar link "Editar configurações")
