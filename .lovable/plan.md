## Problema

Na criação de campanha, ao desmarcar contatos na Etapa 1 (ex.: 98 de 178), o "Resumo final" da Etapa 2 mostra **178** em vez de **98**, dando a impressão de que a seleção manual foi ignorada.

## Causa

Em `src/routes/_authenticated/campaigns.index.tsx`, linha 877, o resumo exibe `summary.eligible`, que vem do resolver de contatos (contagem bruta de elegíveis na lista, **sem** considerar as exclusões manuais do usuário em `excludedKeys`).

O envio real **já está correto** — `submit.mutate()` (linha 472–473) usa `eligibleRecipients`, que aplica `excludedKeys` e contém apenas os 98 selecionados. O problema é puramente visual.

## Correção

Em `src/routes/_authenticated/campaigns.index.tsx`:

1. Linha 877 — trocar `{summary.eligible}` por `{eligibleCount}` (variável já existente na linha 454, que respeita `excludedKeys`).
2. Quando `eligibleCount !== summary.eligible`, anexar um sufixo discreto tipo `(de {summary.eligible} na lista)` para deixar claro que houve filtragem manual.
3. Manter o bloco de "Bloqueados" como está — ele segue refletindo opt-out/sem consentimento/inválidos/duplicados detectados pelo resolver.

Nenhuma mudança no backend, no envio ou no resolver — apenas no rótulo do resumo.
