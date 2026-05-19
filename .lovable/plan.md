## Paginação 10 em 10 no seletor de listas

No passo "Para quem enviar?" → método **Lista**, o bloco "Selecione uma ou mais listas" hoje mostra todas as listas numa área rolável. Vou paginar em **10 por página**, mantendo a seleção entre páginas.

### Mudanças (apenas em `src/routes/_authenticated/campaigns.index.tsx`)

1. **Novo estado local** ao lado de `listIds`:
   - `const [listsPage, setListsPage] = useState(0);`
   - `const PAGE_SIZE = 10;`

2. **Derivar página atual** antes do `.map`:
   - `pageCount = Math.max(1, Math.ceil(lists.length / PAGE_SIZE))`
   - `pageLists = lists.slice(listsPage * 10, listsPage * 10 + 10)`
   - Clamp: se `listsPage >= pageCount`, resetar para 0 (via `useEffect` dependente de `lists.length`).

3. **Render**: trocar `lists.map(...)` por `pageLists.map(...)`. A `div` rolável passa a ter altura natural (sem `max-h-56 overflow-y-auto`) já que são no máx. 10 itens.

4. **Cabeçalho da seleção** (linha 510-528): adicionar uma terceira ação:
   - **"Selecionar todas da página"** → `setListIds(prev => Array.from(new Set([...prev, ...pageLists.map(l => l.id)])))`
   - Manter **"Selecionar todas"** (todas as listas, todas as páginas) e **"Limpar"**.

5. **Rodapé do bloco** (entre a div da lista e o rodapé "X lista(s)…"): adicionar controles de paginação quando `lists.length > 10`:
   ```
   [‹ Anterior]   Página {listsPage+1} de {pageCount}   ({lists.length} listas)   [Próxima ›]
   ```
   - Botões `variant="ghost" size="sm"` com `ChevronLeft` / `ChevronRight` (já em uso no projeto via lucide-react — adicionar ao import se faltar).
   - Desabilitar nas extremidades.

6. **Contagem do rodapé existente** (linha 561-564) permanece igual — usa `listIds` global, independente de página.

### Comportamento
- A seleção (`listIds`) é global e persiste ao trocar de página.
- "Selecionar todas" continua marcando todas as listas do banco (não só a página).
- "Selecionar todas da página" é o atalho 10 em 10 pedido.
- O `Badge` "N contato(s)" e o estilo dos itens não mudam.

### Não muda
- Nenhuma alteração de backend, schema ou lógica de `runPreview`.
- Nenhuma alteração nas outras abas (Etiquetas, Importar, Manual) nem no `RecipientTable`.
- Sem novos componentes nem dependências.
