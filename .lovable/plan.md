# Nova Campanha — Wizard 2 etapas

Reformular o fluxo "Nova Campanha" em um modal grande (`max-w-4xl`) com 2 etapas, 5 métodos de seleção de destinatários, e painel de revisão final. Manter compliance (consentimento, opt-out, telefone válido) como bloqueio rígido para avançar.

## 1. Banco de dados

Migração criando suporte a listas de contatos:

- `contact_lists` — id, name, description, created_by, created_at, updated_at
- `contact_list_items` — id, list_id (FK), contact_id (FK), created_at, UNIQUE(list_id, contact_id)
- Índices em `contact_list_items(list_id)` e `(contact_id)`
- RLS: admin/gestor manage; authenticated read
- Trigger `tg_set_updated_at` em `contact_lists`

Não criar `contact_tags` (já usamos `contacts.tags text[]`). Não tocar em `campaigns`, `channels`, `message_queue`, `campaign_recipients` (estrutura já adequada).

## 2. Server functions (`src/lib/campaigns.functions.ts` novo)

Todas com `requireSupabaseAuth` + checagem de role admin/gestor:

- `listContactListsFn` — retorna listas com contagem
- `previewRecipientsFn` — input: `{ method, params }`; resolve método para `{ contacts, summary }` onde summary = `{ found, eligible, blockedOptOut, blockedNoConsent, invalidPhone, duplicates }`. Suporta:
  - `list`: `{ listId }`
  - `tags`: `{ tags: string[], match: "any" | "all" }`
  - `import`: `{ rows: [{ name, phone, email?, tags?, consent }] }` — normaliza E.164 via `src/lib/phone.ts`
  - `manual`: `{ rows: [...] }` — mesmo shape
- `createCampaignFn` — valida payload completo (nome, channelId ativo, scheduledAt futuro ou null, mensagem ≥5 chars, contactIds ≥1), inserts `campaigns` + `campaign_recipients` apenas para elegíveis, registra `campaign_events` "queued", status `draft` ou `scheduled`.

Validação Zod estrita em todas (max lengths, regex telefone).

## 3. UI — `src/routes/_authenticated/campaigns.tsx`

Substituir `CampaignWizard` atual por novo `<NewCampaignWizard />` em Dialog (`max-w-4xl`, scroll interno).

### Estado central
```ts
{ step: 1|2, name, scheduledAt, channelId,
  method: "list"|"tags"|"groups"|"import"|"manual"|null,
  methodParams, resolvedContacts, summary,
  message, ratePerMin, autoOptOutFooter, autoPauseOnErrors }
```

### Etapa 1 — Dados + Destinatários

Layout:
- Header: "Nova Campanha" + subtítulo
- 3 inputs em grid: Nome, Agendamento (`datetime-local`, `min=now`), Canal (Select de canais com `status != "paused"` mostrando label + badge status)
- Card "Destinatários" expansível com badge "X contatos" (count de elegíveis)
- Grid 2x3 de cards de método (`<MethodCard>` reutilizável):
  - Listas (`List` icon)
  - Filtrar por Etiquetas (`Tag` icon)
  - Grupos do Sistema (`Users` icon, **disabled sempre** nesta versão — tooltip "Disponível apenas para WhatsApp Web")
  - Importar Planilha (`FileSpreadsheet` icon)
  - Adicionar Manualmente (`UserPlus` icon)
- Cards: borda `border-primary` quando ativo, opacidade 50 + cursor-not-allowed quando disabled
- Painel do método selecionado expande abaixo:
  - **list**: Select de listas → carrega contatos
  - **tags**: Multi-select de tags + RadioGroup "qualquer / todas"
  - **import**: `<input type="file" accept=".csv,.xlsx">`, parser CSV inline (split por `,` / `;`), XLSX via dynamic `import("xlsx")`. Mostra prévia.
  - **manual**: Form (nome, telefone, checkbox consentimento, tags via input chips), botão "Adicionar contato", lista editável
