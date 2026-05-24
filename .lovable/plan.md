## Reativar campanha finalizada com pendências

Diagnóstico da REMAX - Parceria:
- `campaigns.status = 'done'`
- 134 `campaign_recipients.status='queued'` e 134 `message_queue.status='pending'` (não foram drenados porque a UI antiga finalizava direto via `supabase.update`, pulando a server fn que marcava itens como `failed`).
- 40 já enviados, 1 falha. Restam 134 prontos para serem processados.

### Mudanças

#### 1. UI — `src/routes/_authenticated/campaigns.$campaignId.tsx`
Quando `campaign.status === 'done'` **e** existirem recipients pendentes (`stats.queued > 0`), mostrar botão **"Reativar e continuar envio"**.

Comportamento ao clicar:
- Abre `AlertDialog` de confirmação explicando: "X destinatários ficaram sem envio. A campanha voltará para o status 'Em execução' e continuará pelos pendentes."
- Se já estiver fora da janela, reaproveita o mesmo diálogo do "Retomar" (Esperar próxima janela / Enviar agora 30 min).
- Chama `setCampaignStatusFn({ status: 'running' })` (a server fn já reagenda `pending` para `now()`).

#### 2. Server fn — `src/lib/send-panel.functions.ts`
Permitir transição `done → running` (já permitida pelo enum, sem mudança de schema). Adicionar pequena salvaguarda: quando vier `status='running'` e a campanha estiver hoje `done`, sincronizar 1) `campaign_recipients` com status diferente de `sent/failed/opted_out` que tenham item correspondente em `message_queue`, garantindo que voltem para `queued` (defensivo — atualmente já estão `queued` mesmo com campanha `done`).

#### 3. Ação imediata para a REMAX - Parceria
Após o deploy: o gestor clica em **Reativar e continuar envio** na própria UI. Não vou tocar manualmente no banco — a mesma feature serve para qualquer campanha futura na mesma situação.

Sem mudanças adicionais (badge de "Janela ignorada" e diálogo de horário já existem do passo anterior e serão reutilizados).
