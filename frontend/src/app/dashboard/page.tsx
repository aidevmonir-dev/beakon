"use client";

/* Beakon home — customizable, Digits-style dashboard.
 *
 * The page is a thin frame: it loads shared data once, reads the user's
 * saved layout from localStorage, and renders an ordered list of
 * widgets via <WidgetSwitch>. An "Edit dashboard" toggle reveals a
 * dashed-ring chrome around each widget with reorder + remove buttons,
 * plus a "+ Add widget" button that opens the catalog picker.
 *
 * To add a new widget kind:
 *   1) export a component from components/dashboard/widgets.tsx
 *   2) add a WidgetType + catalog entry in lib/dashboard-layout.ts
 *   3) wire it into <WidgetSwitch> below
 */
import { useEffect, useMemo, useState } from "react";
import {
  CalendarCheck, Maximize2, Minimize2, NotebookPen, Pencil, Plus, RotateCcw, Save,
} from "lucide-react";
import { api } from "@/lib/api";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import {
  type WidgetInstance, type WidgetType,
  DEFAULT_LAYOUT, loadLayout, newWidgetId, resetLayout, saveLayout,
  WIDGET_CATALOG,
} from "@/lib/dashboard-layout";
import { WidgetShell } from "@/components/dashboard/widget-shell";
import { AddWidgetPicker } from "@/components/dashboard/widget-picker";
import {
  AISummaryWidget,
  ApprovalInboxWidget,
  CashPositionWidget,
  EntityBalancesWidget,
  KPIStripWidget,
  QuickActionsWidget,
  RecentActivityWidget,
  type BankAccount, type Entity, type JESummary,
} from "@/components/dashboard/widgets";
import {
  AnomaliesWidget,
  APAgingWidget,
  ARAgingWidget,
  BankListWidget,
  PeriodCloseWidget,
  PLSnapshotWidget,
  UnmatchedBankWidget,
} from "@/components/dashboard/accounting-widgets";


