"use client";

/* AddWidgetPicker — modal listing every widget in WIDGET_CATALOG that
 * isn't already part of the current layout. Clicking a card adds it to
 * the bottom of the layout.
 */
import { Plus, X } from "lucide-react";
import {
  WIDGET_CATALOG, type WidgetType,
} from "@/lib/dashboard-layout";
import { cn } from "@/lib/utils";


export function AddWidgetPicker({
  inUse, onAdd, onClose,
}: {
  /** Widget types already in the layout — dimmed in the picker. */
  inUse: Set<WidgetType>;
  onAdd: (type: WidgetType) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl mx-4 rounded-2xl bg-white shadow-2xl border border-canvas-200 max-h-[80vh] flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-canvas-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add a widget</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Pick a card to drop onto the dashboard. You can reorder or remove later.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Catalog */}
        <div className="overflow-y-auto p-4 grid gap-3 sm:grid-cols-2">
          {WIDGET_CATALOG.map((entry) => {
            const used = inUse.has(entry.type);
            return (
              <button
                key={entry.type}
                onClick={() => !used && onAdd(entry.type)}
                disabled={used}
                className={cn(
                  "rounded-xl border text-left p-4 transition-all",
                  used
                    ? "border-canvas-200 bg-canvas-50/60 cursor-not-allowed opacity-70"
                    : "border-canvas-200 bg-white hover:border-brand-300 hover:shadow-md cursor-pointer",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">{entry.name}</h3>
                  {used ? (
                    <span className="inline-flex items-center rounded-full bg-canvas-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 ring-1 ring-inset ring-canvas-200">
                      In use
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-100">
                      <Plus className="w-3 h-3" />
                      Add
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[12px] text-gray-600 leading-relaxed">
                  {entry.description}
                </p>
              </button>
            );
          })}
        </div>

        <footer className="px-5 py-3 border-t border-canvas-100 flex justify-end bg-canvas-50/40 rounded-b-2xl">
          <button onClick={onClose} className="btn-secondary text-sm">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
