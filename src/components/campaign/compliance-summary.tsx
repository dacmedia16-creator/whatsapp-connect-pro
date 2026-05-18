import type { ResolveSummary } from "@/lib/recipient-resolver";

export function ComplianceSummary({ summary }: { summary: ResolveSummary }) {
  const items = [
    { label: "Encontrados", value: summary.found, cls: "text-foreground" },
    { label: "Elegíveis", value: summary.eligible, cls: "text-success" },
    { label: "Opt-out", value: summary.blockedOptOut, cls: "text-warning" },
    { label: "Sem consentimento", value: summary.blockedNoConsent, cls: "text-muted-foreground" },
    { label: "Telefone inválido", value: summary.invalidPhone, cls: "text-destructive" },
    { label: "Duplicados", value: summary.duplicates, cls: "text-muted-foreground" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 rounded-md border bg-muted/20 p-3">
      {items.map((it) => (
        <div key={it.label} className="text-center">
          <p className={`text-lg font-semibold ${it.cls}`}>{it.value}</p>
          <p className="text-[11px] text-muted-foreground leading-tight">{it.label}</p>
        </div>
      ))}
    </div>
  );
}
