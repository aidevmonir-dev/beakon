"use client";

/* Wealth Management — module dashboard.
 *
 * Wired to two backend aggregation endpoints introduced 2026-05-12:
 *
 *   /beakon/wealth/summary/             → AUM, YTD return, top portfolios,
 *                                         top holdings, allocation by
 *                                         asset class, custodian overview.
 *   /beakon/wealth/performance-trend/   → 12-month AUM trail for the
 *                                         portfolio-performance line.
 *
 * Both endpoints read PositionSnapshot + PerformanceSnapshot, populated
 * by the Avaloq SFTP feed (or `manage.py seed_avaloq_demo` for the
 * Geneva-feed demo).
 *
 * Wealth Insights stays narrative-driven (no /insights/ endpoint), but
 * we now derive the items from the live summary numbers — concentration
 * breaches surface automatically, YTD return is real, etc. Wealth Tasks
 * is the same trick: built from real signals (stale snapshots, missing
 * custodian coverage) so they only appear when the underlying condition
 * holds.
 *
 * Replaces the earlier hand-picked PLACEHOLDER constants.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Banknote, Building2,
  ClipboardList, Coins, Download, Info, Landmark, PieChart, Plus, Search,
  Sparkles, TrendingUp, Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtCompactLead, fmt2 } from "@/lib/format";


// ── Types ──────────────────────────────────────────────────────────


interface SummaryPortfolio {
  portfolio_code: string;
  portfolio_name: string;
  value: string;
  ytd_return_pct: number | null;
}

interface SummaryHolding {
  isin: string;
  instrument_name: string;
  asset_class: string;
  custodian: string;
  market_value: string;
  weight_pct: number;
}

interface SummaryClassRow { asset_class: string; value: string; pct: number; }
interface SummaryCustodianRow { custodian_name: string; value: string; pct: number; }

interface WealthSummaryResp {
  currency: string;
  as_of: string | null;
  aum: string;
  aum_delta_pct: number | null;
  ytd_return_pct: number | null;
  portfolio_count: number;
  custodian_count: number;
  top_portfolios: SummaryPortfolio[];
  top_holdings: SummaryHolding[];
  by_asset_class: SummaryClassRow[];
  by_custodian: SummaryCustodianRow[];
}

interface TrendMonth { month: string; value: string; }
interface WealthTrendResp { currency: string; months: TrendMonth[]; }


// Palette for asset-class and custodian donuts/bars. Picks rotate
// deterministically so the same class/custodian always lands on the
// same colour even as the list shifts.
const ASSET_CLASS_COLOURS: Record<string, string> = {
  Equities:       "#2563eb",
  "Fixed Income": "#14b8a6",
  Cash:           "#f59e0b",
  Alternatives:   "#8b5cf6",
  "Real Estate":  "#ec4899",
  Commodities:    "#0ea5e9",
  Crypto:         "#f43f5e",
  Other:          "#9ca3af",
};
const CUSTODIAN_PALETTE = ["#2563eb", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#0ea5e9"];


// ── Page ───────────────────────────────────────────────────────────


export default function WealthDashboardPage() {
  const [summary, setSummary] = useState<WealthSummaryResp | null>(null);
  const [trend, setTrend] = useState<WealthTrendResp | null>(null);

  useEffect(() => {
    void Promise.allSettled([
      api.get<WealthSummaryResp>("/beakon/wealth/summary/"),
      api.get<WealthTrendResp>("/beakon/wealth/performance-trend/", { months: "12" }),
    ]).then(([s, t]) => {
      if (s.status === "fulfilled") setSummary(s.value);
      else setSummary(emptySummary());
      if (t.status === "fulfilled") setTrend(t.value);
      else setTrend({ currency: "", months: [] });
    });
  }, []);

  const currency = summary?.currency || "CHF";
  const aum = num(summary?.aum);
  const aumDelta = summary?.aum_delta_pct ?? null;
  const ytdPct = summary?.ytd_return_pct ?? null;
  const portfolioCount = summary?.portfolio_count ?? null;
  const custodianCount = summary?.custodian_count ?? null;

  const assetSegments = useMemo<AssetSegment[]>(
    () => (summary?.by_asset_class ?? []).map((c) => ({
      label: c.asset_class,
      pct: c.pct,
      value: num(c.value),
      color: ASSET_CLASS_COLOURS[c.asset_class] ?? ASSET_CLASS_COLOURS.Other,
    })),
    [summary],
  );

  const custodianRows = useMemo<CustodianRow2[]>(
    () => (summary?.by_custodian ?? []).map((r, i) => ({
      name: r.custodian_name,
      value: num(r.value),
      pct: r.pct,
      color: CUSTODIAN_PALETTE[i % CUSTODIAN_PALETTE.length],
    })),
    [summary],
  );

  const insights = useMemo(() => deriveInsights(summary), [summary]);
  const tasks    = useMemo(() => deriveTasks(summary), [summary]);

  return (
    <div className="px-1 py-2 sm:px-2 sm:py-4">
      <div className="mx-auto w-full max-w-7xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
              Wealth Management
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Track portfolios, holdings and performance across your organization.
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
              href="/dashboard/wealth"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Portfolio
            </Link>
          </div>
        </div>

        {/* ── Search / Ask bar ───────────────────────────────────── */}
        <div className="mt-6 relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search portfolios, custodians, holdings or ask getBeakon…"
            className="w-full rounded-xl border border-canvas-200 bg-white py-3 pl-10 pr-12 text-[13.5px] text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-violet-50 text-violet-700 ring-1 ring-violet-100">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>

        {/* ── Stats row ──────────────────────────────────────────── */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Portfolios" sub="Across all entities"
            value={portfolioCount === null ? "—" : String(portfolioCount)}
            icon={PieChart} accent="brand" />
          <StatCard label="Assets Under Management"
            sub={aumDelta === null
              ? <span className="text-gray-500">vs last quarter</span>
              : <TrendDelta pct={aumDelta} since="last quarter" />}
            value={summary === null ? "—" : fmtCompactLead(aum, currency)}
            icon={Wallet} accent="mint" />
          <StatCard label="Custodian Accounts" sub="Active relationships"
            value={custodianCount === null ? "—" : String(custodianCount)}
            icon={Building2} accent="amber" />
          <StatCard label="Net Performance" sub="Year to date"
            value={ytdPct === null
              ? "—"
              : `${ytdPct >= 0 ? "+" : ""}${(ytdPct * 100).toFixed(1)}%`}
            icon={TrendingUp} accent="violet" />
        </ul>

        {/* ── Row 1: Performance (span 2) • Allocation • Top Portfolios ── */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <PortfolioPerformanceCard trend={trend} currency={currency}
              loading={trend === null} />
          </div>
          <AllocationCard segments={assetSegments}
            total={aum} currency={currency}
            loading={summary === null} />
          <TopPortfoliosCard rows={summary?.top_portfolios ?? []}
            currency={currency}
            loading={summary === null} />
        </div>

        {/* ── Row 2: Holdings (span 2) • Custodians • right column ─ */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <TopHoldingsCard rows={summary?.top_holdings ?? []}
              currency={currency}
              loading={summary === null} />
          </div>
          <CustodianOverviewCard rows={custodianRows} currency={currency}
            loading={summary === null} />
          <div className="space-y-4">
            <WealthInsightsCard items={insights} loading={summary === null} />
            <WealthTasksCard tasks={tasks} loading={summary === null} />
          </div>
        </div>
      </div>
    </div>
  );
}


function emptySummary(): WealthSummaryResp {
  return {
    currency: "",
    as_of: null,
    aum: "0",
    aum_delta_pct: null,
    ytd_return_pct: null,
    portfolio_count: 0,
    custodian_count: 0,
    top_portfolios: [],
    top_holdings: [],
    by_asset_class: [],
    by_custodian: [],
  };
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
          <div className="text-[22px] font-semibold text-gray-900 leading-tight tabular-nums mt-0.5">
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


function TrendDelta({ pct, since }: { pct: number; since: string }) {
  const positive = pct >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[11.5px] font-medium",
      positive ? "text-mint-700" : "text-rose-700",
    )}>
      <ArrowUpRight className={cn("h-3 w-3", !positive && "rotate-90")} />
      {positive ? "+" : ""}{(pct * 100).toFixed(1)}% vs {since}
    </span>
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
    <section className={cn(
      "flex flex-col rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5",
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
        <div className="mt-4 pt-3 border-t border-canvas-100">{footer}</div>
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


function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500 px-4 text-center">
      {text}
    </div>
  );
}


// ── Portfolio Performance line ────────────────────────────────────


function PortfolioPerformanceCard({
  trend, currency, loading,
}: { trend: WealthTrendResp | null; currency: string; loading: boolean }) {
  const points = useMemo<PerfPoint[]>(() => {
    if (!trend) return [];
    return trend.months.map((m) => ({
      label: monthLabel(m.month),
      portfolio: num(m.value),
    }));
  }, [trend]);
  const hasData = points.some((p) => p.portfolio > 0);

  return (
    <Card
      title="Portfolio Performance"
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
        <LegendChip swatch="bg-brand-600" label={`Total Portfolio (${currency})`} line />
      </div>
      {loading ? (
        <div className="mt-3 h-48 rounded-lg bg-canvas-100/60 animate-pulse" />
      ) : !hasData ? (
        <EmptyHint text="No snapshot history yet. Once the custodian feed runs daily, this fills in automatically." />
      ) : (
        <LineChartSVG series={points} />
      )}
    </Card>
  );
}


interface PerfPoint { label: string; portfolio: number; }


function LegendChip({
  swatch, label, line,
}: { swatch: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {line ? (
        <span className={cn("h-0.5 w-4", swatch)} aria-hidden />
      ) : (
        <span className={cn("h-2.5 w-2.5 rounded-sm", swatch)} aria-hidden />
      )}
      {label}
    </span>
  );
}


function LineChartSVG({ series }: { series: PerfPoint[] }) {
  const W = 600; const H = 220;
  const PADL = 44; const PADB = 22; const PADT = 10; const PADR = 8;
  const chartW = W - PADL - PADR; const chartH = H - PADT - PADB;
  const max = Math.max(...series.map((s) => s.portfolio), 1);
  const yMax = niceCeil(max);
  const stepX = chartW / Math.max(series.length - 1, 1);
  const yScale = (v: number) => PADT + chartH - (v / yMax) * chartH;
  const xAt = (i: number) => PADL + stepX * i;
  const ticks = niceTicks(yMax, 4);
  const fmtTick = (v: number) => v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : `${v}`;

  const pts = series.map((s, i) => `${xAt(i)},${yScale(s.portfolio)}`).join(" ");

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
      <polyline points={pts} fill="none" stroke="#2563eb"
        strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((s, i) => (
        <circle key={`p-${i}`} cx={xAt(i)} cy={yScale(s.portfolio)} r="2.6" fill="#2563eb" />
      ))}
      {series.map((s, i) => (
        <text key={s.label + i} x={xAt(i)} y={H - 6} textAnchor="middle"
          className="fill-gray-500" fontSize="9">{s.label}</text>
      ))}
    </svg>
  );
}


