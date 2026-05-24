## Corrigir "Chama Simples" — delay global por campanha

### Bug
Em `src/lib/send/channel-selector.server.ts` (linha 68-79), `simple_call` força `delay_seconds: 15`, mas o pacing é medido por `lastSendAt(channelId)` (linha 142) — ou seja, **15s por canal**. Com 4 canais ativos, cada um tem seu próprio relógio começando em 0, então os 4 disparam quase simultaneamente, depois esperam 15s, e disparam outros 4 em rajada.

Evidência: send_logs mostra 4 envios em 11 segundos no último ciclo.

Comportamento esperado: **15s entre QUALQUER envio da campanha**, alternando canais a cada disparo.

### Mudança (1 arquivo)

**`src/lib/send/rate-limit.server.ts`** — adicionar helper:
```ts
export async function lastCampaignSendAt(campaignId: string): Promise<Date | null> {
  // último envio bem-sucedido da campanha em QUALQUER canal
  const { data } = await supabaseAdmin
    .from("send_logs")
    .select("created_at")
    .eq("campaign_id", campaignId)
    .gte("http_status", 200).lt("http_status", 300)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? new Date(data.created_at) : null;
}
```

**`src/lib/send/channel-selector.server.ts`** — no bloco de pacing (linha 136-149), quando `mode === "simple_call"` (preservar o modo original num `isSimpleCall` antes do override da linha 68), usar `lastCampaignSendAt(campaignId)` no lugar de `lastSendAt(cid)`. Para os outros modos, mantém o comportamento atual (15s por chip faz sentido para round_robin/least_used).

Sem mudanças no banco, no enqueue ou na UI. Sem mudança de configuração para o usuário — basta retomar a campanha.
