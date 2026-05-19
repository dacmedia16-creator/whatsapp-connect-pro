import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col gap-4 mb-8 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1.5">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-wider text-accent">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl md:text-4xl text-foreground tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}