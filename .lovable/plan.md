## O que está errado

Validando contra o banco, encontrei 4 inconsistências reais no **Dashboard** e nos **Relatórios** que fazem os números não baterem entre as telas:

### 1. Dashboard — "Taxa de entrega" está sempre 100%
A fórmula é `delivered / sent`, mas o código define `delivered = sent`. Logo, sempre dá 100%, mesmo que existam 68 falhas no banco.
**Correção:** calcular como `sucessos / (sucessos + falhas)` usando `send_logs.http_status` (≥300 = falha).

### 2. Dashboard — "Mensagens enviadas" não bate com o resto do app
- Dashboard mostra `send_logs` com `http_status<300` = **202** (inclui testes, retries, reenvios).
- Painel de campanha mostra `campaign_recipients.status='sent'` = **160**.
São métricas diferentes com o mesmo rótulo. O usuário vê "200" aqui e "160" ali e acha que está errado.
**Correção:** trocar a métrica do Dashboard para **destinatários entregues** (`campaign_recipients` com `status='sent'`), que é o que aparece nas campanhas e no painel de envios. Os 202 do `send_logs` viram um card secundário "Tentativas de API".

### 3. Dashboard — "Taxa de resposta" mistura tudo
`replies = todas mensagens recebidas no histórico` ÷ `tentativas de envio`. Não filtra por campanha nem por janela de tempo, e pode passar de 100%.
**Correção:** contar **contatos únicos** que responderam após o primeiro envio de campanha, dentro do mesmo período do gráfico (14 dias).

### 4. Dashboard e Relatórios — Gráfico por dia com fuso errado
O agrupamento usa `created_at.slice(0,10)` (UTC). Como o usuário está em BRT (UTC-3), envios feitos depois das 21h aparecem **no dia seguinte** no gráfico.
**Correção:** converter para `America/Sao_Paulo` antes de pegar a data (`toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })`).

### 5. Bônus — limite silencioso de 1000 linhas
PostgREST corta em 1000 por padrão. Hoje você tem 209 logs, então ainda não morde, mas quando passar de 1000 os números vão "parar de crescer" sem aviso.
**Correção:** trocar as queries de contagem por `select("*", { count: "exact", head: true })` no dashboard.

---

## Arquivos a alterar

- `src/routes/_authenticated/dashboard.tsx` — refatorar os 4 stat cards e o gráfico (itens 1–5)
- `src/routes/_authenticated/reports.tsx` — corrigir agrupamento por fuso em `OverviewReport` (item 4) e nos demais agrupamentos por dia

Sem mudanças no backend / banco — é tudo correção de fórmula e fuso no frontend.

## Confirmação rápida

Quer que eu vá direto pelo plano acima, ou prefere que eu corrija só **o Dashboard** primeiro (que é o que aparece logo que você entra) e deixe Relatórios para depois?