export default function HomePage() {
  /* ── Shared data ─────────────────────────────────────────────── */
  const [entities, setEntities] = useState<Entity[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [pending, setPending] = useState<JESummary[]>([]);
  const [recent, setRecent] = useState<JESummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const norm = <T,>(d: { results: T[] } | T[] | undefined): T[] =>
      Array.isArray(d) ? d : (d?.results ?? []);
    Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
        .then(norm).catch(() => [] as Entity[]),
      api.get<{ results: BankAccount[] } | BankAccount[]>("/beakon/bank-accounts/", {
        is_active: "true", page_size: "100",
      }).then(norm).catch(() => [] as BankAccount[]),
      api.get<{ entries: JESummary[] }>("/beakon/reports/journal-listing/", {
        status: "pending_approval", limit: "20",
      }).then((d) => d.entries || []).catch(() => [] as JESummary[]),
      api.get<{ entries: JESummary[] }>("/beakon/reports/journal-listing/", {
        status: "posted", limit: "10",
      }).then((d) => d.entries || []).catch(() => [] as JESummary[]),
    ]).then(([e, b, p, r]) => {
      setEntities(e); setBanks(b); setPending(p); setRecent(r);
    }).finally(() => setLoading(false));
  }, []);

  /* ── Compact toggle (round figures + K/M/B notation) ─────────── */
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    try {
      setCompact(localStorage.getItem("beakon:dashboard:compact") === "1");
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("beakon:dashboard:compact", compact ? "1" : "0");
    } catch { /* ignore */ }
  }, [compact]);

  /* ── Scope: entity-level vs group-wide ───────────────────────── */
  const [scopeEntityId, setScopeEntityId] = useState<number | null>(null);
  // Reset scope if the selected entity is no longer in the active list.
  useEffect(() => {
    if (scopeEntityId !== null && !entities.some((e) => e.id === scopeEntityId)) {
      setScopeEntityId(null);
    }
  }, [entities, scopeEntityId]);

  /* ── Layout state ────────────────────────────────────────────── */
  const [layout, setLayout] = useState<WidgetInstance[]>(DEFAULT_LAYOUT);
  const [editMode, setEditMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on first render to avoid a server/client
  // mismatch (Next.js hydrates with the SSR'd default).
  useEffect(() => {
    setLayout(loadLayout());
    setHydrated(true);
  }, []);

  // Persist any layout change.
  useEffect(() => {
    if (hydrated) saveLayout(layout);
  }, [layout, hydrated]);

  const inUse = useMemo(
    () => new Set(layout.map((w) => w.type)),
    [layout],
  );

  const moveUp = (idx: number) => setLayout((prev) => {
    if (idx <= 0) return prev;
    const next = prev.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    return next;
  });

  const moveDown = (idx: number) => setLayout((prev) => {
    if (idx >= prev.length - 1) return prev;
    const next = prev.slice();
    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    return next;
  });

  const remove = (idx: number) => setLayout((prev) => prev.filter((_, i) => i !== idx));

  const addWidget = (type: WidgetType) => {
    setLayout((prev) => [...prev, { id: newWidgetId(type), type }]);
    setPickerOpen(false);
  };

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });

  // Filter shared data by entity when a scope is set, so the cash /
  // KPI / inbox widgets honour the scope picker too.
  const scopedBanks = useMemo(() => {
    if (scopeEntityId === null) return banks;
    const ent = entities.find((e) => e.id === scopeEntityId);
    return ent ? banks.filter((b) => b.entity_code === ent.code) : banks;
  }, [banks, entities, scopeEntityId]);

  const scopedEntities = useMemo(() => {
    if (scopeEntityId === null) return entities;
    return entities.filter((e) => e.id === scopeEntityId);
  }, [entities, scopeEntityId]);

  const scopedPending = useMemo(() => {
    if (scopeEntityId === null) return pending;
    const ent = entities.find((e) => e.id === scopeEntityId);
    return ent ? pending.filter((j) => j.entity_code === ent.code) : pending;
  }, [pending, entities, scopeEntityId]);

  const scopedRecent = useMemo(() => {
    if (scopeEntityId === null) return recent;
    const ent = entities.find((e) => e.id === scopeEntityId);
    return ent ? recent.filter((j) => j.entity_code === ent.code) : recent;
  }, [recent, entities, scopeEntityId]);

  const dataProps = {
    loading,
    entities: scopedEntities,
    banks: scopedBanks,
    pending: scopedPending,
    recent: scopedRecent,
    scopeEntityId,
    compact,
  };

  return (
    <div>
      <PageHeader
        title="Home"
        description={
          editMode
            ? "Reorder, remove, or add widgets. Layout is saved to your browser. Click Done when finished."
            : "Today's cash position, what's waiting on you, and what just posted. Customize your layout with Edit dashboard."
        }
        context={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
              <CalendarCheck className="h-3.5 w-3.5 text-brand-600" />
              <span className="font-medium text-gray-800">{today}</span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
              <span className="text-gray-500">Scope:</span>
              <select
                value={scopeEntityId ?? ""}
                onChange={(e) => setScopeEntityId(e.target.value ? Number(e.target.value) : null)}
                className="bg-transparent text-xs font-medium text-gray-800 focus:outline-none"
              >
                <option value="">All entities</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setCompact((v) => !v)}
              className={
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " +
                (compact
                  ? "border-brand-200 bg-brand-50 text-brand-800"
                  : "border-canvas-200 bg-white/80 text-gray-600 hover:text-gray-900")
              }
              title={compact ? "Showing K / M / B — click to switch back to exact 2dp" : "Switch to K / M / B notation for executive viewing"}
            >
              {compact ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
              {compact ? "Compact" : "Exact"}
            </button>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            {editMode ? (
              <>
                <button
                  onClick={() => setPickerOpen(true)}
                  className="btn-secondary text-sm"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Add widget
                </button>
                <button
                  onClick={() => {
                    if (confirm("Reset your dashboard to the default layout?")) {
                      setLayout(resetLayout());
                    }
                  }}
                  className="btn-secondary text-sm"
                  title="Reset to default layout"
                >
                  <RotateCcw className="w-4 h-4 mr-1.5" /> Reset
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="btn-primary text-sm"
                >
                  <Save className="w-4 h-4 mr-1.5" /> Done
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditMode(true)}
                  className="btn-secondary text-sm"
                  title="Customize the layout"
                >
                  <Pencil className="w-4 h-4 mr-1.5" /> Edit dashboard
                </button>
                <Link href="/dashboard/journal-entries/new" className="btn-primary text-sm">
                  <NotebookPen className="w-4 h-4 mr-1.5" /> New journal entry
                </Link>
              </>
            )}
          </div>
        }
      />

      <div className={editMode ? "mt-7 space-y-7" : "mt-5 space-y-5"}>
        {(() => {
          // Pair up adjacent half-span widgets (AR+AP, inbox+recent) so
          // they sit side-by-side on lg screens. Also handles the case
          // where only one is present (it gets the full width).
          const items: React.ReactNode[] = [];
          for (let i = 0; i < layout.length; i++) {
            const a = layout[i];
            const b = layout[i + 1];
            const aEntry = WIDGET_CATALOG.find((c) => c.type === a.type);
            const bEntry = b ? WIDGET_CATALOG.find((c) => c.type === b.type) : null;
            const pairAB =
              !editMode && b && aEntry?.span === "half" && bEntry?.span === "half";
            if (pairAB && b) {
              items.push(
                <div key={`${a.id}+${b.id}`} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <WidgetSwitch widget={a} {...dataProps} />
                  <WidgetSwitch widget={b} {...dataProps} />
                </div>,
              );
              i++; // consumed b
            } else {
              items.push(
                <WidgetShell
                  key={a.id}
                  editMode={editMode}
                  isFirst={i === 0}
                  isLast={i === layout.length - 1}
                  label={aEntry?.name ?? a.type}
                  onMoveUp={() => moveUp(i)}
                  onMoveDown={() => moveDown(i)}
                  onRemove={() => remove(i)}
                >
                  <WidgetSwitch widget={a} {...dataProps} />
                </WidgetShell>,
              );
            }
          }
          return items;
        })()}

        {layout.length === 0 && (
          <div className="rounded-2xl border border-dashed border-canvas-300 bg-canvas-50/40 p-10 text-center">
            <p className="text-sm text-gray-600">Your dashboard is empty.</p>
            <button
              onClick={() => setPickerOpen(true)}
              className="btn-primary mt-3 text-sm"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add a widget
            </button>
          </div>
        )}

        {editMode && layout.length > 0 && (
          <button
            onClick={() => setPickerOpen(true)}
            className="w-full rounded-2xl border-2 border-dashed border-canvas-300 hover:border-brand-300 bg-white/40 hover:bg-brand-50/40 transition-all py-6 flex items-center justify-center gap-2 text-sm font-medium text-gray-600 hover:text-brand-800"
          >
            <Plus className="w-4 h-4" />
            Add a widget here
          </button>
        )}
      </div>

      {pickerOpen && (
        <AddWidgetPicker
          inUse={inUse}
          onAdd={addWidget}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}


/* Switch component — picks the right widget for a given instance. */
function WidgetSwitch({
  widget, loading, entities, banks, pending, recent, scopeEntityId, compact,
}: {
  widget: WidgetInstance;
  loading: boolean;
  entities: Entity[];
  banks: BankAccount[];
  pending: JESummary[];
  recent: JESummary[];
  scopeEntityId: number | null;
  compact: boolean;
}) {
  switch (widget.type) {
    case "cash-position":
      return <CashPositionWidget loading={loading} entities={entities} banks={banks} compact={compact} />;
    case "kpi-strip":
      return <KPIStripWidget loading={loading} entities={entities} banks={banks} pending={pending} recent={recent} />;
    case "pnl-snapshot":
      return <PLSnapshotWidget entityId={scopeEntityId} compact={compact} />;
    case "ar-aging":
      return <ARAgingWidget entityId={scopeEntityId} compact={compact} />;
    case "ap-aging":
      return <APAgingWidget entityId={scopeEntityId} compact={compact} />;
    case "bank-list":
      return <BankListWidget banks={banks} loading={loading} compact={compact} />;
    case "unmatched-bank":
      return <UnmatchedBankWidget entityId={scopeEntityId} />;
    case "period-close":
      return <PeriodCloseWidget entityId={scopeEntityId} />;
    case "anomalies":
      return <AnomaliesWidget entityId={scopeEntityId} />;
    case "approval-inbox":
      return <ApprovalInboxWidget loading={loading} pending={pending} />;
    case "recent-activity":
      return <RecentActivityWidget loading={loading} recent={recent} />;
    case "quick-actions":
      return <QuickActionsWidget />;
    case "entity-balances":
      return <EntityBalancesWidget loading={loading} entities={entities} banks={banks} compact={compact} />;
    case "ai-summary":
      return <AISummaryWidget />;
    default:
      return null;
  }
}
