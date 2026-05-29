## Problema

Hoje é 29/05, mas o card "Saúde dos canais" mostra "25 de 25 envios hoje" no Envio 7, "24 de 25" no Envio 4, etc. Esses valores são dos dias **25/05 e 26/05** — os últimos dias em que cada chip enviou algo.

## Causa raiz

A coluna `channels.sent_today` só é zerada quando o sender processa uma nova mensagem e detecta que `sent_today_date != hoje`. Como não há envios há ~2 dias, o contador antigo permanece "congelado" no banco.

O **Painel de Envios** já trata isso corretamente:
```ts
const sentToday = c.sent_today_date === today ? c.sent_today : 0;
```
(`src/lib/send-panel.functions.ts:188`)

Mas o **Dashboard** (`src/routes/_authenticated/dashboard.tsx:56, 249, 267`) lê `sent_today` cru, sem comparar com `sent_today_date`. Por isso exibe o contador velho como se fosse de hoje.

## Correção

1. Em `src/routes/_authenticated/dashboard.tsx`:
   - Incluir `sent_today_date` no `select` da query de canais (linha 56).
   - Calcular `sentTodayEffective = c.sent_today_date === todayISO ? c.sent_today : 0` no render do card "Saúde dos canais".
   - Usar esse valor efetivo tanto no cálculo da barra (`used`) quanto no texto "X de Y envios hoje".

Mudança mínima, escopo só de apresentação. Banco e fila não mudam — o sender continuará zerando o contador real no primeiro envio do dia, exatamente como hoje.

## Arquivos

- `src/routes/_authenticated/dashboard.tsx` (único arquivo alterado)
