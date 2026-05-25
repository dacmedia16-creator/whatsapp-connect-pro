## Permitir escolher a ordem dos canais selecionados

Hoje só o modo **Prioridade manual** mostra a lista reordenável (setas ↑/↓). Nos modos **Round-robin** e **Chama Simples** a ordem usada é a de seleção dos checkboxes, sem como reordenar. Vamos expor o mesmo controle de ordem também para esses dois modos e usar essa ordem na rotação real.

### 1. UI — `src/components/campaign/send-settings-form.tsx`

- Mover o bloco "Ordem de prioridade" (lista com setas ↑/↓) para fora do `if (form.rotation_mode === "manual_priority")`.
- Mostrar a lista quando `rotation_mode` for `manual_priority`, `round_robin` **ou** `simple_call`, desde que haja canais selecionados.
- Ajustar o label/descrição por modo:
  - `manual_priority`: "Ordem de prioridade — o canal nº 1 é usado enquanto disponível."
  - `round_robin`: "Ordem da rotação — os canais são usados em ciclo, do 1 para o último."
  - `simple_call`: "Ordem dos canais — 1 envio por canal, em sequência, respeitando esta ordem."
- Reaproveitar `moveChannel` / `orderedPriority` já existentes (nada novo no estado: continua usando `form.channel_priority`).

### 2. Backend — `src/lib/send/channel-selector.server.ts`

No `pickChannel`, quando o modo for `round_robin` (incluindo `simple_call`, que já é convertido em `round_robin` internamente):

- Em vez de iterar `selected_channel_ids` na ordem em que vieram, usar `channel_priority` como ordem base, filtrando só os ids que estão em `selected_channel_ids`. Se `channel_priority` estiver vazio, cai no comportamento atual (`selected_channel_ids`).
- O `cursor` de round-robin continua igual, só muda o array base.

Mesma mudança em `pickChannelForEnqueue` (modo `round_robin` planejado).

### 3. Sem mudanças
- Sem migrations (coluna `channel_priority` já existe).
- `least_used` continua ignorando a ordem (ordena por uso).
- Worker (`process-queue.ts`) não muda.
- Telas de listagem/relatório não mudam.

### Resultado
Em qualquer modo de rotação que dependa de ordem (manual, round-robin, chama simples), o usuário arrasta os canais com ↑/↓ no formulário de envio da campanha e essa ordem é respeitada nos disparos.
