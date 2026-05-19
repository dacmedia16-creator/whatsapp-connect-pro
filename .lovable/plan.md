## Diagnóstico

A campanha "Teste" foi criada com **3 contatos manuais** (audience_filter mostra `server_resolved.eligible: 3`). Os 3 destinatários foram inseridos em `campaign_recipients` às 03:40:43. **49 segundos depois (03:41:32)** mais **178 destinatários** foram adicionados — total 181.

Esses 178 vieram quando você clicou em **"Iniciar envio"**, que chama `enqueueCampaignFn` em `src/lib/ziontalk.functions.ts` (linhas 470‑535). Essa função **ignora completamente** o `method` da campanha e os destinatários já resolvidos. Ela faz:

```ts
let q = supabaseAdmin.from("contacts")
  .select(...).eq("consent", true).is("opt_out_at", null);
if (filter.tags?.length) q = q.contains("tags", filter.tags);
const { data: contacts } = await q;
// upsert em campaign_recipients
```

Para `method = "manual"` (sem `filter.tags`), isso vira "pegue **todos** os contatos com consentimento" — exatamente os 178 antigos que vazaram, somados aos 3 manuais já presentes (deduplicados via `onConflict`), dando 181.

A correção que fizemos antes em `createCampaignFn` resolveu a **criação**, mas o bug se repetiu no caminho do **enqueue** (clique em "Iniciar envio").

## Plano

### 1. Corrigir `enqueueCampaignFn` (`src/lib/ziontalk.functions.ts`)

Eliminar a re‑resolução de destinatários no enqueue. Os destinatários já foram resolvidos e validados pelo `createCampaignFn` (autoritativo) e estão em `campaign_recipients`. O enqueue só deve:

1. Carregar os `campaign_recipients` existentes da campanha (status `queued`).
2. Carregar os `contacts` correspondentes (para name/phone/custom_fields usados na renderização).
3. Validar canais e settings (mantém igual).
4. Montar `message_queue` com rotação/delay (mantém igual).
5. **Remover** o bloco que faz `supabase.from("contacts").select(...).eq("consent", true)` e o `upsert` em `campaign_recipients`.

Se não houver `campaign_recipients` para a campanha, retornar `{ enqueued: 0, message: "Nenhum destinatário na campanha" }` em vez de criar do zero (criação só pode acontecer via `createCampaignFn`).

Também atualizar `total_recipients` apenas se divergir, ou removê‑lo (já foi definido na criação) — evita reescrever.

### 2. Limpar a campanha "Teste" atual (opcional, sob aprovação)

Status atual: `done` com 181 destinatários, 0 enviados, 0 falhas. Opções:
- **Não mexer** — está finalizada e nada foi enviado.
- **Apagar** os 178 destinatários extras (`DELETE FROM campaign_recipients WHERE campaign_id='64351fe0...' AND contact_id NOT IN (<os 3 manuais>)`) — requer migration.

Recomendo deixar como está, já que `status='done'` e progresso 0%.

### 3. Validação manual após deploy

Criar nova campanha manual com 2‑3 contatos → clicar "Iniciar envio" → verificar que `total_recipients` permanece 2‑3 e que `message_queue` recebe só esses.

## Escopo

- **In:** uma edição em `src/lib/ziontalk.functions.ts` (função `enqueueCampaignFn`).
- **Out:** UI, criação de campanha (já corrigida), webhook, painel de envios, auth, RLS.
