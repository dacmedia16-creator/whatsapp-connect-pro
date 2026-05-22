## Despausar campanha "Feedback REMAX"

Aplicar uma migration única que retoma a campanha pausada agora há pouco:

```sql
update public.campaigns
   set status = 'running', updated_at = now()
 where id = 'a497d320-dd1b-408a-a091-8caf0a2a6d23'
   and status = 'paused';
```

Sem alteração de schema, lógica ou configurações. Apenas troca o status de `paused` → `running` para que o cron volte a processar a fila pendente dessa campanha.

**Aviso:** a causa raiz do auto-pause indevido (descrita na mensagem anterior — `auto_pause_on_all_channels_down` disparando em pacing temporário) **continua presente**. Se nada for ajustado, a campanha pode voltar a pausar pelo mesmo motivo em poucos minutos. Recomendo, em seguida, aprovar também a correção do bug de classificação no `pickChannel` / `sender`.