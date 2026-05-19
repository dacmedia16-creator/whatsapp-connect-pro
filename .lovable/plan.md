## Objetivo

Permitir liberar o envio de respostas em uma conversa marcando manualmente o contato como consentido (opt-in), direto no inbox.

## Mudanças

### 1. Server function — `src/lib/inbox.functions.ts`
Adicionar `setContactConsentFn`:
- Input: `contactId: uuid`, `consent: boolean`.
- Permissão: apenas admin/gestor (atendente NÃO libera consent — protege LGPD).
- Quando `consent = true`: setar `consent=true`, `consent_at=now()`, e se houver `opt_out_at` válido, manter? → Decisão: se o contato fez opt-out, NÃO permitir liberar pelo botão (orientar a remover opt-out separadamente). Retornar erro claro.
- Quando `consent = false`: setar `consent=false`, limpar `consent_at`.
- Atualizar `updated_at`.

### 2. UI — `src/routes/_authenticated/inbox.tsx`
No painel direito (aside "Contato"), na seção "Consentimento":
- Se `consent=false` e sem opt-out: mostrar botão **"Marcar como consentido"** (admin/gestor). Confirmação inline ("Tem certeza? Isso libera o envio de respostas para este contato.").
- Se `consent=true`: mostrar botão discreto **"Revogar consentimento"** (admin/gestor).
- Se `opt_out_at`: manter badge "Opt-out" sem botão de liberar (não dá pra contornar opt-out por aqui).
- Atendente vê os badges mas sem botões.

No banner de bloqueio acima do composer (linha 451-455), quando for "sem consentimento" e o usuário tiver permissão, adicionar link/botão "Liberar consentimento" que aciona o mesmo fluxo.

Após sucesso: invalidar `["inbox-conversations"]` para o badge/estado atualizar, e toast "Contato marcado como consentido".

### 3. Sem mudanças de schema
A tabela `contacts` já tem `consent` e `consent_at`. Não há migration necessária.

## Detalhes técnicos

- Usar `useMutation` + `useServerFn(setContactConsentFn)` no componente da conversa.
- Permissão no front: já existe `canManage` no componente — reutilizar para mostrar/esconder os botões.
- O backend continua sendo a fonte de verdade da permissão (checagem de role admin/gestor dentro do handler).
- Não alterar o webhook nem a lógica de bloqueio do `sender.server.ts` — o desbloqueio acontece naturalmente porque `consent` passa a ser `true`.