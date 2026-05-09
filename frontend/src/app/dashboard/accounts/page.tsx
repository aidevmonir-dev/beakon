"use client";

/* Chart of Accounts — the ledger's spine.
 *
 * Architecture notes:
 *   · Balances + 12-month sparklines come from the read-only
 *     /beakon/accounts/summary/ endpoint. No accounting logic runs here.
 *   · Tree display: `parent` references build a 2-level hierarchy
 *     (deeper trees render flat — intentional; depth > 2 is rare in real CoAs).
 *   · Filter chips (scope/type/status) + search + entity filter narrow the view
 *     without mutating data. Summary stats recompute from the visible set.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Plus, X, Search, ChevronDown, ChevronRight, Building2,
  Landmark, Wallet, Scale, TrendingUp, TrendingDown, MoreHorizontal,
  Layers, Globe, Info, Archive, Pencil, AlertCircle, Check,
  ArrowUp, ArrowDown, Command, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";


// ── Types ─────────────────────────────────────────────────────────────────

interface Entity { id: number; code: string; name: string; functional_currency: string; }

interface Account {
  id: number;
  code: string;
  name: string;
  entity: number | null;
  entity_code: string | null;
  account_type: string;
  account_subtype: string;
  normal_balance: string;
  currency: string;
  parent: number | null;
  is_active: boolean;
  is_system: boolean;
  description?: string;
}

interface SummaryRow { id: number; balance: string; sparkline: number[]; }
interface SummaryResp { as_of: string; months: string[]; accounts: SummaryRow[]; }

interface SubtypeOption { value: string; label: string; is_custom: boolean; id?: number; }
type SubtypeCatalog = Record<string, SubtypeOption[]>;

type TypeKey = "asset" | "liability" | "equity" | "revenue" | "expense";

const TYPES: {
  value: TypeKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  rail: string;
  pill: string;
  spark: string;
}[] = [
  { value: "asset",     label: "Assets",      icon: Wallet,       rail: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 ring-emerald-100",  spark: "#10b981" },
  { value: "liability", label: "Liabilities", icon: Scale,        rail: "bg-rose-500",    pill: "bg-rose-50 text-rose-700 ring-rose-100",            spark: "#f43f5e" },
  { value: "equity",    label: "Equity",      icon: Landmark,     rail: "bg-indigo-500",  pill: "bg-indigo-50 text-indigo-700 ring-indigo-100",      spark: "#6366f1" },
  { value: "revenue",   label: "Revenue",     icon: TrendingUp,   rail: "bg-sky-500",     pill: "bg-sky-50 text-sky-700 ring-sky-100",               spark: "#0ea5e9" },
  { value: "expense",   label: "Expenses",    icon: TrendingDown, rail: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 ring-amber-100",         spark: "#f59e0b" },
];

const SUBTYPES_BY_TYPE: Record<TypeKey, string[]> = {
  asset:     ["bank", "cash", "current_asset", "accounts_receivable", "intercompany_receivable", "prepaid", "inventory", "investment", "loan_receivable", "fixed_asset", "accumulated_depreciation", "intangible_asset", "other_asset"],
  liability: ["accounts_payable", "intercompany_payable", "accrued_liability", "current_liability", "loan_payable", "long_term_liability", "tax_payable", "vat_payable", "other_liability"],
  equity:    ["capital", "retained_earnings", "revaluation_reserve", "fx_translation_reserve", "distribution", "other_equity"],
  revenue:   ["operating_revenue", "investment_income", "fx_gain", "other_income"],
  expense:   ["cogs", "operating_expense", "professional_fees", "depreciation", "fx_loss", "tax_expense", "other_expense"],
};


// ── Helpers ───────────────────────────────────────────────────────────────

function fmtMoney(raw: string | number) {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `−${s}` : s;
}

function fmtCompact(n: number) {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${abs.toFixed(0)}`;
}

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


// ── Sparkline (interactive, hover → month + value tooltip) ────────────────

function Sparkline({ data, months, color }: { data: number[]; months: string[]; color: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data || data.length === 0) return <span className="text-[11px] text-gray-300">—</span>;

  const W = 76, H = 24, P = 2;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 0);
  const range = max - min || 1;
  const step = (W - 2 * P) / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => [P + i * step, P + (H - 2 * P) * (1 - (v - min) / range)] as const);
  const lineD = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaD = `${lineD} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const [lx, ly] = pts[pts.length - 1];
  const gradId = `spark-${color.replace("#", "")}`;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round((x - P) / step)));
    setHoverIdx(idx);
  }

  const h = hoverIdx != null ? pts[hoverIdx] : null;
  const hoverLabel = hoverIdx != null && months[hoverIdx]
    ? new Date(months[hoverIdx]).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "";
  const hoverValue = hoverIdx != null ? fmtMoney(data[hoverIdx]) : "";

  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradId})`} />
        <path d={lineD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* end dot */}
        <circle cx={lx} cy={ly} r="2" fill={color} />
        {/* hover indicator */}
        {h && (
          <>
            <line x1={h[0]} x2={h[0]} y1={0} y2={H} stroke={color} strokeOpacity="0.25" strokeWidth="1" />
            <circle cx={h[0]} cy={h[1]} r="2.6" fill="white" stroke={color} strokeWidth="1.5" />
          </>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow-lg"
          style={{ left: h[0], top: -4 }}
        >
          <span className="opacity-70">{hoverLabel}</span>
          <span className="ml-1.5 font-mono tabular-nums">{hoverValue}</span>
        </div>
      )}
    </div>
  );
}


