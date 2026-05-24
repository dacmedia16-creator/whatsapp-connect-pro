## Liberar leases órfãos + capturar erro real da API

Dois ajustes independentes para destravar a campanha REMAX e dar visibilidade real do que a Ziontalk retorna nas falhas.

---

### (A) Reaper de leases órfãos em `message_queue`

**Problema observado:** 134 mensagens da campanha `bb6e2472…` estão em `status='processing'`, `attempts=0`, criadas às 20:23 e nunca tocadas. Vieram de um worker que pegou (`status='processing'`) e morreu antes de processar — ninguém mais as pega.

**Mudança de schema (migration):**
- Adicionar `processing_started_at timestamptz NULL` em `message_queue`.
- Index parcial: `CREATE INDEX ON message_queue (processing_started_at) WHERE status='processing'`.

**Setar `processing_started_at` no claim:** nos 2 lugares que fazem o claim atômico:
- `src/routes/api/public/hooks/process-queue.ts` (linha 16)
- `src/lib/ziontalk.functions.ts` `processQueueFn` (linha 229)

Trocar `.update({ status: "processing" })` por `.update({ status: "processing", processing_started_at: nowIso })`.

**Reset de presos:** antes do claim em ambos os runners, rodar:
```ts
await supabaseAdmin
  .from("message_queue")
  .update({
    status: "pending",
    processing_started_at: null,
    last_error: "Reset automático: lease expirado (worker não concluiu em 5 min)",
  })
  .eq("status", "processing")
  .lt("processing_started_at", new Date(Date.now() - 5 * 60_000).toISOString());
```

E nos handlers de `sent`/`failed` em `sender.server.ts`, limpar `processing_started_at: null` junto com o update final (para não deixar lixo).

**Limpeza imediata** (fora da migration, via insert tool): resetar os 134 órfãos atuais da campanha REMAX para `pending` para destravar agora.

---

### (B) Capturar corpo de erro real da API

**Problema:** `last_error` salva `"Failed to send the message"` — é literalmente o que a Ziontalk devolve em texto puro. Sem HTTP status e sem o JSON cru se houver. Difícil debugar.

**Mudanças em `src/lib/ziontalk.server.ts`:**
- Em `zionSendMessage`, capturar também `request_id`/headers úteis (`x-request-id`, `content-type`) e devolver no retorno: `{ ok, status, body, requestId, contentType }`.
- Tentar parsear `body` como JSON e, se houver `{ error: ..., message: ... }`, extrair pra mensagem amigável.

**Mudanças em `src/lib/send/sender.server.ts` (no bloco de falha, ~linha 398):**
- Prefixar `last_error` com `[HTTP <status>]` para sempre saber o código:
  ```ts
  last_error: `[HTTP ${result.status}] ${(result.body || "sem corpo").slice(0, 480)}`
  ```
- Mesma coisa para o `last_error` do canal e `error` do recipient.
- `console.error("[send-fail]", { queueId: item.id, channelId: ch.id, phone: ct.phone_e164, status: result.status, body: result.body, requestId: result.requestId })` — fica visível em `server-function-logs`.
- Garantir que o `send_logs.insert` já existente (linha 329) continue gravando `http_status` + `response_text` completos (já faz; só confirmar).

---

### Fora do escopo, mas observado

No preview apareceu um erro 400 da query de `campaign_events`:
> `Could not find a relationship between 'campaign_events' and 'contacts' in the schema cache (PGRST200)`

A tabela não tem FK declarada para `contacts`/`channels`, mas a UI tenta fazer embed `contact:contacts(...)`. Posso corrigir em seguida (adicionar as FKs ou trocar o embed por join manual) — só me avise.
