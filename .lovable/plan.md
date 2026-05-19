## Cancelar/ignorar previews antigos quando a seleção mudar rápido

Hoje, se o usuário marca/desmarca várias listas em sequência, o debounce de 250ms reduz chamadas — mas se duas chamadas já estiverem em voo (ex.: lista grande lenta + nova seleção), a resposta antiga pode chegar depois e sobrescrever `resolved` / `summary` com dados obsoletos. Vou ignorar respostas que não correspondem mais à seleção atual.

### Mudanças (somente em `src/routes/_authenticated/campaigns.index.tsx`)

1. **Token de requisição** com `useRef<number>(0)` (`previewReqIdRef`):
   - `runPreview()` incrementa o ref no início e captura o valor local (`myReq`).
   - Após `await previewFn(...)`, compara `myReq` com `previewReqIdRef.current`. Se diferente, **descarta** a resposta (não chama `setResolved`/`setSummary`/`setPreviewLoading(false)` finais).
   - Apenas a chamada vencedora aplica resultado e zera `previewLoading`.

2. **AbortController por chamada** (`previewAbortRef`):
   - Antes de cada `runPreview()`, aborta o controller anterior se existir.
   - Cria novo `AbortController`, guarda em ref, e passa `signal` para `previewFn({ data, signal })` (TanStack serverFn aceita `signal` no segundo argumento — ou via fetch options). Se a chamada for cancelada, ignorar `AbortError` no catch (sem toast).
   - Isso libera rede/CPU além do simples descarte.

3. **Debounce mais robusto no `useEffect`**:
   - Manter `setTimeout` de 250ms, mas no cleanup também marcar o token atual como inválido (incrementando `previewReqIdRef`) para descartar qualquer resposta pendente da seleção anterior.
   - Quando `listIds.length === 0`, além de limpar o estado, abortar o controller atual e incrementar o token.

4. **Estado de loading consistente**:
   - `setPreviewLoading(true)` continua no início. Só vira `false` quando a resposta vencedora retorna (ou em erro não-abort dela). Chamadas descartadas não tocam o flag — assim a UI continua mostrando "Carregando…" até a última requisição válida concluir.

5. **Cleanup ao desmontar/fechar o dialog**:
   - Em `useEffect` de cleanup do componente (ou ao fechar o modal de criação), abortar o controller pendente e incrementar o token, evitando warning de set state em componente desmontado.

### Não muda
- Lógica de seleção, paginação 10-em-10, checkboxes e backend (`previewRecipientsFn`) ficam intactos.
- Métodos `tags`/`import`/`manual` continuam manuais, mas se beneficiam da mesma proteção (qualquer clique repetido cancela o anterior).

### Arquivos alterados
- `src/routes/_authenticated/campaigns.index.tsx` — refs (`previewReqIdRef`, `previewAbortRef`), ajuste em `runPreview`, `useEffect` de auto-preview e cleanup.
