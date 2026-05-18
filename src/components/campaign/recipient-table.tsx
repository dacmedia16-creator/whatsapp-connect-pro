import { Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPhone } from "@/lib/phone";
import type { ResolvedContact, RecipientStatus } from "@/lib/recipient-resolver";

const STATUS: Record<RecipientStatus, { label: string; cls: string }> = {
  eligible: { label: "Elegível", cls: "border-success text-success" },
  no_consent: { label: "Sem consentimento", cls: "border-muted-foreground text-muted-foreground" },
  opt_out: { label: "Opt-out", cls: "border-warning text-warning" },
  invalid_phone: { label: "Telefone inválido", cls: "border-destructive text-destructive" },
  duplicate: { label: "Duplicado", cls: "border-muted-foreground text-muted-foreground" },
};

export function RecipientTable({
  contacts,
  onRemove,
}: {
  contacts: ResolvedContact[];
  onRemove?: (index: number) => void;
}) {
  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center border rounded-md bg-muted/10">
        <Users className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm font-medium">Nenhum contato encontrado</p>
        <p className="text-xs text-muted-foreground">Selecione uma lista ou método para ver os contatos</p>
      </div>
    );
  }
  return (
    <div className="border rounded-md max-h-[320px] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Telefone</TableHead>
            <TableHead>Etiquetas</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Consent.</TableHead>
            <TableHead>Status</TableHead>
            {onRemove && <TableHead className="w-10"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c, i) => (
            <TableRow key={`${c.phone_e164 ?? c.rawPhone}-${i}`}>
              <TableCell className="font-medium text-sm">{c.name}</TableCell>
              <TableCell className="font-mono text-xs">
                {c.phone_e164 ? formatPhone(c.phone_e164) : <span className="text-destructive">{c.rawPhone}</span>}
              </TableCell>
              <TableCell className="text-xs">
                <div className="flex flex-wrap gap-1">
                  {c.tags.slice(0, 3).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
                  ))}
                  {c.tags.length > 3 && <span className="text-muted-foreground">+{c.tags.length - 3}</span>}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground capitalize">{c.source}</TableCell>
              <TableCell>{c.consent ? "✓" : "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className={STATUS[c.status].cls}>{STATUS[c.status].label}</Badge>
              </TableCell>
              {onRemove && (
                <TableCell>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onRemove(i)}>
                    <X className="h-3 w-3" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
