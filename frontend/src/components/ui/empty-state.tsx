import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Action { label: string; onClick: () => void; icon?: LucideIcon; }

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  primaryAction?: Action;
  secondaryAction?: { label: string; onClick: () => void };
  tone?: "default" | "brand" | "warning";
  className?: string;
}

const TONE_BG: Record<string, string> = {
  default: "from-canvas-50 to-white",
  brand: "from-brand-50/60 to-white",
  warning: "from-amber-50/60 to-white",
};
const ICON_TONE: Record<string, string> = {
  default: "bg-canvas-100 text-gray-500 ring-canvas-200/80",
  brand: "bg-white text-brand-600 ring-brand-100",
  warning: "bg-white text-amber-600 ring-amber-100",
};

/** Finance-grade empty state — soft gradient, iconography, and intentional copy.
 * Avoid the generic "nothing here" look — always explain what's missing and what
 * the user can do next. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  tone = "default",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-canvas-200/70 bg-gradient-to-b px-6 py-12 text-center shadow-sm",
        TONE_BG[tone],
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ring-1 ring-inset",
          ICON_TONE[tone],
        )}
      >
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-gray-500">
          {description}
        </p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {primaryAction && <ActionButton variant="primary" action={primaryAction} />}
          {secondaryAction && (
            <button onClick={secondaryAction.onClick} className="btn-secondary">
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ action, variant }: { action: Action; variant: "primary" | "secondary" }) {
  const Icon = action.icon;
  return (
    <button
      onClick={action.onClick}
      className={variant === "primary" ? "btn-primary" : "btn-secondary"}
    >
      {Icon && <Icon className="w-4 h-4 mr-1.5" />}
      {action.label}
    </button>
  );
}
