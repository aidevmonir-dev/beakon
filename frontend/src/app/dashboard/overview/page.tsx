"use client";

/* Dashboard — executive overview.
 *
 * Wired to existing /beakon/reports/* endpoints — same pattern as the
 * Accounting dashboard. Promise.allSettled around every call so partial
 * failures don't blank the page.
 *
 *   /organizations/{id}/                → org name + Beakon Currency
 *   /beakon/entities/                   → Total Entities count
 *   /beakon/bank-accounts/              → Cash by Entity donut (grouped
 *                                         by entity_code, summing
 *                                         posted-only gl_balance)
 *   /beakon/reports/cash-trend/         → Cash Position headline +
 *                                         delta_pct + 12-month line
 *   /beakon/reports/profit-loss/ ×12    → Financial Overview bars
 *   /beakon/bills/?status=pending_approval         ↑
 *   /beakon/invoices/?status=pending_approval      ├─ Open Approvals total
 *   /beakon/journal-entries/?status=pending_approval│  + per-type breakdown
 *   /beakon/trip-claims/?status=submitted          ↓
 *   /beakon/anomalies/                  → Anomalies + Policy Exception
 *                                         count (kind contains "policy"
 *                                         or "stale_approval")
 *   /audit/events/                      → Recent Activity (top 5)
 *
 * Beakon Insights is the one remaining placeholder — no `/insights/`
 * endpoint exists yet, so we render 3 hand-curated narrative items
 * with the same shape the future endpoint will produce. Marked clearly
 * as `// TODO:` so a future PR can swap them.
 *
 * This page replaces the older customizable widget dashboard. The widget
 * components (`components/dashboard/widgets.tsx`) are still on disk for
 * easy revert if Thomas wants the customization story back; nothing
 * here imports them.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Bell, BookOpen, Building2, Calculator,
  CheckCircle2, ClipboardCheck, Coins, Download, FileText, Info, Lightbulb,
  Plane, Plus, Search, Shield, Sparkles, TrendingUp, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtCompactLead } from "@/lib/format";


// ── Types ──────────────────────────────────────────────────────────


interface OrgPayload { id: number; name: string; currency?: string; }

interface EntityRow { id: number; code?: string; name?: string; parent: number | null; }

interface BankAccount {
  id: number;
  name: string;
  bank_name: string;
  entity_code: string;
  entity_name: string;
  currency: string;
  gl_balance: string;
}

interface CashTrendMonth { month: string; balance: string; }
interface CashTrendResp {
  currency: string;
  months: CashTrendMonth[];
  total_now: string;
  delta_pct: number | null;
}

interface ProfitLossResp {
  totals?: { revenue?: string; expenses?: string };
  buckets?: Record<string, { total: string }>;
}

interface BillRow { id: number; status?: string; }
interface InvoiceRow { id: number; status?: string; }
interface ClaimRow { id: number; status?: string; }
interface JERow { id: number; status?: string; }

interface Anomaly {
  id: string;
  kind?: string;
  severity: "high" | "medium" | "low";
  title: string;
  description?: string;
  detected_at?: string;
}
interface AnomaliesResponse {
  as_of: string;
  total: number;
  counts: { high: number; medium: number; low: number };
  anomalies: Anomaly[];
}

interface AuditEvent {
  id: number;
  action: string;
  object_type: string;
  object_repr: string;
  actor_name: string | null;
  created_at: string;
}

type ListResult<T> = { results: T[]; count?: number } | T[];

function asArray<T>(r: ListResult<T> | null | undefined): T[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.results ?? []);
}


// Entity-donut palette — same indigo family as the mockup donut so the
// dashboard reads as a single set of charts even at a glance.
const ENTITY_COLOURS = ["#2563eb", "#60a5fa", "#a5b4fc", "#c7d2fe", "#818cf8", "#6366f1"];


// ── Page ───────────────────────────────────────────────────────────


export default function DashboardPage() {
  const [orgName, setOrgName] = useState("");
  const [orgCurrency, setOrgCurrency] = useState("CHF");

  const [entitiesCount, setEntitiesCount] = useState<number | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[] | null>(null);
  const [cashTrend, setCashTrend] = useState<CashTrendResp | null>(null);
  const [plMonths, setPlMonths] = useState<MonthlyPL[] | null>(null);

  const [billsPending, setBillsPending] = useState<number | null>(null);
  const [invoicesPending, setInvoicesPending] = useState<number | null>(null);
  const [jePending, setJEPending] = useState<number | null>(null);
  const [claimsPending, setClaimsPending] = useState<number | null>(null);

  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    const orgId = typeof window !== "undefined"
      ? localStorage.getItem("organization_id") : null;

    if (orgId) {
      void api.get<OrgPayload>(`/organizations/${orgId}/`).then((org) => {
        setOrgName(org.name || "");
        if (org.currency) setOrgCurrency(org.currency);
      }).catch(() => {});
    }

    // 12 parallel P&L calls for the Financial Overview bars.
    const months = lastNMonthStarts(12);
    const plRequests = months.map((m) => api.get<ProfitLossResp>(
      "/beakon/reports/profit-loss/",
      { date_from: ymd(m.start), date_to: ymd(m.end) },
    ).then(
      (d) => ({ label: m.label, pl: d }),
      () => ({ label: m.label, pl: null as ProfitLossResp | null }),
    ));

    void Promise.allSettled([
      api.get<ListResult<EntityRow>>("/beakon/entities/"),
      api.get<ListResult<BankAccount>>("/beakon/bank-accounts/"),
      api.get<CashTrendResp>("/beakon/reports/cash-trend/", { months: "12" }),
      Promise.all(plRequests),
      api.get<ListResult<BillRow>>("/beakon/bills/", { status: "pending_approval" }),
      api.get<ListResult<InvoiceRow>>("/beakon/invoices/", { status: "pending_approval" }),
      api.get<ListResult<JERow>>("/beakon/journal-entries/", { status: "pending_approval" }),
      api.get<ListResult<ClaimRow>>("/beakon/trip-claims/", { status: "submitted" }),
      api.get<AnomaliesResponse>("/beakon/anomalies/"),
      api.get<ListResult<AuditEvent>>("/audit/events/"),
    ]).then(([ent, ba, ct, plArr, bill, inv, je, clm, anm, aud]) => {
      if (ent.status === "fulfilled") setEntitiesCount(asArray(ent.value).length);
      if (ba.status === "fulfilled") setBankAccounts(asArray(ba.value));
      if (ct.status === "fulfilled") setCashTrend(ct.value);
      if (plArr.status === "fulfilled") {
        setPlMonths(plArr.value.map((p) => ({
          label: p.label,
          revenue:  parseRevenueExpense(p.pl, "revenue"),
          expenses: parseRevenueExpense(p.pl, "expenses"),
        })));
      } else setPlMonths([]);
      if (bill.status === "fulfilled") setBillsPending(asArray(bill.value).length);
      if (inv.status === "fulfilled") setInvoicesPending(asArray(inv.value).length);
      if (je.status === "fulfilled") setJEPending(asArray(je.value).length);
      if (clm.status === "fulfilled") setClaimsPending(asArray(clm.value).length);
      if (anm.status === "fulfilled") setAnomalies(anm.value?.anomalies ?? []);
      else setAnomalies([]);
      if (aud.status === "fulfilled") setAuditEvents(asArray(aud.value).slice(0, 5));
      else setAuditEvents([]);
    });
  }, []);

  // ── Derived state ────────────────────────────────────────────────

  const cashCurrency = cashTrend?.currency || orgCurrency;
  const netCash = num(cashTrend?.total_now);
  const cashDeltaPct = cashTrend?.delta_pct ?? null;

  const openApprovals =
    (billsPending ?? 0) + (invoicesPending ?? 0) +
    (jePending ?? 0) + (claimsPending ?? 0);

  const cashByEntity = useMemo<EntitySegment[]>(
    () => groupBankAccountsByEntity(bankAccounts ?? []),
    [bankAccounts],
  );

  // Policy exceptions = anomalies whose kind tags policy violation /
  // stale approvals. Matches what AnomalyService surfaces today
  // ("policy_breach", "stale_approval"); broader matching keeps us
  // forward-compatible.
  const policyExceptionCount = (anomalies ?? []).filter((a) => {
    const k = (a.kind ?? "").toLowerCase();
    return k.includes("policy") || k.includes("stale");
  }).length;

  return (
    <div className="px-1 py-2 sm:px-2 sm:py-4">
      <div className="mx-auto w-full max-w-7xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              A clear view of your organization&apos;s financial and operational performance.
              {orgName && <span className="text-gray-400"> · {orgName}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 hover:text-gray-900 transition"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <Link
              href="/dashboard/journal-entries"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create
            </Link>
          </div>
        </div>

        {/* ── Search / Ask bar ───────────────────────────────────── */}
        <div className="mt-6 relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search entities, reports, approvals or ask getBeakon…"
            className="w-full rounded-xl border border-canvas-200 bg-white py-3 pl-10 pr-12 text-[13.5px] text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-violet-50 text-violet-700 ring-1 ring-violet-100">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>

        {/* ── Stats row ──────────────────────────────────────────── */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Entities" sub="Active entities"
            value={entitiesCount === null ? "—" : String(entitiesCount)}
            icon={Building2} accent="brand" />
          <StatCard label="Cash Position"
            sub={cashDeltaPct === null
              ? <span className="text-gray-500">vs last month</span>
              : <TrendDelta pct={cashDeltaPct} />}
            value={cashTrend === null
              ? "—"
              : fmtCompactLead(netCash, cashCurrency)}
            icon={Coins} accent="mint" />
          <StatCard label="Open Approvals"
            sub="Requires your attention"
            value={billsPending === null && invoicesPending === null
              && jePending === null && claimsPending === null
              ? "—"
              : String(openApprovals)}
            icon={ClipboardCheck} accent="amber" />
          <StatCard label="AI Insights" sub="Curated narratives"
            value={String(PLACEHOLDER_INSIGHTS.length)}
            icon={Sparkles} accent="violet" />
        </ul>

        {/* ── Row 1 ──────────────────────────────────────────────── */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FinancialOverviewCard
            plMonths={plMonths}
            cashSeries={cashTrend?.months ?? null}
            currency={cashCurrency}
            loading={plMonths === null || cashTrend === null} />
          <CashByEntityCard segments={cashByEntity}
            total={netCash}
            currency={cashCurrency}
            loading={bankAccounts === null} />
          <ApprovalsCard
            travelClaims={claimsPending}
            supplierInvoices={billsPending}
            policyExceptions={anomalies === null ? null : policyExceptionCount}
            employmentApprovals={null /* TODO: dedicated employment approvals endpoint */} />
        </div>

        {/* ── Row 2 ──────────────────────────────────────────────── */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <AnomaliesCard items={anomalies ?? []}
            loading={anomalies === null} />
          <RecentActivityCard items={auditEvents ?? []}
            loading={auditEvents === null} />
          <BeakonInsightsCard items={PLACEHOLDER_INSIGHTS} />
        </div>
      </div>
    </div>
  );
}


// ── Stat card ──────────────────────────────────────────────────────


type Accent = "brand" | "mint" | "amber" | "violet";


function StatCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  accent: Accent;
}) {
  const tone =
    accent === "brand"  ? { well: "bg-brand-50 text-brand-700",   ring: "ring-brand-100" } :
    accent === "mint"   ? { well: "bg-mint-50 text-mint-700",     ring: "ring-mint-100" } :
    accent === "amber"  ? { well: "bg-amber-50 text-amber-700",   ring: "ring-amber-100" } :
                          { well: "bg-violet-50 text-violet-700", ring: "ring-violet-100" };

  return (
    <li className={cn(
      "rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5 ring-1",
      tone.ring,
    )}>
      <div className="flex items-start gap-3">
        <span className={cn(
          "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          tone.well,
        )}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-gray-500 truncate">{label}</div>
          <div className="text-[24px] font-semibold text-gray-900 leading-tight tabular-nums mt-0.5">
            {value}
          </div>
          <div className="mt-0.5 text-[11.5px] text-gray-500">
            {sub}
          </div>
        </div>
      </div>
    </li>
  );
}


