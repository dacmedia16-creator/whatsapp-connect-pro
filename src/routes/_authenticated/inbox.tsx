import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { Search, Send, StickyNote, MessageSquareText, Ban, Inbox as InboxIcon, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { sendMessageFn } from "@/lib/ziontalk.functions";
import { assignConversationFn, updateConversationStatusFn, addInternalNoteFn, markConversationReadFn } from "@/lib/inbox.functions";
import { formatPhone } from "@/lib/phone";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
  head: () => ({ meta: [{ title: "Caixa de entrada — ZionFlow" }] }),
});

const STATUS_LABEL: Record<string, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
};

function InboxPage() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const markRead = useServerFn(markConversationReadFn);

  const { data: channelOptions = [] } = useQuery({
    queryKey: ["inbox-channel-options"],
    queryFn: async () => {
      const { data } = await supabase.from("channels").select("id, label").order("label");
      return data ?? [];
    },
  });

  // Realtime: invalidate on any change to conversations or messages
  useEffect(() => {
    const ch = supabase
      .channel("inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        qc.invalidateQueries({ queryKey: ["inbox-conversations"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["inbox-conversations"] });
        const convId = (payload.new as any)?.conversation_id ?? (payload.old as any)?.conversation_id;
        if (convId) qc.invalidateQueries({ queryKey: ["inbox-messages", convId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["inbox-conversations", statusFilter, channelFilter],
    queryFn: async () => {
      let q = supabase
        .from("conversations")
        .select("id, status, assigned_to, last_message_at, unread_count, channel_id, contact:contacts(id,name,phone_e164,consent,opt_out_at,tags)")
        .order("last_message_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") q = q.eq("status", statusFilter as any);
      if (channelFilter !== "all") q = q.eq("channel_id", channelFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c: any) => {
      const n = c.contact?.name?.toLowerCase() ?? "";
      const p = c.contact?.phone_e164 ?? "";
      return n.includes(q) || p.includes(q);
    });
  }, [conversations, search]);

  const selected = filtered.find((c: any) => c.id === selectedId) ?? null;

  // Mark as read when conversation is opened (and has unread messages)
  useEffect(() => {
    if (!selected || !selected.unread_count) return;
    markRead({ data: { conversationId: selected.id } })
      .then(() => qc.invalidateQueries({ queryKey: ["inbox-conversations"] }))
      .catch(() => {});
  }, [selected?.id, selected?.unread_count, markRead, qc]);

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="px-6 pt-4 pb-2">
        <PageHeader
          title="Caixa de entrada"
          description="Atenda conversas em tempo real, atribua e responda com agilidade."
        />
      </div>
      <div className="flex-1 flex min-h-0 border-t">
        {/* Lista */}
        <aside
          className={cn(
            "w-full md:w-80 border-r md:flex flex-col min-h-0 bg-card/30",
            selected ? "hidden md:flex" : "flex",
          )}
        >
          <div className="p-3 space-y-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar" className="pl-8 h-8" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="novo">Novo</SelectItem>
                <SelectItem value="em_atendimento">Em atendimento</SelectItem>
                <SelectItem value="aguardando_cliente">Aguardando cliente</SelectItem>
                <SelectItem value="resolvido">Resolvido</SelectItem>
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Canal" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os canais</SelectItem>
                {channelOptions.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="flex-1">
            {isLoading && (
              <div className="p-6 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm">
                <InboxIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Nenhuma conversa.
              </div>
            )}
            {filtered.map((c: any) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b hover:bg-accent transition-colors block",
                  selectedId === c.id && "bg-accent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{c.contact?.name ?? "—"}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {c.last_message_at ? format(new Date(c.last_message_at), "dd/MM HH:mm") : ""}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{c.contact?.phone_e164 ? formatPhone(c.contact.phone_e164) : ""}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Badge variant="outline" className="text-[9px] px-1 py-0">{STATUS_LABEL[c.status] ?? c.status}</Badge>
                  {c.contact?.opt_out_at && <Badge variant="outline" className="text-[9px] px-1 py-0 border-destructive text-destructive">opt-out</Badge>}
                  {c.unread_count > 0 && <Badge className="text-[9px] px-1 py-0">{c.unread_count}</Badge>}
                </div>
              </button>
            ))}
          </ScrollArea>
        </aside>

        {/* Central */}
        <main
          className={cn(
            "flex-1 flex-col min-w-0 min-h-0",
            selected ? "flex" : "hidden md:flex",
          )}
        >
          {selected ? (
            <ConversationPanel
              key={selected.id}
              conv={selected}
              currentUserId={user?.id ?? null}
              role={role}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-center text-muted-foreground">
              <div>
                <MessageSquareText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                Selecione uma conversa para começar.
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ConversationPanel({ conv, currentUserId, role, onBack }: { conv: any; currentUserId: string | null; role: string | null; onBack: () => void }) {
  const qc = useQueryClient();
  const send = useServerFn(sendMessageFn);
  const note = useServerFn(addInternalNoteFn);
  const assign = useServerFn(assignConversationFn);
  const setStatus = useServerFn(updateConversationStatusFn);

  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);

  const canManage = role === "admin" || role === "gestor";

  const { data: messages = [] } = useQuery({
    queryKey: ["inbox-messages", conv.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("messages")
        .select("id, direction, body, internal_note, created_at, created_by")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true })
        .limit(500);
      return data ?? [];
    },
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });

  const { data: quickReplies = [] } = useQuery({
    queryKey: ["quick-replies"],
    queryFn: async () => {
      const { data } = await supabase.from("quick_replies").select("id, title, body").order("title");
      return data ?? [];
    },
  });

  const { data: atendentes = [] } = useQuery({
    queryKey: ["atendentes"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["admin", "gestor", "atendente"]);
      const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
      if (!ids.length) return [];
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      return profs ?? [];
    },
    enabled: canManage,
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      const body = draft.trim();
      if (!body) return;
      if (mode === "note") {
        await note({ data: { conversationId: conv.id, body } });
      } else {
        if (!conv.channel_id) throw new Error("Conversa sem canal definido");
        await send({
          data: {
            channelId: conv.channel_id,
            contactId: conv.contact.id,
            conversationId: conv.id,
            message: body,
          },
        });
      }
      setDraft("");
      qc.invalidateQueries({ queryKey: ["inbox-messages", conv.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignMut = useMutation({
    mutationFn: async (assignedTo: string | null) => assign({ data: { conversationId: conv.id, assignedTo } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox-conversations"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: async (status: any) => setStatus({ data: { conversationId: conv.id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox-conversations"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const optedOut = !!conv.contact?.opt_out_at;
  const noConsent = !conv.contact?.consent;

  return (
    <div className="flex-1 flex min-h-0">
      {/* Mensagens + composer */}
      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="border-b px-4 py-3 flex items-center justify-between gap-3 bg-card/30">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8 shrink-0"
              onClick={onBack}
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <p className="font-medium truncate">{conv.contact?.name ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{conv.contact?.phone_e164 ? formatPhone(conv.contact.phone_e164) : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Select value={conv.status} onValueChange={(v) => statusMut.mutate(v)}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="novo">Novo</SelectItem>
                <SelectItem value="em_atendimento">Em atendimento</SelectItem>
                <SelectItem value="aguardando_cliente">Aguardando cliente</SelectItem>
                <SelectItem value="resolvido">Resolvido</SelectItem>
              </SelectContent>
            </Select>
            {canManage && (
              <Select
                value={conv.assigned_to ?? "__none__"}
                onValueChange={(v) => assignMut.mutate(v === "__none__" ? null : v)}
              >
                <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="Atribuir…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem atribuição</SelectItem>
                  {atendentes.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.full_name ?? a.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </header>

        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">Nenhuma mensagem ainda.</p>
          )}
          <div className="space-y-2 max-w-3xl mx-auto">
            {messages.map((m: any) => (
              <MessageBubble key={m.id} m={m} mine={m.created_by === currentUserId} />
            ))}
          </div>
        </ScrollArea>

        <div className="border-t p-3 bg-card/30">
          {(optedOut || noConsent) && mode === "reply" && (
            <div className="text-xs text-destructive flex items-center gap-1 mb-2">
              <Ban className="h-3 w-3" />
              {optedOut ? "Contato fez opt-out — envio bloqueado." : "Contato sem consentimento — envio bloqueado."}
            </div>
          )}
          <div className="flex items-center gap-2 mb-2">
            <div className="inline-flex rounded-md border bg-background">
              <button
                onClick={() => setMode("reply")}
                className={cn("px-3 py-1 text-xs", mode === "reply" && "bg-accent")}
              >
                Resposta
              </button>
              <button
                onClick={() => setMode("note")}
                className={cn("px-3 py-1 text-xs", mode === "note" && "bg-warning/20")}
              >
                <StickyNote className="h-3 w-3 inline mr-1" />Nota interna
              </button>
            </div>
            {quickReplies.length > 0 && mode === "reply" && (
              <div className="relative">
                <Button size="sm" variant="ghost" onClick={() => setQuickReplyOpen((v) => !v)}>
                  Respostas rápidas
                </Button>
                {quickReplyOpen && (
                  <div className="absolute bottom-full mb-1 left-0 z-20 w-80 max-h-60 overflow-auto bg-popover border rounded-md shadow-lg">
                    {quickReplies.map((qr: any) => (
                      <button
                        key={qr.id}
                        className="w-full text-left p-2 hover:bg-accent text-sm border-b last:border-b-0"
                        onClick={() => { setDraft(qr.body); setQuickReplyOpen(false); }}
                      >
                        <p className="font-medium text-xs">{qr.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{qr.body}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={mode === "note" ? "Nota visível apenas para a equipe…" : "Escreva sua resposta…"}
            rows={3}
            className={mode === "note" ? "bg-warning/5" : ""}
            disabled={mode === "reply" && (optedOut || noConsent)}
          />
          <div className="flex justify-end mt-2">
            <Button
              onClick={() => sendMut.mutate()}
              disabled={sendMut.isPending || !draft.trim() || (mode === "reply" && (optedOut || noConsent))}
            >
              {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              {mode === "note" ? "Adicionar nota" : "Enviar"}
            </Button>
          </div>
        </div>
      </section>

      {/* Painel direito */}
      <aside className="hidden lg:flex w-72 border-l flex-col p-4 bg-card/30 gap-3">
        <p className="text-xs uppercase text-muted-foreground">Contato</p>
        <div>
          <p className="font-medium">{conv.contact?.name}</p>
          <p className="text-xs text-muted-foreground">{conv.contact?.phone_e164 ? formatPhone(conv.contact.phone_e164) : ""}</p>
        </div>
        <Separator />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Consentimento</p>
          {optedOut ? (
            <Badge variant="outline" className="border-destructive text-destructive">Opt-out</Badge>
          ) : conv.contact?.consent ? (
            <Badge variant="outline" className="border-success text-success">Ativo</Badge>
          ) : (
            <Badge variant="outline">Pendente</Badge>
          )}
        </div>
        {conv.contact?.tags?.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Tags</p>
            <div className="flex flex-wrap gap-1">
              {conv.contact.tags.map((t: string) => (
                <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function MessageBubble({ m, mine }: { m: any; mine: boolean }) {
  if (m.internal_note) {
    return (
      <div className="rounded-md bg-warning/10 border border-warning/30 p-2 text-xs">
        <div className="flex items-center gap-1 text-warning font-medium mb-1">
          <StickyNote className="h-3 w-3" /> Nota interna
        </div>
        <p className="whitespace-pre-wrap">{m.body}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}</p>
      </div>
    );
  }
  const outbound = m.direction === "out";
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-2 text-sm",
          outbound ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <p className={cn("text-[10px] mt-1", outbound ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
        </p>
      </div>
    </div>
  );
}