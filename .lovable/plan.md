# Anexo de mídia em campanhas

Permitir que a campanha tenha um arquivo anexado (imagem, PDF, áudio ou vídeo) que será enviado junto da mensagem para cada destinatário via Ziontalk.

## 1. Storage (Lovable Cloud)

Migration nova:

- Bucket `campaign-media` (público para leitura — necessário para o Ziontalk baixar a URL).
- RLS em `storage.objects`:
  - SELECT público em `campaign-media`.
  - INSERT/DELETE apenas para usuários autenticados com role `admin` ou `gestor` (via `has_role`).
- Coluna nova em `campaigns`:
  - `media_url text null`
  - `media_type text null` (`image` | `video` | `audio` | `document`)
  - `media_mime text null`
  - `media_filename text null`
- Coluna nova em `campaign_recipients.error` já existe; nada a fazer.

Limites:
- Imagem: até 5 MB, `image/jpeg|png|webp|gif`.
- Vídeo: até 16 MB, `video/mp4|3gpp`.
- Áudio: até 10 MB, `audio/mpeg|ogg|aac|amr`.
- PDF: até 20 MB, `application/pdf`.

Validação aplicada no client (UX) e re-validada no `createCampaignFn` (mime+tamanho via HEAD no storage).

## 2. Upload no wizard

Editar `src/routes/_authenticated/campaigns.index.tsx` — passo 2 (mensagem):

- Novo componente `CampaignMediaPicker` (em `src/components/campaign/media-picker.tsx`):
  - `<input type="file">` com `accept` por tipo.
  - Detecta tipo (image/video/audio/document) a partir do mime.
  - Sobe direto via `supabase.storage.from("campaign-media").upload(...)` com path `${userId}/${campaignDraftId|uuid}/${filename}`.
  - Mostra preview: `<img>`, `<video controls>`, `<audio controls>` ou ícone + nome para PDF.
  - Botão "Remover".
- Estado `media` no wizard: `{ url, type, mime, filename, path } | null`.
- Pré-visualização (passo 2) mostra a mídia acima do texto.
- Bloqueio: se o upload falhar, exibe erro e impede avançar.

## 3. Persistência

Editar `src/lib/campaigns.functions.ts`:

- `createInput` ganha `media: z.object({ url, type, mime, filename }).nullable().optional()`.
- Insert em `campaigns` passa `media_url/media_type/media_mime/media_filename`.

## 4. Envio via Ziontalk

Editar `src/lib/ziontalk.server.ts`:

```ts
export async function zionSendMessage(opts: {
  apiKey: string;
  phone: string;
  msg: string;
  media?: { url: string; type: "image"|"video"|"audio"|"document"; filename: string; mime: string } | null;
})
```

Comportamento:
1. Se `media` presente: `fetch(media.url)` → `Blob`, anexa no FormData como campo `file` (nome do arquivo preservado).
2. Sempre anexa `msg` e `mobile_phone`.
3. POST em `https://app.ziontalk.com/api/send_message/` (mesmo endpoint).

Campo do arquivo: `file` (padrão Zion). Caso o usuário confirme outro nome depois, basta trocar uma string.

Editar `src/lib/send/sender.server.ts` para carregar `media_*` da campanha junto com a mensagem e passar para `zionSendMessage`.

## 5. UI auxiliar

- Badge na lista de campanhas (`campaigns.index.tsx`) indicando "📎 mídia" quando `media_url` presente.
- Página de detalhe (`campaigns.$campaignId.tsx`): mostrar preview da mídia anexada.

## Arquivos tocados

- nova migration (`campaign-media` bucket + colunas em `campaigns`)
- `src/components/campaign/media-picker.tsx` (novo)
- `src/routes/_authenticated/campaigns.index.tsx`
- `src/routes/_authenticated/campaigns.$campaignId.tsx`
- `src/lib/campaigns.functions.ts`
- `src/lib/ziontalk.server.ts`
- `src/lib/send/sender.server.ts`

## Risco a confirmar

O Ziontalk recebe o arquivo via campo `file` no mesmo `/api/send_message/`. Se o painel deles usar outro nome (`attach`, `arquivo`), o ajuste é de uma linha em `ziontalk.server.ts`. Em caso de erro do Ziontalk no primeiro envio de teste, ajusto imediatamente.
