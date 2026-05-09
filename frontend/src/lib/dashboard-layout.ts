/* Dashboard layout — multi-view, pluggable widget system.
 *
 * The home page can hold multiple named views (Overview / Expenses /
 * Revenue / your-own). Each view has its own ordered widget list. The
 * active view id, the views array, and the layout per view all persist
 * to localStorage so a refresh restores everything.
 *
 * Adding a new widget = three steps:
 *   1) add a `WidgetType` literal
 *   2) add a CATALOG entry describing it
 *   3) render it inside `<WidgetSwitch>` in the dashboard page
 */

export type WidgetType =
  | "cash-position"
  | "kpi-strip"
  | "pnl-snapshot"
  | "ar-aging"
  | "ap-aging"
  | "bank-list"
  | "unmatched-bank"
  | "period-close"
  | "anomalies"
  | "approval-inbox"
  | "recent-activity"
  | "quick-actions"
  | "entity-balances"
  | "ai-summary"
  | "cash-trend"
  | "expenses-analysis"
  | "revenue-analysis";


export interface WidgetInstance {
  id: string;
  type: WidgetType;
  settings?: Record<string, unknown>;
}


export interface DashboardView {
  id: string;
  name: string;
  layout: WidgetInstance[];
}


export interface WidgetCatalogEntry {
  type: WidgetType;
  name: string;
  description: string;
  span?: "full" | "half" | "split";
}


/* ────────────────────── Default views ─────────────────────────── */

const OVERVIEW_LAYOUT: WidgetInstance[] = [
  { id: "ov-trend",       type: "cash-trend" },
  { id: "ov-cash",        type: "cash-position" },
  { id: "ov-kpi",         type: "kpi-strip" },
  { id: "ov-pnl",         type: "pnl-snapshot" },
  { id: "ov-ar",          type: "ar-aging" },
  { id: "ov-ap",          type: "ap-aging" },
  { id: "ov-banks",       type: "bank-list" },
  { id: "ov-unmatched",   type: "unmatched-bank" },
  { id: "ov-inbox",       type: "approval-inbox" },
  { id: "ov-recent",      type: "recent-activity" },
  { id: "ov-period",      type: "period-close" },
  { id: "ov-actions",     type: "quick-actions" },
];

const EXPENSES_LAYOUT: WidgetInstance[] = [
  { id: "ex-analysis",    type: "expenses-analysis" },
  { id: "ex-ap",          type: "ap-aging" },
  { id: "ex-pnl",         type: "pnl-snapshot" },
  { id: "ex-anomalies",   type: "anomalies" },
  { id: "ex-recent",      type: "recent-activity" },
  { id: "ex-actions",     type: "quick-actions" },
];

const REVENUE_LAYOUT: WidgetInstance[] = [
  { id: "rv-analysis",    type: "revenue-analysis" },
  { id: "rv-ar",          type: "ar-aging" },
  { id: "rv-pnl",         type: "pnl-snapshot" },
  { id: "rv-trend",       type: "cash-trend" },
  { id: "rv-actions",     type: "quick-actions" },
];

export const DEFAULT_VIEWS: DashboardView[] = [
  { id: "overview", name: "Overview", layout: OVERVIEW_LAYOUT },
  { id: "expenses", name: "Expenses", layout: EXPENSES_LAYOUT },
  { id: "revenue",  name: "Revenue",  layout: REVENUE_LAYOUT  },
];


/* Back-compat: some callers may still import DEFAULT_LAYOUT. */
export const DEFAULT_LAYOUT: WidgetInstance[] = OVERVIEW_LAYOUT;


