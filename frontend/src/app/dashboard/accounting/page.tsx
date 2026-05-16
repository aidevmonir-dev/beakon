"use client";

/* Accounting — module dashboard.
 *
 * Wired to the existing /beakon/reports/* endpoints — no new backend
 * code, all aggregation reuses what already exists for the standalone
 * report pages. Endpoints called in parallel via Promise.allSettled so a
 * single failure keeps the rest of the dashboard alive.
 *
 *   /beakon/bank-accounts/            → Bank Accounts count + Cash-by-Bank
 *   /beakon/reports/cash-trend/       → Net Cash Position + 12-month
 *                                       cash-balance line
 *   /beakon/reports/profit-loss/      → 12 calls in parallel for monthly
 *                                       Revenue + Expense series
 *   /beakon/reports/ap-aging/         → Open Payables headline + buckets
 *   /beakon/reports/ar-aging/         → Open Receivables headline + buckets
 *   /beakon/reports/journal-listing/  → Recent Transactions (top 5 posted)
 *   /beakon/periods/                  → Period Status (current open period)
 *   /beakon/entities/                 → Top Dimensions: entity count
 *   /beakon/employees/                → Top Dimensions: employee count
 *   /beakon/dimension-types/          → Top Dimensions: project + department
 *
 * Layout follows Thomas's 2026-05-11 Accounting mockup:
 *
 *   Header • Search • View scope • Tab nav • 4 KPI cards
 *   Row 1: Financial Overview (span 2) + Cash by Bank + Period Status
 *   Row 2: Recent Transactions (span 2) + AP/AR Snapshot + Accounting Tasks
 *   Row 3: Top Dimensions strip
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Briefcase, Building2, CheckCircle2, ChevronDown, ClipboardList,
  Download, FileOutput, FileText, Info, Landmark, NotebookPen, Plus, Receipt,
  Search, Sparkles, Tags, TrendingUp, Users, Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtCompactLead, fmt2 } from "@/lib/format";


// ── Types ──────────────────────────────────────────────────────────


interface OrgPayload { id: number; name: string; currency?: string; }

interface BankAccount {
  id: number; name: string; bank_name: string; entity_code: string;
  currency: string; gl_balance: string;
}

interface CashTrendMonth { month: string; balance: string; }
interface CashTrendResp {
  currency: string;
  months: CashTrendMonth[];
  total_now: string;
  delta_pct: number | null;
}

interface ProfitLossResp {
  /* Real shape is richer; we only need the totals. */
  totals?: { revenue?: string; expenses?: string };
  buckets?: Record<string, { total: string }>;
}

interface AgingResp {
  reporting_currency: string;
  totals: Record<string, string>;
  grand_total: string;
  party_count: number;
  document_count: number;
}

interface JEEntry {
  id: number;
  entry_number: string;
  entity_code: string;
  entity_name: string;
  date: string;
  status: string;
  source_type: string;
  source_ref: string | null;
  memo: string;
  currency: string;
  total: string;
}
interface JournalListingResp { entries: JEEntry[]; }

interface PeriodRow {
  id: number; entity_code: string; name: string;
  status: string; start_date: string; end_date: string;
  closed_at: string | null;
}

interface DimensionType {
  id: number; code: string; name: string; active_flag: boolean;
  value_count: number;
}

interface EntityRow { id: number; is_active?: boolean; }
interface EmployeeRow { id: number; }

type ListResult<T> = { results: T[]; count?: number } | T[];

function asArray<T>(r: ListResult<T> | null | undefined): T[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.results ?? []);
}


// ── Tabs ───────────────────────────────────────────────────────────


interface Tab { name: string; href: string; }

const TABS: Tab[] = [
  { name: "Overview",          href: "/dashboard/accounting" },
  { name: "Chart of Accounts", href: "/dashboard/accounts" },
  { name: "Bank Accounts",     href: "/dashboard/bank" },
  { name: "Transactions",      href: "/dashboard/journal-entries" },
  { name: "AP",                href: "/dashboard/bills" },
  { name: "Vendors",           href: "/dashboard/vendors" },
  { name: "AR",                href: "/dashboard/invoices" },
  { name: "Customers",         href: "/dashboard/customers" },
  { name: "Journal Entries",   href: "/dashboard/journal-entries" },
  { name: "Ledger",            href: "/dashboard/ledger" },
  { name: "Dimensions",        href: "/dashboard/dimensions" },
  { name: "Tax / VAT",         href: "/dashboard/tax-codes" },
  { name: "Learning Rules",    href: "/dashboard/learning-rules" },
  { name: "Reports",           href: "/dashboard/reports" },
];


