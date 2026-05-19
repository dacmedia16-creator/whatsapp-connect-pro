import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Upload, Trash2, Pencil, Ban, RotateCcw, Search, Tag as TagIcon } from "lucide-react";
import { toast } from "sonner";
import { normalizePhoneE164, formatPhone } from "@/lib/phone";
import { ContactListsTab } from "@/components/contacts/contact-lists-tab";

export const Route = createFileRoute("/_authenticated/contacts")({
  component: ContactsPage,
  head: () => ({ meta: [{ title: "Contatos — Denis Envia Flow" }] }),
});

type Contact = {
  id: string;
  name: string;
  phone_e164: string;
  tags: string[];
  consent: boolean;
  consent_at: string | null;
  opt_out_at: string | null;
  source: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
};

function ContactsPage() {
  const { role } = useAuth();
  const canManage = role === "admin" || role === "gestor";
  const isAdmin = role === "admin";

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Contatos"
        description="Base de contatos com consentimento, importação CSV e gestão de opt-out."
      />
      <Tabs defaultValue="contacts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="contacts">Contatos</TabsTrigger>
          <TabsTrigger value="lists">Listas</TabsTrigger>
          <TabsTrigger value="optout">Palavras de opt-out</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts">
          <ContactsTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="lists">
          <ContactListsTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="optout">
          <OptOutTab isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ContactsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [showOptedOut, setShowOptedOut] = useState(false);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Contact[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!showOptedOut && c.opt_out_at) return false;
      if (filterTag && !c.tags?.includes(filterTag)) return false;
      if (!q) return true;
      return (
        c.name?.toLowerCase().includes(q) ||
        c.phone_e164?.toLowerCase().includes(q) ||
        c.tags?.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [contacts, search, filterTag, showOptedOut]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    contacts.forEach((c) => c.tags?.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [contacts]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contato removido");
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleOptOut = useMutation({
    mutationFn: async (c: Contact) => {
      const next = c.opt_out_at ? null : new Date().toISOString();
      const { error } = await supabase
        .from("contacts")
        .update({ opt_out_at: next, consent: !next })
        .eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou tag"
            className="pl-9"
          />
        </div>
        <select
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todas as tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={showOptedOut} onCheckedChange={(v) => setShowOptedOut(!!v)} />
          Mostrar opt-outs
        </label>
        <div className="flex-1" />
        {canManage && (
          <>
            <ImportCsvDialog onDone={() => qc.invalidateQueries({ queryKey: ["contacts"] })} />
            <ContactDialog mode="create" onDone={() => qc.invalidateQueries({ queryKey: ["contacts"] })} />
          </>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Consentimento</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-[140px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum contato encontrado.</TableCell></TableRow>
              )}
              {filtered.map((c) => (
                <TableRow key={c.id} className={c.opt_out_at ? "opacity-60" : ""}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-sm">{formatPhone(c.phone_e164)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.tags?.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.opt_out_at ? (
                      <Badge variant="outline" className="border-destructive text-destructive">Opt-out</Badge>
                    ) : c.consent ? (
                      <Badge variant="outline" className="border-success text-success">Ativo</Badge>
                    ) : (
                      <Badge variant="outline">Pendente</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.source ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <div className="inline-flex items-center gap-1">
                        <ContactDialog
                          mode="edit"
                          contact={c}
                          onDone={() => qc.invalidateQueries({ queryKey: ["contacts"] })}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          title={c.opt_out_at ? "Reativar" : "Marcar opt-out"}
                          onClick={() => toggleOptOut.mutate(c)}
                        >
                          {c.opt_out_at ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Remover ${c.name}?`)) del.mutate(c.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        {filtered.length} de {contacts.length} contato(s){contacts.length >= 1000 && " — limite de exibição: 1000"}
      </p>
    </div>
  );
}

function ContactDialog({
  mode,
  contact,
  onDone,
}: {
  mode: "create" | "edit";
  contact?: Contact;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState(contact?.phone_e164 ?? "");
  const [tags, setTags] = useState((contact?.tags ?? []).join(", "));
  const [consent, setConsent] = useState(contact?.consent ?? true);
  const [source, setSource] = useState(contact?.source ?? "manual");

  const save = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (trimmedName.length < 1 || trimmedName.length > 120) throw new Error("Nome inválido");
      const e164 = normalizePhoneE164(phone);
      if (!e164) throw new Error("Telefone inválido");
      const tagArr = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= 40)
        .slice(0, 20);
      const payload = {
        name: trimmedName,
        phone_e164: e164,
        tags: tagArr,
        consent,
        consent_at: consent ? new Date().toISOString() : null,
        source: source.trim() || null,
      };
      if (mode === "create") {
        const { error } = await supabase.from("contacts").insert(payload);
        if (error) throw error;
      } else if (contact) {
        const { error } = await supabase.from("contacts").update(payload).eq("id", contact.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Contato criado" : "Contato atualizado");
      onDone();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button><Plus className="h-4 w-4 mr-1" /> Novo contato</Button>
        ) : (
          <Button size="icon" variant="ghost" title="Editar"><Pencil className="h-4 w-4" /></Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novo contato" : "Editar contato"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label>Telefone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5511999999999" />
          </div>
          <div className="space-y-1">
            <Label>Tags (separadas por vírgula)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cliente, vip" />
          </div>
          <div className="space-y-1">
            <Label>Origem</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} maxLength={60} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(!!v)} />
            Contato deu consentimento para receber mensagens
          </label>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name || !phone}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ImportRow = { name: string; phone: string; tags?: string; consent?: string; source?: string };

function ImportCsvDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [defaultConsent, setDefaultConsent] = useState(true);
  const [defaultSource, setDefaultSource] = useState("csv-import");
  const [result, setResult] = useState<{ total: number; success: number; failed: number; errors: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const run = async () => {
    if (!file) return;
    setParsing(true);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = Papa.parse<ImportRow>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      });

      const errors: string[] = [];
      const rows = parsed.data as ImportRow[];
      const seen = new Set<string>();
      const valid: Array<{
        name: string;
        phone_e164: string;
        tags: string[];
        consent: boolean;
        consent_at: string | null;
        source: string;
      }> = [];

      rows.forEach((row, i) => {
        const rowNum = i + 2; // header + 1-index
        const name = (row.name ?? "").toString().trim();
        const phoneRaw = (row.phone ?? "").toString().trim();
        if (!name) { errors.push(`Linha ${rowNum}: nome vazio`); return; }
        if (!phoneRaw) { errors.push(`Linha ${rowNum}: telefone vazio`); return; }
        const phone_e164 = normalizePhoneE164(phoneRaw);
        if (!phone_e164) { errors.push(`Linha ${rowNum}: telefone inválido "${phoneRaw}"`); return; }
        if (seen.has(phone_e164)) { errors.push(`Linha ${rowNum}: telefone duplicado no arquivo`); return; }
        seen.add(phone_e164);
        const tags = (row.tags ?? "").toString().split(/[,;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 20);
        const consentVal = (row.consent ?? "").toString().trim().toLowerCase();
        const consent = consentVal === ""
          ? defaultConsent
          : ["true", "1", "sim", "yes", "y"].includes(consentVal);
        valid.push({
          name: name.slice(0, 120),
          phone_e164,
          tags,
          consent,
          consent_at: consent ? new Date().toISOString() : null,
          source: (row.source ?? "").toString().trim() || defaultSource,
        });
      });

      // Dedupe vs existing contacts by phone
      let success = 0;
      let failed = 0;
      const phones = valid.map((v) => v.phone_e164);
      if (phones.length > 0) {
        const { data: existing } = await supabase
          .from("contacts")
          .select("phone_e164")
          .in("phone_e164", phones);
        const existingSet = new Set((existing ?? []).map((c) => c.phone_e164));
        const toInsert = valid.filter((v) => {
          if (existingSet.has(v.phone_e164)) {
            errors.push(`Já existe: ${v.phone_e164}`);
            return false;
          }
          return true;
        });

        // Batch insert in chunks of 500
        for (let i = 0; i < toInsert.length; i += 500) {
          const chunk = toInsert.slice(i, i + 500);
          const { error } = await supabase.from("contacts").insert(chunk);
          if (error) {
            failed += chunk.length;
            errors.push(`Lote ${i / 500 + 1}: ${error.message}`);
          } else {
            success += chunk.length;
          }
        }
      }

      await supabase.from("contact_imports").insert({
        file_name: file.name,
        total: rows.length,
        success,
        failed: rows.length - success,
        errors: errors.slice(0, 200),
      });

      setResult({ total: rows.length, success, failed: rows.length - success, errors: errors.slice(0, 50) });
      if (success > 0) {
        toast.success(`${success} contato(s) importado(s)`);
        onDone();
      } else if (errors.length > 0) {
        toast.error("Nenhum contato importado — veja os erros");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline"><Upload className="h-4 w-4 mr-1" /> Importar CSV</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar contatos via CSV</DialogTitle>
          <DialogDescription>
            Colunas suportadas: <code>name</code>, <code>phone</code>, <code>tags</code>, <code>consent</code>, <code>source</code>.
            Telefones são normalizados para E.164 (BR como padrão).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={defaultConsent} onCheckedChange={(v) => setDefaultConsent(!!v)} />
              Consent padrão = sim
            </label>
            <div className="space-y-1">
              <Label className="text-xs">Origem padrão</Label>
              <Input value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)} className="h-8" />
            </div>
          </div>

          {result && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <p>Total no arquivo: <strong>{result.total}</strong></p>
              <p className="text-success">Importados: <strong>{result.success}</strong></p>
              <p className="text-destructive">Falhas/duplicados: <strong>{result.failed}</strong></p>
              {result.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Ver erros ({result.errors.length})</summary>
                  <ul className="mt-1 text-xs max-h-40 overflow-auto list-disc pl-5">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          <Button onClick={run} disabled={!file || parsing}>
            {parsing ? "Importando…" : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptOutTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [newKeyword, setNewKeyword] = useState("");

  const { data: keywords = [], isLoading } = useQuery({
    queryKey: ["opt_out_keywords"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opt_out_keywords")
        .select("*")
        .order("keyword");
      if (error) throw error;
      return data ?? [];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const kw = newKeyword.trim().toLowerCase();
      if (kw.length < 2 || kw.length > 40) throw new Error("Palavra deve ter entre 2 e 40 caracteres");
      const { error } = await supabase.from("opt_out_keywords").insert({ keyword: kw });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Palavra adicionada");
      setNewKeyword("");
      qc.invalidateQueries({ queryKey: ["opt_out_keywords"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("opt_out_keywords").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["opt_out_keywords"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div>
          <h3 className="font-medium">Palavras-chave de opt-out</h3>
          <p className="text-sm text-muted-foreground">
            Quando um contato responde com uma destas palavras, ele é automaticamente marcado como opt-out e removido das campanhas futuras.
          </p>
        </div>

        {isAdmin && (
          <div className="flex gap-2 max-w-md">
            <Input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="ex: sair, parar, descadastrar"
              maxLength={40}
              onKeyDown={(e) => { if (e.key === "Enter") add.mutate(); }}
            />
            <Button onClick={() => add.mutate()} disabled={add.isPending || !newKeyword.trim()}>
              Adicionar
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!isLoading && keywords.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma palavra configurada.</p>
          )}
          {keywords.map((k) => (
            <Badge key={k.id} variant="secondary" className="text-sm py-1 px-3 gap-2">
              <TagIcon className="h-3 w-3" />
              {k.keyword}
              {isAdmin && (
                <button
                  onClick={() => remove.mutate(k.id)}
                  className="ml-1 text-muted-foreground hover:text-destructive"
                  aria-label={`Remover ${k.keyword}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}