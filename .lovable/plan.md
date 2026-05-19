## Problema

Ao criar campanha por **lista** ou **etiquetas**, mesmo selecionando apenas 10 contatos na UI, o backend dispara para todos (178). O wizard mostra "10 de 178 elegíveis selecionados", mas o envio ignora isso.

## Causa raiz

Em `src/lib/campaigns.functions.ts` (handler de `createCampaignFn`), o bloco "Resolução autoritativa" para `method === "list"` e `method === "tags"` **recarrega todos os contatos da fonte (lista/tag)** e descarta o array `data.recipients` enviado pelo cliente. O comentário no código diz explicitamente:

> "Para 'list' e 'tags' RECARREGAMOS a fonte do banco — ignoramos o array do cliente para impedir vazamento de contatos antigos."

Isso evita vazamento, mas também ignora a **subseleção** que o usuário fez no modal (os 10 marcados). Resultado: `contactIds` acaba contendo os 178 elegíveis da lista, não os 10 escolhidos.

Para `import` e `manual` o problema não ocorre porque o servidor usa diretamente `data.recipients`.

## Correção

Tratar `data.recipients` como **whitelist de telefones** quando o método for `list`/`tags`:

1. No início do handler, construir `Set<string>` com os `phone_e164` enviados pelo cliente (já existe como `clientPhones`).
2. Nos branches `list` e `tags`, ao iterar os contatos resolvidos do banco, **filtrar** apenas aqueles cujo `phone_e164` está em `clientPhones`. Continua descartando opt-out / sem consent no servidor (autoridade preservada).
3. Validar que ao menos 1 contato sobrou após o cruzamento — se a interseção for vazia, lançar erro claro ("Seleção não corresponde aos contatos da lista").
4. Atualizar `audience_filter.server_resolved` para refletir a diferença (já mostra `client_submitted` e `diff_from_client`).

Isso preserva a proteção contra vazamento (servidor ainda é a fonte de verdade para consent/opt-out e para IDs reais), mas honra a subseleção do usuário.

## Arquivo afetado

- `src/lib/campaigns.functions.ts` — apenas o handler de `createCampaignFn`, branches `list` e `tags`.

## Validação

1. Criar campanha por lista escolhendo 10 de 178 → `total_recipients = 10`, 10 linhas em `campaign_recipients`, 10 em `message_queue`.
2. Criar campanha por lista sem desmarcar nada → comportamento atual preservado (178).
3. Criar por etiquetas com subseleção → mesma lógica.
4. Import/manual → inalterado.