- Painel "Contatos selecionados" — tabela com colunas: Nome | Telefone (formatPhone) | Etiquetas | Origem | Consentimento | Status (badge colorido) | Remover
  - Status: `eligible` (success), `no_consent` (warn), `opt_out` (warn), `invalid_phone` (destructive), `duplicate` (muted)
  - Empty state: `<Users>` icon + "Nenhum contato encontrado / Selecione uma lista ou método"
- Resumo compliance abaixo: 6 contadores (encontrados, elegíveis, opt-out, sem consent, telefone inválido, duplicados)

### Etapa 2 — Mensagem e revisão

- Textarea "Mensagem da campanha" com chips clicáveis de variáveis: `{{nome}} {{telefone}}`
- Painel "Pré-visualização" renderizando 1º contato elegível com variáveis substituídas
- Avisos automáticos (alert amarelo):
  - msg < 20 chars
  - sem `{{nome}}` (sugerir personalização)
  - sem identificação de remetente (heurística: nenhuma palavra capitalizada longa nos primeiros 80 chars)
- Configurações em card: Velocidade (msg/min), Intervalo derivado, Checkbox "Respeitar horário comercial do canal" (sempre on, disabled), Checkbox "Pausar automaticamente se >20% falhas/opt-outs"
- Card "Resumo final": nome, canal, agendamento, total elegível, total bloqueado, método, prévia da mensagem

### Rodapé fixo

- Esquerda: "Etapa X de 2"
- Direita: Cancelar | Voltar (step 2) | Salvar rascunho | **Próxima** (step 1) / **Agendar campanha** ou **Iniciar campanha** (step 2)
- Botão Próxima desabilita até: `name && channelId && scheduledAtValid && eligibleCount >= 1`
- Botão final desabilita até: mensagem ≥5 chars

## 4. Componentes auxiliares novos

- `src/components/campaign/method-card.tsx` — card selecionável genérico
- `src/components/campaign/recipient-table.tsx` — tabela com badges de status + remover
- `src/components/campaign/compliance-summary.tsx` — 6 contadores
- `src/lib/recipient-resolver.ts` — utilitários puros (normaliza telefone, deduplica, classifica status) reusados client+server

## 5. Dependências

- `bun add xlsx` para parsing de planilhas

## 6. Detalhes técnicos

- Telefone: usar `normalizePhone` de `src/lib/phone.ts` (já existe). Inválido = não E.164 após normalizar.
- Deduplicação: por `phone_e164` dentro do conjunto resolvido + cruzar com contatos existentes para preencher consent/opt_out_at.
- Import/manual cria contatos novos via `createCampaignFn` em transação (upsert por phone), associa em `campaign_recipients`.
- Variáveis no template: `{{nome}}` → `contact.name`, `{{telefone}}` → `formatPhone`, `{{empresa}}` → `contact.custom_fields.empresa ?? ""`.
- Rota detalhe (`campaigns.$campaignId.tsx`) continua igual — não tocar.

## 7. Arquivos afetados

**Novos:**
- `supabase/migrations/<ts>_contact_lists.sql`
- `src/lib/campaigns.functions.ts`
- `src/lib/recipient-resolver.ts`
- `src/components/campaign/method-card.tsx`
- `src/components/campaign/recipient-table.tsx`
- `src/components/campaign/compliance-summary.tsx`

**Editados:**
- `src/routes/_authenticated/campaigns.tsx` — substituir `CampaignWizard`
- `package.json` — `xlsx`

## 8. Fora de escopo (deixar para depois)

- Sincronização real de grupos WhatsApp Web (card permanece disabled com tooltip)
- UI separada de gestão de listas (CRUD) — só leitura no wizard; usuário cria listas via Contatos depois (próxima iteração)
- Pausa automática efetiva no worker (apenas flag salva no `campaigns.audience_filter.autoPauseOnErrors`)
