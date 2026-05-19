# Melhorar controle de delay e previsibilidade dos envios

## O que muda pra você

Duas adições no formulário de configuração de envio da campanha:

### 1. Previsão de duração (sempre visível)

Um card no topo do formulário mostrando, em tempo real, conforme você mexe nos sliders:

```
Estimativa
≈ 2h 15min de envio efetivo
~ 8 mensagens por minuto · 4 chips ativos · 480 destinatários
```

Recalcula automaticamente quando você muda: nº de canais selecionados, delay, delay aleatório, `max_per_minute`, `max_per_hora`. **Sem considerar janela horária nem pausas** — é tempo corrido de envio puro, como você pediu.

### 2. Delay global entre lotes (novo campo opcional)

Hoje cada chip tem seu próprio relógio: começa, dispara, espera seus 30s, dispara de novo. Eles dessincronizam rapidamente. O novo campo permite forçar o ritmo "rajada paralela":

```
[ ] Sincronizar lotes paralelos
    Dispara N mensagens ao mesmo tempo (uma por chip), espera, repete.
    
    Tamanho do lote: [4] (= nº de canais selecionados, sugerido)
    Pausa entre lotes: [60] segundos
```

Quando **desligado** (padrão): comportamento atual — cada chip respeita seu próprio `delay_seconds`, throughput máximo.

Quando **ligado**: o cron agrupa os envios em lotes do tamanho configurado e empurra o próximo lote inteiro para `agora + pausa_entre_lotes`. Mais lento e mais previsível.

## Como vai funcionar por trás

### Estimativa (frontend, puro cálculo)

Em `src/components/campaign/send-settings-form.tsx`, recebe `totalRecipients` via prop e renderiza um novo card no topo. Fórmula:

```ts
const n = selected_channel_ids.length || 1;
const delayMed = random_delay_min && random_delay_max
  ? (random_delay_min + random_delay_max) / 2
  : delay_seconds;

// taxa teórica por minuto, limitada por max_per_minute
const taxaPorChip = 60 / Math.max(delayMed, 1);
const taxaTotal = Math.min(taxaPorChip * n, max_per_minute);

const minutos = totalRecipients / taxaTotal;
```

Formata "Xh Ymin" e mostra a taxa efetiva. O `totalRecipients` o wizard já calcula — basta passar pra prop.

### Modo sincronizado (servidor)

**Schema** (`campaign_send_settings`): 2 colunas novas
- `batch_mode boolean default false`
- `batch_pause_seconds integer` (nullable)

**Form** (`send-settings-form.tsx`): switch + input numérico, validação básica (pausa ≥ 0).

**Cron** (`src/lib/send/sender.server.ts`):
- Após `result.ok`, se `settings.batch_mode` está ligado: em vez de chamar `pushNextScheduledFor` por chip, chamar nova função `pushBatchScheduledFor(ctx, campaignId, channelIds, batch_pause_seconds)` que empurra **todos os próximos `pending` da campanha** (um por canal) para `agora + batch_pause_seconds`.
- Quando desligado: mantém o `pushNextScheduledFor` atual (zero mudança de comportamento).

Isso garante o ritmo "4 juntos → pausa → 4 juntos" que você descreveu, sem quebrar o fluxo individual por chip quando o modo está desligado.

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| migration nova | + colunas `batch_mode`, `batch_pause_seconds` em `campaign_send_settings` |
| `src/components/campaign/send-settings-form.tsx` | + card de estimativa, + seção "Lotes sincronizados", + 2 campos no state |
| `src/routes/_authenticated/campaigns.$campaignId.settings.tsx` e wizard de criação | passar `totalRecipients` pra prop nova |
| `src/lib/campaigns.functions.ts` | persistir/ler os 2 campos novos |
| `src/lib/send/sender.server.ts` | nova `pushBatchScheduledFor` + branch no `if (result.ok)` |

## Validação após implementar

1. Abrir uma campanha existente → ver o card de estimativa atualizando ao vivo
2. Ligar "Sincronizar lotes", definir pausa 30s, salvar
3. Disparar com 3+ chips → ver no `message_queue.scheduled_for` os próximos 3 itens com timestamp idêntico (lote sincronizado)
4. Desligar o modo → comportamento volta ao atual

## Minha opinião sobre o trade-off

O modo sincronizado é mais lento que o atual (4 chips × 30s vira ~8 msgs/min vs ~40 msgs/min hoje), mas é mais "natural" — parece tráfego humano coordenado em vez de 4 robôs com relógios diferentes. Pra volumes pequenos/médios e pra evitar bloqueio em chips novos, vale a pena. Pra blasts grandes, deixe desligado.

A estimativa de duração é ganho puro sem custo.
