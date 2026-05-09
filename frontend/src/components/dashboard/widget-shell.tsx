"use client";

/* WidgetShell — wraps any widget with edit-mode chrome.
 *
 * Out of edit mode it's invisible (just renders children). In edit mode
 * it adds a thin dashed ring, a small overlay menu in the top-right
 * corner with reorder + remove buttons, and a "drag handle" affordance
 * on the left edge. The handle is decorative for v1 — reordering is
 * driven by the up/down buttons; HTML5 drag is a follow-up.
 */
import { ChevronUp, ChevronDown, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";


export function WidgetShell({
  editMode, isFirst, isLast, label, onMoveUp, onMoveDown, onRemove, children,
}: {
  editMode: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Friendly name shown in the edit-mode label chip. */
  label: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  if (!editMode) return <>{children}</>;
  return (
    <div className="relative group/widget">
      {/* Dashed ring + dim padding when editing so the boundary is obvious */}
      <div className="rounded-2xl ring-1 ring-dashed ring-canvas-300/80 ring-offset-2 ring-offset-canvas-50 transition-all hover:ring-brand-300">
        {children}
      </div>

      {/* Top-left label chip */}
      <div className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full bg-white border border-canvas-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-600 shadow-sm">
        <GripVertical className="w-3 h-3 text-gray-400" />
        {label}
      </div>

      {/* Top-right action bar */}
      <div className="absolute -top-3 right-4 inline-flex items-center gap-0 rounded-full bg-white border border-canvas-200 shadow-sm overflow-hidden">
        <ShellButton
          label="Move up"
          disabled={isFirst}
          onClick={onMoveUp}
          icon={<ChevronUp className="w-3.5 h-3.5" />}
        />
        <span className="w-px h-4 bg-canvas-200" />
        <ShellButton
          label="Move down"
          disabled={isLast}
          onClick={onMoveDown}
          icon={<ChevronDown className="w-3.5 h-3.5" />}
        />
        <span className="w-px h-4 bg-canvas-200" />
        <ShellButton
          label="Remove"
          onClick={onRemove}
          icon={<X className="w-3.5 h-3.5" />}
          tone="rose"
        />
      </div>
    </div>
  );
}


function ShellButton({
  label, icon, onClick, disabled = false, tone = "default",
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "rose";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "px-2 py-1 transition-colors",
        disabled && "opacity-30 cursor-not-allowed",
        !disabled && tone === "default" && "text-gray-500 hover:text-gray-900 hover:bg-canvas-50",
        !disabled && tone === "rose" && "text-rose-500 hover:text-rose-700 hover:bg-rose-50",
      )}
    >
      {icon}
    </button>
  );
}
