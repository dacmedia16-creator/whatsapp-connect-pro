## Objetivo
Na Caixa de entrada, garantir que a última mensagem da conversa esteja sempre visível — rolar automaticamente para o fim ao abrir uma conversa e ao chegar mensagens novas (incluindo as próprias enviadas).

## Mudanças

**Arquivo:** `src/routes/_authenticated/inbox.tsx` (componente `ConversationPanel`)

1. Adicionar `ref` no final da lista de mensagens (um `<div ref={bottomRef} />` após o `map`).
2. Adicionar `ref` no viewport do `ScrollArea` para controlar o scroll diretamente.
3. `useEffect` que dispara quando:
   - `conv.id` muda (abrir outra conversa) → scroll instantâneo para o fim.
   - `messages.length` muda (chegou mensagem nova via realtime/polling ou envio próprio) → scroll suave para o fim, **somente se o usuário já estava próximo do fim** (ex.: < 120px do bottom). Isso evita arrastar o usuário para baixo se ele estiver lendo mensagens antigas.
4. Mostrar um pequeno indicador opcional ("↓ novas mensagens") quando há mensagens novas e o usuário rolou para cima — clicável para ir ao fim. (mínimo, opcional)

## Detalhes técnicos
- O `ScrollArea` do shadcn usa Radix; pegar o viewport via `scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')`.
- Usar `scrollTop = scrollHeight` para ir ao fim sem depender de `scrollIntoView` (mais confiável dentro do Radix).
- Para detectar "próximo do fim": `scrollHeight - scrollTop - clientHeight < 120`.
- Não mexer em lógica de envio, realtime, ou queries — apenas comportamento de scroll na UI.

## Escopo
Somente frontend (`inbox.tsx`). Nenhuma mudança em server functions, banco ou estilos globais.