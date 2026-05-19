## Importar / adicionar contatos em série a uma lista existente

Hoje, no diálogo **Gerenciar contatos** de uma lista, só dá para selecionar contatos já cadastrados, um a um (ou em lote, mas apenas dos existentes). Vou adicionar duas novas formas de popular uma lista de uma vez:

### 1. Importar CSV/planilha
- Novo botão **"Importar CSV"** no topo da coluna "Adicionar contatos".
- Aceita `.csv` (vírgula ou ponto-e-vírgula) e `.txt`.
- Colunas reconhecidas: `nome`, `telefone` (obrigatória), `email`, `tags` (separadas por `;`), `consent` (true/false). Cabeçalho opcional — se não houver, a 1ª coluna é telefone e a 2ª nome.
- Limite: 5.000 linhas por importação.

### 2. Colar/digitar em série (manual em massa)
- Novo botão **"Adicionar em série"**.
- Textarea grande, uma linha por contato. Formatos aceitos:
  - `Nome, Telefone`
  - `Telefone` (nome fica vazio → usa o próprio telefone)
- Até 500 linhas.

### Fluxo comum (CSV ou manual)
1. Tela de pré-visualização (reutiliza o `RecipientTable` já existente) mostrando:
   - Elegíveis, telefone inválido, duplicados, já na lista, opt-out.
2. Botão **"Adicionar N contatos à lista"** que:
   - Faz `upsert` por `phone_e164` na tabela `contacts` (cria os novos com `consent=true`, `source='list_import'` ou `'list_manual'`).
   - Insere em `contact_list_items` apenas os que ainda não estão na lista (dedupe contra `memberIds`).
   - Mostra toast com resumo: `X adicionados · Y já estavam · Z inválidos`.

### Backend
Nova server function `addContactsToListFn` em `src/lib/contact-lists.functions.ts`:
- Input: `{ listId, rows: RawRow[], source: 'import'|'manual' }`.
- Protegida por `requireSupabaseAuth` + `assertManager`.
- Reutiliza `normalizePhoneE164` e `classifyRows` (mesma lógica do wizard de campanha).
- Retorna `{ added, alreadyInList, skipped: { invalid, optOut, duplicate } }`.

### Frontend
- Atualizar `src/components/contacts/contact-lists-tab.tsx`:
  - 2 novos diálogos (`ImportCsvDialog`, `BulkManualDialog`) dentro de `ManageListMembersDialog`.
  - Reaproveitar o parser CSV simples (sem dependência nova) — split por linha, detectar delimitador.
  - Após sucesso, invalidar `contact_list_items` e `contact_lists_counts`.

### Validações
- Telefone via `libphonenumber-js` (já em uso).
- Nome ≤ 200 chars, tags ≤ 20 itens de até 60 chars.
- Sem alteração de schema — só usa as tabelas `contacts` e `contact_list_items` existentes.

### Arquivos
- **Novo**: `src/lib/contact-lists.functions.ts`
- **Editar**: `src/components/contacts/contact-lists-tab.tsx`
