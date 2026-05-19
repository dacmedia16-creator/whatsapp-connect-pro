## Problema

O toast vermelho "JWT has expired" aparece quando o token de acesso do Supabase venceu (sessões duram 1h por padrão) e você clica em **Validar contatos** (ou qualquer outra ação que chame um serverFn).

Fluxo do bug:
1. `attachSupabaseAuth` lê `supabase.auth.getSession()` e anexa o `access_token` atual no header `Authorization`.
2. Se o token já expirou e o auto-refresh do Supabase ainda não rodou (aba ficou ociosa, máquina dormiu), o serverFn recebe um JWT vencido.
3. O middleware `requireSupabaseAuth` rejeita → erro borbulha até o `toast.error` em `runPreview` mostrando a mensagem crua do Supabase.

Hoje **não existe nenhum tratamento global** para sessão expirada — o usuário fica preso na tela vendo erro genérico em vez de ser mandado de volta pro login.

## Plano

### 1. Forçar refresh proativo no `attachSupabaseAuth`

Em `src/integrations/supabase/auth-attacher.ts`, antes de pegar o token:

- Ler a `session` atual.
- Se `expires_at` está a menos de ~60s do vencimento (ou já passou), chamar `supabase.auth.refreshSession()` e usar o novo token.
- Se o refresh falhar (refresh_token inválido), seguir sem header — o servidor responde 401 e o passo 3 cuida.

Isso resolve 90% dos casos: a próxima chamada a serverFn renova o token sozinha.

### 2. Listener global de expiração no `useAuth`

Em `src/hooks/use-auth.tsx`, no `onAuthStateChange`, tratar os eventos:

- `TOKEN_REFRESHED` → silencioso (já funciona).
- `SIGNED_OUT` → limpar estado (já funciona).
- **Novo:** detectar erro de refresh (evento `SIGNED_OUT` disparado pelo Supabase quando refresh falha) → mostrar toast amigável "Sua sessão expirou, faça login novamente" e redirecionar pra `/login`.

### 3. Handler de erro nos serverFns do cliente

Criar um helper `handleServerFnError(e)` (em `src/lib/server-fn-error.ts`) que:

- Detecta strings `JWT expired`, `Unauthorized`, `No authorization header`.
- Faz `supabase.auth.signOut()` + `navigate({ to: '/login' })` + toast "Sessão expirada, entre novamente."
- Em outros erros, só repassa a mensagem original.

Substituir o `toast.error(e.message ...)` em `runPreview` (e nos outros catches de serverFn da tela de campanhas, e idealmente nas outras telas) por esse helper.

### 4. Validação

- Forçar expiração (no DevTools, alterar `expires_at` no localStorage para o passado) e clicar em **Validar contatos** → deve renovar transparentemente.
- Apagar o `refresh_token` do localStorage e clicar em **Validar** → deve redirecionar pro login com toast amigável, sem o erro vermelho cru.

## Fora de escopo

- Não vou mexer na lógica de envio nem nas configurações.
- Não vou aumentar o tempo de expiração do JWT (config do projeto Supabase, fora da UI).

## Detalhes técnicos

- O Supabase JS já tem `autoRefreshToken: true` no client, mas só renova quando a aba está visível e ativa — não cobre o caso de aba dormindo. O refresh proativo no middleware do TanStack fecha esse gap.
- `expires_at` na session é em segundos Unix; comparar com `Date.now()/1000`.
- O helper de erro precisa rodar só no cliente (usa `window`/router).
