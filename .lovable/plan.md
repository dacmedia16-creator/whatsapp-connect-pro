## Diagnóstico

Hoje na criação da campanha (etapa 1) existe um único campo "Agendamento" do tipo `datetime-local`. A regra é: **vazio = envio imediato**, preenchido = agendar. Isso fica confuso — não há um botão claro de "Enviar agora".

## Plano

Trocar o campo único por um **seletor explícito** com duas opções:

- ⚡ **Enviar agora** (padrão) — limpa `scheduledAt`
- 📅 **Agendar para...** — mostra o input `datetime-local`

### Mudanças (apenas UI, em `src/routes/_authenticated/campaigns.index.tsx`)

1. No bloco da etapa 1 (linhas ~531‑540), substituir o campo único por um `RadioGroup` (ou dois botões segmentados) com as duas opções. Quando "Enviar agora" estiver selecionado, `scheduledAt` é forçado a `""`. Quando "Agendar para..." for selecionado, mostra o `Input datetime-local` abaixo.
2. Manter o checkbox "Iniciar/agendar imediatamente após criar (rascunho)" na etapa 3 como está — ele controla outra coisa (criar como rascunho).
3. Ajustar o texto do botão final (linha 904):
   - Rascunho → "Salvar rascunho"
   - Imediato → "Enviar agora"
   - Agendado → "Agendar campanha"
4. Resumo final (linha 852): manter "Imediato" / data formatada.

### Fora do escopo

- Nenhuma mudança no servidor (`createCampaignFn` já aceita `scheduledAt: null` como envio imediato).
- Nenhuma mudança no enqueue ou fila.
- Nenhuma mudança em settings de envio (delay, janela, rotação).
