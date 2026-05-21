## Diagnóstico

Verifiquei na base. A campanha **Feedback Semanal** (running) tem os 4 chips selecionados, modo **round_robin**, delay de 30s.

Dados de hoje (2026-05-21):

| Canal   | Enviados hoje | Pendentes |
|---------|---------------|-----------|
| Envio 1 | **0**         | 15        |
| Envio 2 | 4             | 15        |
| Envio 3 | 6             | 16        |
| Envio 4 | 8             | 15        |

Ou seja: **Envio 1 nunca foi escolhido** pelo seletor em nenhuma rodada do cron. Confirmei: nem sucesso, nem falha — zero tentativas em `send_logs`.

## Causa raiz

Em `src/lib/send/channel-selector.server.ts`, o cursor de round-robin (`rrCursor`) vive dentro do `SelectorContext`, que é **recriado a cada execução do cron** (`createSenderContext` em `process-queue.ts`). O cursor sempre começa em **0**.

O enfileiramento espaça itens a cada `delay_seconds` (30s). O cron roda a cada ~60s, então cada batch claim'a apenas **1-2 itens elegíveis**. Em cada batch:

- pick #1: cursor=0 → candidato `[E3,E4,E1,E2]` → escolhe **E3**
- pick #2: cursor=1 → candidato `[E4,E1,E2,E3]` → escolhe **E4**
- (batch acaba antes de chegar em E1 e E2)

Como o cursor zera no próximo cron, **E1 e E2 (posições 2 e 3 da lista) nunca são alcançados**. Por isso E3 e E4 acumulam quase todos os envios e E1 fica em zero. Os itens originalmente pré-atribuídos a E1 no enqueue acabam sendo reatribuídos ao chip escolhido pelo `pickChannel` (linha 208 do `sender.server.ts`), e desaparecem da fila de E1 sem nunca usar o chip.

## Correção

**Persistir o cursor de round-robin entre execuções do cron**, por campanha.

### Detalhes técnicos

1. **Migration**: adicionar coluna `rotation_cursor int not null default 0` em `campaign_send_settings`.

2. **`src/lib/send/channel-selector.server.ts`** (`pickChannel`):
   - No modo `round_robin`, ler o cursor inicial do `settings.rotation_cursor` na primeira chamada da campanha no batch (cachear em `ctx.rrCursor`).
   - Após escolher um canal, fazer `UPDATE campaign_send_settings SET rotation_cursor = ((rotation_cursor + 1) % N) WHERE campaign_id = …` (UPDATE atômico — não usa o valor lido, evita race entre instâncias do cron).
   - O cache em memória continua avançando local para evitar repetir o mesmo chip dentro de um batch grande.

3. **Importante**: avançar o cursor **somente quando um canal é efetivamente retornado** (não quando todos falham nas regras de limite). Caso contrário, retries vazios pularão posições.

### O que NÃO vou mexer

- Lógica de `least_used` e `manual_priority` continuam iguais.
- Enfileiramento inicial (`pickInitialChannel`) continua igual — é só placeholder de canal, o `pickChannel` no envio já reatribui.
- Sem mudanças em UI, schedule de cron, ou outros fluxos.

## Resultado esperado

Após o fix, o próximo batch que escolher E3 grava cursor=1 no banco; o batch seguinte começará em cursor=1 (E4); o próximo em cursor=2 (**E1**); depois cursor=3 (E2). Distribuição efetivamente justa entre os 4 chips mesmo com batches pequenos.
