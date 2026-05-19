import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Plug, Pause, Play, Trash2, KeyRound, Ban, Copy } from "lucide-react";
import { toast } from "sonner";
import { normalizePhoneE164, formatPhone } from "@/lib/phone";
import { testChannelFn } from "@/lib/ziontalk.functions";
import { createChannelFn, rotateChannelKeyFn, revokeChannelKeyFn, listChannelKeysFn } from "@/lib/channels.functions";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/channels")({
  component: ChannelsPage,
  head: () => ({ meta: [{ title: "Canais — ZionFlow" }] }),
});

function ChannelsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const qc = useQueryClient();
  const testChannel = useServerFn(testChannelFn);
  const createChannel = useServerFn(createChannelFn);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dailyLimit, setDailyLimit] = useState(500);

  const { data: channels } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await supabase
        .from("channels")
        .select("id,label,phone_e164,status,daily_limit,sent_today,sent_today_date,last_error,business_hours,zion_api_key_hint,created_at")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const e164 = normalizePhoneE164(phone);
      if (!e164) throw new Error("Telefone inválido");
      if (!apiKey.trim()) throw new Error("API Key obrigatória");
      await createChannel({
        data: {
          label,
          phone_e164: e164,
          zion_api_key: apiKey.trim(),
          daily_limit: dailyLimit,
        },
      });
    },
    onSuccess: () => {
      toast.success("Canal cadastrado");
      qc.invalidateQueries({ queryKey: ["channels"] });
      setOpen(false);
      setLabel(""); setPhone(""); setApiKey(""); setDailyLimit(500);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePause = useMutation({
    mutationFn: async (c: { id: string; status: string }) => {
      const next = c.status === "paused" ? "connected" : "paused";
      const { error } = await supabase.from("channels").update({ status: next }).eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Canal removido");
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
  });

  const test = useMutation({
    mutationFn: async (id: string) => testChannel({ data: { channelId: id } }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Canal verificado com sucesso");
      else toast.error("Falha na autenticação — verifique a API Key");
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Canais"
        description="Números de WhatsApp conectados via API ZionTalk. Cada canal possui sua própria API Key."
        actions={
          isAdmin && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1" /> Novo canal</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Novo canal WhatsApp</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Identificação</Label>
                    <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Comercial SP" />
                  </div>
                  <div className="space-y-1">
                    <Label>Telefone</Label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5511999999999" />
                  </div>
                  <div className="space-y-1">
                    <Label>API Key (do canal na ZionTalk)</Label>
                    <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" />
                  </div>
                  <div className="space-y-1">
                    <Label>Limite diário</Label>
                    <Input
                      type="number"
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(parseInt(e.target.value || "0", 10))}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !label || !phone || !apiKey}>
                    Salvar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <Card>
        <CardContent className="p-0">
          {channels?.length ? (
            <div className="divide-y">
              {channels.map((c) => (
                <div key={c.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-4 min-w-0">
                    <Plug className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.label}</p>
                      <p className="text-sm text-muted-foreground">{formatPhone(c.phone_e164)}</p>
                      {c.last_error && <p className="text-xs text-destructive mt-1">{c.last_error}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground hidden md:inline">
                      {c.sent_today}/{c.daily_limit} hoje
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        c.status === "connected"
                          ? "border-success text-success"
                          : c.status === "paused"
                          ? "border-warning text-warning"
                          : "border-destructive text-destructive"
                      }
                    >
                      {c.status}
                    </Badge>
                    {isAdmin && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                          Testar
                        </Button>
                        <ChannelKeysDialog channelId={c.id} channelLabel={c.label} />
                        <Button size="icon" variant="ghost" onClick={() => togglePause.mutate(c)}>
                          {c.status === "paused" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => del.mutate(c.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  </div>
                  {isAdmin && <WebhookUrlRow channelId={c.id} />}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-10 text-center text-muted-foreground">
              Nenhum canal cadastrado ainda.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type KeyRow = {
  id: string;
  version: number;
  hint: string;
  status: "active" | "superseded" | "revoked";
  created_at: string;
  created_by: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
};

function ChannelKeysDialog({ channelId, channelLabel }: { channelId: string; channelLabel: string }) {
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const qc = useQueryClient();
  const listKeys = useServerFn(listChannelKeysFn);
  const rotateKey = useServerFn(rotateChannelKeyFn);
  const revokeKey = useServerFn(revokeChannelKeyFn);

  const { data, isFetching } = useQuery({
    queryKey: ["channel-keys", channelId],
    queryFn: async () => (await listKeys({ data: { channelId } })).keys as KeyRow[],
    enabled: open,
  });

  const rotateMut = useMutation({
    mutationFn: async () => {
      if (newKey.trim().length < 8) throw new Error("Chave muito curta");
      await rotateKey({ data: { channelId, zion_api_key: newKey.trim() } });
    },
    onSuccess: () => {
      toast.success("Chave rotacionada — nova versão ativa");
      setNewKey("");
      qc.invalidateQueries({ queryKey: ["channel-keys", channelId] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: async (keyId: string) => revokeKey({ data: { keyId } }),
    onSuccess: () => {
      toast.success("Chave revogada");
      qc.invalidateQueries({ queryKey: ["channel-keys", channelId] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusBadge = (s: KeyRow["status"]) =>
    s === "active"
      ? "border-success text-success"
      : s === "superseded"
      ? "border-muted-foreground/40 text-muted-foreground"
      : "border-destructive text-destructive";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <KeyRound className="h-4 w-4 mr-1" /> Chaves
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chaves de API — {channelLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Rotacionar (nova chave)</Label>
          <div className="flex gap-2">
            <Input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Cole a nova API Key"
            />
            <Button onClick={() => rotateMut.mutate()} disabled={rotateMut.isPending}>
              Rotacionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A chave atual será marcada como <em>superseded</em> e a nova passa a ser usada nos envios.
          </p>
        </div>

        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versão</TableHead>
                <TableHead>Hint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">Carregando…</TableCell></TableRow>
              )}
              {!isFetching && (data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">Sem histórico ainda.</TableCell></TableRow>
              )}
              {(data ?? []).map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-mono">v{k.version}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">…{k.hint}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadge(k.status)}>{k.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(k.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-right">
                    {k.status !== "revoked" ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive">
                            <Ban className="h-4 w-4 mr-1" /> Revogar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revogar chave v{k.version}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {k.status === "active"
                                ? "Esta é a chave ATIVA. Revogá-la bloqueia novos envios deste canal até que você rotacione uma nova chave."
                                : "A chave será invalidada permanentemente."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => revokeMut.mutate(k.id)}>
                              Revogar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {k.revoked_at && format(new Date(k.revoked_at), "dd/MM/yyyy", { locale: ptBR })}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}