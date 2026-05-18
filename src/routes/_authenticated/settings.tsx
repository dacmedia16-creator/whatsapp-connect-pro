import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Trash2, Plus, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Configurações — ZionFlow" }] }),
});

function SettingsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="Configurações" description="Horários comerciais, opt-out e gestão de usuários." />
      <Tabs defaultValue="hours" className="space-y-4">
        <TabsList>
          <TabsTrigger value="hours">Horários comerciais</TabsTrigger>
          <TabsTrigger value="optout">Palavras de opt-out</TabsTrigger>
          <TabsTrigger value="users">Usuários e permissões</TabsTrigger>
        </TabsList>
        <TabsContent value="hours"><BusinessHoursTab isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="optout"><OptOutTab isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="users"><UsersTab isAdmin={isAdmin} /></TabsContent>
      </Tabs>
    </div>
  );
}

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TZ_OPTIONS = ["America/Sao_Paulo", "America/Bahia", "America/Manaus", "America/Belem", "America/Fortaleza", "UTC"];

function BusinessHoursTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: channels = [] } = useQuery({
    queryKey: ["settings-channels"],
    queryFn: async () => {
      const { data } = await supabase.from("channels").select("id, label, business_hours").order("label");
      return data ?? [];
    },
  });
  return (
    <div className="space-y-3">
      {channels.length === 0 && (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhum canal cadastrado.</CardContent></Card>
      )}
      {channels.map((c: any) => (
        <ChannelHoursCard key={c.id} channel={c} isAdmin={isAdmin} onSaved={() => qc.invalidateQueries({ queryKey: ["settings-channels"] })} />
      ))}
    </div>
  );
}

function ChannelHoursCard({ channel, isAdmin, onSaved }: { channel: any; isAdmin: boolean; onSaved: () => void }) {
  const bh = channel.business_hours ?? {};
  const [tz, setTz] = useState(bh.tz ?? "America/Sao_Paulo");
  const [start, setStart] = useState(bh.start ?? "09:00");
  const [end, setEnd] = useState(bh.end ?? "18:00");
  const [days, setDays] = useState<number[]>(bh.days ?? [1, 2, 3, 4, 5]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("channels")
        .update({ business_hours: { tz, start, end, days: [...days].sort() } })
        .eq("id", channel.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Horário salvo"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{channel.label}</h3>
        {isAdmin && (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-3 w-3 mr-1" /> Salvar</Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Fuso horário</Label>
          <Select value={tz} onValueChange={setTz} disabled={!isAdmin}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TZ_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Início</Label>
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={!isAdmin} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fim</Label>
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!isAdmin} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {DAYS.map((d, i) => {
          const on = days.includes(i);
          return (
            <button
              key={i}
              disabled={!isAdmin}
              onClick={() => setDays((p) => on ? p.filter((x) => x !== i) : [...p, i])}
              className={`px-3 py-1 text-xs rounded border ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </CardContent></Card>
  );
}

function OptOutTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [kw, setKw] = useState("");
  const { data: kws = [] } = useQuery({
    queryKey: ["opt-out-kws"],
    queryFn: async () => (await supabase.from("opt_out_keywords").select("id, keyword").order("keyword")).data ?? [],
  });
  const add = useMutation({
    mutationFn: async () => {
      const v = kw.trim().toLowerCase();
      if (!v) throw new Error("Palavra vazia");
      const { error } = await supabase.from("opt_out_keywords").insert({ keyword: v });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Adicionada"); setKw(""); qc.invalidateQueries({ queryKey: ["opt-out-kws"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("opt_out_keywords").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opt-out-kws"] }),
  });
  return (
    <Card><CardContent className="p-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        Quando um contato enviar qualquer uma dessas palavras, será automaticamente marcado como opt-out.
      </p>
      {isAdmin && (
        <div className="flex gap-2">
          <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="ex: sair" maxLength={40} />
          <Button onClick={() => add.mutate()} disabled={add.isPending}><Plus className="h-3 w-3 mr-1" /> Adicionar</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {kws.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma palavra cadastrada.</p>}
        {kws.map((k: any) => (
          <Badge key={k.id} variant="secondary" className="gap-1 pr-1">
            {k.keyword}
            {isAdmin && (
              <button onClick={() => del.mutate(k.id)} className="ml-1 hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
            )}
          </Badge>
        ))}
      </div>
    </CardContent></Card>
  );
}

function UsersTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({
    queryKey: ["users-roles"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
      if (!ids.length) return [];
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      const roleMap = new Map<string, string[]>();
      (roles ?? []).forEach((r) => {
        const a = roleMap.get(r.user_id) ?? [];
        a.push(r.role);
        roleMap.set(r.user_id, a);
      });
      return (profs ?? []).map((p: any) => ({ ...p, roles: roleMap.get(p.id) ?? [] }));
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "admin" | "gestor" | "atendente" }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Função atualizada"); qc.invalidateQueries({ queryKey: ["users-roles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return <Card><CardContent className="p-6 text-center text-muted-foreground">Apenas administradores podem gerenciar usuários.</CardContent></Card>;
  }

  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Email</TableHead><TableHead className="w-[200px]">Função</TableHead></TableRow></TableHeader>
        <TableBody>
          {users.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Nenhum usuário.</TableCell></TableRow>}
          {users.map((u: any) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.full_name ?? "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
              <TableCell>
                <Select value={u.roles[0] ?? ""} onValueChange={(v) => setRole.mutate({ userId: u.id, role: v as any })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">admin</SelectItem>
                    <SelectItem value="gestor">gestor</SelectItem>
                    <SelectItem value="atendente">atendente</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}