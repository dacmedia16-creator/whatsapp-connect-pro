import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  delta?: { value: string; positive?: boolean } | null;
  tone?: "default" | "success" | "warning" | "destructive" | "info";
  className?: string;
}

const toneRing: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-muted text-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-accent/10 text-accent",
};

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  tone = "default",
  className,
}: StatCardProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg",
              toneRing[tone],
            )}
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <p className="font-display text-3xl text-foreground mt-3 tracking-tight">{value}</p>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {delta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
                delta.positive
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {delta.positive ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {delta.value}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}