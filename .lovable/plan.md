## Objetivo

Permitir que administradores rotacionem a chave ZionTalk de cada canal sem perder o histórico, mantendo apenas uma chave ativa por vez, e podendo revogar versões antigas (invalidá-las imediatamente).

## Modelagem

Nova tabela `public.channel_api_keys`:

- `channel_id` (fk canal)
- `version` (int, incrementa por canal — 1, 2, 3…)
- `key_encrypted` (bytea, `pgp_sym_encrypt`)
- `hint` (últimos 4 dígitos)
- `status` (`active` | `revoked` | `superseded`)
- `created_by`, `created_at`, `revoked_at`, `revoked_by`, `revoked_reason`
- índice único parcial: apenas **1** linha `active` por `channel_id`

A coluna `channels.zion_api_key_encrypted` deixa de ser a fonte da verdade — passa a refletir a chave ativa (mantida para compatibilidade do `get_channel_api_key`, atualizada por trigger sempre que a versão ativa muda). `channels.zion_api_key_hint` também segue espelhando.

## Funções SQL (SECURITY DEFINER, restritas a service_role)

- `rotate_channel_api_key(p_channel_id, p_plain_key, p_secret, p_user)`:
  marca a chave atual como `superseded`, insere nova versão `active`, atualiza colunas espelho em `channels`.
- `revoke_channel_api_key(p_key_id, p_user, p_reason)`:
  marca a versão como `revoked`. Se era a `active`, limpa a chave do canal e marca status `disconnected` — bloqueia novos envios até nova rotação.
- `get_channel_api_key(channel_id, secret)`: continua existindo, mas lê de `channel_api_keys` (active mais recente). Mantém fallback legado.

## Server functions (`src/lib/channels.functions.ts`)

- `rotateChannelKeyFn(channelId, newKey)` — substitui `updateChannelKeyFn`; chama `rotate_channel_api_key` via RPC.
- `revokeChannelKeyFn(keyId, reason?)` — chama `revoke_channel_api_key`.
- `listChannelKeysFn(channelId)` — retorna histórico (sem a chave em texto): `version`, `hint`, `status`, datas, autor.
- `createChannelFn`: passa a usar `rotate_channel_api_key` para criar a versão 1.

Todas exigem role `admin` e usam `process.env.CHANNEL_KEY_SECRET`.

## UI (`src/routes/_authenticated/channels.tsx`)

Botão "Rotacionar chave" abre dialog com nova chave (a antiga é marcada como superseded automaticamente). Aba/seção "Histórico de chaves" por canal mostrando tabela:

```text
versão | hint  | status      | criada em | criada por | ações
v3     | …a1b2 | active      | 18/05     | João       | Revogar
v2     | …9f0c | superseded  | 10/05     | Maria      | Revogar
v1     | …2e3d | revoked     | 01/05     | João       | —
```

Confirmação obrigatória (`AlertDialog`) antes de revogar a chave ativa, avisando que envios serão bloqueados até nova rotação.

## RLS / segurança

- `channel_api_keys` com RLS habilitada.
- Política SELECT: somente `admin` (mesmo padrão de `channels`).
- Sem políticas de INSERT/UPDATE/DELETE — alterações vão exclusivamente pelas funções `SECURITY DEFINER` chamadas com service_role pelas server functions.
- `key_encrypted` nunca é retornada à UI; apenas o `hint`.

## Compatibilidade

- Backfill: para cada canal existente com `zion_api_key_encrypted is not null`, criar versão 1 ativa em `channel_api_keys` copiando o blob cifrado.
- `get_channel_api_key` privilegia `channel_api_keys.active`; só usa fallback de `channels.zion_api_key_encrypted` se a tabela estiver vazia (transição).

## Entregáveis

1. Migration: tabela, índices, trigger de espelhamento, funções `rotate`/`revoke`, atualização de `get_channel_api_key`, backfill, grants.
2. `channels.functions.ts`: `rotateChannelKeyFn`, `revokeChannelKeyFn`, `listChannelKeysFn`; remoção/alias de `updateChannelKeyFn`.
3. `channels.tsx`: botão "Rotacionar", lista de histórico por canal, ação "Revogar" com confirmação.
4. Atualizar wizard de criação de canais para usar o novo fluxo (cria versão 1).
