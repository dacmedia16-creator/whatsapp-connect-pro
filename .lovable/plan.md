# Equilibrar envios entre os chips

## Diagnóstico

Distribuição real das últimas 24h (`send_logs`): 14 / 17 / 4 / 11. As campanhas estão em `rotation_mode = round_robin`, mas saiu desigual por dois motivos no código:

1. **Cursor de round-robin é em memória** (`ctx.rrCursor` em `src/lib/send/channel-selector.server.ts`). Cada execução do cron (`process-queue`) cria um `SelectorContext` novo → o cursor reinicia em 0 a cada batch. Resultado: o primeiro chip da lista é escolhido com mais frequência.
2. **Skip silencioso por pacing/limite**: quando um chip falha em algum filtro (delay entre envios, max/min, max/hora, status), o RR pula sem "devolver a vez" — chips mais lentos acumulam menos.

## Solução recomendada

Trocar o default para **`least_used`** (já implementado em `pickChannel`): a cada item, ordena os chips por `sent_today` ascendente. É auto-balanceador — se um chip ficar para trás, vira primeiro candidato até equiparar.

Mudanças:

1. **`src/components/campaign/send-settings-form.tsx`**
   - Trocar `SEND_SETTINGS_DEFAULTS.rotation_mode` de `"round_robin"` para `"least_used"`.
   - Reordenar os cards do `RadioGroup` para "Menos usado" aparecer primeiro, com badge "Recomendado".
   - Ajustar copy do "Round-robin" indicando que pode ficar desigual quando há limites/pacing.

2. **`src/lib/campaigns.functions.ts`**
   - No upsert de `campaign_send_settings`, se o cliente não enviar `rotation_mode`, gravar `"least_used"` em vez de cair no default da coluna (`round_robin`).

3. **Campanhas em andamento** (REMAX - Visita Prova, remax 2): atualizar via insert tool para `rotation_mode = 'least_used'` — pergunto antes de executar.

## Alternativa (manter round-robin "de verdade")

Persistir o cursor no banco (`campaign_send_settings.rr_cursor int`), incrementando a cada `pickChannel`. Mais código (migration + update por item) e ainda assim não compensa skips por pacing/limite. Por isso recomendo `least_used`.

## Validação

- Nova campanha com 4 chips ativos e sem limite atingido → diferença ≤ 1 entre o chip mais usado e o menos usado em `send_logs`.
- Campanhas antigas com `round_robin` continuam funcionando (sem migration forçada).

## Pergunta

Confirmo dois pontos antes de implementar:
- (a) Trocar default para **Menos usado** ✅ (recomendado)
- (b) Atualizar as **2 campanhas em andamento** para `least_used` agora, ou deixar só para campanhas novas?