// Donut colour rotation used by Cash by Bank when an institution doesn't
// have a built-in mapping. Picks are aligned with the rest of the
// dashboard palette so the colour scheme stays consistent.
const BANK_COLOURS = ["#2563eb", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#0ea5e9", "#22c55e"];


// ── Page ───────────────────────────────────────────────────────────


export default function AccountingDashboardPage() {
  const [orgCurrency, setOrgCurrency] = useState("CHF");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[] | null>(null);
  const [cashTrend, setCashTrend] = useState<CashTrendResp | null>(null);
  const [plMonths, setPlMonths] = useState<MonthlyPL[] | null>(null);
  const [apAging, setApAging] = useState<AgingResp | null>(null);
  const [arAging, setArAging] = useState<AgingResp | null>(null);
  const [recentEntries, setRecentEntries] = useState<JEEntry[] | null>(null);
  const [periods, setPeriods] = useState<PeriodRow[] | null>(null);
  const [entities, setEntities] = useState<EntityRow[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [dimensionTypes, setDimensionTypes] = useState<DimensionType[] | null>(null);

  useEffect(() => {
    const orgId = typeof window !== "undefined"
      ? localStorage.getItem("organization_id") : null;
    if (orgId) {
      void api.get<OrgPayload>(`/organizations/${orgId}/`).then((org) => {
        if (org.currency) setOrgCurrency(org.currency);
      }).catch(() => {});
    }

    // Twelve month starts (first day of each of the trailing 12 months,
    // earliest first). Used to fetch a P&L per month for the Financial
    // Overview chart.
    const months = lastNMonthStarts(12);
    const plRequests = months.map((m) => {
      const dateFrom = ymd(m.start);
      const dateTo   = ymd(m.end);
      return api.get<ProfitLossResp>("/beakon/reports/profit-loss/", {
        date_from: dateFrom, date_to: dateTo,
      }).then((d) => ({ label: m.label, pl: d }))
        .catch(() => ({ label: m.label, pl: null as ProfitLossResp | null }));
    });

    void Promise.allSettled([
      api.get<ListResult<BankAccount>>("/beakon/bank-accounts/"),
      api.get<CashTrendResp>("/beakon/reports/cash-trend/", { months: "12" }),
      Promise.all(plRequests),
      api.get<AgingResp>("/beakon/reports/ap-aging/"),
      api.get<AgingResp>("/beakon/reports/ar-aging/"),
      api.get<JournalListingResp>("/beakon/reports/journal-listing/", {
        status: "posted", limit: "5",
      }),
      api.get<ListResult<PeriodRow>>("/beakon/periods/"),
      api.get<ListResult<EntityRow>>("/beakon/entities/"),
      api.get<ListResult<EmployeeRow>>("/beakon/employees/"),
      api.get<ListResult<DimensionType>>("/beakon/dimension-types/"),
    ]).then(([
      ba, ct, plArr, ap, ar, jl, prd, ent, emp, dim,
    ]) => {
      if (ba.status === "fulfilled") setBankAccounts(asArray(ba.value));
      if (ct.status === "fulfilled") setCashTrend(ct.value);
      if (plArr.status === "fulfilled") {
        setPlMonths(plArr.value.map((p) => ({
          label: p.label,
          revenue: parseRevenueExpense(p.pl, "revenue"),
          expenses: parseRevenueExpense(p.pl, "expenses"),
        })));
      } else {
        setPlMonths([]);
      }
      if (ap.status === "fulfilled") setApAging(ap.value);
      if (ar.status === "fulfilled") setArAging(ar.value);
      if (jl.status === "fulfilled") setRecentEntries(jl.value?.entries ?? []);
      else setRecentEntries([]);
      if (prd.status === "fulfilled") setPeriods(asArray(prd.value));
      if (ent.status === "fulfilled") setEntities(asArray(ent.value));
      if (emp.status === "fulfilled") setEmployees(asArray(emp.value));
      if (dim.status === "fulfilled") setDimensionTypes(asArray(dim.value));
    });
  }, []);

  // ── Derived state ────────────────────────────────────────────────

  // Currency for headlines: prefer the cash-trend currency (the bank
  // accounts' dominant ccy) over the org's Beakon Currency, since cash
  // amounts are always reported in their own currency.
  const cashCurrency = cashTrend?.currency || orgCurrency;
  const reportingCurrency = apAging?.reporting_currency
    || arAging?.reporting_currency
    || orgCurrency;

  const cashByBank = useMemo<BankSegment[]>(
    () => groupBankAccountsByInstitution(bankAccounts ?? []),
    [bankAccounts],
  );
  const cashByBankTotal = cashByBank.reduce((a, s) => a + s.amount, 0);

  const apOpenTotal = num(apAging?.grand_total);
  const arOpenTotal = num(arAging?.grand_total);
  const apOpenCount = apAging?.document_count ?? null;
  const arOpenCount = arAging?.document_count ?? null;

  const netCash = num(cashTrend?.total_now);

  const apBuckets = collapseAgingBuckets(apAging);
  const arBuckets = collapseAgingBuckets(arAging);

  const projectType = dimensionTypes?.find((d) => isProjectCode(d.code));
  const deptType    = dimensionTypes?.find((d) => isDeptCode(d.code));

  // Current open period: prefer status=open with the most recent end_date.
  const currentPeriod = useMemo<PeriodRow | null>(() => {
    if (!periods || periods.length === 0) return null;
    const open = periods.filter((p) => p.status === "open");
    const pool = open.length ? open : periods;
    return pool.slice().sort(
      (a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime(),
    )[0];
  }, [periods]);

  return (
    <div className="px-1 py-2 sm:px-2 sm:py-4">
      <div className="mx-auto w-full max-w-7xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
              Accounting
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage financial operations, ledgers, payables, receivables and reporting across your organization.
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
            <CreateMenu />
          </div>
        </div>

        {/* ── Search / Ask bar ───────────────────────────────────── */}
        <div className="mt-6 relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search accounts, transactions, suppliers or ask getBeakon…"
            className="w-full rounded-xl border border-canvas-200 bg-white py-3 pl-10 pr-12 text-[13.5px] text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          {/* Thomas §5.5: shift the AI sparkle from violet to Beakon teal —
              the AI cue should feel brand-aligned, not generic-AI purple. */}
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-mint-50 text-mint-700 ring-1 ring-mint-100">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>

        {/* ── View scope row ─────────────────────────────────────── */}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 transition"
          >
            <span className="text-gray-500">View:</span>
            <span className="text-brand-700">Full Structure</span>
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          </button>
          <p className="text-[11.5px] text-gray-500">
            You are viewing the full structure. Select an entity to focus this page.
          </p>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────── */}
        <Tabs />

        {/* ── Stats row ──────────────────────────────────────────── */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Thomas §5.9: metric card colours by MEANING, not aesthetics.
              Bank=blue, Payables=amber, Receivables=teal, Net Cash=navy.
              Violet reserved for AI/insights — no longer used here. */}
          <StatCard label="Bank Accounts" sub="Across all entities"
            value={bankAccounts === null ? "—" : String(bankAccounts.length)}
            icon={Landmark} accent="blue" />
          <StatCard label="Open Payables"
            sub={apOpenCount === null ? "—" : `${apOpenCount} outstanding bill${apOpenCount === 1 ? "" : "s"}`}
            value={apAging === null ? "—" : fmtCompactLead(apOpenTotal, reportingCurrency)}
            icon={Receipt} accent="amber" />
          <StatCard label="Open Receivables"
            sub={arOpenCount === null ? "—" : `${arOpenCount} unpaid invoice${arOpenCount === 1 ? "" : "s"}`}
            value={arAging === null ? "—" : fmtCompactLead(arOpenTotal, reportingCurrency)}
            icon={FileText} accent="mint" />
          <StatCard label="Net Cash Position" sub="Across selected entities"
            value={cashTrend === null ? "—" : fmtCompactLead(netCash, cashCurrency)}
            icon={TrendingUp} accent="brand" />
        </ul>

        {/* ── Row 1 ──────────────────────────────────────────────── */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <FinancialOverviewCard months={plMonths} loading={plMonths === null}
              currency={reportingCurrency} />
          </div>
          <CashByBankCard segments={cashByBank}
            total={cashByBankTotal}
            currency={cashCurrency}
            loading={bankAccounts === null} />
          <PeriodStatusCard
            current={currentPeriod}
            lastClosed={periods?.find((p) => p.status === "closed") ?? null}
            loading={periods === null} />
        </div>

        {/* ── Row 2 ──────────────────────────────────────────────── */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <RecentTransactionsCard
              entries={recentEntries ?? []}
              loading={recentEntries === null} />
          </div>
          <AgingSnapshotCard
            payables={apBuckets}
            receivables={arBuckets}
            apTotal={apOpenTotal}
            arTotal={arOpenTotal}
            currency={reportingCurrency}
            loading={apAging === null || arAging === null} />
          <AccountingTasksCard
            apCount={apOpenCount}
            arCount={arOpenCount}
            pendingApprovals={null /* covered by /dashboard/approvals */} />
        </div>

        {/* ── Row 3: Top Dimensions ──────────────────────────────── */}
        <TopDimensionsRow
          entities={entities === null ? null : entities.filter((e) => e.is_active !== false).length}
          employees={employees === null ? null : employees.length}
          projects={projectType?.value_count ?? null}
          departments={deptType?.value_count ?? null}
        />
      </div>
    </div>
  );
}


// ── Create dropdown ──────────────────────────────────────────────
// Replaces the single "New Entry" button per Thomas's 2026-05-12
// design feedback (§5.4). One entry point to every authoring flow:
// Journal Entry, Supplier Invoice (Bill), Customer Invoice, Bank
// Account, Transaction (via Transaction Type picker). Beakon-navy
// button per the brand palette guidance.

interface CreateAction {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const CREATE_ACTIONS: CreateAction[] = [
  {
    label: "New Journal Entry",
    href: "/dashboard/journal-entries?new=1",
    icon: NotebookPen,
    description: "Manual debit/credit posting",
  },
  {
    label: "New Supplier Invoice",
    href: "/dashboard/bills?new=1",
    icon: Receipt,
    description: "Bill from a vendor (AP)",
  },
  {
    label: "New Customer Invoice",
    href: "/dashboard/invoices?new=1",
    icon: FileOutput,
    description: "Bill a customer (AR)",
  },
  {
    label: "New Bank Account",
    href: "/dashboard/bank?new=1",
    icon: Wallet,
    description: "Register an account in the ledger",
  },
  {
    label: "New Transaction",
    href: "/dashboard/journal-entries?new=1",
    icon: ArrowRight,
    description: "Pick a transaction type (AP / AR / Trade / Loan / Fixed Asset / Period-end)",
  },
];


function CreateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2",
          "text-[13px] font-semibold text-white transition-colors",
          "shadow-[0_4px_12px_-4px_rgba(15,23,42,0.25)]",
          // Beakon navy (§5.3); slightly lighter on hover.
          "bg-brand-800 hover:bg-brand-700",
        )}
      >
        <Plus className="h-4 w-4" />
        Create
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 -mr-0.5 transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-40 mt-2 w-72 origin-top-right rounded-xl",
            "bg-white border border-canvas-200",
            "shadow-[0_16px_48px_-12px_rgba(15,23,42,0.18)]",
            "py-1.5 overflow-hidden",
          )}
        >
          {CREATE_ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.label}
                href={a.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-start gap-3 px-3 py-2.5 mx-1 rounded-lg",
                  "hover:bg-brand-50 group transition-colors",
                )}
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas-50 text-slate-600 group-hover:bg-white group-hover:text-brand-700">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-gray-900 group-hover:text-brand-900 leading-tight">
                    {a.label}
                  </span>
                  <span className="block text-[11.5px] text-gray-500 mt-0.5 leading-snug">
                    {a.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── Tabs ───────────────────────────────────────────────────────────


function Tabs() {
  // The strip only renders on the Accounting overview, so "Overview" is
  // the active tab by construction. Thomas §5.7: strengthen the active
  // underline (3px, navy) so the selection reads confidently; tighten
  // inactive hover so the strip feels deliberate, not muted. The
  // scrollbar that appears under 13 tabs is hidden — it cluttered the
  // strip and contradicted the "premium, calm" feel from §6.
  return (
    <div className="mt-5 -mb-px overflow-x-auto border-b border-canvas-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex min-w-max items-center gap-1">
        {TABS.map((t, i) => (
          <li key={t.name}>
            <Link
              href={t.href}
              className={cn(
                "inline-block px-3.5 py-2.5 text-[12.5px] -mb-px transition-colors",
                i === 0
                  ? "border-b-[3px] border-brand-700 text-brand-800 font-semibold"
                  : "border-b-[3px] border-transparent text-slate-500 font-medium hover:text-brand-700 hover:border-brand-200",
              )}
            >
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}


// ── Stat card ──────────────────────────────────────────────────────


// Accent palette per Thomas §5.3 / §5.9 semantic mapping:
//   brand  = Beakon navy   (primary metrics, e.g. Net Cash)
//   blue   = action blue   (informational / "this is an asset" metrics)
//   mint   = Beakon teal   (positive status — Receivables expected in)
//   amber  = pending       (Payables — money we owe / action needed)
//   violet = RESERVED for AI / insights; do not use for financial metrics.
type Accent = "brand" | "blue" | "mint" | "amber" | "violet";


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
    accent === "brand"  ? { well: "bg-brand-50 text-brand-800",   ring: "ring-brand-100" } :
    accent === "blue"   ? { well: "bg-blue-50 text-blue-700",     ring: "ring-blue-100" } :
    accent === "mint"   ? { well: "bg-mint-50 text-mint-700",     ring: "ring-mint-100" } :
    accent === "amber"  ? { well: "bg-amber-50 text-amber-700",   ring: "ring-amber-100" } :
                          { well: "bg-violet-50 text-violet-700", ring: "ring-violet-100" };

  return (
    // Thomas §5.1: KPI cards share the same lifted shadow + crisper
    // border as the section Cards for visual consistency.
    <li className={cn(
      "rounded-2xl border border-canvas-200 bg-white p-4 sm:p-5 ring-1",
      "shadow-[0_8px_24px_rgba(15,23,42,0.04)]",
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
          <div className="text-[22px] font-semibold text-gray-900 leading-tight tabular-nums mt-0.5 truncate">
            {value}
          </div>
          <div className="mt-0.5 text-[11.5px] text-gray-500 truncate">
            {sub}
          </div>
        </div>
      </div>
    </li>
  );
}


// ── Card wrapper ───────────────────────────────────────────────────


function Card({
  title, action, info, children, footer, className,
}: {
  title: string;
  action?: React.ReactNode;
  info?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    // Thomas §5.1: cards get the lifted soft shadow so they stand off
    // the lighter canvas instead of dissolving into it.
    <section className={cn(
      "flex flex-col rounded-2xl border border-canvas-200 bg-white p-4 sm:p-5",
      "shadow-[0_8px_24px_rgba(15,23,42,0.04)]",
      className,
    )}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[14.5px] font-semibold text-gray-900">
          {title}
          {info && <Info className="h-3.5 w-3.5 text-gray-400" />}
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


// ── Financial Overview (real, two-line) ────────────────────────────


interface MonthlyPL { label: string; revenue: number; expenses: number; }


function FinancialOverviewCard({
  months, loading, currency,
}: { months: MonthlyPL[] | null; loading: boolean; currency: string }) {
  const hasData = !!months && months.some((m) => m.revenue > 0 || m.expenses > 0);

  return (
    <Card
      title="Financial Overview" info
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
        <LegendChip swatch="bg-brand-600" label={`Revenue (${currency})`} line />
        <LegendChip swatch="bg-gray-300" label={`Expenses (${currency})`} line />
      </div>

      {loading ? (
        <div className="mt-3 h-44 rounded-lg bg-canvas-100/60 animate-pulse" />
      ) : !hasData ? (
        <EmptyChart
          text="No posted revenue or expenses yet. Start by adding transactions or importing accounting data."
          cta={{ href: "/dashboard/journal-entries?new=1", label: "Add Transaction" }}
        />
      ) : (
        <FinChartSVG series={months!} />
      )}
    </Card>
  );
}


function LegendChip({ swatch, label, line }: { swatch: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(
        line ? "h-0.5 w-4" : "h-2.5 w-2.5 rounded-sm",
        swatch,
      )} aria-hidden />
      {label}
    </span>
  );
}


function FinChartSVG({ series }: { series: MonthlyPL[] }) {
  const W = 600; const H = 220;
  const PADL = 38; const PADB = 22; const PADT = 10; const PADR = 8;
  const chartW = W - PADL - PADR; const chartH = H - PADT - PADB;

  const max = Math.max(...series.flatMap((s) => [s.revenue, s.expenses]), 1);
  const yMax = niceCeil(max);
  const stepX = chartW / Math.max(series.length - 1, 1);
  const yScale = (v: number) => PADT + chartH - (v / yMax) * chartH;
  const xAt = (i: number) => PADL + stepX * i;
  const ticks = niceTicks(yMax, 5);
  const fmtTick = (v: number) => v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : `${v}`;

  const rPts = series.map((s, i) => `${xAt(i)},${yScale(s.revenue)}`).join(" ");
  const ePts = series.map((s, i) => `${xAt(i)},${yScale(s.expenses)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full h-48">
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
      <polyline points={ePts} fill="none" stroke="#9ca3af" strokeWidth="1.5"
        strokeLinejoin="round" />
      {series.map((s, i) => (
        <circle key={`e-${i}`} cx={xAt(i)} cy={yScale(s.expenses)} r="2" fill="#9ca3af" />
      ))}
      <polyline points={rPts} fill="none" stroke="#2563eb" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {series.map((s, i) => (
        <circle key={`r-${i}`} cx={xAt(i)} cy={yScale(s.revenue)} r="2.6" fill="#2563eb" />
      ))}
      {series.map((s, i) => (
        <text key={s.label} x={xAt(i)} y={H - 6} textAnchor="middle"
          className="fill-gray-500" fontSize="9">{s.label}</text>
      ))}
    </svg>
  );
}


function EmptyChart({
  text, cta,
}: {
  text: string;
  cta?: { href: string; label: string };
}) {
  // Thomas §5.8: empty states should include stronger action prompts so
  // the user knows what to do next, not just "the system is empty".
  return (
    <div className="mt-3 h-44 rounded-lg bg-canvas-50/60 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
      <p className="text-[12.5px] text-gray-500 leading-relaxed max-w-sm">{text}</p>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          {cta.label}
        </Link>
      )}
    </div>
  );
}


// ── Cash by Bank (donut) ──────────────────────────────────────────


interface BankSegment {
  label: string; amount: number; pct: number; color: string;
}


function groupBankAccountsByInstitution(accounts: BankAccount[]): BankSegment[] {
  const groups = new Map<string, number>();
  for (const a of accounts) {
    const key = a.bank_name?.trim() || a.name || "Unallocated";
    const bal = num(a.gl_balance);
    groups.set(key, (groups.get(key) ?? 0) + bal);
  }
  // Drop near-zero / negative-only buckets so the donut isn't dominated
  // by sliver segments.
  const entries = Array.from(groups.entries()).filter(([, v]) => v > 1);
  entries.sort((a, b) => b[1] - a[1]);

  const total = entries.reduce((a, [, v]) => a + v, 0);
  return entries.map(([label, amount], i) => ({
    label, amount,
    pct: total > 0 ? (amount / total) * 100 : 0,
    color: BANK_COLOURS[i % BANK_COLOURS.length],
  }));
}


function CashByBankCard({
  segments, total, currency, loading,
}: {
  segments: BankSegment[]; total: number; currency: string; loading: boolean;
}) {
  return (
    <Card title="Cash by Bank" info>
      {loading ? (
        <CardSkeleton rows={4} />
      ) : segments.length === 0 ? (
        // Thomas §5.8: empty state with an explicit CTA so the user
        // knows what action turns this into a populated card.
        <div className="flex h-32 flex-col items-center justify-center gap-2.5 rounded-lg bg-canvas-50/60 px-4 text-center">
          <p className="text-[12px] text-gray-500 leading-relaxed max-w-sm">
            No bank account balances yet. Add a bank account or post your first transaction.
          </p>
          <Link
            href="/dashboard/bank?new=1"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Bank Account
          </Link>
        </div>
      ) : (
        // Compact horizontal layout: donut on the left, two-column
        // legend on the right (bank name + percentage). The full amount
        // moves to a hover tooltip — the previous three-column layout
        // clipped long bank names like "UBS Switzerland" and "Zürcher
        // Kantonalbank" inside the narrow card.
        <div className="flex items-center gap-4">
          <Donut segments={segments}
            total={fmtCompactLead(total, currency)}
            subtitle="Total Cash" />
          <ul className="flex-1 min-w-0 space-y-2">
            {segments.slice(0, 5).map((s) => (
              <li
                key={s.label}
                className="flex items-center justify-between gap-2"
                title={`${s.label} · ${fmtCompactLead(s.amount, currency)}`}
              >
                <span className="inline-flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  <span className="text-[11.5px] text-gray-700 truncate">{s.label}</span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-gray-900 tabular-nums">
                  {s.pct.toFixed(1)}%
                </span>
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
  total: string; subtitle: string;
}) {
  const size = 130; const stroke = 18; const r = (size - stroke) / 2;
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


// ── Period Status ─────────────────────────────────────────────────


function PeriodStatusCard({
  current, lastClosed, loading,
}: {
  current: PeriodRow | null;
  lastClosed: PeriodRow | null;
  loading: boolean;
}) {
  return (
    <Card title="Period Status">
      {loading ? (
        <CardSkeleton rows={4} />
      ) : (
        <ul className="divide-y divide-canvas-100">
          <PSRow label="Current Period"
            icon={CheckCircle2} tone="mint"
            value={current
              ? `${current.name} · ${capitalize(current.status)}`
              : "No open period"} />
          <PSRow label="Last Reconciliation"
            icon={ClipboardList} tone="indigo"
            value={lastClosed?.closed_at
              ? timeAgo(lastClosed.closed_at)
              : "—"} />
          <PSRow label="VAT Return"
            icon={FileText} tone="amber"
            value="Draft" />
          <PSRow label="Close Tasks Remaining"
            icon={ClipboardList} tone="indigo"
            value="—" />
        </ul>
      )}
    </Card>
  );
}


function PSRow({
  label, value, icon: Icon, tone,
}: {
  label: string; value: string;
  icon: React.ComponentType<{ className?: string }>;
  // Thomas §5.3/§5.9: violet is reserved for AI/insights only — drop
  // it from the financial Period Status rows.
  tone: "mint" | "indigo" | "amber" | "brand";
}) {
  const toneClass =
    tone === "mint"   ? "bg-mint-50 text-mint-700"     :
    tone === "indigo" ? "bg-indigo-50 text-indigo-700" :
    tone === "amber"  ? "bg-amber-50 text-amber-700"   :
                        "bg-brand-50 text-brand-800";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md", toneClass)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 text-[12.5px] text-gray-700 truncate">{label}</span>
      <span className="text-[12px] font-semibold text-gray-900 shrink-0">{value}</span>
    </li>
  );
}


// ── Recent Transactions ───────────────────────────────────────────


function RecentTransactionsCard({
  entries, loading,
}: { entries: JEEntry[]; loading: boolean }) {
  return (
    <Card
      title="Recent Transactions"
      action={
        <Link href="/dashboard/journal-entries"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all transactions
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={5} />
      ) : entries.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500">
          No posted journal entries yet.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] font-medium text-gray-500">
                <th className="font-medium pb-2 pl-2 pr-3">Date</th>
                <th className="font-medium pb-2 pr-3">Description</th>
                <th className="font-medium pb-2 pr-3">Entity</th>
                <th className="font-medium pb-2 pr-3">Reference</th>
                <th className="font-medium pb-2 pr-3 text-right">Amount</th>
                <th className="font-medium pb-2 pr-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-canvas-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-canvas-50/40 transition-colors">
                  <td className="py-2.5 pl-2 pr-3 text-gray-500 whitespace-nowrap">
                    {fmtDate(e.date)}
                  </td>
                  <td className="py-2.5 pr-3 font-medium text-gray-900 truncate max-w-[260px]">
                    {e.memo || "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-gray-600 truncate max-w-[180px]">
                    {e.entity_name || e.entity_code}
                  </td>
                  <td className="py-2.5 pr-3 text-gray-500 font-mono text-[11.5px] whitespace-nowrap">
                    {e.entry_number || e.source_ref || "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-gray-900 whitespace-nowrap">
                    {e.currency} {fmt2(e.total)}
                  </td>
                  <td className="py-2.5 pr-2"><StatusPill status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


function StatusPill({ status }: { status: string }) {
  const tone =
    status === "posted"            ? "bg-mint-50 text-mint-700 ring-mint-100" :
    status === "approved"          ? "bg-brand-50 text-brand-700 ring-brand-100" :
    status === "pending_approval"  ? "bg-amber-50 text-amber-700 ring-amber-100" :
    status === "rejected"          ? "bg-rose-50 text-rose-700 ring-rose-100" :
                                     "bg-canvas-100 text-gray-700 ring-canvas-200";
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 whitespace-nowrap",
      tone,
    )}>
      {capitalize(status.replace(/_/g, " "))}
    </span>
  );
}


// ── Aging Snapshot ────────────────────────────────────────────────


interface AgingBucket { label: string; amount: number; }


function collapseAgingBuckets(r: AgingResp | null): AgingBucket[] {
  if (!r) return [];
  const t = r.totals;
  const current = num(t.current);
  const d_1_30  = num(t.d_1_30);
  const d_31_60 = num(t.d_31_60);
  const d_61_90 = num(t.d_61_90);
  const d_90    = num(t.d_90_plus);
  return [
    { label: "Current",  amount: current },
    { label: "30 Days",  amount: d_1_30 },
    { label: "60+ Days", amount: d_31_60 + d_61_90 + d_90 },
  ];
}


function AgingSnapshotCard({
  payables, receivables, apTotal, arTotal, currency, loading,
}: {
  payables: AgingBucket[]; receivables: AgingBucket[];
  apTotal: number; arTotal: number; currency: string; loading: boolean;
}) {
  return (
    <Card
      title="Payables & Receivables Snapshot"
      footer={
        <Link href="/dashboard/reports"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View aging report
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={6} />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <AgingMini title="Payables Aging" total={apTotal}
            buckets={payables} currency={currency} barClass="bg-brand-500" />
          <AgingMini title="Receivables Aging" total={arTotal}
            buckets={receivables} currency={currency} barClass="bg-mint-500" />
        </div>
      )}
    </Card>
  );
}


function AgingMini({
  title, total, buckets, currency, barClass,
}: {
  title: string; total: number; buckets: AgingBucket[]; currency: string; barClass: string;
}) {
  const max = Math.max(...buckets.map((b) => b.amount), 1);
  const empty = buckets.every((b) => b.amount === 0);
  return (
    <div>
      <div className="text-[12px] font-medium text-gray-900">{title}</div>
      <div className="text-[10.5px] text-gray-500 mt-0.5">
        Total {fmtCompactLead(total, currency)}
      </div>
      {empty ? (
        <div className="mt-3 text-[11px] text-gray-400">No open documents.</div>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {buckets.map((b) => (
            <li key={b.label}>
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-gray-600">{b.label}</span>
                <span className="text-gray-900 tabular-nums">
                  {fmtCompactLead(b.amount, currency)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-canvas-100 overflow-hidden">
                <div className={cn("h-full rounded-full", barClass)}
                  style={{ width: `${(b.amount / max) * 100}%` }}
                  aria-hidden />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// ── Accounting Tasks ──────────────────────────────────────────────


function AccountingTasksCard({
  apCount, arCount, pendingApprovals,
}: {
  apCount: number | null;
  arCount: number | null;
  pendingApprovals: number | null;
}) {
  const tasks: { key: string; title: string; body: string; href: string }[] = [];

  if ((apCount ?? 0) > 0) {
    tasks.push({
      key: "ap",
      title: "Pay outstanding bills",
      body: `${apCount} open bill${apCount === 1 ? "" : "s"} across aging buckets.`,
      href: "/dashboard/bills",
    });
  }
  if ((arCount ?? 0) > 0) {
    tasks.push({
      key: "ar",
      title: "Follow up on receivables",
      body: `${arCount} unpaid invoice${arCount === 1 ? "" : "s"}.`,
      href: "/dashboard/invoices",
    });
  }
  tasks.push({
    key: "approvals",
    title: "Review pending approvals",
    body: pendingApprovals === null
      ? "Pending JEs / bills / invoices awaiting sign-off."
      : `${pendingApprovals} items awaiting review.`,
    href: "/dashboard/approvals",
  });
  tasks.push({
    key: "recon",
    title: "Reconcile bank accounts",
    body: "Match feed vs ledger, resolve breaks.",
    href: "/dashboard/reconciliations",
  });
  tasks.push({
    key: "vat",
    title: "Finalize VAT return",
    body: "Current period VAT summary.",
    href: "/dashboard/reports/vat",
  });

  return (
    <Card
      title="Accounting Tasks"
      footer={
        <Link href="/dashboard/approvals"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all tasks
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      <ul className="space-y-2.5">
        {tasks.slice(0, 4).map((t) => (
          <li key={t.key}>
            <Link href={t.href}
              className="group flex items-start gap-3 -mx-1 p-1 rounded-md hover:bg-canvas-50/60 transition">
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-canvas-300 bg-white" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-gray-900 leading-tight">{t.title}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{t.body}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}


// ── Top Dimensions ────────────────────────────────────────────────


function TopDimensionsRow({
  entities, employees, projects, departments,
}: {
  entities: number | null; employees: number | null;
  projects: number | null; departments: number | null;
}) {
  const items = [
    { label: "Entity",      value: entities,    sub: "Active entities",     icon: Building2 },
    { label: "Employee",    value: employees,   sub: "Active employees",    icon: Users },
    { label: "Project",     value: projects,    sub: "Active projects",     icon: Briefcase },
    { label: "Department",  value: departments, sub: "Active departments",  icon: Building2 },
  ];
  return (
    <section className="mt-5 rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-gray-900">
          <Tags className="h-4 w-4 text-gray-400" />
          Top Dimensions
        </h2>
        <Link href="/dashboard/dimensions"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all dimensions
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <li key={it.label}
              className="flex items-center gap-3 rounded-xl border border-canvas-200/70 bg-canvas-50/40 p-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-canvas-200 text-brand-700">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-gray-500 truncate">{it.label}</div>
                <div className="text-[18px] font-semibold text-gray-900 leading-tight tabular-nums">
                  {it.value === null ? "—" : it.value}
                </div>
                <div className="text-[10.5px] text-gray-500 truncate">{it.sub}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}


// ── Helpers ───────────────────────────────────────────────────────


function num(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  const n = typeof s === "number" ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
}


function parseRevenueExpense(pl: ProfitLossResp | null, kind: "revenue" | "expenses"): number {
  if (!pl) return 0;
  // Prefer .totals.{kind} if present.
  if (pl.totals?.[kind]) return num(pl.totals[kind]);
  // Else sum the relevant bucket totals.
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
    const end = new Date(next.getTime() - 86_400_000); // last day of month
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


function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}


function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60)      return "just now";
  if (s < 3600)    return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)   return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800)  return `${Math.floor(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
}


function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}


function isProjectCode(code: string): boolean {
  const k = (code || "").toUpperCase();
  return k === "PROJECT" || k === "PROJECTS" || k === "PROJ";
}


function isDeptCode(code: string): boolean {
  const k = (code || "").toUpperCase();
  return k === "DEPARTMENT" || k === "DEPT" || k === "DEPARTMENTS";
}
