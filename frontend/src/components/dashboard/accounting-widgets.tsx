"use client";

/* Accounting-first dashboard widgets.
 *
 * Each one self-fetches because they all call different report
 * endpoints with their own period / scope params. The dashboard page
 * only feeds them the active entity (or "all entities" when null).
 *
 * Endpoints used:
 *   GET /beakon/reports/ar-aging/?entity=...&as_of=...
 *   GET /beakon/reports/ap-aging/?entity=...&as_of=...
 *   GET /beakon/reports/profit-loss/?entity=...&date_from=...&date_to=...
 *   GET /beakon/periods/?entity=...
 *   GET /beakon/anomalies/?entity=...
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, Calculator,
  CalendarCheck, CheckCircle2, ChevronRight, Clock, FileText, Receipt,
  Scale, Search, ShieldCheck, TrendingUp, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmt2Fixed, fmtAccountingFixed, fmtCompact, fmtDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import type { BankAccount, Entity } from "@/components/dashboard/widgets";


/* ──────────────────────────── Helpers ─────────────────────────── */

/** YYYY-MM-DD for today, in local time. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}


/* ──────────────────────────── 1. P&L snapshot ─────────────────── */

interface PLResponse {
  reporting_currency: string;
  period_start: string;
  period_end: string;
  revenue: { total: string };
  operating_expenses: { total: string };
  gross_profit: string;
  operating_income: string;
  net_income: string;
}

export function PLSnapshotWidget({
  entityId, compact = false,
}: { entityId: number | null; compact?: boolean }) {
  const [data, setData] = useState<PLResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = { date_from: from, date_to: to };
    if (entityId) params.entity = String(entityId);
    api.get<PLResponse>("/beakon/reports/profit-loss/", params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityId, from, to]);

  const ccy = data?.reporting_currency || "";
  const revenue   = parseFloat(data?.revenue?.total || "0");
  const opex      = parseFloat(data?.operating_expenses?.total || "0");
  const ni        = parseFloat(data?.net_income || "0");
  const niPositive = ni >= 0;

  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <header className="px-5 py-3.5 border-b border-canvas-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-mint-50 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-mint-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Profit &amp; loss</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Period: {fmtDate(from)} → {fmtDate(to)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 className="text-[11px] px-2 py-1 rounded border border-canvas-200 bg-white" />
          <span className="text-gray-300 text-xs">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 className="text-[11px] px-2 py-1 rounded border border-canvas-200 bg-white" />
          <Link href="/dashboard/reports" className="text-xs text-brand-700 hover:underline ml-2 whitespace-nowrap">
            Full P&amp;L <ChevronRight className="w-3.5 h-3.5 inline" />
          </Link>
        </div>
      </header>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <PLTile label="Revenue" tone="mint" loading={loading}
                value={revenue} ccy={ccy} icon={ArrowUpRight} compact={compact} />
        <PLTile label="Operating expenses" tone="amber" loading={loading}
                value={opex} ccy={ccy} icon={ArrowDownRight} compact={compact} />
        <PLTile label="Net income" tone={niPositive ? "brand" : "rose"} loading={loading}
                value={ni} ccy={ccy} icon={niPositive ? TrendingUp : ArrowDownRight}
                accounting compact={compact} />
      </div>
      {!loading && data && revenue > 0 && (
        <div className="px-5 pb-4">
          <PLBar revenue={revenue} opex={opex} netIncome={ni} ccy={ccy} />
        </div>
      )}
    </section>
  );
}