function TrendDelta({ pct }: { pct: number }) {
  const positive = pct >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[11.5px] font-medium",
      positive ? "text-mint-700" : "text-rose-700",
    )}>
      <TrendingUp className={cn("h-3 w-3", !positive && "rotate-180")} />
      {Math.abs(pct * 100).toFixed(1)}% vs last month
    </span>
  );
}


// ── Card wrapper ──────────────────────────────────────────────────


function Card({
  title, action, accent = "neutral", icon: Icon, children, footer,
}: {
  title: string;
  action?: React.ReactNode;
  accent?: "neutral" | "rose" | "mint" | "violet";
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const iconTone =
    accent === "rose"   ? "text-rose-600" :
    accent === "mint"   ? "text-mint-600" :
    accent === "violet" ? "text-violet-600" :
                          "text-gray-500";
  return (
    <section className="flex flex-col rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14.5px] font-semibold text-gray-900">
          {Icon && <Icon className={cn("h-4 w-4", iconTone)} />}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4 flex-1">{children}</div>
      {footer && (
        <div className="mt-4 pt-3 border-t border-canvas-100">
          {footer}
        </div>
      )}
    </section>
  );
}


function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="h-7 rounded-md bg-canvas-100/80 animate-pulse" />
      ))}
    </ul>
  );
}


