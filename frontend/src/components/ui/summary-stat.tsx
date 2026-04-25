import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SummaryStatProps {
  label: string;
  value: string | number;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "brand" | "mint" | "amber" | "rose" | "indigo";
  className?: string;
}

/** Compact metric card intended for 2–4 up grids on listing pages.
 * Intentionally restrained — serious finance UI, not a marketing hero. */
export function SummaryStat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: SummaryStatProps) {
  const tones: Record<string, { bg: string; iconBg: string; iconText: string }> = {
    default: { bg: "bg-white", iconBg: "bg-canvas-100", iconText: "text-gray-500" },
    brand:   { bg: "bg-white", iconBg: "bg-brand-50",   iconText: "text-brand-600" },
    mint:    { bg: "bg-white", iconBg: "bg-mint-50",    iconText: "text-mint-700" },
    amber:   { bg: "bg-white", iconBg: "bg-amber-50",   iconText: "text-amber-600" },
    rose:    { bg: "bg-white", iconBg: "bg-rose-50",    iconText: "text-rose-600" },
    indigo:  { bg: "bg-white", iconBg: "bg-indigo-50",  iconText: "text-indigo-600" },
  };
  const t = tones[tone];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-canvas-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.03)] px-4 py-3.5",
        t.bg,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
            {label}
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums text-gray-900 tracking-tight leading-none">
            {value}
          </p>
          {hint && <div className="mt-1.5 text-[11px] text-gray-500 leading-snug">{hint}</div>}
        </div>
        {Icon && (
          <div className={cn("shrink-0 h-8 w-8 rounded-lg flex items-center justify-center", t.iconBg, t.iconText)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  );
}
