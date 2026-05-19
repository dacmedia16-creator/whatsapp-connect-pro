## Carregar contatos automaticamente ao marcar a lista

Hoje, depois de marcar a(s) lista(s), o usuário precisa clicar **"Calcular destinatários"** para a tabela paginada aparecer. Vou disparar esse cálculo automaticamente assim que `listIds` mudar (no método "list"), para que a tabela 10-em-10 com checkboxes apareça sozinha.

### Mudanças (apenas em `src/routes/_authenticated/campaigns.index.tsx`)

1. **Auto-preview em modo "list"** via `useEffect` em `[method, listIds.join("|")]`:
   - Se `method === "list"` e `listIds.length > 0` → chamar `runPreview()` com debounce de ~250ms (timeout) para evitar múltiplas chamadas quando o usuário marca várias listas em sequência.
   - Se `listIds.length === 0` → limpar `resolved`, `summary`, `excludedKeys`, `recipientsPage`.
   - Guarda contra disparos enquanto outra preview está em andamento (`isPreviewing` ref/state) e cancela o timeout anterior no cleanup.

2. **Indicador de carregamento**:
   - Novo estado `previewLoading: boolean` (true durante `runPreview`).
   - Botão **"Calcular destinatários"** vira **"Recalcular"** quando `resolved.length > 0` (continua disponível como ação manual, ex.: depois de mudar listas via API).
   - Enquanto carrega, mostrar um pequeno texto "Carregando contatos…" acima da `ComplianceSummary`.

3. **Mensagens auxiliares**:
   - Texto atual "1 lista(s) · 178 contato(s) na soma bruta…" continua.
   - Logo abaixo, quando `resolved.length > 0`, já aparece a `SelectableRecipients` automaticamente (já implementada).

### Não muda
- Métodos **tags / import / manual** continuam exigindo o clique no botão de "Calcular / Validar" (são entradas que mudam menos previsivelmente; auto-fetch ali poderia disparar muitas chamadas).
- Backend, schema e RLS intactos.
- Comportamento da paginação 10-em-10 e checkboxes já está pronto.

### Arquivos alterados
- `src/routes/_authenticated/campaigns.index.tsx` — `useEffect` de auto-preview + estado `previewLoading` + label dinâmica do botão.
