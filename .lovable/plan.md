## Problema

A campanha "Teste" foi criada com a lista **"Corretores Remax Unica Escolha"** (178 contatos), mas acabou enfileirando **181 destinatários** — três a mais do que a lista contém. Esses três contatos extras vêm da base de contatos antiga e o usuário quer que a campanha use **só** o que está na fonte selecionada.

Levantamento no banco confirmou:
- `contact_list_items` da lista: **178**
- `contacts` elegíveis na base inteira: **181** (consent=true, sem opt-out)
- Diferença: 3 contatos elegíveis estão fora da lista, mas mesmo assim entraram

## Causa provável

O `previewRecipientsFn` ("list") faz `select contact:contacts(...)` em `contact_list_items` — isso é correto. Mas o `createCampaignFn` **não revalida** que cada `recipient` enviado pelo cliente realmente pertence às listas declaradas em `methodSummary.listIds`. Se o estado de UI ficou sujo (ex.: o usuário trocou de método "tags → list" e a lista de `eligibleRecipients` reteve resíduos), o servidor aceita do mesmo jeito.

Também falta: na tela de criação, o usuário não vê de forma explícita "lista tem 178, fila tem 181" — então o desvio passa despercebido.

## Plano

### 1. Endurecer o servidor (fonte da verdade)

Em `src/lib/campaigns.functions.ts → createCampaignFn`:

- Quando `method === "list"`: ignorar o array `recipients` do cliente e **recarregar** os contatos diretamente de `contact_list_items.in('list_id', methodSummary.listIds)`. Aplicar consent + opt-out + dedup por telefone. Resultado vira a fonte autoritativa de `contactIds`.
- Quando `method === "tags"`: idem — refazer a query `contacts` filtrada por `methodSummary.tags` + `match`.
- Quando `method === "import" | "manual"`: manter o caminho atual (não tem fonte canônica no DB), mas validar que cada `phone_e164` recebido aparece na lista de telefones que o cliente declarou ter importado/digitado.
- Se a contagem final divergir do que o cliente enviou, registrar a diferença em `audience_filter` para auditoria.

### 2. Limpar estado da UI ao trocar de método

Em `src/routes/_authenticated/campaigns.index.tsx`:

- Ao mudar `method`, já zera `resolved`, mas **também** zerar `excludedKeys`, `listIds`, `tagSelection`, `manualRows`, `importedRows` — para não vazar IDs/telefones de uma fonte anterior.
- Garantir que `eligibleRecipients` (linha 425) só considere itens cuja `source === method` atual.

### 3. Tornar a contagem visível no passo 1

Na seção "Destinatários" do wizard, mostrar um resumo curto em 3 números:

```text
Lista: 178   →   Elegíveis: 175   →   Na fila: 175
                                       (-3 sem consentimento)
```

Hoje só aparece "X selecionados / Y total"; a quebra deixa claro de onde vem cada exclusão e impede o "+3 fantasma" passar batido.

### 4. Validação manual

Depois do deploy:
1. Criar campanha pela lista "Corretores Remax": esperar exatamente 178 (ou menos, conforme consent).
2. Trocar de método "list → tags → list" no meio do fluxo: contadores zeram, sem resíduo.
3. Conferir no painel de envios que `campaign_recipients.count` bate com o resumo do wizard.

## Fora de escopo

- Não vou apagar contatos antigos da base (mantém histórico).
- Não toca em send-panel, processamento de fila, autenticação ou cancelamento de campanha.