// ── MoM delta chip ────────────────────────────────────────────────────────

function DeltaChip({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const cur = data[data.length - 1];
  const prev = data[data.length - 2];
  if (cur === 0 && prev === 0) return null;
  if (prev === 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-brand-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-inset ring-brand-100">
        New
      </span>
    );
  }
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (!isFinite(pct) || Math.abs(pct) < 0.1) return null;
  const up = pct > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ring-inset",
        up
          ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
          : "bg-rose-50 text-rose-700 ring-rose-100",
      )}
    >
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(pct) >= 1000 ? `${(Math.abs(pct) / 1000).toFixed(1)}k` : Math.abs(pct).toFixed(1)}%
    </span>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────

type ScopeFilter = "all" | "shared" | "entity";
type StatusFilter = "all" | "active" | "inactive";

export default function AccountsPage() {
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [orgName, setOrgName] = useState<string>("");

  const [entities, setEntities] = useState<Entity[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<Map<number, SummaryRow>>(new Map());
  const [months, setMonths] = useState<string[]>([]);
  const [subtypeCatalog, setSubtypeCatalog] = useState<SubtypeCatalog>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [entityId, setEntityId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<TypeKey | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [collapsed, setCollapsed] = useState<Set<TypeKey>>(new Set());

  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; account: Account } | null>(null);

  // Keyboard nav
  const searchRef = useRef<HTMLInputElement>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  // ── Org bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    const id = typeof window !== "undefined" ? localStorage.getItem("organization_id") : null;
    setHasOrg(!!id);
    if (id) {
      // Try to surface the org name for the header chip.
      api.get<{ organizations?: { id: number; name: string }[] }>("/auth/me/")
        .then((d) => {
          const org = d.organizations?.find((o) => String(o.id) === id);
          setOrgName(org?.name || "");
        })
        .catch(() => {});
    }
  }, []);

  const reloadSubtypes = async () => {
    const cat = await api.get<SubtypeCatalog>("/beakon/account-subtypes/").catch(() => ({}));
    setSubtypeCatalog(cat);
    return cat;
  };

  const load = async () => {
    setLoading(true);
    const entParam = entityId ? `?entity_id=${entityId}` : "";
    const [ents, accs, sum, cat] = await Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
        .then((d) => (Array.isArray(d) ? d : d.results ?? []))
        .catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { page_size: "1000" })
        .then((d) => (Array.isArray(d) ? d : d.results ?? []))
        .catch(() => []),
      api.get<SummaryResp>(`/beakon/accounts/summary/${entParam}`)
        .catch(() => ({ as_of: "", months: [], accounts: [] } as SummaryResp)),
      api.get<SubtypeCatalog>("/beakon/account-subtypes/").catch(() => ({})),
    ]);
    setEntities(ents);
    setAccounts(accs);
    const m = new Map<number, SummaryRow>();
    for (const r of sum.accounts) m.set(r.id, r);
    setSummary(m);
    setMonths(sum.months || []);
    setSubtypeCatalog(cat);
    setLoading(false);
  };

  useEffect(() => {
    if (!hasOrg) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasOrg, entityId]);

  // ── Derived data ─────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => accounts.filter((a) => {
    if (scope === "shared" && a.entity !== null) return false;
    if (scope === "entity" && a.entity === null) return false;
    if (entityId && a.entity !== null && a.entity.toString() !== entityId) return false;
    if (typeFilter !== "all" && a.account_type !== typeFilter) return false;
    if (status === "active" && !a.is_active) return false;
    if (status === "inactive" && a.is_active) return false;
    if (q) {
      const hay = `${a.code} ${a.name} ${a.account_subtype} ${a.entity_code || "shared"}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [accounts, scope, entityId, typeFilter, status, q]);

  const byType = useMemo(() => {
    const map = new Map<TypeKey, Account[]>();
    TYPES.forEach((t) => map.set(t.value, []));
    for (const a of filtered) {
      const list = map.get(a.account_type as TypeKey);
      if (list) list.push(a);
    }
    for (const arr of map.values()) arr.sort((x, y) => x.code.localeCompare(y.code));
    return map;
  }, [filtered]);

  // Build parent → children map for tree display.
  const childrenOf = useMemo(() => {
    const m = new Map<number, Account[]>();
    for (const a of accounts) {
      if (a.parent != null) {
        const arr = m.get(a.parent) || [];
        arr.push(a);
        m.set(a.parent, arr);
      }
    }
    return m;
  }, [accounts]);

  const sectionTotals = useMemo(() => {
    const t = new Map<TypeKey, number>();
    for (const k of TYPES) {
      const rows = byType.get(k.value) || [];
      t.set(k.value, rows.reduce((acc, r) => acc + Number(summary.get(r.id)?.balance ?? 0), 0));
    }
    return t;
  }, [byType, summary]);

  // Summary stats across the *full* (pre-filter) dataset — so the cards
  // represent truth, not the current filter lens.
  const stats = useMemo(() => {
    const total = accounts.length;
    const active = accounts.filter((a) => a.is_active).length;
    const shared = accounts.filter((a) => a.entity === null).length;
    const entitySpecific = total - shared;
    return { total, active, shared, entitySpecific };
  }, [accounts]);

  // Counts per type for the chip rail (pre-type-filter).
  const typeCounts = useMemo(() => {
    const counts = new Map<TypeKey, number>();
    TYPES.forEach((t) => counts.set(t.value, 0));
    const base = accounts.filter((a) => {
      if (scope === "shared" && a.entity !== null) return false;
      if (scope === "entity" && a.entity === null) return false;
      if (entityId && a.entity !== null && a.entity.toString() !== entityId) return false;
      if (status === "active" && !a.is_active) return false;
      if (status === "inactive" && a.is_active) return false;
      return true;
    });
    for (const a of base) {
      const k = a.account_type as TypeKey;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return { counts, total: base.length };
  }, [accounts, scope, entityId, status]);

  // ── Handlers ─────────────────────────────────────────────────────────
  function toggleSection(k: TypeKey) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function archiveAccount(a: Account) {
    if (!confirm(`Archive "${a.code} · ${a.name}"? It can be reactivated later from the inactive filter.`)) return;
    try {
      await api.patch(`/beakon/accounts/${a.id}/`, { is_active: false });
      await load();
    } catch (e: any) {
      alert("Archive failed: " + JSON.stringify(e?.detail || e));
    }
  }

  const activeFilterCount =
    (scope !== "all" ? 1 : 0) +
    (entityId ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (status !== "active" ? 1 : 0) +
    (q ? 1 : 0);

  function resetFilters() {
    setQuery(""); setScope("all"); setEntityId(""); setTypeFilter("all"); setStatus("active");
  }

  // Flat list of currently-visible rows (for arrow nav). Respects section
  // order and collapsed sections.
  const visibleRows = useMemo(() => {
    const flat: Account[] = [];
    for (const t of TYPES) {
      if (collapsed.has(t.value)) continue;
      const rows = byType.get(t.value) || [];
      if (rows.length === 0) continue;
      const topLevel = rows.filter((r) => r.parent == null || !rows.some((x) => x.id === r.parent));
      for (const p of topLevel) {
        flat.push(p);
        const kids = (childrenOf.get(p.id) || []).filter((c) => rows.some((r) => r.id === c.id));
        kids.sort((a, b) => a.code.localeCompare(b.code));
        for (const k of kids) flat.push(k);
      }
    }
    return flat;
  }, [byType, collapsed, childrenOf]);

  // Reset focused row when the visible set changes (filters, collapse).
  useEffect(() => {
    if (focusedIdx !== null && focusedIdx >= visibleRows.length) setFocusedIdx(null);
  }, [visibleRows, focusedIdx]);

  // Global keyboard shortcuts: `/` focus search, ⌘K select-all-focus,
  // ↑/↓ row nav, Enter open edit drawer.
  const handleKey = useCallback((e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement | null;
    const inField =
      tgt &&
      (tgt.tagName === "INPUT" ||
        tgt.tagName === "TEXTAREA" ||
        tgt.tagName === "SELECT" ||
        tgt.isContentEditable);

    // Cmd/Ctrl+K — always focus + select search
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (inField) return;  // don't intercept while typing elsewhere

    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (e.key === "Escape" && drawer) {
      setDrawer(null);
      return;
    }
    if (visibleRows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => (i === null ? 0 : Math.min(visibleRows.length - 1, i + 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => (i === null ? 0 : Math.max(0, i - 1)));
    } else if (e.key === "Enter" && focusedIdx !== null && visibleRows[focusedIdx]) {
      e.preventDefault();
      setDrawer({ mode: "edit", account: visibleRows[focusedIdx] });
    }
  }, [visibleRows, focusedIdx, drawer]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  // Scroll the focused row into view.
  useEffect(() => {
    if (focusedIdx === null) return;
    const el = document.querySelector<HTMLTableRowElement>(`tr[data-row-idx="${focusedIdx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIdx]);

  // ── No-org premium state ─────────────────────────────────────────────
  if (hasOrg === false) {
    return (
      <div>
        <PageHeader
          title="Chart of Accounts"
          description="The ledger's spine — every entry in Beakon posts to an account defined here."
        />
        <div className="mt-6">
          <EmptyState
            tone="brand"
            icon={Building2}
            title="Select an organization to view the ledger"
            description="The Chart of Accounts is scoped to an organization. Create or switch into one to see its account structure, balances, and recent activity."
            primaryAction={{ label: "Manage organizations", icon: Plus, onClick: () => { window.location.href = "/setup"; } }}
          />
        </div>
      </div>
    );
  }

  // ── Main page ────────────────────────────────────────────────────────
  const visibleTypes = TYPES.filter((t) => (byType.get(t.value)?.length ?? 0) > 0);

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        description="The ledger's spine — every entry in Beakon posts to an account defined here. Live balances and 12-month trend per account."
        context={
          orgName ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
              <Building2 className="h-3.5 w-3.5 text-brand-600" />
              <span className="font-medium text-gray-800">{orgName}</span>
              <span className="text-gray-300">·</span>
              <span className="tabular-nums">{stats.total} accounts</span>
            </div>
          ) : null
        }
        actions={
          <div className="flex items-center gap-2">
            <a
              href="/dashboard/accounts/import"
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
            >
              <Sparkles className="w-3.5 h-3.5" /> Import with AI
            </a>
            <button onClick={() => setDrawer({ mode: "create" })} className="btn-primary">
              <Plus className="w-4 h-4 mr-1.5" /> New Account
            </button>
          </div>
        }
      />

      {/* ── Summary stats ─────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat
          label="Total accounts"
          value={stats.total}
          hint={`${stats.active} active · ${stats.total - stats.active} archived`}
          icon={BookOpen}
          tone="brand"
        />
        <SummaryStat
          label="Active"
          value={stats.active}
          hint={stats.total ? `${Math.round((stats.active / stats.total) * 100)}% of total` : "—"}
          icon={Check}
          tone="mint"
        />
        <SummaryStat
          label="Shared"
          value={stats.shared}
          hint="Reusable across every entity"
          icon={Globe}
          tone="indigo"
        />
        <SummaryStat
          label="Entity-specific"
          value={stats.entitySpecific}
          hint={`Across ${entities.length} ${entities.length === 1 ? "entity" : "entities"}`}
          icon={Layers}
          tone="amber"
        />
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="mt-5 rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by code, name, subtype, or entity"
              className="w-full h-10 pl-9 pr-20 rounded-xl border border-canvas-200 bg-white text-sm placeholder-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none transition"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-canvas-50"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded-md border border-canvas-200 bg-canvas-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 sm:inline-flex">
                <Command className="h-2.5 w-2.5" /> K
              </kbd>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-10 rounded-xl border border-canvas-200 bg-white text-sm px-3 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="">All entities</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>
            <select
              className="h-10 rounded-xl border border-canvas-200 bg-white text-sm px-3 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="active">Active only</option>
              <option value="all">All statuses</option>
              <option value="inactive">Archived</option>
            </select>
          </div>
        </div>

        {/* Filter chip rail */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-canvas-100 px-3 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mr-1">Scope</span>
          <FilterChip active={scope === "all"}    onClick={() => setScope("all")}>All</FilterChip>
          <FilterChip active={scope === "shared"} onClick={() => setScope("shared")}>Shared</FilterChip>
          <FilterChip active={scope === "entity"} onClick={() => setScope("entity")}>Entity-specific</FilterChip>

          <span className="mx-2 h-4 w-px bg-canvas-200" />

          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mr-1">Type</span>
          <FilterChip active={typeFilter === "all"} onClick={() => setTypeFilter("all")} count={typeCounts.total}>All</FilterChip>
          {TYPES.map((t) => (
            <FilterChip
              key={t.value}
              active={typeFilter === t.value}
              onClick={() => setTypeFilter(t.value)}
              count={typeCounts.counts.get(t.value) || 0}
            >
              {t.label}
            </FilterChip>
          ))}

          {activeFilterCount > 0 && (
            <>
              <span className="mx-2 h-4 w-px bg-canvas-200" />
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-brand-700 font-medium hover:text-brand-900 hover:underline"
              >
                Reset filters
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-canvas-50/80 backdrop-blur border-b border-canvas-200/70">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                <th className="w-24 pl-5 pr-2 py-2.5 font-semibold">Code</th>
                <th className="pr-4 py-2.5 font-semibold">Name</th>
                <th className="hidden md:table-cell pr-4 py-2.5 font-semibold">Subtype</th>
                <th className="hidden lg:table-cell pr-4 py-2.5 font-semibold">Scope</th>
                <th className="hidden xl:table-cell pr-4 py-2.5 font-semibold">Trend</th>
                <th className="pr-4 py-2.5 text-right font-semibold">Balance</th>
                <th className="w-10 pr-3 py-2.5"></th>
              </tr>
            </thead>

            {loading ? (
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} columns={7} />)}
              </tbody>
            ) : filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      icon={Search}
                      title={accounts.length === 0 ? "Create your first account" : "No accounts match these filters"}
                      description={
                        accounts.length === 0
                          ? "Beakon can't post journal entries without accounts. Start by adding a cash account or a revenue line for your primary entity."
                          : "Try broadening the scope, clearing the search, or switching status to see archived accounts."
                      }
                      primaryAction={
                        accounts.length === 0
                          ? { label: "Create first account", icon: Plus, onClick: () => setDrawer({ mode: "create" }) }
                          : activeFilterCount > 0
                          ? { label: "Reset filters", onClick: resetFilters }
                          : undefined
                      }
                      className="border-0 shadow-none rounded-none"
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              visibleTypes.map((t) => {
                const rows = byType.get(t.value) || [];
                const isOpen = !collapsed.has(t.value);
                const total = sectionTotals.get(t.value) || 0;
                const Icon = t.icon;
                // Render tree: top-level first, then children indented beneath.
                const topLevel = rows.filter((r) => r.parent == null || !rows.some((x) => x.id === r.parent));
                const rendered: Account[] = [];
                for (const p of topLevel) {
                  rendered.push(p);
                  const kids = (childrenOf.get(p.id) || []).filter((c) => rows.some((r) => r.id === c.id));
                  kids.sort((a, b) => a.code.localeCompare(b.code));
                  for (const k of kids) rendered.push(k);
                }
                return (
                  <tbody key={t.value} className="border-t border-canvas-100">
                    <tr
                      onClick={() => toggleSection(t.value)}
                      className="group cursor-pointer bg-canvas-50/40 hover:bg-canvas-50 transition-colors select-none"
                    >
                      <td className="relative pl-5 pr-2 py-2.5">
                        <span className={cn("absolute left-0 top-0 bottom-0 w-1", t.rail)} />
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-canvas-200 text-gray-600">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                      </td>
                      <td colSpan={4} className="pr-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-gray-900 tracking-tight">{t.label}</span>
                          <span className="text-[11px] text-gray-400 font-medium">
                            {rows.length} {rows.length === 1 ? "account" : "accounts"}
                          </span>
                        </div>
                      </td>
                      <td className="pr-4 py-2.5 text-right">
                        <span className="font-mono text-[13px] font-semibold text-gray-900 tabular-nums">
                          {fmtMoney(total)}
                        </span>
                      </td>
                      <td className="pr-3 py-2.5">
                        <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform", isOpen ? "" : "-rotate-90")} />
                      </td>
                    </tr>

                    {isOpen && rendered.map((a) => {
                      const isChild = a.parent != null && rendered.some((x) => x.id === a.parent);
                      const s = summary.get(a.id);
                      const bal = Number(s?.balance ?? 0);
                      const sp = s?.sparkline || [];
                      const rowIdx = visibleRows.indexOf(a);
                      const isFocused = focusedIdx === rowIdx && rowIdx >= 0;
                      return (
                        <tr
                          key={a.id}
                          data-row-idx={rowIdx}
                          onClick={() => setDrawer({ mode: "edit", account: a })}
                          onMouseEnter={() => setFocusedIdx(rowIdx)}
                          className={cn(
                            "group cursor-pointer transition-colors relative",
                            isFocused
                              ? "bg-brand-50/50 [&>td:first-child]:shadow-[inset_2px_0_0_0_var(--color-brand-500)]"
                              : "hover:bg-brand-50/30",
                          )}
                        >
                          <td className="pl-5 pr-2 py-2 font-mono text-[11px] text-gray-500 tabular-nums">
                            {a.code}
                          </td>
                          <td className="pr-4 py-2 min-w-0">
                            <div className={cn("flex items-center gap-2 min-w-0", isChild && "pl-5")}>
                              {isChild && <ChevronRight className="h-3 w-3 text-gray-300 shrink-0" />}
                              <span className="text-sm text-gray-900 truncate">{a.name}</span>
                              {a.is_system && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 ring-1 ring-gray-200/60">system</span>
                              )}
                              {!a.is_active && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200/60">archived</span>
                              )}
                            </div>
                          </td>
                          <td className="hidden md:table-cell pr-4 py-2">
                            {a.account_subtype ? (
                              <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-canvas-100 text-gray-600">
                                {titleCase(a.account_subtype)}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="hidden lg:table-cell pr-4 py-2 text-xs">
                            {a.entity_code ? (
                              <span className="inline-flex items-center gap-1 text-gray-600">
                                <Layers className="h-3 w-3 text-gray-400" />
                                <span className="font-mono">{a.entity_code}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-indigo-700">
                                <Globe className="h-3 w-3" />
                                Shared
                              </span>
                            )}
                          </td>
                          <td className="hidden xl:table-cell pr-4 py-2">
                            <Sparkline data={sp} months={months} color={t.spark} />
                          </td>
                          <td className="pr-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <DeltaChip data={sp} />
                              <span className={cn("font-mono text-sm tabular-nums", bal === 0 ? "text-gray-300" : "text-gray-900")}>
                                {fmtMoney(bal)}
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">
                              {a.currency || ""}
                            </div>
                          </td>
                          <td className="pr-3 py-2">
                            <RowActions
                              account={a}
                              onEdit={() => setDrawer({ mode: "edit", account: a })}
                              onArchive={() => archiveAccount(a)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })
            )}
          </table>
        </div>
      </div>

      {drawer && (
        <AccountDrawer
          key={drawer.mode === "edit" ? drawer.account.id : "create"}
          mode={drawer.mode}
          account={drawer.mode === "edit" ? drawer.account : undefined}
          entities={entities}
          accounts={accounts}
          subtypeCatalog={subtypeCatalog}
          onSubtypeCatalogChange={reloadSubtypes}
          onClose={() => setDrawer(null)}
          onSaved={async () => { setDrawer(null); await load(); }}
        />
      )}
    </div>
  );
}


// ── Row actions menu ──────────────────────────────────────────────────────

function RowActions({
  account, onEdit, onArchive,
}: { account: Account; onEdit: () => void; onArchive: () => void }) {
  const [open, setOpen] = useState(false);
  if (account.is_system) {
    // System accounts can't be archived or edited freely — keep the slot visually stable.
    return <span className="inline-block w-5 h-5" aria-hidden />;
  }
  return (
    <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-canvas-100"
        aria-label="Row actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 top-7 z-50 w-40 rounded-lg border border-canvas-200 bg-white shadow-lg py-1 text-sm">
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-canvas-50"
            >
              <Pencil className="h-3.5 w-3.5 text-gray-400" /> Edit
            </button>
            {account.is_active && (
              <button
                onClick={(e) => { e.stopPropagation(); setOpen(false); onArchive(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-amber-700 hover:bg-amber-50"
              >
                <Archive className="h-3.5 w-3.5" /> Archive
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}


// ── Create / edit drawer ──────────────────────────────────────────────────

function AccountDrawer({
  mode, account, entities, accounts, subtypeCatalog, onSubtypeCatalogChange, onClose, onSaved,
}: {
  mode: "create" | "edit";
  account?: Account;
  entities: Entity[];
  accounts: Account[];
  subtypeCatalog: SubtypeCatalog;
  onSubtypeCatalogChange: () => Promise<SubtypeCatalog>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = mode === "edit" && !!account;
  const [form, setForm] = useState({
    code: account?.code || "",
    name: account?.name || "",
    entity: account?.entity ? String(account.entity) : "",
    account_type: (account?.account_type || "asset") as TypeKey,
    account_subtype: account?.account_subtype || "",
    normal_balance: account?.normal_balance || "debit",
    currency: account?.currency || "",
    parent: account?.parent ? String(account.parent) : "",
    description: account?.description || "",
    is_active: account?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // When type changes, flip normal balance to the accounting convention.
  useEffect(() => {
    if (isEdit) return;
    const credit = ["liability", "equity", "revenue"].includes(form.account_type);
    setForm((f) => ({ ...f, normal_balance: credit ? "credit" : "debit", account_subtype: "" }));
  }, [form.account_type, isEdit]);

  const subtypeOptions: SubtypeOption[] =
    subtypeCatalog[form.account_type] ||
    (SUBTYPES_BY_TYPE[form.account_type] || []).map((v) => ({ value: v, label: titleCase(v), is_custom: false }));
  const parentCandidates = accounts.filter(
    (a) =>
      a.id !== account?.id &&
      a.account_type === form.account_type &&
      (form.entity ? a.entity === null || String(a.entity) === form.entity : a.entity === null),
  );

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true); setErr(null);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      entity: form.entity ? Number(form.entity) : null,
      account_type: form.account_type,
      account_subtype: form.account_subtype || "",
      normal_balance: form.normal_balance,
      currency: form.currency.trim().toUpperCase(),
      parent: form.parent ? Number(form.parent) : null,
      description: form.description.trim(),
      is_active: form.is_active,
    };
    try {
      if (isEdit && account) {
        await api.patch(`/beakon/accounts/${account.id}/`, payload);
      } else {
        await api.post("/beakon/accounts/", payload);
      }
      await onSaved();
    } catch (e: any) {
      setErr(typeof e?.detail === "string" ? e.detail : JSON.stringify(e?.detail || e || "Failed to save"));
    } finally {
      setBusy(false);
    }
  }

  const typeMeta = TYPES.find((t) => t.value === form.account_type);

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[500px] bg-white border-l border-canvas-200 overflow-y-auto flex flex-col">
        {/* Drawer header */}
        <div className="relative px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                {isEdit ? "Edit account" : "New account"}
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">
                {isEdit
                  ? `${account?.code} · ${account?.name}`
                  : "Add an account to the ledger"}
              </h2>
              {!isEdit && (
                <p className="mt-1 text-xs text-gray-500 max-w-xs">
                  Every journal entry posts to an account. Pick a type that fits the balance sheet or income statement line it represents.
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Identity */}
          <Section title="Identity" hint="A short numeric code and a clear human-readable name.">
            <div className="grid grid-cols-3 gap-3">
              <FieldLabel label="Code" required className="col-span-1">
                <input
                  className="input font-mono"
                  value={form.code}
                  onChange={(e) => update("code", e.target.value)}
                  placeholder="1010"
                  disabled={isEdit && account?.is_system}
                />
              </FieldLabel>
              <FieldLabel label="Name" required className="col-span-2">
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Checking — Operating"
                />
              </FieldLabel>
            </div>
          </Section>

          {/* Classification */}
          <Section
            title="Classification"
            hint="Type drives where this account appears on the balance sheet and income statement. Subtype is optional but tightens categorisation for reports."
          >
            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Type" required>
                <select
                  className="input"
                  value={form.account_type}
                  onChange={(e) => update("account_type", e.target.value as TypeKey)}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </FieldLabel>
              <SubtypeField
                accountType={form.account_type}
                value={form.account_subtype}
                options={subtypeOptions}
                onChange={(v) => update("account_subtype", v)}
                onCatalogChange={onSubtypeCatalogChange}
              />
            </div>
            {typeMeta && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-canvas-50 px-2.5 py-1.5 text-[11px] text-gray-600 ring-1 ring-inset ring-canvas-200/70">
                <Info className="h-3 w-3 text-gray-400" />
                <span>
                  <span className={cn("inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset mr-1.5", typeMeta.pill)}>
                    {typeMeta.label}
                  </span>
                  normally carries a <strong className="font-semibold">{form.normal_balance}</strong> balance.
                </span>
              </div>
            )}
          </Section>

          {/* Scope */}
          <Section
            title="Scope"
            hint={
              <>
                <strong>Shared</strong> accounts are visible on every entity and are ideal for master lines like retained earnings. <strong>Entity-specific</strong> accounts are private to one entity.
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Entity">
                <select
                  className="input"
                  value={form.entity}
                  onChange={(e) => update("entity", e.target.value)}
                >
                  <option value="">Shared across all entities</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="Parent account" hint="Optional — for nested CoAs">
                <select
                  className="input"
                  value={form.parent}
                  onChange={(e) => update("parent", e.target.value)}
                >
                  <option value="">None</option>
                  {parentCandidates.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                  ))}
                </select>
              </FieldLabel>
            </div>
          </Section>

          {/* Details */}
          <Section title="Details">
            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Currency" hint="Blank = multi-currency">
                <input
                  className="input uppercase font-mono"
                  value={form.currency}
                  onChange={(e) => update("currency", e.target.value)}
                  maxLength={3}
                  placeholder="EUR"
                />
              </FieldLabel>
              <FieldLabel label="Normal balance" required>
                <select
                  className="input"
                  value={form.normal_balance}
                  onChange={(e) => update("normal_balance", e.target.value)}
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </FieldLabel>
            </div>
            <FieldLabel label="Description" className="mt-3" hint="Internal notes — not shown to external reports">
              <textarea
                className="input min-h-[64px] resize-y"
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="e.g., Primary operating cash — Chase 1234. Used for daily operational payments."
              />
            </FieldLabel>
            {isEdit && !account?.is_system && (
              <label className="mt-3 flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-canvas-200"
                  checked={form.is_active}
                  onChange={(e) => update("is_active", e.target.checked)}
                />
                <span>
                  <span className="font-medium">Account is active</span>
                  <span className="block text-gray-400 mt-0.5">Inactive accounts are hidden from pickers but remain on historical entries.</span>
                </span>
              </label>
            )}
          </Section>

          {err && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{err}</span>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-canvas-100 bg-white/95 backdrop-blur px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            type="submit"
            onClick={(e) => submit(e as any)}
            disabled={busy || !form.code || !form.name}
            className="btn-primary"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create account"}
          </button>
        </div>
      </div>
    </div>
  );
}


function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">{title}</h3>
        {hint && <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function FieldLabel({
  label, hint, required, className, children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10px] text-gray-400">{hint}</span>}
    </label>
  );
}


function SubtypeField({
  accountType, value, options, onChange, onCatalogChange,
}: {
  accountType: TypeKey;
  value: string;
  options: SubtypeOption[];
  onChange: (v: string) => void;
  onCatalogChange: () => Promise<SubtypeCatalog>;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");  // auto-slugged from label
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function slugify(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  async function saveCustom() {
    setErr(null);
    const slug = newValue || slugify(newLabel);
    if (!newLabel.trim() || !slug) {
      setErr("Both label and value are required.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/beakon/account-subtypes/", {
        account_type: accountType, value: slug, label: newLabel.trim(),
      });
      await onCatalogChange();
      onChange(slug);
      setAdding(false);
      setNewLabel(""); setNewValue("");
    } catch (e: any) {
      setErr(typeof e?.detail === "string" ? e.detail : JSON.stringify(e?.detail || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FieldLabel label="Subtype">
      <div className="space-y-2">
        <div className="relative">
          <select
            className="input pr-8"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">—</option>
            <optgroup label="Built-in">
              {options.filter((o) => !o.is_custom).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
            {options.some((o) => o.is_custom) && (
              <optgroup label="Custom">
                {options.filter((o) => o.is_custom).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:text-brand-900"
          >
            <Plus className="h-3 w-3" /> Add custom subtype
          </button>
        ) : (
          <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-2.5 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-800">
              New subtype under {titleCase(accountType)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                autoFocus
                className="input"
                placeholder="Label (e.g. Crypto)"
                value={newLabel}
                onChange={(e) => {
                  setNewLabel(e.target.value);
                  if (!newValue) setNewValue(slugify(e.target.value));
                }}
              />
              <input
                className="input font-mono text-xs"
                placeholder="value"
                value={newValue}
                onChange={(e) => setNewValue(slugify(e.target.value))}
              />
            </div>
            {err && <div className="text-[11px] text-rose-700">{err}</div>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setAdding(false); setErr(null); setNewLabel(""); setNewValue(""); }}
                className="text-[11px] px-2 py-1 rounded text-gray-600 hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !newLabel.trim()}
                onClick={saveCustom}
                className="text-[11px] px-2.5 py-1 rounded bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Add subtype"}
              </button>
            </div>
          </div>
        )}
      </div>
    </FieldLabel>
  );
}
