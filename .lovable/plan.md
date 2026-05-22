## Aumentar limite de anexos para 30 MB

Atualmente os limites em `src/components/campaign/media-picker.tsx` são:
- Imagem: 5 MB
- Vídeo: 16 MB
- Áudio: 10 MB
- PDF: 20 MB

### Mudança
Subir todos para **30 MB** em `LIMITS` e atualizar o texto auxiliar abaixo do botão para "Imagem, vídeo, áudio ou PDF ≤30MB".

### Observações importantes
- O bucket `campaign-media` no Storage tem um `file_size_limit` próprio. Se estiver definido abaixo de 30 MB, uploads vão falhar com erro do Storage mesmo com o front liberado. Vou verificar e, se necessário, criar migration para subir o limite do bucket para 30 MB (≈ 31457280 bytes).
- A API ZionTalk pode ter seu próprio teto por tipo de mídia (especialmente vídeo, que no WhatsApp oficial é 16 MB). Arquivos acima do limite real do provedor vão retornar erro no envio — o limite de upload no app sobe, mas o envio em si pode falhar. Quer que eu mantenha 30 MB para todos mesmo assim, ou prefere 30 MB só onde faz sentido (ex.: PDF/áudio) e manter vídeo em 16 MB?