// ── Asset class allocation (donut) ─────────────────────────────────


interface AssetSegment { label: string; pct: number; value: number; color: string; }


function AllocationCard({
  segments, total, currency, loading,
}: {
  segments: AssetSegment[]; total: number; currency: string; loading: boolean;
}) {
  return (
    <Card title="Allocation by Asset Class">
      {loading ? (
        <CardSkeleton rows={5} />
      ) : segments.length === 0 ? (
        <EmptyHint text="No allocation data yet." />
      ) : (
        <div className="flex items-center gap-4">
          <Donut segments={segments}
            total={fmtCompactLead(total, currency)}
            subtitle="Total AUM" />
          <ul className="flex-1 space-y-2">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: s.color }} aria-hidden />
                  <span className="text-[12px] text-gray-700 truncate">{s.label}</span>
                </span>
                <span className="text-[12px] font-semibold text-gray-900 tabular-nums">
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
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        <div className="text-[14px] font-semibold text-gray-900 leading-tight tabular-nums">{total}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}


// ── Top Portfolios ─────────────────────────────────────────────────


function TopPortfoliosCard({
  rows, currency, loading,
}: {
  rows: SummaryPortfolio[]; currency: string; loading: boolean;
}) {
  return (
    <Card
      title="Top Portfolios"
      footer={
        <Link href="/dashboard/wealth"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all portfolios
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyHint text="No portfolios with positions yet." />
      ) : (
        <ol className="divide-y divide-canvas-100">
          {rows.map((p, i) => {
            const value = num(p.value);
            const pct = p.ytd_return_pct;
            return (
              <li key={p.portfolio_code} className="flex items-center gap-3 py-2.5">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-canvas-100 text-[11px] font-semibold text-gray-600">
                  {i + 1}
                </span>
                <span className="flex-1 text-[12.5px] font-medium text-gray-900 truncate">
                  {p.portfolio_name || p.portfolio_code}
                </span>
                <span className="shrink-0 text-[12px] text-gray-700 tabular-nums">
                  {fmtCompactLead(value, currency)}
                </span>
                {pct !== null && (
                  <span className={cn(
                    "shrink-0 text-[12px] font-semibold tabular-nums",
                    pct >= 0 ? "text-mint-700" : "text-rose-700",
                  )}>
                    {pct >= 0 ? "+" : ""}{(pct * 100).toFixed(1)}%
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}


// ── Top Holdings (table) ───────────────────────────────────────────


function TopHoldingsCard({
  rows, currency, loading,
}: {
  rows: SummaryHolding[]; currency: string; loading: boolean;
}) {
  return (
    <Card
      title="Top Holdings"
      footer={
        <Link href="/dashboard/wealth"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all holdings
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <EmptyHint text="No holdings yet — once the custodian feed runs, this populates." />
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] font-medium text-gray-500">
                <th className="font-medium pb-2 pl-2 pr-3">Holding</th>
                <th className="font-medium pb-2 pr-3">Asset Class</th>
                <th className="font-medium pb-2 pr-3">Custodian</th>
                <th className="font-medium pb-2 pr-3 text-right">Market Value ({currency})</th>
                <th className="font-medium pb-2 pr-2 text-right">Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-canvas-100">
              {rows.map((h) => {
                const Icon = iconForAssetClass(h.asset_class);
                return (
                  <tr key={h.isin} className="hover:bg-canvas-50/40 transition-colors">
                    <td className="py-2.5 pl-2 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-canvas-100 text-gray-600">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="font-medium text-gray-900 truncate">
                          {h.instrument_name || h.isin}
                        </span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-600">{h.asset_class}</td>
                    <td className="py-2.5 pr-3 text-gray-600">{h.custodian || "—"}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-gray-900">
                      {fmt2(h.market_value)}
                    </td>
                    <td className="py-2.5 pr-2 text-right tabular-nums text-gray-900">
                      {h.weight_pct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


function iconForAssetClass(cls: string) {
  if (cls === "Equities")     return TrendingUp;
  if (cls === "Fixed Income") return Landmark;
  if (cls === "Cash")         return Coins;
  if (cls === "Alternatives") return Banknote;
  if (cls === "Real Estate")  return Building2;
  return Coins;
}


// ── Custodian Overview ────────────────────────────────────────────


interface CustodianRow2 { name: string; value: number; pct: number; color: string; }


function CustodianOverviewCard({
  rows, currency, loading,
}: {
  rows: CustodianRow2[]; currency: string; loading: boolean;
}) {
  const maxPct = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <Card
      title="Custodian Overview" info
      footer={
        <Link href="/dashboard/bank-feed"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all custodians
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyHint text="No custodian exposure mapped yet." />
      ) : (
        <ul className="space-y-3.5">
          {rows.map((r) => (
            <li key={r.name}>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-gray-700 font-medium truncate">{r.name}</span>
                <span className="text-gray-900 tabular-nums shrink-0">
                  {fmtCompactLead(r.value, currency)}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-canvas-100 overflow-hidden">
                <div className="h-full rounded-full"
                  style={{
                    width: `${(r.pct / maxPct) * 100}%`,
                    background: r.color,
                  }}
                  aria-label={`${r.name} ${r.pct.toFixed(1)}% of AUM`}
                />
              </div>
              <div className="text-[10.5px] text-gray-500 mt-0.5 tabular-nums">
                {r.pct.toFixed(1)}%
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


// ── Wealth Insights (derived from real summary) ──────────────────


interface WealthInsight {
  key: string;
  title: string;
  tone: "mint" | "indigo" | "amber";
  icon: React.ComponentType<{ className?: string }>;
}


function deriveInsights(summary: WealthSummaryResp | null): WealthInsight[] {
  if (!summary) return [];
  const out: WealthInsight[] = [];

  // YTD performance line (only if we have a number).
  if (summary.ytd_return_pct !== null) {
    const ret = summary.ytd_return_pct * 100;
    const positive = ret >= 0;
    out.push({
      key: "ytd",
      title: positive
        ? `YTD net performance is +${ret.toFixed(1)}% across all portfolios.`
        : `YTD net performance is ${ret.toFixed(1)}% — review allocations.`,
      tone: positive ? "mint" : "amber",
      icon: TrendingUp,
    });
  }

  // Asset-class concentration check (>50% in any single class).
  const heavy = summary.by_asset_class.find((c) => c.pct >= 50);
  if (heavy) {
    out.push({
      key: "concentration-class",
      title: `${heavy.asset_class} represents ${heavy.pct.toFixed(1)}% of AUM — above 50% concentration threshold.`,
      tone: "amber",
      icon: AlertTriangle,
    });
  }

  // Single-holding concentration check (>10% weight).
  const heavyHolding = summary.top_holdings.find((h) => h.weight_pct >= 10);
  if (heavyHolding) {
    out.push({
      key: "concentration-holding",
      title: `${heavyHolding.instrument_name} is ${heavyHolding.weight_pct.toFixed(1)}% of total AUM — above single-holding threshold.`,
      tone: "amber",
      icon: AlertTriangle,
    });
  }

  // Custodian concentration (>70% with one bank).
  const heavyCustodian = summary.by_custodian.find((c) => c.pct >= 70);
  if (heavyCustodian) {
    out.push({
      key: "concentration-custodian",
      title: `${heavyCustodian.custodian_name} custodies ${heavyCustodian.pct.toFixed(1)}% of AUM — consider diversifying.`,
      tone: "indigo",
      icon: Coins,
    });
  }

  return out.slice(0, 3);
}


function WealthInsightsCard({
  items, loading,
}: { items: WealthInsight[]; loading: boolean }) {
  return (
    <Card title="Wealth Insights"
      footer={
        <Link href="/dashboard/wealth"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all insights
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyHint text="No insights yet — once positions land, this surfaces concentration and return commentary." />
      ) : (
        <ul className="space-y-3">
          {items.map((i) => {
            const Icon = i.icon;
            const tone =
              i.tone === "mint"   ? "bg-mint-50 text-mint-700" :
              i.tone === "indigo" ? "bg-indigo-50 text-indigo-700" :
                                    "bg-amber-50 text-amber-700";
            return (
              <li key={i.key} className="flex items-start gap-3">
                <span className={cn("mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md", tone)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="text-[12.5px] text-gray-800 leading-relaxed">{i.title}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}


// ── Wealth Tasks (derived from real signals) ─────────────────────


interface WealthTask { key: string; title: string; dueLabel: string; }


function deriveTasks(summary: WealthSummaryResp | null): WealthTask[] {
  if (!summary) return [];
  const out: WealthTask[] = [];

  // Stale snapshot check — if the latest as_of is more than 3 days
  // old, surface an "Upload custodian statement" task.
  if (summary.as_of) {
    const age = Math.floor(
      (Date.now() - new Date(summary.as_of).getTime()) / 86_400_000,
    );
    if (age > 3) {
      out.push({
        key: "stale-snapshot",
        title: `Upload latest custodian statement (last as-of ${age} days old)`,
        dueLabel: "Overdue",
      });
    }
  }

  // Concentration follow-up
  const heavy = summary.by_asset_class.find((c) => c.pct >= 50);
  if (heavy) {
    out.push({
      key: "review-concentration",
      title: `Review ${heavy.asset_class} concentration`,
      dueLabel: "This week",
    });
  }

  // Always-on
  out.push({
    key: "quarterly-report",
    title: "Review quarterly performance report",
    dueLabel: "End of quarter",
  });
  out.push({
    key: "rebalance",
    title: "Rebalance against target allocation",
    dueLabel: "Next review",
  });

  return out.slice(0, 4);
}


function WealthTasksCard({
  tasks, loading,
}: { tasks: WealthTask[]; loading: boolean }) {
  return (
    <Card title="Wealth Tasks" action={
      <ClipboardList className="h-4 w-4 text-gray-400" />
    }>
      {loading ? (
        <CardSkeleton rows={4} />
      ) : tasks.length === 0 ? (
        <EmptyHint text="No open tasks." />
      ) : (
        <ul className="divide-y divide-canvas-100">
          {tasks.map((t) => (
            <li key={t.key} className="flex items-center gap-3 py-2.5">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ring-canvas-300 bg-white" />
              <span className="flex-1 text-[12.5px] text-gray-900 truncate">{t.title}</span>
              <span className="text-[11.5px] text-gray-500 shrink-0">{t.dueLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


// ── Helpers ───────────────────────────────────────────────────────


function num(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  const n = typeof s === "number" ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
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


function monthLabel(iso: string): string {
  // "2026-05-31" → "May '26"
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const m = d.toLocaleDateString(undefined, { month: "short" });
  const y = String(d.getFullYear()).slice(2);
  return `${m} '${y}`;
}
