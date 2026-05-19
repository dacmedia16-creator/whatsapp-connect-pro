# Redesign global — ZionFlow SaaS

Objetivo: elevar o painel a um SaaS B2B premium (clareza, confiança, hierarquia), sem tocar em regra de negócio, auth, schema ou integrações. Apenas camada visual e de composição.

## Direção visual aprovada

- **Paleta Navy Trust** — fundo claro, navy profundo como cor primária, azul médio como acento, branco/cinza claro como superfícies.
- **Tipografia** — Space Grotesk (display/headings) + DM Sans (body/UI), via `@fontsource`.
- **Layout dashboard clássico** — sidebar + topbar + grade de painéis.
- **Densidade arejada (2/5)** — espaçamento generoso, cards com respiro, tabelas com linhas confortáveis.

## Sistema de design

### Tokens (`src/styles.css`)

Substituir paleta Emerald por Navy Trust em oklch:

```text
--background      #fafbfc   off-white frio
--foreground      #0f1b3d   navy profundo
--card / popover  #ffffff
--muted           #f1f5f9
--muted-foreground#64748b
--border / input  #e2e8f0
--primary         #0f1b3d   navy
--primary-foreground #ffffff
--accent          #3b6fa0   azul médio (links, focus, highlights sutis)
--ring            #3b6fa0
--success         verde sóbrio
--warning         âmbar
--destructive     vermelho controlado
--sidebar         #0f1b3d   navy profundo
--sidebar-foreground #e8edf3
--sidebar-accent  #1e3a5f
--sidebar-primary #3b6fa0   estado ativo
--gold → removido (substituído por accent azul; nenhum botão "dourado")
```

Versão `.dark` espelhada (background `#0b1226`, card `#111a33`, primary vira accent azul claro para contraste).

Tokens novos para profundidade:
```text
--shadow-xs   0 1px 2px rgba(15,27,61,.04)
--shadow-sm   0 1px 3px rgba(15,27,61,.06), 0 1px 2px rgba(15,27,61,.04)
--shadow-md   0 4px 12px rgba(15,27,61,.08)
--radius      0.625rem (mantido)
```

### Tipografia

- Instalar `@fontsource/space-grotesk` + `@fontsource/dm-sans` via `bun add`, importar em `src/main.tsx` (ou equivalente bootstrap).
- `--font-display: "Space Grotesk"`, `--font-sans: "DM Sans"`.
- Escala: h1 32/40, h2 24/32, h3 20/28, body 14/22, small 12/18. `tracking-tight` em headings.
- Remover Instrument Serif e Work Sans do CSS.

### Primitivas shadcn (variantes, sem mudar API)

- **Button** — novo variante `premium` (navy gradient sutil), variant default já é navy. `size="icon"` ganha `min-h-10 min-w-10` para mobile.
- **Card** — novo `CardToolbar` slot e variantes (`elevated`, `flat`, `interactive`). Padding padrão `p-6`.
- **Input/Textarea/Select** — altura `h-10`, `bg-card`, foco em `ring-accent`.
- **Badge** — novas tones: `success`, `warning`, `info`, `neutral`, `outline-soft`.
- **Table** — header `bg-muted/50` + `text-xs uppercase tracking-wide`, linhas com hover `bg-muted/40`, divisórias suaves.
- **Dialog/Sheet** — header com título grande display e descrição muted.

### Estados globais (componentes novos em `src/components/ui/`)

- `EmptyState` — ícone em círculo accent, título display, descrição, CTA.
- `LoadingState` — Skeletons consistentes (cards, lista, tabela).
- `ErrorState` — alerta destrutivo com botão "Tentar novamente".
- `StatCard` — métrica padrão (label, valor grande display, delta com seta colorida, ícone).
- `SectionHeader` — substitui usos ad-hoc, com breadcrumbs opcional.

## Telas

### 1. Sidebar (`app-sidebar.tsx`)
- Fundo navy `--sidebar`, logo monocromático (sem o quadrado dourado), agrupamentos: **Operação** (Inbox, Contatos), **Crescimento** (Campanhas, Painel de envios), **Análise** (Dashboard, Relatórios), **Sistema** (Canais, Configurações).
- Item ativo: barra accent à esquerda + bg `--sidebar-accent`.
- Rodapé com avatar, nome, role em badge sutil; menu de ações (perfil, sair).

### 2. Topbar (`_authenticated.tsx`)
- Altura 56, busca global (`⌘K` placeholder), notificações (sino), seletor de workspace/canal ativo, atalho de novo (botão primário).

### 3. Dashboard (`dashboard.tsx`)
- Grade clássica: 4 `StatCard` no topo (Mensagens, Conversas ativas, Taxa de entrega, Contatos).
- Linha seguinte: gráfico de volume (col-span-2) + lista "Conversas que aguardam resposta".
- Linha final: "Campanhas recentes" (tabela compacta) + "Saúde dos canais".