function PLTile({
  label, value, ccy, tone, loading, icon: Icon, accounting = false, compact = false,
}: {
  label: string; value: number; ccy: string; loading: boolean;
  tone: "mint" | "amber" | "brand" | "rose";
  icon: React.ComponentType<{ className?: string }>;
  accounting?: boolean;
  compact?: boolean;
}) {
  const T: Record<string, { bg: string; text: string; ring: string }> = {
    mint:  { bg: "bg-mint-50",  text: "text-mint-700",  ring: "ring-mint-100" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-100" },
    brand: { bg: "bg-brand-50", text: "text-brand-700", ring: "ring-brand-100" },
    rose:  { bg: "bg-rose-50",  text: "text-rose-700",  ring: "ring-rose-100" },
  };
  const t = T[tone];
  return (
    <div className={cn("rounded-xl ring-1 ring-inset p-3.5", t.bg, t.ring)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-[10px] uppercase tracking-[0.08em] font-semibold", t.text)}>{label}</span>
        <Icon className={cn("w-3.5 h-3.5", t.text)} />
      </div>
      <div className="mt-1.5 text-xl font-semibold tabular-nums text-gray-900">
        {loading ? <Skeleton className="h-6 w-32 inline-block" /> : (
          <>
            <span className="text-[11px] text-gray-500 font-medium font-mono mr-1.5">{ccy}</span>
            {compact
              ? (accounting && value < 0 ? `(${fmtCompact(-value)})` : fmtCompact(Math.abs(value)))
              : (accounting ? fmtAccountingFixed(value, 2) : fmt2Fixed(Math.abs(value), 2))}
          </>
        )}
      </div>
    </div>
  );
}


function PLBar({
  revenue, opex, netIncome, ccy,
}: { revenue: number; opex: number; netIncome: number; ccy: string }) {
  // Visual proportion: opex as % of revenue (capped at 100%)
  const opexPct = Math.min(100, (opex / Math.max(revenue, 1)) * 100);
  const niPct = Math.max(0, 100 - opexPct);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1.5">
        <span>How the revenue is spent</span>
        <span className="tabular-nums">
          Margin {((netIncome / Math.max(revenue, 1)) * 100).toFixed(1)}%
        </span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-canvas-100">
        <div className="bg-amber-400" style={{ width: `${opexPct}%` }} title={`Opex ${ccy} ${fmt2Fixed(opex, 2)}`} />
        <div className="bg-mint-500" style={{ width: `${niPct}%` }} title={`Net ${ccy} ${fmt2Fixed(netIncome, 2)}`} />
      </div>
      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-600">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Opex</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-mint-500" /> Net income</span>
      </div>
    </div>
  );
}


/* ──────────────────────────── 2. AR aging ─────────────────────── */

interface AgingDoc {
  id: number;
  reference?: string;
  external_ref?: string;
  invoice_date?: string;
  due_date?: string;
  days_overdue?: number;
  bucket?: string;
  amount?: string;
  native_amount?: string;
  native_currency?: string;
  status?: string;
}

interface AgingResponse {
  reporting_currency: string;
  buckets: string[];
  parties: {
    party_id: number;
    party_code: string;
    party_name: string;
    buckets: Record<string, string>;
    total: string;
    /** API returns an array of document records, not just a count. */
    docs: AgingDoc[];
  }[];
  totals: Record<string, string>;
  grand_total: string;
  party_count: number;
  document_count: number;
}

export function ARAgingWidget({
  entityId, compact = false,
}: { entityId: number | null; compact?: boolean }) {
  return (
    <AgingPanel
      kind="ar"
      title="Money in"
      subtitle="What customers owe — and how late they are."
      iconBg="bg-mint-50"
      iconColor="text-mint-700"
      icon={Banknote}
      endpoint="/beakon/reports/ar-aging/"
      partyLabel="Customer"
      seeAllHref="/dashboard/reports?tab=ar"
      entityId={entityId}
      compact={compact}
    />
  );
}

export function APAgingWidget({
  entityId, compact = false,
}: { entityId: number | null; compact?: boolean }) {
  return (
    <AgingPanel
      kind="ap"
      title="Money out"
      subtitle="What you owe vendors — overdue first."
      iconBg="bg-amber-50"
      iconColor="text-amber-700"
      icon={Receipt}
      endpoint="/beakon/reports/ap-aging/"
      partyLabel="Vendor"
      seeAllHref="/dashboard/reports?tab=ap"
      entityId={entityId}
      compact={compact}
    />
  );
}


function AgingPanel({
  kind, title, subtitle, iconBg, iconColor, icon: Icon, endpoint, partyLabel,
  seeAllHref, entityId, compact,
}: {
  kind: "ar" | "ap";
  title: string;
  subtitle: string;
  iconBg: string;
  iconColor: string;
  icon: React.ComponentType<{ className?: string }>;
  endpoint: string;
  partyLabel: string;
  seeAllHref: string;
  entityId: number | null;
  compact: boolean;
}) {
  const f = (v: number) => compact ? fmtCompact(v) : fmt2Fixed(v, 2);
  const [data, setData] = useState<AgingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const asOf = todayISO();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = { as_of: asOf };
    if (entityId) params.entity = String(entityId);
    api.get<AgingResponse>(endpoint, params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [endpoint, entityId, asOf]);

  const ccy = data?.reporting_currency || "";
  const buckets = data?.buckets || ["current", "1-30", "31-60", "61-90", "90+"];
  const total = parseFloat(data?.grand_total || "0");

  // Compute the percentage of "overdue" (not in the first/current bucket).
  const overdue = useMemo(() => {
    if (!data) return 0;
    let sum = 0;
    for (const b of buckets.slice(1)) {
      sum += parseFloat(data.totals?.[b] || "0");
    }
    return sum;
  }, [data, buckets]);
  const overduePct = total > 0 ? Math.round((overdue / total) * 100) : 0;

  const topParties = (data?.parties || []).slice(0, 5);

  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden h-full flex flex-col">
      <header className="px-5 py-3.5 border-b border-canvas-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0", iconBg)}>
            <Icon className={cn("w-4 h-4", iconColor)} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">{subtitle}</p>
          </div>
        </div>
        <Link href={seeAllHref} className="text-xs text-brand-700 hover:underline whitespace-nowrap inline-flex items-center gap-0.5">
          See all <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>

      {/* Big number + overdue chip */}
      <div className="px-5 py-3 border-b border-canvas-100 bg-canvas-50/30">
        {loading ? (
          <Skeleton className="h-7 w-40" />
        ) : (
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[12px] font-mono font-semibold text-gray-500">{ccy}</span>
            <span className="text-2xl font-semibold tabular-nums text-gray-900">{f(total)}</span>
            <span className={cn(
              "ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
              overduePct === 0
                ? "bg-mint-50 text-mint-700 ring-mint-100"
                : overduePct < 25
                  ? "bg-amber-50 text-amber-700 ring-amber-100"
                  : "bg-rose-50 text-rose-700 ring-rose-100",
            )}>
              {overduePct === 0
                ? "All current"
                : `${overduePct}% overdue`}
            </span>
          </div>
        )}
      </div>

      {/* Aging buckets — stacked horizontal bar */}
      <div className="px-5 py-3">
        {loading || !data ? (
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2 w-3/4" />
          </div>
        ) : total > 0 ? (
          <BucketBar buckets={buckets} totals={data.totals} ccy={ccy} grand={total} compact={compact} />
        ) : (
          <div className="py-5 text-center text-xs text-gray-400">No outstanding balances.</div>
        )}
      </div>

      {/* Top parties */}
      {!loading && topParties.length > 0 && (
        <div className="border-t border-canvas-100">
          <div className="px-5 pt-2.5 pb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-gray-500">
              Top {partyLabel.toLowerCase()}s
            </span>
            <span className="text-[10px] text-gray-400 tabular-nums">
              {data?.party_count ?? topParties.length} total
            </span>
          </div>
          <ul className="divide-y divide-canvas-100 pb-1">
            {topParties.map((p) => (
              <li key={p.party_id} className="px-5 py-1.5 flex items-center gap-3">
                <span className="font-mono text-[11px] text-gray-500 w-16 shrink-0 truncate">{p.party_code}</span>
                <span className="flex-1 text-sm text-gray-800 truncate" title={p.party_name}>{p.party_name}</span>
                <span className="text-[10px] text-gray-400 tabular-nums">
                  {p.docs.length} doc{p.docs.length === 1 ? "" : "s"}
                </span>
                <span className="text-xs tabular-nums text-gray-700 font-medium">
                  <span className="text-gray-400 font-mono mr-1">{ccy}</span>
                  {f(parseFloat(p.total))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}


function BucketBar({
  buckets, totals, ccy, grand, compact,
}: { buckets: string[]; totals: Record<string, string>; ccy: string; grand: number; compact: boolean }) {
  const f = (v: number) => compact ? fmtCompact(v) : fmt2Fixed(v, 2);
  const TONE: Record<number, string> = {
    0: "bg-mint-400",
    1: "bg-amber-300",
    2: "bg-amber-500",
    3: "bg-rose-400",
    4: "bg-rose-600",
  };
  const TEXT_TONE: Record<number, string> = {
    0: "text-mint-700",
    1: "text-amber-700",
    2: "text-amber-800",
    3: "text-rose-700",
    4: "text-rose-800",
  };
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-canvas-100">
        {buckets.map((b, i) => {
          const v = parseFloat(totals?.[b] || "0");
          const pct = grand > 0 ? (v / grand) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={b}
              className={TONE[i] || "bg-gray-300"}
              style={{ width: `${pct}%` }}
              title={`${b}: ${ccy} ${f(v)}`}
            />
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1 text-[10px]">
        {buckets.map((b, i) => {
          const v = parseFloat(totals?.[b] || "0");
          return (
            <div key={b} className="text-center">
              <div className={cn("font-semibold uppercase tracking-wider", TEXT_TONE[i] || "text-gray-500")}>{b}</div>
              <div className="text-gray-700 tabular-nums">{f(v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ──────────────────────────── 3. Bank list ────────────────────── */

export function BankListWidget({
  banks, loading, compact = false,
}: { banks: BankAccount[]; loading: boolean; compact?: boolean }) {
  const f = (v: number) => compact ? fmtCompact(v) : fmt2Fixed(v, 2);
  const sorted = useMemo(
    () => banks.slice().sort((a, b) =>
      Math.abs(parseFloat(b.gl_balance || "0")) - Math.abs(parseFloat(a.gl_balance || "0")),
    ),
    [banks],
  );
  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <header className="px-5 py-3.5 border-b border-canvas-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-brand-50 flex items-center justify-center">
            <Banknote className="w-4 h-4 text-brand-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Bank accounts</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Balances per the general ledger.</p>
          </div>
        </div>
        <Link href="/dashboard/bank" className="text-xs text-brand-700 hover:underline whitespace-nowrap inline-flex items-center gap-0.5">
          See all <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      {loading ? (
        <div className="p-5 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 flex-1 max-w-[200px]" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-gray-500">No bank accounts connected.</div>
      ) : (
        <ul className="divide-y divide-canvas-100">
          {sorted.slice(0, 6).map((b) => (
            <li key={b.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-canvas-50/40 transition-colors">
              <Link href={`/dashboard/bank/${b.id}`} className="flex-1 min-w-0 inline-flex items-center gap-3">
                <span className="inline-flex items-center rounded bg-canvas-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 font-mono shrink-0">
                  {b.entity_code}
                </span>
                <span className="text-sm text-gray-800 truncate" title={b.name}>{b.name}</span>
              </Link>
              <span className="text-xs tabular-nums text-gray-700 font-medium whitespace-nowrap">
                <span className="text-gray-400 font-mono mr-1">{b.currency}</span>
                {f(parseFloat(b.gl_balance || "0"))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


/* ──────────────────────────── 4. Period close ─────────────────── */

interface PeriodSummary {
  id: number;
  entity_code: string;
  name: string;
  period_type: string;
  start_date: string;
  end_date: string;
  status: string;
}

export function PeriodCloseWidget({ entityId }: { entityId: number | null }) {
  const [periods, setPeriods] = useState<PeriodSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = { page_size: "100" };
    if (entityId) params.entity = String(entityId);
    api.get<{ results: PeriodSummary[] } | PeriodSummary[]>("/beakon/periods/", params)
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : (d.results ?? []);
        setPeriods(list);
      })
      .catch(() => { if (!cancelled) setPeriods([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityId]);

  const open = periods.filter((p) => p.status === "open");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const closingSoon = open
    .map((p) => ({
      ...p,
      daysLeft: Math.ceil(
        (new Date(p.end_date + "T00:00:00").getTime() - today.getTime()) / 86_400_000,
      ),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <header className="px-5 py-3.5 border-b border-canvas-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-indigo-50 flex items-center justify-center">
            <CalendarCheck className="w-4 h-4 text-indigo-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Period close</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Open periods and how close they are to their end date.
            </p>
          </div>
        </div>
        <Link href="/dashboard/periods" className="text-xs text-brand-700 hover:underline whitespace-nowrap inline-flex items-center gap-0.5">
          Manage <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      <div className="px-5 py-3 border-b border-canvas-100 grid grid-cols-3 gap-3 text-center">
        <PeriodStat label="Open" value={open.length} icon={Clock} tone="amber" loading={loading} />
        <PeriodStat label="Closed" value={periods.filter((p) => p.status === "closed").length}
                    icon={CheckCircle2} tone="mint" loading={loading} />
        <PeriodStat label="Total" value={periods.length} icon={ShieldCheck} tone="default" loading={loading} />
      </div>
      <div>
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 flex-1 max-w-[160px]" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        ) : closingSoon.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-500">
            {periods.length === 0 ? "No periods configured yet." : "No periods are open right now."}
          </div>
        ) : (
          <ul className="divide-y divide-canvas-100">
            {closingSoon.map((p) => (
              <li key={p.id} className="px-5 py-2.5 flex items-center gap-3">
                <span className="inline-flex items-center rounded bg-canvas-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 font-mono shrink-0">
                  {p.entity_code}
                </span>
                <span className="flex-1 text-sm text-gray-800 truncate">{p.name}</span>
                <span className="text-[11px] text-gray-400 whitespace-nowrap">
                  ends {fmtDate(p.end_date)}
                </span>
                <span className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  p.daysLeft < 0 ? "bg-rose-50 text-rose-700 ring-rose-100" :
                  p.daysLeft <= 5 ? "bg-amber-50 text-amber-700 ring-amber-100" :
                  "bg-canvas-100 text-gray-600 ring-canvas-200",
                )}>
                  {p.daysLeft < 0 ? `${Math.abs(p.daysLeft)}d overdue` : `${p.daysLeft}d left`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}


function PeriodStat({
  label, value, icon: Icon, tone, loading,
}: {
  label: string; value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: "default" | "amber" | "mint";
  loading: boolean;
}) {
  const T: Record<string, { text: string; bg: string }> = {
    default: { text: "text-gray-700", bg: "bg-canvas-100" },
    amber:   { text: "text-amber-700", bg: "bg-amber-50" },
    mint:    { text: "text-mint-700",  bg: "bg-mint-50" },
  };
  const t = T[tone];
  return (
    <div>
      <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-[0.08em] text-gray-500 font-semibold">
        <span className={cn("inline-flex h-4 w-4 rounded items-center justify-center", t.bg)}>
          <Icon className={cn("w-2.5 h-2.5", t.text)} />
        </span>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">
        {loading ? <Skeleton className="h-6 w-10 inline-block" /> : value}
      </div>
    </div>
  );
}


/* ──────────────────────────── 5. Anomalies ────────────────────── */

interface AnomalyResp {
  total: number;
  counts: Record<string, number>;
  anomalies: {
    id: string;
    kind: string;
    severity: string;
    title: string;
    description: string;
    amount?: string | null;
    currency?: string | null;
    suggested_action?: string;
  }[];
}

export function AnomaliesWidget({ entityId }: { entityId: number | null }) {
  const [data, setData] = useState<AnomalyResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = {};
    if (entityId) params.entity = String(entityId);
    api.get<AnomalyResp>("/beakon/anomalies/", params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityId]);

  const items = (data?.anomalies || []).slice(0, 5);

  return (
    <section className="rounded-2xl border border-rose-100 bg-gradient-to-b from-rose-50/30 to-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <header className="px-5 py-3.5 border-b border-rose-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-rose-100 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-rose-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Anomalies</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              AI-flagged oddities in the ledger — large round numbers, missing dates, unusual ratios.
            </p>
          </div>
        </div>
        <Link href="/dashboard/anomalies" className="text-xs text-brand-700 hover:underline whitespace-nowrap inline-flex items-center gap-0.5">
          See all <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      {loading ? (
        <div className="p-5 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 flex-1 max-w-[200px]" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : !data || items.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <CheckCircle2 className="w-6 h-6 text-mint-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-800">No anomalies right now</p>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-xs mx-auto">
            The ledger looks clean. We'll flag anything that smells off.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-rose-100/70">
          {items.map((a) => (
            <li key={a.id} className="px-5 py-2.5">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  a.severity === "high" ? "bg-rose-50 text-rose-700 ring-rose-200" :
                  a.severity === "medium" ? "bg-amber-50 text-amber-700 ring-amber-200" :
                  "bg-canvas-100 text-gray-600 ring-canvas-200",
                )}>
                  {a.severity}
                </span>
                <span className="text-sm font-medium text-gray-900 truncate flex-1" title={a.title}>{a.title}</span>
                {a.amount && (
                  <span className="text-xs tabular-nums text-gray-700 whitespace-nowrap">
                    {a.currency && <span className="text-gray-400 font-mono mr-1">{a.currency}</span>}
                    {fmt2Fixed(parseFloat(a.amount), 2)}
                  </span>
                )}
              </div>
              {a.description && (
                <p className="text-[11px] text-gray-500 mt-0.5 truncate" title={a.description}>{a.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


/* ──────────────────────────── 6. Unmatched bank items ─────────── */

/** Tiny widget to surface "bank txns waiting to be matched". Aggregates
 *  across all bank accounts by hitting the bank-tx list with status=new. */
export function UnmatchedBankWidget({ entityId }: { entityId: number | null }) {
  const [count, setCount] = useState<number | null>(null);
  const [sample, setSample] = useState<{ id: number; date: string; description: string; amount: string; currency: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params: Record<string, string> = { status: "new", page_size: "5" };
    if (entityId) params.entity = String(entityId);
    api.get<{ count?: number; results: any[] } | any[]>("/beakon/bank-transactions/", params)
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : (d.results ?? []);
        const c = !Array.isArray(d) && typeof d.count === "number" ? d.count : list.length;
        setCount(c);
        setSample(list.slice(0, 5));
      })
      .catch(() => { if (!cancelled) { setCount(0); setSample([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
  }, [entityId]);

  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <header className="px-5 py-3.5 border-b border-canvas-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center">
            <Scale className="w-4 h-4 text-amber-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Unmatched bank items</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Bank transactions the books haven't seen yet.</p>
          </div>
        </div>
        <Link href="/dashboard/reconciliations" className="text-xs text-brand-700 hover:underline whitespace-nowrap inline-flex items-center gap-0.5">
          Reconcile <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      <div className="px-5 py-3 border-b border-canvas-100">
        {loading ? (
          <Skeleton className="h-6 w-16" />
        ) : count === 0 ? (
          <div className="flex items-center gap-2 text-mint-700">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm font-medium">All matched</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-gray-900">{count}</span>
            <span className="text-xs text-gray-500">awaiting match</span>
          </div>
        )}
      </div>
      {!loading && sample.length > 0 && (
        <ul className="divide-y divide-canvas-100">
          {sample.map((t) => (
            <li key={t.id} className="px-5 py-2 flex items-center gap-3 text-sm">
              <span className="text-[11px] text-gray-400 tabular-nums w-20 shrink-0">{fmtDate(t.date)}</span>
              <span className="flex-1 truncate text-gray-700" title={t.description}>{t.description}</span>
              <span className="text-xs tabular-nums text-gray-700 whitespace-nowrap">
                <span className="text-gray-400 font-mono mr-1">{t.currency}</span>
                {fmt2Fixed(parseFloat(t.amount), 2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
