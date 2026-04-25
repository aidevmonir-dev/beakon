import { cn } from "@/lib/utils";

interface FilterChipProps {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  tone?: "default" | "brand";
}

/** Compact pill-style filter used in toolbars. Active = brand tint + ring.
 * Use for scope/type toggles across any listing page. */
export function FilterChip({ active, onClick, children, count, tone = "default" }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
        active
          ? tone === "brand"
            ? "border-brand-200 bg-brand-50 text-brand-800 ring-2 ring-brand-100"
            : "border-canvas-300 bg-white text-gray-900 ring-2 ring-canvas-200/70"
          : "border-canvas-200 bg-white/70 text-gray-600 hover:bg-white hover:text-gray-900",
      )}
    >
      <span>{children}</span>
      {typeof count === "number" && (
        <span
          className={cn(
            "ml-0.5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
            active ? "bg-white/80 text-gray-700" : "bg-canvas-100 text-gray-500",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