### 4. Inbox (`inbox.tsx`)
- Layout 3 colunas: lista de conversas (320px), thread, painel de contato (320px colapsável).
- Header da thread com avatar, nome, canal, badges de consentimento (já existentes) refinados.
- Composer com toolbar (anexo, template, emoji), botão enviar primary, banner de bloqueio com tom warning + ação "Liberar consentimento".
- Painel de contato com seções: Identidade, Consentimento, Listas, Histórico.

### 5. Contatos (`contacts.tsx`)
- Topo: busca + filtros (lista, consentimento, canal, tag) em chips removíveis.
- Tabela: avatar, nome, telefone, canais (badges), consentimento (badge color), última interação, ações (menu).
- Bulk actions na barra ao selecionar.
- Aba "Listas" como tabs no topo.

### 6. Campanhas
- **Lista** (`campaigns.index.tsx`): cards de campanha com KPIs (enviadas, entregues, respondidas), status badge, gráfico sparkline.
- **Detalhe / Settings**: stepper visual (1. Público → 2. Mensagem → 3. Envio → 4. Revisão) no topo, conteúdo em cards `flat` por etapa.

### 7. Painel de envios (`sending-panel.tsx`)
- Header com switch global pausar/retomar.
- Cards de fila por canal com progresso, taxa/s, throttling.
- Tabela de jobs com status colorido.

### 8. Canais (`channels.tsx`)
- Grid de cards por canal (logo WhatsApp/etc, status pill, número, saúde), CTA "Conectar canal" como card tracejado.

### 9. Relatórios (`reports.tsx`)
- 4 KPIs no topo, abas (Mensagens / Campanhas / Atendimento), gráficos com tema custom (cores `--chart-*` realinhadas ao navy/accent), tabela detalhada exportável.

### 10. Configurações (`settings.tsx`)
- Layout duas colunas: nav vertical de seções + conteúdo em cards `flat` com `SectionHeader`.

### 11. Auth (`login.tsx`, `signup.tsx`)
- Split-screen: formulário à esquerda em card minimalista, lateral direita navy com logo, tagline e prova social/feature highlights.

## Responsividade

- Sidebar colapsa para ícones em < 1024px, vira drawer offcanvas em < 768px.
- Inbox: 3 colunas → 2 (esconde painel contato) em < 1280px → 1 (stack com tabs) em < 768px.
- Tabelas grandes: scroll horizontal com sombra de borda; cards em mobile substituem tabelas em Contatos e Campanhas.
- `h-dvh` no shell para evitar problemas mobile.

## Acessibilidade

- Tokens com contraste AA validado (navy `#0f1b3d` em branco = 14:1).
- `focus-visible:ring-2 ring-accent ring-offset-2` global.
- Todos botões icon-only revisados para `aria-label`.
- `<main>` único no layout autenticado e rotas públicas.
- Tap targets ≥ 44px em mobile.

## Arquivos previstos (apenas UI, sem lógica)

```text
src/styles.css                          paleta + tokens
src/main.tsx                            imports @fontsource
src/components/ui/button.tsx            variante premium + sizes
src/components/ui/card.tsx              variantes
src/components/ui/badge.tsx             tones
src/components/ui/table.tsx             estilos header
src/components/ui/input.tsx, textarea.tsx, select.tsx
src/components/empty-state.tsx          NOVO
src/components/loading-state.tsx        NOVO
src/components/error-state.tsx          NOVO
src/components/stat-card.tsx            NOVO
src/components/section-header.tsx       NOVO (substitui page-header)
src/components/app-sidebar.tsx          grupos + visual
src/components/topbar.tsx               NOVO
src/routes/_authenticated.tsx           topbar + main
src/routes/_authenticated/dashboard.tsx
src/routes/_authenticated/inbox.tsx
src/routes/_authenticated/contacts.tsx
src/routes/_authenticated/campaigns.*.tsx
src/routes/_authenticated/sending-panel.tsx
src/routes/_authenticated/channels.tsx
src/routes/_authenticated/reports.tsx
src/routes/_authenticated/settings.tsx
src/routes/login.tsx, signup.tsx
```

## Garantias

- Nenhuma mudança em `src/lib/*.functions.ts`, `src/lib/*.server.ts`, `src/integrations/supabase/*`, migrations, RLS, webhooks ou rotas `/api/*`.
- Todos os hooks, mutations, queries e props existentes preservados.
- Apenas markup, classes, variantes de componentes e novos componentes de apresentação.

## Entrega

Ao final, resumo por tela com antes/depois conceitual e principais ganhos de UX (hierarquia, navegação, densidade, consistência, acessibilidade).
