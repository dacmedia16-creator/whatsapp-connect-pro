## Diagnóstico

A campanha **Teste 2** não enviou porque o processamento manual respeitou o horário comercial do canal:

- Canal **Envio 1** está configurado para enviar de **09:00 até 23:59** em `America/Sao_Paulo`.
- O clique aconteceu por volta de **00:01** no horário de São Paulo.
- Por isso o lote foi marcado como **adiado**, não como enviado.
- Além disso, existem **3 itens de fila para o mesmo destinatário**, porque a campanha foi enfileirada mais de uma vez e a função atual permite duplicar mensagens na `message_queue`.

Também há um problema de UX: o botão mostra “3 adiadas”, mas não explica claramente que foi por horário comercial.

## Plano

1. **Corrigir o reagendamento fora do horário comercial**
   - Atualizar `processQueueFn` para usar a mesma lógica do endpoint público e reagendar para a próxima janela válida do canal, em vez de empurrar apenas mais 30 minutos.
   - Assim, fora do horário, a mensagem vai para o próximo horário real de envio, por exemplo 09:00.

2. **Evitar duplicidade na fila**
   - Ajustar `enqueueCampaignFn` para não inserir outra linha em `message_queue` quando já existir fila pendente/processando/enviada para o mesmo `campaign_recipient_id`.
   - Isso impede que um destinatário receba a mesma campanha mais de uma vez.

3. **Melhorar o feedback do botão “Processar lote”**
   - Quando nada for enviado por horário comercial, mostrar uma mensagem clara como: “Envio adiado por horário comercial. Próxima tentativa: 09:00”.
   - Manter os contadores de enviadas/falhas/adiadas.

4. **Limpar a campanha atual para teste correto**
   - Remover as filas duplicadas da campanha **Teste 2**, deixando apenas uma mensagem pendente para o destinatário.
   - Agendar essa mensagem para o próximo horário permitido pelo canal, ou para agora caso você queira alterar o horário do canal depois.

5. **Validar no banco**
   - Conferir que existe apenas uma fila para a campanha.
   - Conferir que o status fica coerente: `queued/pending` até o horário permitido, ou `sent` após processamento dentro da janela.