// ── Financial Overview (bars + line) ──────────────────────────────


interface MonthlyPL { label: string; revenue: number; expenses: number; }


function FinancialOverviewCard({
  plMonths, cashSeries, currency, loading,
}: {
  plMonths: MonthlyPL[] | null;
  cashSeries: CashTrendMonth[] | null;
  currency: string;
  loading: boolean;
}) {
  const cashByMonth = useMemo(() => {
    if (!cashSeries) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const c of cashSeries) m.set(c.month.slice(0, 7), num(c.balance));
    return m;
  }, [cashSeries]);

  // Align cash-trend balances onto the P&L month set so both series
  // share a single x-axis.
  const series = useMemo(() => {
    if (!plMonths) return [] as ChartMonth[];
    return plMonths.map((p) => ({
      label:    p.label,
      revenue:  p.revenue,
      expense:  p.expenses,
      balance:  cashByMonth.get(p.label.slice(0, 0)) ?? 0, // placeholder
    }));
  }, [plMonths, cashByMonth]);

  // The cashByMonth keys are YYYY-MM. The plMonths labels are like
  // "Jun '24" — we need a YYYY-MM key to look up. Rebuild here using
  // the underlying month index since both lists are aligned by month
  // (lastNMonthStarts walks the trailing 12 months oldest-first).
  const alignedSeries = useMemo(() => {
    if (!plMonths) return [] as ChartMonth[];
    const monthStarts = lastNMonthStarts(plMonths.length);
    return plMonths.map((p, i) => {
      const ms = monthStarts[i].start;
      const key = `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, "0")}`;
      return {
        label:   p.label,
        revenue: p.revenue,
        expense: p.expenses,
        balance: cashByMonth.get(key) ?? 0,
      };
    });
  }, [plMonths, cashByMonth]);

  // Use alignedSeries (cashByMonth-driven). The earlier `series` is
  // intentionally kept to keep the diff small for the chart builder.
  void series;

  const hasData = alignedSeries.some(
    (m) => m.revenue > 0 || m.expense > 0 || m.balance !== 0,
  );

  return (
    <Card
      title="Financial Overview"
      icon={(props) => <Info {...props} />}
      action={
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11.5px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 transition"
        >
          Last 12 months
          <ArrowRight className="h-3 w-3 -rotate-90 opacity-70" />
        </button>
      }
    >
      <div className="flex items-center gap-4 text-[11.5px] text-gray-600">
        <LegendChip swatch="bg-brand-600" label="Revenue" />
        <LegendChip swatch="bg-brand-200" label="Expense" />
        <LegendChip swatch="bg-mint-500" label="Cash Balance" line />
      </div>
      {loading ? (
        <div className="mt-3 h-44 rounded-lg bg-canvas-100/60 animate-pulse" />
      ) : !hasData ? (
        <EmptyHint text="No posted revenue, expenses or cash movement yet." />
      ) : (
        <BarLineChart series={alignedSeries} />
      )}
      <p className="text-[10.5px] text-gray-400 mt-1">{currency} · last 12 months</p>
    </Card>
  );
}


