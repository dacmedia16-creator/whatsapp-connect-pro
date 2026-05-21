## Diagnóstico

Os dados da campanha **Feedback Semanal** estão corretos no banco para a campanha: **77 destinatários**, **77 enviados**, **77 registros na fila como sent**, **77 logs 2xx**.

A divergência vem de telas usando fontes diferentes para o mesmo número:

- **Dashboard / Saúde dos canais** usa `channels.sent_today`, que soma envios de todos os tipos e pode incluir envios manuais/testes ou campanhas anteriores do dia.
- **Painel de Envios** mostra por campanha usando `campaign_recipients` e `message_queue`, mas a aba de canais mostra saúde global dos canais.
- **Relatórios** ainda mistura `send_logs`, `messages`, `campaign_recipients` e `channels.sent_today`, então os números não fecham entre telas.

Exemplo real encontrado:

```text
Campanha Feedback Semanal: 77 enviados
Envio 1: 13 da campanha, sent_today 13
Envio 2: 14 da campanha, sent_today 16  <- 2 envios extras fora dessa campanha
Envio 3: 25 da campanha, sent_today 25
Envio 4: 25 da campanha, sent_today 25
Soma campanha: 77
Soma sent_today: 79
```

## Plano de correção

1. **Criar uma fonte única para métricas de envio**
   - Centralizar as contagens em server functions, usando `campaign_recipients` como verdade para progresso de campanha.
   - Usar `send_logs` apenas como “tentativas/API”, não como “mensagens enviadas”.
   - Usar `messages` apenas para conversas/mensagens exibidas, não para progresso de campanha.

2. **Corrigir o Dashboard**
   - Card “Mensagens enviadas”: total de `campaign_recipients.status = 'sent'`.
   - Card “Taxa de entrega”: `sent / (sent + failed)` usando destinatários da campanha, não logs globais.
   - Gráfico diário: agrupar enviados por `campaign_recipients.sent_at` em São Paulo.
   - Saúde dos canais: deixar claro se é **uso global de hoje** ou mudar para contagem real de `send_logs` por canal no dia.

3. **Corrigir o Painel de Envios**
   - Overview e progresso: contar direto por `campaign_recipients` da campanha selecionada.
   - “Total na fila” deve representar total da campanha, não total de linhas existentes em `message_queue`.
   - Aba “Canais”: adicionar/usar contagem **dessa campanha por canal**, para não confundir com `sent_today` global.
   - Manter `sent_today` apenas como controle de limite diário do chip.

4. **Corrigir Relatórios**
   - Relatório por campanha: usar `campaign_recipients` para enviados/falhas/pendentes/opt-out.
   - Relatório por canal: separar “enviadas hoje por campanha/log” de “contador de limite diário”.
   - Visão geral: gráfico por dia baseado em `campaign_recipients.sent_at` e falhas por status do destinatário.

5. **Validação final**
   - Conferir novamente no banco a campanha Feedback Semanal.
   - Confirmar que Dashboard, Painel de Envios e Relatórios mostram os mesmos totais para enviados/falhas/pendentes.
   - Manter os números de “tentativas API” como métrica separada quando necessário.