import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function MethodCard({
  icon: Icon,
  title,
  subtitle,
  active,
  disabled,
  tooltip,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  active?: boolean;
  disabled?: boolean;
  tooltip?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={tooltip}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 text-left transition-all",
        "hover:border-primary/60 hover:bg-muted/30",
        active && "border-primary bg-primary/5 ring-1 ring-primary",
        disabled && "opacity-50 cursor-not-allowed hover:border-border hover:bg-transparent",
      )}
    >
      <span className={cn("rounded-md p-2 bg-muted", active && "bg-primary/10 text-primary")}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-sm">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{subtitle}</span>
      </span>
    </button>
  );
}
