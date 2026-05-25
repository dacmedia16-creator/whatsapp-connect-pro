## Zerar contadores de envio do dia

Resetar o contador "enviados hoje" de **todos os canais** para 0, sem afetar histórico de envios, fila ou campanhas.

### O que será feito
- Atualizar a tabela `channels`:
  - `sent_today = 0`
  - `sent_today_date = CURRENT_DATE`
- Aplicado a **todos os canais** (sem filtro).

### O que NÃO muda
- Mensagens já enviadas (`send_logs`, `campaign_recipients`, `messages`) permanecem intactas.
- Fila (`message_queue`) não é tocada.
- Status dos canais (connected/paused/error) não muda.
- Limites diários (`daily_limit`) não mudam.

### Efeito prático
Após o reset, cada canal volta a poder enviar até seu `daily_limit` completo hoje (ex.: se o limite é 500 e já tinha enviado 25, agora pode enviar mais 500).

### SQL
```sql
UPDATE channels SET sent_today = 0, sent_today_date = CURRENT_DATE;
```
