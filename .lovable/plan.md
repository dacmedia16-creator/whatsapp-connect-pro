## Problema

O sender ignora `delay_seconds` e `random_delay_min/max`. Resultado: 14 envios em 7 segundos quando deveriam ter ~25-30s de espaçamento. O cron pega 25 itens e dispara um atrás do outro.

## Solução: pacing por canal via `scheduled_for` (sem dormir no worker)

Não dá pra simplesmente `setTimeout` no Worker do Cloudflare — invocações de cron são curtas e custosas. A correção é **agendar cada item** para o futuro depois que um envio é feito no mesmo canal. O cron só processa itens com `scheduled_for <= now()`, então o pacing emerge naturalmente.

### Mudanças

**1. `src/lib/send/sender.server.ts` — depois de cada envio bem-sucedido**

Logo após marcar o item como `sent`, calcular o próximo horário em que o canal `ch` pode disparar:

```text
nextAvailable = now + jitter(delay_seconds, random_delay_min, random_delay_max)
```

E fazer um `UPDATE message_queue SET scheduled_for = GREATEST(scheduled_for, nextAvailable) WHERE channel_id = ch.id AND status='pending' AND scheduled_for < nextAvailable` (limitado ao próximo item pendente para evitar update gigante — usar subquery com `LIMIT 1` ordenado por `scheduled_for`).

Isso garante que o **próximo item do mesmo chip** só seja elegível depois do delay configurado. Como `pickChannel` pode trocar o `channel_id` no momento do envio, vou empurrar o próximo item pendente desse canal mesmo que originalmente fosse de outro.

**2. Função `jitter()` (mesmo arquivo, helper local)**

```text
delay = delay_seconds
if random_delay_min/max definidos → delay = random_int(min, max)
return now + delay * 1000ms
```

**3. `src/lib/send/channel-selector.server.ts` — respeitar último envio no `pickChannel`**

Hoje `pickChannel` já checa `max_per_minute` via `recentSends`. Adicionar mais uma checagem: se o último envio nesse canal foi há menos que `delay_seconds`, pular pra próximo candidato no round-robin. Isso evita que itens já-elegíveis (que ficaram parados antes de a regra ser aplicada) saiam todos juntos.

Pra isso, expor `lastSendAt(channelId)` em `rate-limit.server.ts` (ou um `MIN(created_at)` invertido — na verdade `MAX(created_at)`) usando `send_logs`.

**4. `src/routes/api/public/hooks/process-queue.ts` — sem mudanças**

Continua claimando 25 itens e processando em loop. O pacing vem do `scheduled_for` empurrado e da checagem de `pickChannel`.

### Como fica na prática (delay=30s, 4 chips)

- t=0s: cron pega 4 itens (um por chip), envia todos. Cada chip ganha `nextAvailable = t+30s`.
- t=1m: cron roda. Outros itens estão `pending` mas o de cada chip que ficou pra trás tem `scheduled_for = t+30s` < now → processa. Pacing per-channel = 30s, throughput agregado ≈ 4/30s.

## Arquivos afetados

- `src/lib/send/sender.server.ts` (push `scheduled_for` após sucesso, helper `jitter`)
- `src/lib/send/channel-selector.server.ts` (gate `lastSendAt < delay`)
- `src/lib/send/rate-limit.server.ts` (nova função `lastSendAt(channelId)`)

## Fora de escopo

- `max_per_minute`/`max_per_hour` já são checados pelo `pickChannel` — sem alteração
- Janela de horário/dia da semana — já tratado em outro fluxo

## Observação sobre o backfill atual

Os 165 itens restantes desta campanha já foram cancelados (status `failed`). Quando você criar uma nova campanha, o novo pacing já vai valer.