/* ────────────────────── Catalog ───────────────────────────────── */

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    type: "cash-trend",
    name: "Cash trend",
    description: "12-month cash balance area chart with the current total and a vs-last-month delta. The headline visual on a Digits-style overview.",
    span: "full",
  },
  {
    type: "cash-position",
    name: "Cash position",
    description: "Total cash across the group with per-currency chips and quick links.",
    span: "full",
  },
  {
    type: "kpi-strip",
    name: "KPI strip",
    description: "Four-tile snapshot: active entities, awaiting approval, posted this week, bank accounts.",
    span: "full",
  },
  {
    type: "pnl-snapshot",
    name: "Profit & loss",
    description: "Revenue, operating expenses, and net income for a configurable period — with a margin bar.",
    span: "full",
  },
  {
    type: "expenses-analysis",
    name: "Expenses analysis",
    description: "AI-generated narrative of where the money's going this period, highlighting the top vendor changes.",
    span: "half",
  },
  {
    type: "revenue-analysis",
    name: "Revenue analysis",
    description: "AI-generated narrative of where the money's coming from, highlighting the top customer changes.",
    span: "half",
  },
  {
    type: "ar-aging",
    name: "Money in (AR aging)",
    description: "What customers owe — aging buckets, % overdue, top customers.",
    span: "half",
  },
  {
    type: "ap-aging",
    name: "Money out (AP aging)",
    description: "What you owe vendors — aging buckets, % overdue, top vendors.",
    span: "half",
  },
  {
    type: "bank-list",
    name: "Bank accounts",
    description: "Per-account GL balance with quick links into the bank-feed detail.",
    span: "full",
  },
  {
    type: "unmatched-bank",
    name: "Unmatched bank items",
    description: "Bank transactions waiting to be categorized — count + sample.",
    span: "full",
  },
  {
    type: "period-close",
    name: "Period close",
    description: "Open vs closed periods plus the next 5 closing dates colored by urgency.",
    span: "full",
  },
  {
    type: "anomalies",
    name: "Anomalies",
    description: "AI-flagged oddities — unusual amounts, missing dates, large round numbers.",
    span: "full",
  },
  {
    type: "approval-inbox",
    name: "Approval inbox",
    description: "Pending bills, invoices, and JEs waiting on a sign-off.",
    span: "half",
  },
  {
    type: "recent-activity",
    name: "Recent activity",
    description: "The last 5 posted journal entries.",
    span: "half",
  },
  {
    type: "quick-actions",
    name: "Quick actions",
    description: "Five tone-coded shortcuts: pay bills, send invoice, bank feed, reconcile, run a report.",
    span: "full",
  },
  {
    type: "entity-balances",
    name: "Cash by entity",
    description: "Cash position broken down per entity.",
    span: "full",
  },
  {
    type: "ai-summary",
    name: "AI executive summary",
    description: "Claude (or local Ollama) reads the latest TB and writes a 3–4 sentence narrative.",
    span: "full",
  },
];


/* ────────────────────── Persistence ───────────────────────────── */

const VIEWS_KEY = "beakon:dashboard:views:v2";
const ACTIVE_KEY = "beakon:dashboard:activeView:v2";


export function loadViews(): DashboardView[] {
  if (typeof window === "undefined") return DEFAULT_VIEWS;
  try {
    const raw = window.localStorage.getItem(VIEWS_KEY);
    if (!raw) return DEFAULT_VIEWS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_VIEWS;
    const known = new Set(WIDGET_CATALOG.map((c) => c.type));
    const cleaned: DashboardView[] = parsed
      .filter((v: any): v is DashboardView =>
        v && typeof v.id === "string" && typeof v.name === "string" && Array.isArray(v.layout))
      .map((v: any) => ({
        id: v.id,
        name: v.name,
        layout: v.layout.filter(
          (w: any): w is WidgetInstance =>
            w && typeof w.id === "string" && typeof w.type === "string" && known.has(w.type),
        ),
      }));
    return cleaned.length > 0 ? cleaned : DEFAULT_VIEWS;
  } catch { return DEFAULT_VIEWS; }
}


export function saveViews(views: DashboardView[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); }
  catch { /* ignore */ }
}


export function loadActiveViewId(): string {
  if (typeof window === "undefined") return DEFAULT_VIEWS[0].id;
  try {
    return window.localStorage.getItem(ACTIVE_KEY) || DEFAULT_VIEWS[0].id;
  } catch { return DEFAULT_VIEWS[0].id; }
}


export function saveActiveViewId(id: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(ACTIVE_KEY, id); }
  catch { /* ignore */ }
}


export function resetViews(): DashboardView[] {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(VIEWS_KEY);
      window.localStorage.removeItem(ACTIVE_KEY);
    } catch { /* ignore */ }
  }
  return DEFAULT_VIEWS;
}


/* Back-compat single-layout helpers (kept for any older import). */
export function loadLayout(): WidgetInstance[] {
  return loadViews()[0]?.layout ?? DEFAULT_LAYOUT;
}
export function saveLayout(layout: WidgetInstance[]): void {
  const views = loadViews();
  if (views.length > 0) {
    views[0] = { ...views[0], layout };
    saveViews(views);
  }
}
export function resetLayout(): WidgetInstance[] {
  return resetViews()[0]?.layout ?? DEFAULT_LAYOUT;
}


export function newWidgetId(type: WidgetType): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${type}-${Date.now().toString(36)}-${rand}`;
}


export function newViewId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `view-${Date.now().toString(36)}-${rand}`;
}
