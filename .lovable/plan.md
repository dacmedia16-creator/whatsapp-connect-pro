## Problema

Clicar em "Abrir" navega para `/campaigns/<id>`, mas a página de detalhes não aparece — continua mostrando a lista de campanhas.

## Causa

No TanStack Router (flat routing), o arquivo `src/routes/_authenticated/campaigns.tsx` vira **rota pai** de `campaigns.$campaignId.tsx`. O `routeTree.gen.ts` confirma isso: `$campaignId` é registrado como child de `/campaigns`.

Como rota pai, `campaigns.tsx` precisaria renderizar `<Outlet />` para que o filho apareça. Hoje ela renderiza apenas `<CampaignsPage />` (a lista), sem `<Outlet />`. Resultado: a URL muda, o route filho "casa", mas nada do filho é renderizado.

## Correção

Transformar `campaigns.tsx` em rota índice, renomeando para `campaigns.index.tsx`. Assim:

- `/campaigns` → `campaigns.index.tsx` (lista)
- `/campaigns/$campaignId` → `campaigns.$campaignId.tsx` (detalhe)

Ambos viram rotas-irmãs sob `/campaigns`, sem precisar de layout pai nem `<Outlet />`. O Vite plugin regenera `routeTree.gen.ts` automaticamente.

### Passos

1. Renomear `src/routes/_authenticated/campaigns.tsx` → `src/routes/_authenticated/campaigns.index.tsx`.
2. Atualizar dentro do arquivo: `createFileRoute("/_authenticated/campaigns")` → `createFileRoute("/_authenticated/campaigns/")` (trailing slash indica index route no TanStack).
3. Nenhuma mudança em links (`<Link to="/campaigns/$campaignId">` continua válido) nem em `campaigns.$campaignId.tsx`.

Sem mudanças em backend, dados ou outras telas.