interface ChartMonth { label: string; revenue: number; expense: number; balance: number; }


function LegendChip({ swatch, label, line }: { swatch: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(
        line ? "h-0.5 w-3" : "h-2.5 w-2.5 rounded-sm",
        swatch,
      )} aria-hidden />
      {label}
    </span>
  );
}


function BarLineChart({ series }: { series: ChartMonth[] }) {
  const W = 480; const H = 200;
  const PADL = 38; const PADB = 22; const PADT = 12; const PADR = 8;
  const chartW = W - PADL - PADR; const chartH = H - PADT - PADB;
  const max = Math.max(...series.flatMap((s) => [s.revenue, s.expense, s.balance]), 1);
  const yMax = niceCeil(max);
  const groupW = chartW / series.length;
  const barW = groupW * 0.28;
  const yScale = (v: number) => PADT + chartH - (v / yMax) * chartH;

  const ticks = niceTicks(yMax, 4);
  const fmtTick = (v: number) => v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : `${v}`;

  const linePts = series.map((s, i) => {
    const cx = PADL + groupW * (i + 0.5);
    const cy = yScale(s.balance);
    return `${cx},${cy}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full h-44">
      {ticks.map((t) => {
        const y = yScale(t);
        return (
          <g key={t}>
            <line x1={PADL} x2={W - PADR} y1={y} y2={y}
              stroke="#e5e7eb" strokeWidth="0.6" />
            <text x={PADL - 6} y={y + 3} textAnchor="end"
              className="fill-gray-400" fontSize="9">{fmtTick(t)}</text>
          </g>
        );
      })}
      {series.map((s, i) => {
        const groupX = PADL + groupW * i;
        const revX = groupX + groupW / 2 - barW - 1.5;
        const expX = groupX + groupW / 2 + 1.5;
        const revH = (s.revenue / yMax) * chartH;
        const expH = (s.expense / yMax) * chartH;
        return (
          <g key={s.label}>
            <rect x={revX} y={yScale(s.revenue)} width={barW} height={revH}
              fill="#2563eb" rx="2" />
            <rect x={expX} y={yScale(s.expense)} width={barW} height={expH}
              fill="#bfdbfe" rx="2" />
            <text x={groupX + groupW / 2} y={H - 6} textAnchor="middle"
              className="fill-gray-500" fontSize="9">{s.label}</text>
          </g>
        );
      })}
      <polyline points={linePts} fill="none" stroke="#10b981"
        strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((s, i) => {
        const cx = PADL + groupW * (i + 0.5);
        const cy = yScale(s.balance);
        return (
          <circle key={s.label} cx={cx} cy={cy} r="2.4" fill="#10b981" />
        );
      })}
    </svg>
  );
}


// ── Cash by Entity (donut) ────────────────────────────────────────


interface EntitySegment { label: string; amount: number; pct: number; color: string; }


function groupBankAccountsByEntity(accounts: BankAccount[]): EntitySegment[] {
  const groups = new Map<string, number>();
  for (const a of accounts) {
    const key = a.entity_name?.trim() || a.entity_code || "Unallocated";
    const bal = num(a.gl_balance);
    groups.set(key, (groups.get(key) ?? 0) + bal);
  }
  const entries = Array.from(groups.entries()).filter(([, v]) => v > 1);
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0);

  // Top 4 individually + everything else collapsed to "Other entities".
  const top = entries.slice(0, 4);
  const other = entries.slice(4).reduce((a, [, v]) => a + v, 0);
  if (other > 0) top.push(["Other entities", other]);

  return top.map(([label, amount], i) => ({
    label, amount,
    pct: total > 0 ? (amount / total) * 100 : 0,
    color: ENTITY_COLOURS[i % ENTITY_COLOURS.length],
  }));
}


function CashByEntityCard({
  segments, total, currency, loading,
}: {
  segments: EntitySegment[]; total: number; currency: string; loading: boolean;
}) {
  return (
    <Card
      title="Cash by Entity"
      footer={
        <Link href="/dashboard/entities" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all entities
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={4} />
      ) : segments.length === 0 ? (
        <EmptyHint text="No bank balances on any entity yet." />
      ) : (
        <div className="flex items-center gap-4">
          <Donut segments={segments}
            total={fmtCompactLead(total, currency)}
            subtitle="Total Cash" />
          <ul className="flex-1 space-y-2">
            {segments.map((s) => (
              <li key={s.label} className="flex items-start gap-2">
                <span className="mt-1 inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ background: s.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-medium text-gray-900 truncate">{s.label}</div>
                  <div className="text-[10.5px] text-gray-500">
                    {fmtCompactLead(s.amount, currency)} ({s.pct.toFixed(1)}%)
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}


function Donut({
  segments, total, subtitle,
}: {
  segments: { pct: number; color: string; label: string }[];
  total: string;
  subtitle: string;
}) {
  const size = 132; const stroke = 18; const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = segments.reduce((a, s) => a + s.pct, 0) || 1;

  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        {segments.map((s) => {
          const len = (s.pct / sum) * c;
          const dasharray = `${len} ${c - len}`;
          const dashoffset = -offset;
          offset += len;
          return (
            <circle
              key={s.label}
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={dasharray} strokeDashoffset={dashoffset}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-[14px] font-semibold text-gray-900 leading-tight tabular-nums">{total}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}


// ── Approvals Awaiting Action ─────────────────────────────────────


function ApprovalsCard({
  travelClaims, supplierInvoices, employmentApprovals, policyExceptions,
}: {
  travelClaims: number | null;
  supplierInvoices: number | null;
  employmentApprovals: number | null;
  policyExceptions: number | null;
}) {
  const rows = [
    { label: "Travel Claims",         icon: Plane,           count: travelClaims,
      tone: "bg-brand-50 text-brand-700",   href: "/dashboard/travel" },
    { label: "Supplier Invoices",     icon: FileText,        count: supplierInvoices,
      tone: "bg-indigo-50 text-indigo-700", href: "/dashboard/bills" },
    { label: "Employment Approvals",  icon: Users,           count: employmentApprovals,
      tone: "bg-amber-50 text-amber-700",   href: "/dashboard/employment" },
    { label: "Policy Exceptions",     icon: Shield,          count: policyExceptions,
      tone: "bg-rose-50 text-rose-700",     href: "/dashboard/anomalies" },
  ];
  return (
    <Card
      title="Approvals Awaiting Action"
      footer={
        <Link href="/dashboard/approvals" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all approvals
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      <ul className="divide-y divide-canvas-100">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.label}>
              <Link href={r.href}
                className="group flex items-center gap-3 py-2.5 hover:bg-canvas-50/60 -mx-2 px-2 rounded-md transition-colors">
                <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  r.tone)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 text-[12.5px] font-medium text-gray-900 truncate">{r.label}</span>
                <span className="text-[13px] font-semibold text-gray-900 tabular-nums">
                  {r.count ?? "—"}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}


// ── Anomalies & Alerts ────────────────────────────────────────────


function AnomaliesCard({ items, loading }: { items: Anomaly[]; loading: boolean }) {
  const top = items.slice(0, 4);
  return (
    <Card title="Anomalies & Alerts" icon={Bell} accent="rose"
      footer={
        <Link href="/dashboard/anomalies" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all alerts
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={4} />
      ) : top.length === 0 ? (
        <EmptyHint text="No anomalies detected." />
      ) : (
        <ul className="divide-y divide-canvas-100">
          {top.map((a) => (
            <li key={a.id}>
              <Link href="/dashboard/anomalies"
                className="group flex items-start gap-3 py-2.5 hover:bg-canvas-50/60 -mx-2 px-2 rounded-md transition-colors">
                <SeverityDot severity={a.severity} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-gray-900 leading-snug">
                    {a.title}
                  </div>
                  {a.description && (
                    <div className="text-[11px] text-gray-500 truncate mt-0.5">
                      {a.description}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">
                  {timeAgo(a.detected_at)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


function SeverityDot({ severity }: { severity: Anomaly["severity"] }) {
  const tone =
    severity === "high"   ? "bg-rose-100 text-rose-700" :
    severity === "medium" ? "bg-amber-100 text-amber-700" :
                            "bg-blue-100 text-blue-700";
  const Icon = severity === "low" ? Info : AlertTriangle;
  return (
    <span className={cn(
      "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
      tone,
    )}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}


// ── Recent Activity ───────────────────────────────────────────────


function RecentActivityCard({ items, loading }: { items: AuditEvent[]; loading: boolean }) {
  return (
    <Card title="Recent Activity" icon={CheckCircle2} accent="mint"
      footer={
        <Link href="/dashboard/audit" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all activity
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyHint text="No recent activity to show." />
      ) : (
        <ul className="divide-y divide-canvas-100">
          {items.slice(0, 4).map((e) => (
            <li key={e.id} className="group flex items-start gap-3 py-2.5 -mx-2 px-2">
              <ActivityIcon kind={e.object_type} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-gray-900 leading-snug truncate">
                  {humanizeAction(e.action, e.object_type, e.object_repr)}
                </div>
                {e.actor_name && (
                  <div className="text-[11px] text-gray-500 mt-0.5">{e.actor_name}</div>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-gray-400">
                {timeAgo(e.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


function ActivityIcon({ kind }: { kind: string }) {
  const k = kind.toLowerCase();
  const Icon =
    k.includes("travel") || k.includes("trip") ? Plane :
    k.includes("invoice")                       ? FileText :
    k.includes("bill")                          ? Calculator :
    k.includes("entity")                        ? Building2 :
    k.includes("policy")                        ? Shield :
    k.includes("journal")                       ? BookOpen :
    k.includes("employ")                        ? Users :
                                                  CheckCircle2;
  return (
    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-canvas-100 text-gray-600">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}


function humanizeAction(action: string, objectType: string, objectRepr: string): string {
  const verb = action.toLowerCase().replace(/_/g, " ");
  const noun = objectType.toLowerCase().replace(/_/g, " ");
  return `${capitalize(noun)} ${objectRepr} ${verb}`.trim();
}


function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}


// ── Beakon Insights ───────────────────────────────────────────────


interface Insight {
  key: string;
  title: string;
  body: string;
  tone: "mint" | "indigo" | "violet";
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}


// TODO: wire to a future /beakon/insights/ endpoint. The shape below
// matches what that endpoint is expected to emit (key, narrative title,
// supporting body, tone, suggested icon, deep-link href).
const PLACEHOLDER_INSIGHTS: Insight[] = [
  { key: "cash-flow",
    title: "Operating cash flow improved 12% this month",
    body: "Strong collection performance across 3 entities.",
    tone: "mint", icon: TrendingUp, href: "/dashboard/reports" },
  { key: "travel",
    title: "Travel expenses are 18% higher than last month",
    body: "Consider reviewing flights and hotel spend.",
    tone: "indigo", icon: Plane, href: "/dashboard/travel" },
  { key: "idle-cash",
    title: "2 entities have idle cash above 2M",
    body: "Explore short-term investment opportunities.",
    tone: "violet", icon: Lightbulb, href: "/dashboard/wealth" },
];


function BeakonInsightsCard({ items }: { items: Insight[] }) {
  return (
    <Card title="Beakon Insights" icon={Sparkles} accent="violet"
      footer={
        <Link href="/dashboard/overview" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all insights
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      <ul className="space-y-3">
        {items.map((i) => {
          const Icon = i.icon;
          const tone =
            i.tone === "mint"   ? "bg-mint-50 text-mint-700" :
            i.tone === "indigo" ? "bg-indigo-50 text-indigo-700" :
                                  "bg-violet-50 text-violet-700";
          return (
            <li key={i.key}>
              <Link href={i.href}
                className="group flex items-start gap-3 -mx-2 px-2 py-1.5 rounded-md hover:bg-canvas-50/60 transition">
                <span className={cn("mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md", tone)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-gray-900 leading-snug">{i.title}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{i.body}</div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}


// ── helpers ───────────────────────────────────────────────────────


function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-24 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500 px-4 text-center">
      {text}
    </div>
  );
}


function num(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  const n = typeof s === "number" ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
}


function parseRevenueExpense(pl: ProfitLossResp | null, kind: "revenue" | "expenses"): number {
  if (!pl) return 0;
  if (pl.totals?.[kind]) return num(pl.totals[kind]);
  if (pl.buckets) {
    if (kind === "revenue") {
      return num(pl.buckets.revenue?.total) + num(pl.buckets.other_income?.total);
    }
    return num(pl.buckets.cogs?.total)
      + num(pl.buckets.operating_expenses?.total)
      + num(pl.buckets.other_expenses?.total);
  }
  return 0;
}


function lastNMonthStarts(n: number): { label: string; start: Date; end: Date }[] {
  const out: { label: string; start: Date; end: Date }[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const end = new Date(next.getTime() - 86_400_000);
    const label = d.toLocaleDateString(undefined, { month: "short" })
      + (d.getMonth() === 0 || i === n - 1
          ? ` '${String(d.getFullYear()).slice(2)}`
          : "");
    out.push({ label, start: d, end });
  }
  return out;
}


function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * pow;
}


function niceTicks(yMax: number, count: number): number[] {
  const step = yMax / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
}


function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60)      return `${s}s ago`;
  if (s < 3600)   return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
