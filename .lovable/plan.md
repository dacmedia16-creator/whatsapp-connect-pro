## "Configurar envios" abre em modal (sem sair da página)

Trocar o botão atual (que navega para `/campaigns/$id/settings`) por um modal/dialog que abre o mesmo formulário de configuração em cima da página da campanha. Ao salvar ou fechar, continua na mesma tela.

---

### 1. Novo componente — `src/components/campaign/send-settings-dialog.tsx`

Wrapper em volta do `<Dialog>` shadcn que:
- Recebe `campaignId`, `campaignName`, `totalRecipients`, `open`, `onOpenChange`.
- Internamente carrega:
  - Lista de canais (`channels` com `id, label, phone_e164, status, business_hours`).
  - Settings atuais via `useServerFn(getSendSettingsFn)` + `useQuery(["send-settings", campaignId])`.
- Renderiza `<SendSettingsForm>` dentro de `<DialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">`.
- Rodapé do dialog com botões **Cancelar** / **Restaurar padrão** / **Salvar** — mesmas ações da página atual.
- Ao salvar com sucesso: `toast.success`, `queryClient.invalidateQueries(["send-settings", campaignId])`, fecha o dialog.
- Bloqueio de fechar quando há `dirty` (igual ao baseline atual: pergunta de confirmação opcional via toast — ou simplesmente desabilita o overlay-close enquanto dirty).

### 2. `src/routes/_authenticated/campaigns.$campaignId.tsx`

- Adicionar estado local `const [settingsOpen, setSettingsOpen] = useState(false)`.
- Substituir o `<Button asChild>` + `<Link to="/campaigns/$campaignId/settings">` por:
  ```tsx
  <Button variant="outline" onClick={() => setSettingsOpen(true)}>
    <Settings className="h-4 w-4 mr-1" /> Configurar envios
  </Button>
  <SendSettingsDialog
    campaignId={campaign.id}
    campaignName={campaign.name}
    totalRecipients={campaign.total_recipients ?? 0}
    open={settingsOpen}
    onOpenChange={setSettingsOpen}
  />
  ```

### 3. Página standalone `/campaigns/$id/settings`

- **Manter** a rota existente para acesso direto via URL (deep link) e como fallback. Apenas remover o uso pelo botão.
- Nada muda no arquivo `campaigns.$campaignId.settings.tsx`.

### 4. Refatoração mínima

Extrair a lógica de carregar settings + ações de salvar para um hook compartilhado `useSendSettingsForm(campaignId)` em `src/lib/use-send-settings-form.ts`, reutilizado pelo dialog e pela página standalone. Evita duplicação. Retorna `{ form, setForm, baseline, dirty, channels, isLoading, save, reset }`.

---

### UX
- Dialog grande (`max-w-4xl`) com scroll interno.
- Aviso "Alterações não salvas" no rodapé do dialog quando `dirty`.
- Esc / clique fora pede confirmação se `dirty` (`onOpenChange` intercepta).
- Após salvar, fica aberto? Não — fecha automaticamente após sucesso (UX típica de modal de config).
