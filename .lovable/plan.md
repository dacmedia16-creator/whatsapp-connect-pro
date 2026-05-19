## Seleção de contatos dentro da lista (10 em 10)

Hoje, ao escolher uma lista no passo "Para quem enviar?", todos os contatos da lista vão direto para o cálculo de destinatários. Vou adicionar uma etapa de **revisão paginada** onde o usuário marca/desmarca contatos antes de calcular.

### Backend (novo serverFn)

Em `src/lib/campaigns.functions.ts`, adicionar `listContactsOfListsFn`:
- Input: `{ listIds: string[] }` (1–50 UUIDs).
- Lê `contact_list_items` → `contacts(id, name, phone_e164, tags, consent, opt_out_at)`.
- Dedupe por `contact.id`.
- Retorna `Array<{ id, name, phone_e164, tags, consent, optOut }>` ordenado por nome.

### Frontend (`src/routes/_authenticated/campaigns.index.tsx`)

1. **Novo estado**:
   - `listContacts: Contact[]` — contatos carregados das listas selecionadas.
   - `excludedContactIds: Set<string>` — quem foi desmarcado (padrão: todos marcados).
   - `contactsPage: number` (0-based), `CONTACTS_PAGE_SIZE = 10`.
   - `loadingContacts: boolean`.

2. **Fluxo**:
   - Botão atual **"Calcular destinatários"** vira **"Carregar contatos"** quando `method === "list"` e `listContacts.length === 0`.
   - Ao clicar: chama `listContactsOfListsFn({ listIds })`, popula `listContacts`, marca todos por padrão (`excludedContactIds = new Set()`), abre o bloco de revisão.
   - Aparece um novo card **"Revisar contatos"** com tabela paginada (10/página):
     - Checkbox por linha (controla `excludedContactIds`).
     - Colunas: ✓ | Nome | Telefone | Tags | Status (consent / opt-out badge).
     - Cabeçalho: "Marcar página", "Desmarcar página", "Marcar todos", "Desmarcar todos".
     - Rodapé: `‹ Anterior | Página X de Y | N selecionados de M | Próxima ›` + botão **"Calcular destinatários (N)"**.
   - "Calcular destinatários" filtra `listContacts` por `!excludedContactIds.has(id)` e chama `previewRecipientsFn` com `method: "manual"` passando essas linhas — assim a tela de preview / criação já existente funciona sem mudar `createCampaignFn`.
   - Botão **"Trocar listas"** limpa `listContacts` e volta ao seletor.

3. **Quando o usuário troca a seleção de listas** (`listIds` muda) ou volta para Etiquetas/Importar/Manual: resetar `listContacts`, `excludedContactIds`, `contactsPage`.

### Detalhes técnicos

- Persistência continua via `method: "manual"` no `previewRecipientsFn` (já aceita até 5000 linhas, e `createCampaignFn` recebe `recipients` direto). Mantém o resto do fluxo intacto.
- Sem alterações de schema, RLS ou outras telas.
- Sem mudança nas abas Etiquetas / Importar / Manual nem no `RecipientTable` do preview pós-cálculo.

### Arquivos alterados

- `src/lib/campaigns.functions.ts` — novo `listContactsOfListsFn`.
- `src/routes/_authenticated/campaigns.index.tsx` — estado, fetch, tabela paginada de revisão.

### Não muda

- Backend de criação de campanha, envio, ou tabelas.
- Outras abas de seleção de público.
