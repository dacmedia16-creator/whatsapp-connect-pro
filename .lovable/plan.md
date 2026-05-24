## Aviso ao retomar fora do horário + override de 30 min

Causa raiz: o sender (em `src/lib/send/sender.server.ts`, linha 181-197) sempre reagenda itens para a próxima abertura da janela quando estamos fora dela — **mesmo com `auto_pause_outside_hours=false`**. Por isso "Retomar" não envia nada agora: os 134 pendentes foram empurrados para amanhã 09:00 BRT.

Além disso, descobri que o UI hoje chama `supabase.from("campaigns").update({status})` direto (linha 179-188 de `campaigns.$campaignId.tsx`), ignorando `setCampaignStatusFn` — então nem o reagendamento de pause/resume está rodando como deveria.

### 1. Migration — já está pronta
Coluna `bypass_window_until timestamptz` em `campaign_send_settings` (já aplicada).

### 2. `setCampaignStatusFn` em `src/lib/send-panel.functions.ts`
- Aceitar `force_now: boolean` opcional.
- Quando `status='running'` + `force_now=true`: grava `bypass_window_until = now() + 30 min`.
- Quando `status='running'` + `force_now=false` (ou ausente): limpa `bypass_window_until = null`.

### 3. `sender.server.ts` — respeitar o override
Antes do bloco que reagenda por janela (linha 181), checar `settings.bypass_window_until > now()`. Se sim, pular o reagendamento e seguir o envio normalmente.

### 4. Tipo `SendSettings` e validador
- `src/lib/send-settings-defaults.ts`: incluir `bypass_window_until: string | null` no tipo + default `null` em `normalizeSendSettings`.
- `src/lib/send-panel.functions.ts`: o validador `settingsInput` do upsert deve aceitar (ou apenas ignorar) o campo — ele não vai aparecer no form, mas precisa não quebrar `getSendSettingsFn`. Mais simples: deixar o campo fora do upsert e o sender lê direto do banco.

### 5. UI — `src/routes/_authenticated/campaigns.$campaignId.tsx`
- Trocar `statusMut` para chamar `setCampaignStatusFn` via `useServerFn` (não mais supabase direto).
- Carregar `getSendSettingsFn` para a campanha (já há query para isso em `SendSettingsDialog`; pode ser uma query nova leve no detalhe).
- Calcular `isWithinWindow(settings, now)` no client (helper compartilhado em `src/lib/send/window.ts` se já existe, senão criar).
- Quando `campaign.status === "paused"`, o botão "Retomar" vira `AlertDialog`:
  - Se **dentro da janela**: confirmação simples → `setCampaignStatusFn({status:"running"})`.
  - Se **fora da janela**: corpo do diálogo explica
    > "Você está fora do horário permitido (HH:MM – HH:MM). Por padrão, os envios serão programados para a próxima abertura da janela: **DD/MM HH:MM**."
    
    Dois botões:
    - **Esperar próxima janela** → `setCampaignStatusFn({status:"running"})`
    - **Enviar agora (30 min)** → `setCampaignStatusFn({status:"running", force_now: true})` + toast "Janela ignorada até HH:MM".

### 6. Badge visual de override ativo
No header da campanha, quando `bypass_window_until > now()`, mostrar badge âmbar: *"Janela ignorada até HH:MM"*.

### 7. Helper de janela compartilhado
Vou verificar se `isWithinCampaignWindow` é importável; se não, extrair para `src/lib/send/window.ts` (puro, sem deps de servidor) para reuso no client.

Sem mudanças em escopo além desses pontos.
