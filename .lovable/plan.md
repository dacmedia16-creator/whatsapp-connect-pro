## Objetivo

Trazer todas as configurações avançadas de envio (hoje em "Configurar envios" do painel/tela de settings da campanha) para dentro do wizard de criação de campanhas, de forma que o gestor já defina tudo no momento da criação — sem precisar abrir uma segunda tela depois.

## O que muda na UI

O wizard atual tem 2 etapas:
1. Dados + destinatários
2. Mensagem + envio (apenas velocidade + auto-pausa)

Passará a ter **3 etapas**:

1. **Dados e destinatários** (igual hoje)
   - Mudança pequena: o seletor "Canal *" vira **multi-seleção de canais** (checkbox list) em vez de um único canal, já que rotação exige múltiplos. Permite 1 só (modo trivial).

2. **Mensagem** (extraída da etapa 2 atual)
   - Textarea + variáveis + preview + warnings. Sem mudanças.

3. **Configurações de envio** (nova, espelhando a tela `campaigns.$campaignId.settings.tsx`)
   - **Rotação entre canais**: round_robin / least_used / manual_priority (com reordenação por setas quando manual).
   - **Velocidade**: `delay_seconds` entre envios + jitter aleatório (`random_delay_min` / `random_delay_max`).
   - **Limites**: `max_per_minute`, `max_per_hour`, `max_per_day_per_channel`.
   - **Janela de envio**: `allowed_start_time`, `allowed_end_time`, dias da semana (chips Seg–Dom), `timezone`.
   - **Segurança**: `auto_pause_outside_hours`, `auto_pause_on_all_channels_down`, "pausar em caso de muitos erros" (já existente).
   - Botão "Restaurar padrões" no rodapé desta etapa.

Etapa 4 (resumo) é absorvida no rodapé da etapa 3 — checkbox "Iniciar/agendar imediatamente" + bloco compacto de resumo permanecem.

## O que muda no backend

`createCampaignFn` em `src/lib/campaigns.functions.ts` passa a aceitar (e persistir) o bloco `sendSettings` no mesmo POST:

- Schema Zod ganha `channelIds: z.array(uuid).min(1)` (substitui `channelId` único; mantém compat aceitando ambos por uma transição curta) e um objeto opcional `sendSettings` com todos os campos da tabela `campaign_send_settings`.
- Validações novas: `allowed_start_time < allowed_end_time`, `random_delay_min ≤ random_delay_max ≤ delay_seconds*3`, `selected_channel_ids ⊆ channelIds`, `channel_priority` é permutação de `selected_channel_ids` quando `rotation_mode = manual_priority`.
- Após inserir a campanha e antes de chamar `enqueueCampaignFn`, faz um `upsert` em `campaign_send_settings` com os valores recebidos (ou aplica defaults se `sendSettings` veio vazio, mantendo comportamento atual).
- `campaigns.channel_ids` passa a guardar todos os canais selecionados (já é `uuid[]`).
- `enqueueCampaignFn` já lê `campaign_send_settings` no fluxo atual — então a distribuição inicial (delay, jitter, rotação, janela) passa a respeitar o que o usuário definiu no wizard sem mudanças adicionais.

## Tela "Configurar envios" da campanha

Permanece existindo (`/_authenticated/campaigns/$campaignId/settings`) para edição posterior. O botão "Configurar envios" no header da campanha continua útil para ajustes finos após o lançamento. A lógica passa a ser a mesma — a única diferença é que agora os valores iniciais já vêm preenchidos pelo wizard em vez dos defaults.

## Arquivos afetados

- `src/routes/_authenticated/campaigns.index.tsx` — wizard ganha etapa 3 com todos os campos; seletor de canal vira multi-select; estado e `submit` enviam `sendSettings`.
- `src/lib/campaigns.functions.ts` — `createInput` aceita `channelIds[]` e `sendSettings`; handler faz upsert em `campaign_send_settings`.
- (Opcional, pequeno) extrair um componente reutilizável `SendSettingsForm` em `src/components/campaign/send-settings-form.tsx` consumido tanto pelo wizard quanto pela tela `campaigns.$campaignId.settings.tsx`, evitando duplicação. Recomendado.

## Pontos de atenção

- **Compat com campanhas antigas**: handler aceita `channelId` (singular) como atalho que vira `[channelId]` para não quebrar testes/integrações eventuais.
- **Validação cruzada no front**: desabilitar "Iniciar campanha" se janela estiver inválida ou `selected_channel_ids` vazio.
- **UX**: etapa 3 fica longa — usar `Accordion` com seções (Canais & rotação / Velocidade & limites / Janela / Segurança) para reduzir scroll.
- **Sem mudança de schema** no banco — `campaign_send_settings` já existe com todos os campos necessários.

Posso prosseguir com a implementação?
