import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Users, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { formatPhone } from "@/lib/phone";

type ContactList = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type ContactRow = {
  id: string;
  name: string;
  phone_e164: string;
  tags: string[];
  opt_out_at: string | null;
  consent: boolean;
};

export function ContactListsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ContactList | null>(null);

  const { data: lists = [], isLoading } = useQuery({
    queryKey: ["contact_lists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_lists")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContactList[];
    },
  });

  const { data: counts = {} } = useQuery({
    queryKey: ["contact_lists_counts", lists.map((l) => l.id).join(",")],
    enabled: lists.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_list_items")
        .select("list_id");
      if (error) throw error;
      const acc: Record<string, number> = {};
      (data ?? []).forEach((r: { list_id: string }) => {
        acc[r.list_id] = (acc[r.list_id] ?? 0) + 1;
      });
      return acc;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contact_lists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lista removida");
      qc.invalidateQueries({ queryKey: ["contact_lists"] });
      qc.invalidateQueries({ queryKey: ["contact_lists_counts"] });
      if (selected) setSelected(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.description ?? "").toLowerCase().includes(q),
    );
  }, [lists, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar listas"
            className="pl-9"
          />
        </div>
        <div className="flex-1" />
        {canManage && (
          <ListFormDialog
            mode="create"
            onDone={() => qc.invalidateQueries({ queryKey: ["contact_lists"] })}
          />
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-[120px]">Contatos</TableHead>
                <TableHead className="w-[220px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhuma lista criada ainda.</TableCell></TableRow>
              )}
              {filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.description || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      <Users className="h-3 w-3" />
                      {counts[l.id] ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelected(l)}
                      >
                        Gerenciar contatos
                      </Button>
                      {canManage && (
                        <>
                          <ListFormDialog
                            mode="edit"
                            list={l}
                            onDone={() => qc.invalidateQueries({ queryKey: ["contact_lists"] })}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Remover lista "${l.name}"? Os contatos não serão apagados.`)) {
                                del.mutate(l.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected && (
        <ManageListMembersDialog
          list={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ListFormDialog({
  mode,
  list,
  onDone,
}: {
  mode: "create" | "edit";
  list?: ContactList;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(list?.name ?? "");
  const [description, setDescription] = useState(list?.description ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > 120) {
        throw new Error("Nome deve ter entre 1 e 120 caracteres");
      }
      const payload = {
        name: trimmed,
        description: description.trim() || null,
      };
      if (mode === "create") {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase
          .from("contact_lists")
          .insert({ ...payload, created_by: u.user?.id });
        if (error) throw error;
      } else if (list) {
        const { error } = await supabase
          .from("contact_lists")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", list.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Lista criada" : "Lista atualizada");
      onDone();
      setOpen(false);
      if (mode === "create") {
        setName("");
        setDescription("");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button><Plus className="h-4 w-4 mr-1" /> Nova lista</Button>
        ) : (
          <Button size="icon" variant="ghost" title="Renomear">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nova lista" : "Editar lista"}</DialogTitle>
          <DialogDescription>
            Listas agrupam contatos para campanhas direcionadas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Ex: Clientes VIP"
            />
          </div>
          <div className="space-y-1">
            <Label>Descrição (opcional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Para o que esta lista será usada?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageListMembersDialog({
  list,
  canManage,
  onClose,
}: {
  list: ContactList;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<Record<string, boolean>>({});

  const { data: members = [], isLoading: loadingMembers } = useQuery({
    queryKey: ["contact_list_items", list.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_list_items")
        .select("id, contact_id, contacts:contact_id (id, name, phone_e164, tags, opt_out_at, consent)")
        .eq("list_id", list.id);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; contact_id: string; contacts: ContactRow | null }>;
    },
  });

  const memberIds = useMemo(
    () => new Set(members.map((m) => m.contact_id)),
    [members],
  );

  const { data: allContacts = [], isLoading: loadingContacts } = useQuery({
    queryKey: ["contacts_for_list_picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, phone_e164, tags, opt_out_at, consent")
        .order("name")
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as ContactRow[];
    },
  });

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allContacts.filter((c) => {
      if (memberIds.has(c.id)) return false;
      if (!q) return true;
      return (
        c.name?.toLowerCase().includes(q) ||
        c.phone_e164?.toLowerCase().includes(q) ||
        c.tags?.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [allContacts, memberIds, search]);

  const addOne = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase
        .from("contact_list_items")
        .insert({ list_id: list.id, contact_id: contactId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact_list_items", list.id] });
      qc.invalidateQueries({ queryKey: ["contact_lists_counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeOne = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from("contact_list_items")
        .delete()
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact_list_items", list.id] });
      qc.invalidateQueries({ queryKey: ["contact_lists_counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addBulk = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const rows = ids.map((id) => ({ list_id: list.id, contact_id: id }));
      const { error } = await supabase.from("contact_list_items").insert(rows);
      if (error) throw error;
    },
    onSuccess: (_d, ids) => {
      toast.success(`${ids.length} contato(s) adicionado(s)`);
      qc.invalidateQueries({ queryKey: ["contact_list_items", list.id] });
      qc.invalidateQueries({ queryKey: ["contact_lists_counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [bulkSel, setBulkSel] = useState<Set<string>>(new Set());
  const toggleBulk = (id: string) => {
    setBulkSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{list.name}</DialogTitle>
          <DialogDescription>
            {list.description || "Adicione ou remova contatos desta lista."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">
                Na lista ({members.length})
              </h4>
            </div>
            <ScrollArea className="h-[420px] border rounded-md">
              <div className="divide-y">
                {loadingMembers && (
                  <div className="p-4 text-sm text-muted-foreground">Carregando…</div>
                )}
                {!loadingMembers && members.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">
                    Lista vazia. Adicione contatos pela coluna ao lado.
                  </div>
                )}
                {members.map((m) => {
                  const c = m.contacts;
                  if (!c) return null;
                  return (
                    <div key={m.id} className="flex items-center gap-2 p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {formatPhone(c.phone_e164)}
                        </div>
                      </div>
                      {c.opt_out_at && <Badge variant="outline" className="border-destructive text-destructive text-xs">Opt-out</Badge>}
                      {!c.consent && !c.opt_out_at && <Badge variant="outline" className="text-xs">Sem consent.</Badge>}
                      {canManage && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeOne.mutate(m.id)}
                          title="Remover da lista"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium">Adicionar contatos</h4>
              {canManage && bulkSel.size > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    addBulk.mutate(Array.from(bulkSel));
                    setBulkSel(new Set());
                  }}
                  disabled={addBulk.isPending}
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  Adicionar {bulkSel.size}
                </Button>
              )}
            </div>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar contato"
                className="pl-9 h-9"
              />
            </div>
            <ScrollArea className="h-[368px] border rounded-md">
              <div className="divide-y">
                {loadingContacts && (
                  <div className="p-4 text-sm text-muted-foreground">Carregando…</div>
                )}
                {!loadingContacts && candidates.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">
                    Nenhum contato disponível.
                  </div>
                )}
                {candidates.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 p-2">
                    {canManage && (
                      <Checkbox
                        checked={bulkSel.has(c.id)}
                        onCheckedChange={() => toggleBulk(c.id)}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {formatPhone(c.phone_e164)}
                      </div>
                    </div>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!adding[c.id]}
                        onClick={async () => {
                          setAdding((s) => ({ ...s, [c.id]: true }));
                          try {
                            await addOne.mutateAsync(c.id);
                          } finally {
                            setAdding((s) => ({ ...s, [c.id]: false }));
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}