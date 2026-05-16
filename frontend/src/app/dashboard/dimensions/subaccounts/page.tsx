"use client";

/* Subaccounts — postable leaf accounts across the org, presented in the
 * accounting-software style of the Chart of Accounts page (sectioned by
 * account type, dense rows with code/name/subtype/entity/balance, monthly
 * sparkline + delta chip, section totals).
 *
 * Surfaced as a financial dimension on the /dashboard/dimensions hub.
 * Thomas's mental model: "subaccount is also a slicer; treat it like a
 * dimension." The detail edit / add still happens on the CoA page —
 * each row links there so we don't duplicate that surface.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowDown, ArrowUp, ChevronDown, Globe, Layers, Landmark,
  ListTree, Loader2, Scale, Search, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";


interface Account {
  id: number;
  code: string;
  name: string;
  account_type: string;
  account_subtype: string;
  entity: number | null;
  entity_code: string | null;
  is_active: boolean;
  is_system?: boolean;
  posting_allowed: boolean;
  header_flag: boolean;
  currency: string;
}

interface SummaryRow { id: number; balance: string; sparkline: number[]; }
interface SummaryResp { as_of: string; months: string[]; accounts: SummaryRow[]; }
interface ApiResp<T> { results?: T[]; count?: number; }

type TypeKey = "asset" | "liability" | "equity" | "revenue" | "expense";

const TYPES: {
  value: TypeKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  rail: string;
  spark: string;
}[] = [
  { value: "asset",     label: "Assets",      icon: Wallet,       rail: "bg-emerald-500", spark: "#10b981" },
  { value: "liability", label: "Liabilities", icon: Scale,        rail: "bg-rose-500",    spark: "#f43f5e" },
  { value: "equity",    label: "Equity",      icon: Landmark,     rail: "bg-indigo-500",  spark: "#6366f1" },
  { value: "revenue",   label: "Revenue",     icon: TrendingUp,   rail: "bg-sky-500",     spark: "#0ea5e9" },
  { value: "expense",   label: "Expenses",    icon: TrendingDown, rail: "bg-amber-500",   spark: "#f59e0b" },
];


export default function SubaccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<Map<number, SummaryRow>>(new Map());
  const [months, setMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<TypeKey, boolean>>({
    asset: false, liability: false, equity: false, revenue: false, expense: false,
  });

  useEffect(() => {
    setLoading(true); setErr(null);
    Promise.all([
      api.get<ApiResp<Account> | Account[]>("/beakon/accounts/", { is_active: "true", page_size: "1000" })
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => [] as Account[]),
      api.get<SummaryResp>("/beakon/accounts/summary/")
        .catch(() => ({ as_of: "", months: [], accounts: [] } as SummaryResp)),
    ])
      .then(([accs, sum]) => {
        // Subaccount = postable leaf — drives the GL directly. Headers
        // and rollups don't belong here.
        setAccounts(accs.filter((a) => a.posting_allowed && !a.header_flag && a.is_active));
        const m = new Map<number, SummaryRow>();
        for (const r of sum.accounts) m.set(r.id, r);
        setSummary(m);
        setMonths(sum.months || []);
      })
      .catch((e) => setErr(e?.error?.message || e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => accounts.filter((a) => {
    if (!q) return true;
    const hay = `${a.code} ${a.name} ${a.account_subtype} ${a.entity_code || "shared"}`.toLowerCase();
    return hay.includes(q);
  }), [accounts, q]);

  const byType = useMemo(() => {
    const m = new Map<TypeKey, Account[]>();
    TYPES.forEach((t) => m.set(t.value, []));
    for (const a of filtered) {
      const list = m.get(a.account_type as TypeKey);
      if (list) list.push(a);
    }
    for (const arr of m.values()) arr.sort((x, y) => x.code.localeCompare(y.code));
    return m;
  }, [filtered]);

  const sectionTotals = useMemo(() => {
    const m = new Map<TypeKey, number>();
    TYPES.forEach((t) => m.set(t.value, 0));
    for (const a of filtered) {
      const s = summary.get(a.id);
      const bal = Number(s?.balance ?? 0);
      const cur = m.get(a.account_type as TypeKey);
      if (cur != null) m.set(a.account_type as TypeKey, cur + bal);
    }
    return m;
  }, [filtered, summary]);

  const toggleSection = (k: TypeKey) =>
    setCollapsed((p) => ({ ...p, [k]: !p[k] }));

  const visibleTypes = TYPES.filter((t) => (byType.get(t.value)?.length ?? 0) > 0);

  return (
    <div>
      <Link href="/dashboard/dimensions"
            className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Dimensions
      </Link>

      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
            <ListTree className="w-5 h-5 text-emerald-700" /> Subaccounts
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-[640px]">
            Postable leaf accounts across the books — the financial dimension
            that drives the GL. Click a row to view and edit it inside the
            Chart of Accounts.
          </p>
        </div>
        <Link href="/dashboard/accounts"
              className="btn-secondary text-xs inline-flex items-center gap-1">
          <ListTree className="w-3.5 h-3.5" /> Open Chart of Accounts
        </Link>
      </div>

      {/* ── Stat strip ─────────────────────────────────────── */}
      {!loading && !err && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
          <StatCard label="Subaccounts" value={accounts.length.toString()} mono />
          {visibleTypes.map((t) => (
            <StatCard
              key={t.value}
              label={t.label}
              value={(byType.get(t.value)?.length ?? 0).toString()}
              accent={t.rail}
              mono
            />
          ))}
        </div>
      )}

      {/* ── Search ─────────────────────────────────────────── */}
      <div className="relative mb-4 max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code, name, subtype, entity…"
          className="input pl-9 w-full"
        />
      </div>

      {loading ? (
        <div className="card p-8 flex items-center justify-center text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading subaccounts…
        </div>
      ) : err ? (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          {q ? "No subaccounts match that search." : "No subaccounts yet — go to Chart of Accounts to add one."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-[0.12em] border-b border-canvas-100">
                <th className="pl-5 pr-2 py-2.5 w-[110px] font-medium">Code</th>
                <th className="pr-4 py-2.5 font-medium">Account</th>
                <th className="hidden md:table-cell pr-4 py-2.5 font-medium">Subtype</th>
                <th className="hidden lg:table-cell pr-4 py-2.5 font-medium">Entity</th>
                <th className="hidden xl:table-cell pr-4 py-2.5 font-medium">12-mo</th>
                <th className="pr-4 py-2.5 text-right font-medium">Balance</th>
                <th className="pr-3 py-2.5 w-[28px]" />
              </tr>
            </thead>
            {visibleTypes.map((t) => {
              const rows = byType.get(t.value) || [];
              if (rows.length === 0) return null;
              const isOpen = !collapsed[t.value];
              const total = sectionTotals.get(t.value) || 0;
              const Icon = t.icon;

              return (
                <tbody key={t.value} className="border-t border-canvas-100">
                  <tr
                    onClick={() => toggleSection(t.value)}
                    className="group cursor-pointer bg-canvas-50/40 hover:bg-canvas-50 select-none"
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
                          {rows.length} {rows.length === 1 ? "subaccount" : "subaccounts"}
                        </span>
                      </div>
                    </td>
                    <td className="pr-4 py-2.5 text-right">
                      <span className="font-mono text-[13px] font-semibold text-gray-900 tabular-nums">
                        {fmtMoney(total)}
                      </span>
                    </td>
                    <td className="pr-3 py-2.5">
                      <ChevronDown className={cn(
                        "h-4 w-4 text-gray-400 transition-transform",
                        isOpen ? "" : "-rotate-90",
                      )} />
                    </td>
                  </tr>

                  {isOpen && rows.map((a) => {
                    const s = summary.get(a.id);
                    const bal = Number(s?.balance ?? 0);
                    const sp = s?.sparkline || [];
                    return (
                      <tr
                        key={a.id}
                        className="group transition-colors hover:bg-brand-50/30"
                      >
                        <td className="pl-5 pr-2 py-2 font-mono text-[11px] text-gray-500 tabular-nums">
                          {a.code}
                        </td>
                        <td className="pr-4 py-2 min-w-0">
                          <Link
                            href={`/dashboard/accounts?focus=${a.id}`}
                            className="flex items-center gap-2 min-w-0 text-sm text-gray-900 hover:text-brand-700"
                          >
                            <span className="truncate">{a.name}</span>
                            {a.is_system && (
                              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 ring-1 ring-gray-200/60">system</span>
                            )}
                          </Link>
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
                            <span className={cn(
                              "font-mono text-sm tabular-nums",
                              bal === 0 ? "text-gray-300" : "text-gray-900",
                            )}>
                              {fmtMoney(bal)}
                            </span>
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">
                            {a.currency || ""}
                          </div>
                        </td>
                        <td className="pr-3 py-2 text-right">
                          <Link
                            href={`/dashboard/accounts?focus=${a.id}`}
                            className="text-gray-300 group-hover:text-gray-600 transition-colors"
                            title="Open in Chart of Accounts"
                          >
                            <ChevronDown className="-rotate-90 h-4 w-4" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );
}


/* ── Helpers ───────────────────────────────────────────────── */

function fmtMoney(raw: string | number) {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `−${s}` : s;
}

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


function StatCard({
  label, value, accent, mono,
}: { label: string; value: string; accent?: string; mono?: boolean }) {
  return (
    <div className="card relative overflow-hidden px-3 py-2.5">
      {accent && <span className={cn("absolute left-0 top-0 bottom-0 w-0.5", accent)} />}
      <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-medium">{label}</div>
      <div className={cn("text-base text-gray-900 mt-0.5", mono && "font-mono tabular-nums")}>{value}</div>
    </div>
  );
}


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
  const gradId = `sub-spark-${color.replace("#", "")}`;

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
    <div className="relative inline-block">
      <svg
        width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block"
        onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradId})`} />
        <path d={lineD} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lx} cy={ly} r="2" fill={color} />
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
