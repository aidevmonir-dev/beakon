"use client";

/* Financial reports — tabs for Trial Balance / P&L / Balance Sheet.
 * Single-entity or consolidated (entity=—all—). Date controls per report.
 * Every figure is computed from posted journal lines at request time. */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, Printer } from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmt2Fixed, fmtAccounting, fmtAccountingFixed, fmtPct, fmtDate, fmtDateTime, fmtLabel } from "@/lib/format";
import NarrativeBox from "@/components/narrative-box";


// ── Report letterhead ───────────────────────────────────────────────────
// One unified header used by every report. Designed to read like a printed
// financial statement (org name → report name → period → scope/currency)
// rather than a web-app card. Actions row sits beside the title, prints
// hidden so the paper version reads cleanly.
function useOrgName(): string {
  const [name, setName] = useState<string>("");
  useEffect(() => {
    const id = typeof window !== "undefined"
      ? localStorage.getItem("organization_id") : null;
    if (!id) return;
    api.get<{ organizations?: { id: number; name: string }[] }>("/auth/me/")
      .then((d) => {
        const org = d.organizations?.find((o) => String(o.id) === id);
        setName(org?.name || "");
      })
      .catch(() => {});
  }, []);
  return name;
}

function ReportLetterhead({
  title, periodLabel, currency, scope, basis = "Accrual",
  status, actions,
}: {
  title: string;
  periodLabel: string;
  currency: string;
  scope: string;
  basis?: string;
  /** Optional small badge — "Balanced" / "OUT OF BALANCE" / etc. */
  status?: { label: string; ok: boolean };
  /** Right-rail tools — Print / Export / Hide-decimals. Hidden in print. */
  actions?: React.ReactNode;
}) {
  const orgName = useOrgName();
  const generatedAt = useMemo(() => fmtDateTime(new Date().toISOString()), []);
  return (
    <div className="mb-5">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex-1 min-w-0">
          {orgName && (
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-[0.18em] mb-0.5">
              {orgName}
            </div>
          )}
          <h2 className="text-2xl font-bold text-gray-900 leading-tight">{title}</h2>
          <div className="text-sm text-gray-700 mt-0.5">{periodLabel}</div>
        </div>
        <div className="flex flex-col items-end gap-2 print:hidden">
          {actions && <div className="flex items-center gap-2">{actions}</div>}
          {status && (
            <span className={
              "text-[11px] font-medium px-2 py-0.5 rounded border " +
              (status.ok
                ? "border-gray-300 text-gray-700 bg-white"
                : "border-red-300 text-red-700 bg-red-50")
            }>
              {status.label}
            </span>
          )}
        </div>
      </div>
      <div className="border-t-2 border-gray-800 mt-2 pt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
        <span><span className="text-gray-400">Scope:</span> <span className="text-gray-700">{scope}</span></span>
        <span><span className="text-gray-400">Basis:</span> {basis}</span>
        <span><span className="text-gray-400">Currency:</span> {currency}</span>
        <span className="ml-auto print:inline">
          <span className="text-gray-400">Generated:</span> {generatedAt}
        </span>
      </div>
    </div>
  );
}


function PrintButton() {
  return (
    <button onClick={() => window.print()}
            className="btn-secondary text-xs print:hidden">
      <Printer className="w-3.5 h-3.5 mr-1" /> Print
    </button>
  );
}


// ── Period quick-picker helpers ────────────────────────────────────────
// All math goes through Date constructors that handle month/year overflow
// natively (Date(y, m+1, 0) = last day of month m, etc.). No timezone
// tricks — we render and consume YYYY-MM-DD strings throughout.
function pad(n: number): string { return String(n).padStart(2, "0"); }
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 0);
}
function startOfYear(d: Date): Date { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d: Date): Date { return new Date(d.getFullYear(), 11, 31); }


// ── CSV download utility ───────────────────────────────────────────────
// Browser-side CSV export: build rows in JS, escape per RFC 4180, blob
// download. No backend round-trip — the data is already in memory from
// the report fetch. Excel + Google Sheets read this format cleanly.
function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  // Add UTF-8 BOM so Excel auto-detects the encoding (umlauts etc.).
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function ExportCsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-secondary text-xs">
      <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
    </button>
  );
}


interface Entity {
  id: number;
  code: string;
  name: string;
  functional_currency: string;
  is_active: boolean;
}


type Tab = "tb" | "pnl" | "bs" | "cf" | "ap_aging" | "ar_aging";


export default function ReportsPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState<string>("");  // "" = consolidated
  const today = new Date().toISOString().slice(0, 10);
  // YTD as the default period for ranged reports (P&L, Cash Flow).
  // Family-office activity is sparse — MTD often shows nothing because
  // bills/invoices land mid-month or in prior periods. YTD gives a more
  // useful first look. Quick-period chips below let users tighten if
  // they want MTD/QTD/last-month.
  const yearStart = today.slice(0, 4) + "-01-01";
  const [dateFrom, setDateFrom] = useState(yearStart);
  const [dateTo, setDateTo] = useState(today);
  const [asOf, setAsOf] = useState(today);
  const [tab, setTab] = useState<Tab>("tb");

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => setEntities(Array.isArray(d) ? d : (d.results ?? [])))
      .catch(() => {});
  }, []);

  const scope = useMemo(() => {
    if (!entityId) return "All entities (consolidated)";
    const e = entities.find((x) => x.id.toString() === entityId);
    return e ? `${e.code} — ${e.name}` : "Single entity";
  }, [entityId, entities]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-700" />
            Reports
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Live from posted journal lines. No caching.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Scope</span>
            <select className="input mt-1" value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}>
              <option value="">Consolidated (all entities)</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>
          </label>
          {tab === "pnl" || tab === "cf" ? (
            <>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Date from</span>
                <input type="date" className="input mt-1"
                       value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Date to</span>
                <input type="date" className="input mt-1"
                       value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
            </>
          ) : (
            <label className="block">
              <span className="text-xs font-medium text-gray-600">As of</span>
              <input type="date" className="input mt-1"
                     value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </label>
          )}
        </div>
        <PeriodPresets
          tab={tab}
          setDateFrom={setDateFrom} setDateTo={setDateTo} setAsOf={setAsOf}
        />
      </div>

      {/* Tabs — bottom-border style, like a print-tab register */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-4 text-sm border-b border-gray-300 print:hidden">
        {[
          { k: "tb", label: "Trial Balance" },
          { k: "pnl", label: "Profit & Loss" },
          { k: "bs", label: "Balance Sheet" },
          { k: "cf", label: "Cash Flow" },
          { k: "ap_aging", label: "AP Aging" },
          { k: "ar_aging", label: "AR Aging" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as Tab)}
            className={
              "py-2 -mb-px border-b-2 transition-colors " +
              (tab === t.k
                ? "border-gray-900 text-gray-900 font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-800")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "tb" && <TrialBalance entityId={entityId} asOf={asOf} scope={scope} />}
      {tab === "pnl" && <ProfitLoss entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} scope={scope} />}
      {tab === "bs" && <BalanceSheet entityId={entityId} asOf={asOf} scope={scope} />}
      {tab === "cf" && <CashFlow entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} scope={scope} />}
      {tab === "ap_aging" && <AgingReport kind="ap" entityId={entityId} asOf={asOf} scope={scope} />}
      {tab === "ar_aging" && <AgingReport kind="ar" entityId={entityId} asOf={asOf} scope={scope} />}
    </div>
  );
}


/* ─── Period quick-pickers ───────────────────────────────────────────── */
// Two chip-sets driven off the active tab. P&L and Cash Flow are
// period-ranged; everything else is as-of-snapshot. Click a chip and
// the date inputs populate — saves typing during demos and cuts the
// "what's the last day of last quarter again" cognitive overhead.

function PresetChip({
  label, onClick,
}: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="px-2 py-0.5 text-[11px] rounded-full border border-canvas-200 bg-white text-gray-600 hover:bg-brand-50 hover:border-brand-200 hover:text-brand-800 transition-colors">
      {label}
    </button>
  );
}

function PeriodPresets({
  tab, setDateFrom, setDateTo, setAsOf,
}: {
  tab: Tab;
  setDateFrom: (s: string) => void;
  setDateTo: (s: string) => void;
  setAsOf: (s: string) => void;
}) {
  const isRanged = tab === "pnl" || tab === "cf";
  const today = new Date();
  const setRange = (from: Date, to: Date) => {
    setDateFrom(isoDate(from));
    setDateTo(isoDate(to));
  };
  const setSnapshot = (d: Date) => setAsOf(isoDate(d));

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-canvas-100">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1">Quick periods</span>
      {isRanged ? (
        <>
          <PresetChip label="MTD" onClick={() => setRange(startOfMonth(today), today)} />
          <PresetChip label="Last month" onClick={() => {
            const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            setRange(startOfMonth(lastMonth), endOfMonth(lastMonth));
          }} />
          <PresetChip label="QTD" onClick={() => setRange(startOfQuarter(today), today)} />
          <PresetChip label="Last quarter" onClick={() => {
            const lastQ = new Date(today.getFullYear(), today.getMonth() - 3, 1);
            setRange(startOfQuarter(lastQ), endOfQuarter(lastQ));
          }} />
          <PresetChip label="YTD" onClick={() => setRange(startOfYear(today), today)} />
          <PresetChip label="Last year" onClick={() => {
            const lastY = new Date(today.getFullYear() - 1, 0, 1);
            setRange(startOfYear(lastY), endOfYear(lastY));
          }} />
        </>
      ) : (
        <>
          <PresetChip label="Today" onClick={() => setSnapshot(today)} />
          <PresetChip label="End of last month" onClick={() => {
            setSnapshot(new Date(today.getFullYear(), today.getMonth(), 0));
          }} />
          <PresetChip label="End of last quarter" onClick={() => {
            const q = Math.floor(today.getMonth() / 3);
            setSnapshot(new Date(today.getFullYear(), q * 3, 0));
          }} />
          <PresetChip label="End of last year" onClick={() => {
            setSnapshot(new Date(today.getFullYear() - 1, 11, 31));
          }} />
        </>
      )}
    </div>
  );
}


/* ─── Cash Flow Statement (direct) ───────────────────────────────────── */

interface CFItem { label: string; amount: string; }
interface CFSection { items: CFItem[]; net: string; }
interface CFResult {
  reporting_currency: string;
  method: string;
  period_start: string;
  period_end: string;
  opening_cash: string;
  operating_activities: CFSection;
  investing_activities: CFSection;
  financing_activities: CFSection;
  net_change: string;
  closing_cash: string;
  verification: {
    derived_closing: string;
    balance_sheet_closing: string;
    difference: string;
    matches: boolean;
  };
}

function CashFlow({
  entityId, dateFrom, dateTo, scope,
}: { entityId: string; dateFrom: string; dateTo: string; scope: string }) {
  const [dimFilter, setDimFilter] = useState<DimFilter>({});
  const params = useMemo(() => {
    const p: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
    if (entityId) p.entity_id = entityId;
    if (Object.keys(dimFilter).length) p.dimension_filter = JSON.stringify(dimFilter);
    return p;
  }, [entityId, dateFrom, dateTo, dimFilter]);
  const [data, loading, err] = useReport<CFResult>("/beakon/reports/cash-flow/", params, []);
  const [hideDecimals, setHideDecimals] = useState(false);
  const fmt = useCallback(
    (v: string | number | null | undefined) => fmt2Fixed(v, hideDecimals ? 0 : 2),
    [hideDecimals],
  );

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div className="card p-6 space-y-5">
      <ReportLetterhead
        title="Cash Flow Statement"
        periodLabel={`Direct method · For the period ${fmtDate(data.period_start)} — ${fmtDate(data.period_end)}`}
        currency={data.reporting_currency}
        scope={scope}
        status={{
          label: data.verification.matches
            ? "Reconciles to balance sheet"
            : `OFF by ${fmt(data.verification.difference)}`,
          ok: data.verification.matches,
        }}
        actions={<>
          <HideDecimalsToggle checked={hideDecimals} onChange={setHideDecimals} />
          <PrintButton />
          <ExportCsvButton onClick={() => exportCashFlowCsv(data)} />
        </>}
      />
      <DimensionFilterBar value={dimFilter} onChange={setDimFilter} />
      <NarrativeBox reportType="cf" entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} />

      {data.operating_activities.items.length === 0
        && data.investing_activities.items.length === 0
        && data.financing_activities.items.length === 0
        && parseFloat(data.net_change) === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-700">No cash movement in this period.</p>
          <p className="text-xs text-gray-500 mt-1.5">
            Bills paid, invoices received, transfers, and other cash JEs will appear here.
            Try a wider window — click <span className="font-medium text-gray-700">YTD</span>{" "}
            or <span className="font-medium text-gray-700">Last year</span> above the report.
          </p>
          <p className="text-[11px] text-gray-400 mt-3">
            Opening cash {data.reporting_currency} {fmt(data.opening_cash)} · Closing cash {data.reporting_currency} {fmt(data.closing_cash)}
          </p>
        </div>
      ) : (
        <>
      <CFRow label="Opening cash balance" value={data.opening_cash} muted format={fmt} />

      <CFSectionView title="Operating activities" section={data.operating_activities} format={fmt} />
      <CFSectionView title="Investing activities" section={data.investing_activities} format={fmt} />
      <CFSectionView title="Financing activities" section={data.financing_activities} format={fmt} />

      <div className="border-t-2 border-double border-gray-800 pt-2 px-3 flex items-center justify-between">
        <span className="text-sm font-bold text-gray-900">Net change in cash</span>
        <span className="text-base font-mono font-bold text-gray-900 tabular-nums">
          {data.reporting_currency} {fmt(data.net_change)}
        </span>
      </div>

      <CFRow label="Closing cash balance" value={data.closing_cash} highlight format={fmt} />

      {!data.verification.matches && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <div className="font-medium mb-1">Cash flow doesn't tie to balance sheet</div>
          <div>Derived: {fmt(data.verification.derived_closing)} · BS: {fmt(data.verification.balance_sheet_closing)} · Diff: {fmt(data.verification.difference)}</div>
          <div className="mt-1 text-[11px] opacity-80">
            Usually means a JE has cash + non-cash lines in different functional currencies, or a cash-to-cash transfer was misclassified.
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

function CFSectionView({ title, section, format }: {
  title: string; section: CFSection;
  format?: (v: string | number | null | undefined) => string;
}) {
  const fmt = format ?? fmt2;
  if (section.items.length === 0 && parseFloat(section.net) === 0) {
    return (
      <div>
        <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-1">{title}</p>
        <p className="text-xs text-gray-400 italic pl-2">No activity in this section.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-1">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {section.items.map((it, i) => {
            const v = parseFloat(it.amount);
            return (
              <tr key={i}>
                <td className="py-1 pr-4 text-gray-800">{it.label}</td>
                <td className="py-1 pl-4 text-right font-mono text-xs tabular-nums w-40 text-gray-900">
                  {v < 0 ? `(${fmt(Math.abs(v))})` : fmt(v)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-canvas-100">
            <td className="pt-1 pr-4 text-right text-xs text-gray-500 font-medium">
              Net cash from {title.replace(" activities", "")}
            </td>
            <td className="pt-1 pl-4 text-right font-mono text-sm font-semibold tabular-nums">
              {fmt(section.net)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CFRow({ label, value, muted, highlight, format }: {
  label: string; value: string; muted?: boolean; highlight?: boolean;
  format?: (v: string | number | null | undefined) => string;
}) {
  const fmt = format ?? fmt2;
  const cls = highlight
    ? "border-t border-gray-700 pt-1.5 px-3 font-semibold text-gray-900"
    : "py-1 px-3";
  return (
    <div className={cls + " flex items-center justify-between"}>
      <span className={"text-sm " + (muted ? "text-gray-500" : "text-gray-900")}>{label}</span>
      <span className={"font-mono text-sm tabular-nums " + (muted ? "text-gray-500" : "text-gray-900")}>
        {fmt(value)}
      </span>
    </div>
  );
}


/* ─── AP / AR Aging ─────────────────────────────────────────────────── */

const BUCKET_LABELS: Record<string, string> = {
  current:   "Current",
  d_1_30:    "1–30 days",
  d_31_60:   "31–60 days",
  d_61_90:   "61–90 days",
  d_90_plus: "90+ days",
};

interface AgingDoc {
  id: number;
  reference: string;
  external_ref: string;
  entity_code: string;
  invoice_date: string;
  due_date: string;
  days_overdue: number;
  bucket: string;
  amount: string;
  native_amount: string;
  native_currency: string;
}

interface AgingParty {
  party_id: number;
  party_code: string;
  party_name: string;
  buckets: Record<string, string>;
  total: string;
  docs: AgingDoc[];
}

interface AgingResult {
  report_type: string;
  as_of: string;
  reporting_currency: string;
  buckets: string[];
  parties: AgingParty[];
  totals: Record<string, string>;
  grand_total: string;
  party_count: number;
  document_count: number;
}

function AgingReport({
  kind, entityId, asOf, scope,
}: { kind: "ap" | "ar"; entityId: string; asOf: string; scope: string }) {
  const [dimFilter, setDimFilter] = useState<DimFilter>({});
  const params = useMemo(() => {
    const p: Record<string, string> = { as_of: asOf };
    if (entityId) p.entity_id = entityId;
    if (Object.keys(dimFilter).length) p.dimension_filter = JSON.stringify(dimFilter);
    return p;
  }, [entityId, asOf, dimFilter]);
  const path = kind === "ap" ? "/beakon/reports/ap-aging/" : "/beakon/reports/ar-aging/";
  const [data, loading, err] = useReport<AgingResult>(path, params, [kind]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hideDecimals, setHideDecimals] = useState(false);
  const fmt = useCallback(
    (v: string | number | null | undefined) => fmt2Fixed(v, hideDecimals ? 0 : 2),
    [hideDecimals],
  );

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  const partyLabel = kind === "ap" ? "Vendor" : "Customer";
  const title = kind === "ap" ? "AP Aging" : "AR Aging";
  const subtitle = kind === "ap"
    ? "Outstanding bills (approved, not yet paid) by age bucket."
    : "Outstanding invoices (issued, not yet paid) by age bucket.";

  return (
    <div className="card p-6">
      <ReportLetterhead
        title={title}
        periodLabel={`${subtitle} As of ${fmtDate(data.as_of)} · ${data.party_count} ${partyLabel.toLowerCase()}${data.party_count === 1 ? "" : "s"} · ${data.document_count} document${data.document_count === 1 ? "" : "s"}`}
        currency={data.reporting_currency}
        scope={scope}
        actions={<>
          <HideDecimalsToggle checked={hideDecimals} onChange={setHideDecimals} />
          <PrintButton />
          <ExportCsvButton onClick={() => exportAgingCsv(data, kind)} />
          <div className="text-right ml-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total outstanding</div>
            <div className="text-base font-mono font-bold text-gray-900 tabular-nums">
              {data.reporting_currency} {fmt(data.grand_total)}
            </div>
          </div>
        </>}
      />
      <DimensionFilterBar value={dimFilter} onChange={setDimFilter} />

      {data.parties.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">
          Nothing outstanding. 🎉
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                <th className="pb-2 pr-4 font-medium">{partyLabel}</th>
                {data.buckets.map((b) => (
                  <th key={b} className="pb-2 px-3 font-medium text-right">
                    {BUCKET_LABELS[b] ?? b}
                  </th>
                ))}
                <th className="pb-2 pl-4 font-medium text-right border-l border-canvas-100">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.parties.map((p) => (
                <Fragment key={p.party_id}>
                  <tr className="border-b border-canvas-50 hover:bg-canvas-50 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === p.party_id ? null : p.party_id)}>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-xs">
                          {expandedId === p.party_id ? "▼" : "▶"}
                        </span>
                        <span className="font-mono text-xs text-gray-500">{p.party_code}</span>
                        <span className="text-sm font-medium text-gray-900">{p.party_name}</span>
                        <span className="text-[10px] text-gray-400">
                          ({p.docs.length} doc{p.docs.length === 1 ? "" : "s"})
                        </span>
                      </div>
                    </td>
                    {data.buckets.map((b) => {
                      const v = parseFloat(p.buckets[b] ?? "0");
                      return (
                        <td key={b} className={
                          "py-2 px-3 text-right font-mono text-xs tabular-nums " +
                          (v > 0 ? (b === "d_90_plus" ? "text-red-700 font-semibold" :
                                    b === "d_61_90" ? "text-orange-700" :
                                    b === "d_31_60" ? "text-yellow-700" : "text-gray-900")
                                 : "text-gray-300")
                        }>
                          {v > 0 ? fmt(p.buckets[b]) : ""}
                        </td>
                      );
                    })}
                    <td className="py-2 pl-4 text-right font-mono text-sm font-semibold tabular-nums border-l border-canvas-100">
                      {fmt(p.total)}
                    </td>
                  </tr>
                  {expandedId === p.party_id && (
                    <tr>
                      <td colSpan={data.buckets.length + 2}
                          className="bg-canvas-50/50 px-4 py-2 border-b border-canvas-100">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wider">
                              <th className="pb-1 pr-3 font-medium">Reference</th>
                              <th className="pb-1 pr-3 font-medium">External #</th>
                              <th className="pb-1 pr-3 font-medium">Entity</th>
                              <th className="pb-1 pr-3 font-medium">Invoice date</th>
                              <th className="pb-1 pr-3 font-medium">Due</th>
                              <th className="pb-1 pl-3 font-medium text-right">Days overdue</th>
                              <th className="pb-1 pl-3 font-medium">Bucket</th>
                              <th className="pb-1 pl-3 font-medium text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.docs.map((d) => (
                              <tr key={d.id} className="border-t border-canvas-100">
                                <td className="py-1 pr-3 font-mono text-brand-700">{d.reference}</td>
                                <td className="py-1 pr-3 text-gray-500 font-mono">{d.external_ref || "—"}</td>
                                <td className="py-1 pr-3 font-mono text-gray-700">{d.entity_code}</td>
                                <td className="py-1 pr-3 text-gray-500 whitespace-nowrap">{fmtDate(d.invoice_date)}</td>
                                <td className="py-1 pr-3 text-gray-500 whitespace-nowrap">{fmtDate(d.due_date)}</td>
                                <td className={"py-1 pl-3 text-right tabular-nums " +
                                               (d.days_overdue > 60 ? "text-red-700 font-semibold" :
                                                d.days_overdue > 30 ? "text-orange-700" :
                                                d.days_overdue > 0 ? "text-yellow-700" : "text-gray-500")}>
                                  {d.days_overdue > 0 ? `+${d.days_overdue}` : d.days_overdue}
                                </td>
                                <td className="py-1 pl-3 text-gray-500 text-[11px]">
                                  {BUCKET_LABELS[d.bucket] ?? d.bucket}
                                </td>
                                <td className="py-1 pl-3 text-right font-mono text-gray-900 tabular-nums">
                                  {fmt(d.amount)}
                                  {d.native_currency !== data.reporting_currency && (
                                    <span className="text-[10px] text-gray-400 ml-1">
                                      ({d.native_currency} {fmt(d.native_amount)})
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-canvas-200">
                <td className="pt-2 pr-4 text-right text-xs text-gray-500 font-semibold">Totals</td>
                {data.buckets.map((b) => (
                  <td key={b} className="pt-2 px-3 text-right font-mono text-xs tabular-nums text-gray-900">
                    {fmt(data.totals[b] ?? "0")}
                  </td>
                ))}
                <td className="pt-2 pl-4 text-right font-mono text-sm font-bold tabular-nums border-l border-canvas-100">
                  {fmt(data.grand_total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}


function useReport<T>(path: string, params: Record<string, string>, deps: unknown[]): [T | null, boolean, string | null] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Stable key so effect fires on real changes only.
  const key = JSON.stringify(params);
  useEffect(() => {
    setLoading(true);
    setErr(null);
    api.get<T>(path, params)
      .then(setData)
      .catch((e) => setErr(e?.error?.message || e?.detail || "Report failed"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, ...deps]);
  return [data, loading, err];
}


/* ─── Trial Balance ─────────────────────────────────────────────────── */

interface TBAccount {
  account_id: number;
  code: string;
  name: string;
  account_type: string;
  entity_code: string | null;
  entity_name: string | null;
  debit: string;
  credit: string;
  net: string;
}

interface TBResult {
  reporting_currency: string;
  as_of: string;
  accounts: TBAccount[];
  totals: { total_debits: string; total_credits: string; is_balanced: boolean };
}

function TrialBalance({ entityId, asOf, scope }: { entityId: string; asOf: string; scope: string }) {
  const [dimFilter, setDimFilter] = useState<DimFilter>({});
  const params = useMemo(() => {
    const p: Record<string, string> = { as_of: asOf };
    if (entityId) p.entity_id = entityId;
    if (Object.keys(dimFilter).length) p.dimension_filter = JSON.stringify(dimFilter);
    return p;
  }, [entityId, asOf, dimFilter]);
  const [data, loading, err] = useReport<TBResult>("/beakon/reports/trial-balance/", params, []);
  const [hideDecimals, setHideDecimals] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const fmt = useCallback(
    (v: string | number | null | undefined) => fmt2Fixed(v, hideDecimals ? 0 : 2),
    [hideDecimals],
  );

  // Aggregate per (code, name, account_type) — when running consolidated,
  // each account is duplicated once per entity. Most accountants want one
  // row per account with debit/credit summed across entities, with a
  // small "(across N entities)" caption. In single-entity scope this loop
  // is a no-op (one row per account already).
  type AggRow = {
    key: string; code: string; name: string; account_type: string;
    debit: number; credit: number;
    entities: { code: string; debit: number; credit: number }[];
  };
  const aggregated = useMemo<AggRow[]>(() => {
    if (!data) return [];
    const map = new Map<string, AggRow>();
    for (const a of data.accounts) {
      const key = `${a.account_type}|${a.code}|${a.name}`;
      const debit = Number(a.debit || 0);
      const credit = Number(a.credit || 0);
      let row = map.get(key);
      if (!row) {
        row = {
          key, code: a.code, name: a.name, account_type: a.account_type,
          debit: 0, credit: 0, entities: [],
        };
        map.set(key, row);
      }
      row.debit += debit;
      row.credit += credit;
      if (a.entity_code) {
        row.entities.push({ code: a.entity_code, debit, credit });
      }
    }
    return Array.from(map.values());
  }, [data]);

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  // Group accounts by type — same order as a real chart of accounts.
  // Each group prints its own subtotal; the file ends with a grand total.
  const TYPE_ORDER: { key: string; label: string }[] = [
    { key: "asset",     label: "Assets" },
    { key: "liability", label: "Liabilities" },
    { key: "equity",    label: "Equity" },
    { key: "revenue",   label: "Revenue" },
    { key: "expense",   label: "Expenses" },
  ];
  const groups = TYPE_ORDER.map(({ key, label }) => {
    const rows = aggregated.filter((r) => r.account_type === key);
    const debit = rows.reduce((s, r) => s + r.debit, 0);
    const credit = rows.reduce((s, r) => s + r.credit, 0);
    return { key, label, rows, debit, credit };
  }).filter((g) => g.rows.length > 0);

  return (
    <div className="card p-6">
      <ReportLetterhead
        title="Trial Balance"
        periodLabel={`As of ${fmtDate(data.as_of)}`}
        currency={data.reporting_currency}
        scope={scope}
        status={{
          label: data.totals.is_balanced ? "Balanced" : "OUT OF BALANCE",
          ok: data.totals.is_balanced,
        }}
        actions={<>
          <HideDecimalsToggle checked={hideDecimals} onChange={setHideDecimals} />
          <PrintButton />
          <ExportCsvButton onClick={() => exportTrialBalanceCsv(data)} />
        </>}
      />
      <DimensionFilterBar value={dimFilter} onChange={setDimFilter} />
      <NarrativeBox reportType="tb" entityId={entityId} asOf={asOf} />
      <div className="mt-3">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-20" />
            <col />
            <col className="w-36" />
            <col className="w-36" />
          </colgroup>
          <thead>
            <tr className="text-[11px] text-gray-500 uppercase tracking-wider border-b border-gray-700">
              <th className="text-left py-1.5 pr-4 font-medium">Code</th>
              <th className="text-left py-1.5 pr-4 font-medium">Account</th>
              <th className="text-right py-1.5 pl-4 font-medium">Debit</th>
              <th className="text-right py-1.5 pl-4 font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                <tr>
                  <td colSpan={4} className="pt-3 pb-1 text-[11px] font-semibold text-gray-700 uppercase tracking-wider">
                    {g.label}
                  </td>
                </tr>
                {g.rows.map((r) => {
                  const multi = r.entities.length > 1;
                  const expanded = expandedKey === r.key;
                  return (
                    <Fragment key={r.key}>
                      <tr
                        className={multi ? "cursor-pointer hover:bg-gray-50" : ""}
                        onClick={multi ? () => setExpandedKey(expanded ? null : r.key) : undefined}
                      >
                        <td className="py-1 pr-4 pl-3 font-mono text-xs text-gray-600">{r.code}</td>
                        <td className="py-1 pr-4 text-sm text-gray-900">
                          {multi && (
                            <span className="text-gray-400 mr-1.5 text-xs">
                              {expanded ? "▾" : "▸"}
                            </span>
                          )}
                          {r.name}
                          {multi && (
                            <span className="ml-2 text-[11px] text-gray-500 font-normal">
                              ({r.entities.length} entities)
                            </span>
                          )}
                        </td>
                        <td className="py-1 pl-4 text-right font-mono text-xs text-gray-900 tabular-nums">
                          {r.debit > 0 ? fmt(r.debit) : ""}
                        </td>
                        <td className="py-1 pl-4 text-right font-mono text-xs text-gray-900 tabular-nums">
                          {r.credit > 0 ? fmt(r.credit) : ""}
                        </td>
                      </tr>
                      {multi && expanded && r.entities.map((e, i) => (
                        <tr key={`${r.key}-${i}`} className="bg-gray-50/50">
                          <td className="py-1 pr-4 pl-3" />
                          <td className="py-1 pr-4 pl-8 text-[11px] text-gray-600 font-mono">
                            {e.code}
                          </td>
                          <td className="py-1 pl-4 text-right font-mono text-[11px] text-gray-600 tabular-nums">
                            {e.debit > 0 ? fmt(e.debit) : ""}
                          </td>
                          <td className="py-1 pl-4 text-right font-mono text-[11px] text-gray-600 tabular-nums">
                            {e.credit > 0 ? fmt(e.credit) : ""}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr>
                  <td colSpan={2} className="py-1 pr-4 pl-3 text-right text-xs font-semibold text-gray-700 border-t border-gray-300">
                    {g.label} subtotal
                  </td>
                  <td className="py-1 pl-4 text-right font-mono text-sm font-semibold text-gray-900 tabular-nums border-t border-gray-300">
                    {g.debit > 0 ? fmt(g.debit) : ""}
                  </td>
                  <td className="py-1 pl-4 text-right font-mono text-sm font-semibold text-gray-900 tabular-nums border-t border-gray-300">
                    {g.credit > 0 ? fmt(g.credit) : ""}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="pt-3 pr-4 text-right font-bold text-sm text-gray-900 border-t-2 border-double border-gray-800">
                Totals
              </td>
              <td className="pt-3 pl-4 text-right font-mono text-sm font-bold text-gray-900 tabular-nums border-t-2 border-double border-gray-800">
                {fmt(data.totals.total_debits)}
              </td>
              <td className="pt-3 pl-4 text-right font-mono text-sm font-bold text-gray-900 tabular-nums border-t-2 border-double border-gray-800">
                {fmt(data.totals.total_credits)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}


/** Reusable "Hide decimals" checkbox. Each report owns its own state and
 * passes the boolean back via onChange — keeps the toggle scoped to one
 * tab so flipping it on Trial Balance doesn't surprise you on the P&L. */
function HideDecimalsToggle({
  checked, onChange,
}: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none print:hidden">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      Hide decimals
    </label>
  );
}


/* ─── Dimension filter ───────────────────────────────────────────────── */

/** Wire shape: { "BANK": ["BANK_A", "BANK_B"], "PORT": ["PORT_MAIN"] }
 * — sent to the report endpoints as ?dimension_filter=<JSON>. */
type DimFilter = Record<string, string[]>;

interface DimType {
  id: number;
  code: string;
  name: string;
  mandatory_flag: boolean;
}

interface DimValue {
  id: number;
  dimension_type: number;
  code: string;
  name: string;
}

/** Loads dimension types + values once per page mount, caches them, and
 * exposes a chip-style picker with a "+ Add filter" dropdown. Picking a
 * type then a value adds an entry to the filter; clicking an existing
 * chip's × removes it. Kernel does the actual filtering. */
function DimensionFilterBar({
  value, onChange,
}: { value: DimFilter; onChange: (v: DimFilter) => void }) {
  const [types, setTypes] = useState<DimType[]>([]);
  const [values, setValues] = useState<DimValue[]>([]);
  const [pickingType, setPickingType] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ results: DimType[] } | DimType[]>(
        "/beakon/dimension-types/", { active_flag: "true", page_size: "200" },
      ).then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: DimValue[] } | DimValue[]>(
        "/beakon/dimension-values/", { active_flag: "true", page_size: "1000" },
      ).then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
    ]).then(([t, v]) => { setTypes(t); setValues(v); });
  }, []);

  const typeByCode = useMemo(() => {
    const m: Record<string, DimType> = {};
    for (const t of types) m[t.code] = t;
    return m;
  }, [types]);

  const valuesForType = (typeCode: string) => {
    const t = typeByCode[typeCode];
    if (!t) return [];
    return values.filter((v) => v.dimension_type === t.id);
  };

  const addValue = (typeCode: string, valueCode: string) => {
    const next = { ...value };
    const cur = next[typeCode] ? [...next[typeCode]] : [];
    if (!cur.includes(valueCode)) cur.push(valueCode);
    next[typeCode] = cur;
    onChange(next);
    setPickingType(null);
  };

  const removeValue = (typeCode: string, valueCode: string) => {
    const next = { ...value };
    next[typeCode] = (next[typeCode] || []).filter((v) => v !== valueCode);
    if (next[typeCode].length === 0) delete next[typeCode];
    onChange(next);
  };

  const clearAll = () => onChange({});

  const chips: { typeCode: string; valueCode: string; label: string }[] = [];
  for (const [tc, vs] of Object.entries(value)) {
    const valueRows = valuesForType(tc);
    for (const v of vs) {
      const match = valueRows.find((r) => r.code === v);
      chips.push({ typeCode: tc, valueCode: v, label: match?.name || v });
    }
  }

  return (
    <div className="flex items-center flex-wrap gap-2 text-xs print:hidden">
      <span className="text-gray-500">Filter by dimension:</span>
      {chips.map((c) => (
        <span
          key={`${c.typeCode}-${c.valueCode}`}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 px-2 py-0.5"
        >
          <span className="font-semibold">{c.typeCode}</span>
          <span className="text-gray-300">·</span>
          <span className="font-mono">{c.valueCode}</span>
          {c.label !== c.valueCode && (
            <span className="text-gray-500">— {c.label}</span>
          )}
          <button
            onClick={() => removeValue(c.typeCode, c.valueCode)}
            className="ml-0.5 text-brand-400 hover:text-rose-600"
            aria-label="Remove filter"
          >
            ×
          </button>
        </span>
      ))}
      {pickingType ? (
        <select
          autoFocus
          className="text-xs border border-canvas-200 rounded px-2 py-0.5"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) addValue(pickingType, e.target.value);
            else setPickingType(null);
          }}
          onBlur={() => setPickingType(null)}
        >
          <option value="">— pick {pickingType} value —</option>
          {valuesForType(pickingType).map((v) => (
            <option key={v.id} value={v.code}>
              {v.code} — {v.name}
            </option>
          ))}
        </select>
      ) : (
        <select
          className="text-xs border border-canvas-200 rounded px-2 py-0.5 bg-white text-gray-600"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) setPickingType(e.target.value);
          }}
        >
          <option value="">+ Add filter</option>
          {types.map((t) => (
            <option key={t.id} value={t.code}>
              {t.code} — {t.name}
            </option>
          ))}
        </select>
      )}
      {chips.length > 0 && (
        <button onClick={clearAll} className="text-gray-400 hover:text-gray-700 underline">
          Clear all
        </button>
      )}
    </div>
  );
}


/* ─── P&L ───────────────────────────────────────────────────────────── */

interface PnLBucket {
  accounts: { code: string; name: string; amount: string }[];
  total: string;
}

interface PnLResult {
  reporting_currency: string;
  period_start: string;
  period_end: string;
  revenue: PnLBucket;
  cogs: PnLBucket;
  gross_profit: string;
  operating_expenses: PnLBucket;
  operating_income: string;
  other_income: PnLBucket;
  other_expenses: PnLBucket;
  net_income: string;
}

function ProfitLoss({
  entityId, dateFrom, dateTo, scope,
}: { entityId: string; dateFrom: string; dateTo: string; scope: string }) {
  const [dimFilter, setDimFilter] = useState<DimFilter>({});
  const params = useMemo(() => {
    const p: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
    if (entityId) p.entity_id = entityId;
    if (Object.keys(dimFilter).length) p.dimension_filter = JSON.stringify(dimFilter);
    return p;
  }, [entityId, dateFrom, dateTo, dimFilter]);
  const [data, loading, err] = useReport<PnLResult>("/beakon/reports/profit-loss/", params, []);
  const [hideDecimals, setHideDecimals] = useState(false);
  const fmt = useCallback(
    (v: string | number | null | undefined) =>
      fmtAccountingFixed(v, hideDecimals ? 0 : 2),
    [hideDecimals],
  );

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  // P&L is empty when no revenue or expense lines hit the period.
  // Common cause: default MTD window misses last month's bills, or the
  // org just hasn't booked any P&L-touching activity yet. Show a hint
  // pointing at the wider quick-period chips instead of an empty
  // accordion of zero-totalled sections.
  const isEmpty =
    parseFloat(data.revenue.total) === 0 &&
    parseFloat(data.cogs.total) === 0 &&
    parseFloat(data.operating_expenses.total) === 0 &&
    parseFloat(data.other_income.total) === 0 &&
    parseFloat(data.other_expenses.total) === 0;

  const revenueTotal = data.revenue.total;

  return (
    <div className="card p-6 space-y-4">
      <ReportLetterhead
        title="Profit & Loss"
        periodLabel={`For the period ${fmtDate(data.period_start)} — ${fmtDate(data.period_end)}`}
        currency={data.reporting_currency}
        scope={scope}
        actions={<>
          <HideDecimalsToggle checked={hideDecimals} onChange={setHideDecimals} />
          <PrintButton />
          <ExportCsvButton onClick={() => exportProfitLossCsv(data)} />
        </>}
      />
      <DimensionFilterBar value={dimFilter} onChange={setDimFilter} />
      <NarrativeBox reportType="pnl" entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} />
      {isEmpty ? (
        <div className="py-10 text-center">
          <p className="text-sm text-gray-700">No revenue or expense activity in this period.</p>
          <p className="text-xs text-gray-500 mt-1.5">
            Bills, invoices, and other revenue/expense JEs in this date range will show here.
            Try a wider window — click <span className="font-medium text-gray-700">YTD</span>{" "}
            or <span className="font-medium text-gray-700">Last year</span> above the report.
          </p>
        </div>
      ) : (
        <>
          <Section title="Revenue" bucket={data.revenue} revenueTotal={revenueTotal} format={fmt} />
          <Section title="Cost of Goods Sold" bucket={data.cogs} revenueTotal={revenueTotal} format={fmt} />
          <TotalRow label="Gross Profit" value={data.gross_profit} highlight
                    revenueTotal={revenueTotal} format={fmt} />
          <Section title="Operating Expenses" bucket={data.operating_expenses}
                   revenueTotal={revenueTotal} format={fmt} />
          <TotalRow label="Operating Income" value={data.operating_income} highlight
                    revenueTotal={revenueTotal} format={fmt} />
          <Section title="Other Income" bucket={data.other_income} revenueTotal={revenueTotal} format={fmt} />
          <Section title="Other Expenses" bucket={data.other_expenses} revenueTotal={revenueTotal} format={fmt} />
          <TotalRow label="Net Income" value={data.net_income} big
                    revenueTotal={revenueTotal} format={fmt} />
        </>
      )}
    </div>
  );
}


/* ─── Balance Sheet ─────────────────────────────────────────────────── */

interface BSSection {
  accounts: { code: string; name: string; amount: string }[];
  total: string;
}

interface BSResult {
  reporting_currency: string;
  as_of: string;
  assets: BSSection;
  liabilities: BSSection;
  equity: BSSection;
  total_assets: string;
  total_liabilities_equity: string;
  is_balanced: boolean;
  ytd_net_income: string;
  difference: string;
}

function BalanceSheet({ entityId, asOf, scope }: { entityId: string; asOf: string; scope: string }) {
  const params = useMemo(() => {
    const p: Record<string, string> = { as_of: asOf };
    if (entityId) p.entity_id = entityId;
    return p;
  }, [entityId, asOf]);
  const [data, loading, err] = useReport<BSResult>("/beakon/reports/balance-sheet/", params, []);

  // Balance sheets follow the audit convention of 2 decimals by default.
  // The "Hide decimals" toggle drops to 0dp so executives can scan round
  // numbers in a board pack without trailing cents.
  const [hideDecimals, setHideDecimals] = useState(false);
  const fmt = useCallback(
    (v: string | number | null | undefined) =>
      fmtAccountingFixed(v, hideDecimals ? 0 : 2),
    [hideDecimals],
  );

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div className="card p-6 space-y-4">
      <ReportLetterhead
        title="Balance Sheet"
        periodLabel={`As of ${fmtDate(data.as_of)}`}
        currency={data.reporting_currency}
        scope={scope}
        status={{
          label: data.is_balanced ? "Balanced" : `DIFF ${fmt(data.difference)}`,
          ok: data.is_balanced,
        }}
        actions={<>
          <HideDecimalsToggle checked={hideDecimals} onChange={setHideDecimals} />
          <PrintButton />
          <ExportCsvButton onClick={() => exportBalanceSheetCsv(data)} />
        </>}
      />
      <NarrativeBox reportType="bs" entityId={entityId} asOf={asOf} />
      <Section title="Assets" bucket={data.assets} format={fmt} />
      <TotalRow label="Total Assets" value={data.total_assets} highlight format={fmt} />
      <Section title="Liabilities" bucket={data.liabilities} format={fmt} />
      <Section title="Equity" bucket={data.equity} format={fmt} />
      <TotalRow label="Total Liabilities + Equity" value={data.total_liabilities_equity} big format={fmt} />
      <p className="text-xs text-gray-400">
        YTD net income rolled into equity: {fmt(data.ytd_net_income)}
      </p>
    </div>
  );
}


/* ─── shared row components ────────────────────────────────────────── */

function Section({
  title, bucket, revenueTotal, format,
}: {
  title: string;
  bucket: { accounts: { code: string; name: string; amount: string }[]; total: string };
  /** When passed (P&L only), renders an extra "% of revenue" column on every row. */
  revenueTotal?: string;
  /** Optional formatter override — Balance Sheet uses this to swap between
   * 2-decimal (audit default) and 0-decimal (executive view) modes. */
  format?: (v: string | number | null | undefined) => string;
}) {
  if (!bucket.accounts.length && parseFloat(bucket.total) === 0) return null;
  const showPct = revenueTotal !== undefined;
  const fmt = format ?? fmtAccounting;
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-1 mt-2">
        {title}
      </p>
      <table className="w-full text-sm">
        <tbody>
          {bucket.accounts.map((a) => (
            <tr key={a.code}>
              <td className="py-1 pr-4 pl-3 font-mono text-xs text-gray-600 w-20">{a.code}</td>
              <td className="py-1 pr-4 text-gray-800">{a.name}</td>
              <td className="py-1 pl-4 text-right font-mono text-xs text-gray-900 tabular-nums w-32">
                {fmt(a.amount)}
              </td>
              {showPct && (
                <td className="py-1 pl-3 text-right font-mono text-[11px] text-gray-400 tabular-nums w-16">
                  {fmtPct(a.amount, revenueTotal)}
                </td>
              )}
            </tr>
          ))}
          <tr>
            <td colSpan={2} className="pt-1 pr-4 pl-3 text-right text-xs text-gray-700 font-semibold border-t border-gray-300">
              {title} subtotal
            </td>
            <td className="pt-1 pl-4 text-right font-mono text-sm font-semibold tabular-nums text-gray-900 border-t border-gray-300">
              {fmt(bucket.total)}
            </td>
            {showPct && (
              <td className="pt-1 pl-3 text-right font-mono text-[11px] text-gray-500 tabular-nums border-t border-gray-300">
                {fmtPct(bucket.total, revenueTotal)}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TotalRow({
  label, value, highlight, big, revenueTotal, format,
}: {
  label: string; value: string; highlight?: boolean; big?: boolean;
  revenueTotal?: string;
  /** Optional formatter override — see Section's `format` prop. */
  format?: (v: string | number | null | undefined) => string;
}) {
  const cls = big
    ? "border-t-2 border-double border-gray-800 pt-2 px-3 font-bold text-gray-900"
    : highlight
    ? "border-t border-gray-700 pt-1.5 px-3 font-semibold text-gray-900"
    : "py-1.5 px-3 text-gray-900";
  const fmt = format ?? fmtAccounting;
  return (
    <div className={cls + " flex items-center justify-between gap-3"}>
      <span className={big ? "text-sm uppercase tracking-wider" : "text-sm"}>{label}</span>
      <span className="flex items-baseline gap-3">
        <span className={
          "font-mono tabular-nums " + (big ? "text-base" : "text-sm")
        }>{fmt(value)}</span>
        {revenueTotal !== undefined && (
          <span className="font-mono text-[11px] tabular-nums w-14 text-right text-gray-500">
            {fmtPct(value, revenueTotal)}
          </span>
        )}
      </span>
    </div>
  );
}


/* ─── CSV exporters (one per report) ─────────────────────────────────── */
// Each exporter builds a row array and hands it to the shared download
// utility. Filenames embed the report period or as-of date so the
// downloaded files are self-identifying when sent to an accountant.

function exportTrialBalanceCsv(data: TBResult) {
  const rows: (string | number)[][] = [
    ["Trial Balance"],
    ["As of", data.as_of, "Currency", data.reporting_currency],
    [],
    ["Code", "Account", "Entity", "Type", "Debit", "Credit", "Net"],
  ];
  for (const a of data.accounts) {
    rows.push([
      a.code, a.name, a.entity_code ?? "shared",
      a.account_type, a.debit, a.credit, a.net,
    ]);
  }
  rows.push([]);
  rows.push(["", "", "", "Totals", data.totals.total_debits, data.totals.total_credits, ""]);
  rows.push(["", "", "", "Balanced", data.totals.is_balanced ? "yes" : "NO", "", ""]);
  downloadCsv(`trial-balance_${data.as_of}.csv`, rows);
}


function exportProfitLossCsv(data: PnLResult) {
  const rows: (string | number)[][] = [
    ["Profit & Loss"],
    ["Period", `${data.period_start} to ${data.period_end}`, "Currency", data.reporting_currency],
    [],
    ["Section", "Code", "Account", "Amount"],
  ];
  const pushBucket = (title: string, bucket: PnLBucket) => {
    for (const a of bucket.accounts) {
      rows.push([title, a.code, a.name, a.amount]);
    }
    rows.push([title, "", `${title} total`, bucket.total]);
    rows.push([]);
  };
  pushBucket("Revenue", data.revenue);
  pushBucket("Cost of Goods Sold", data.cogs);
  rows.push(["", "", "Gross Profit", data.gross_profit]);
  rows.push([]);
  pushBucket("Operating Expenses", data.operating_expenses);
  rows.push(["", "", "Operating Income", data.operating_income]);
  rows.push([]);
  pushBucket("Other Income", data.other_income);
  pushBucket("Other Expenses", data.other_expenses);
  rows.push(["", "", "Net Income", data.net_income]);
  downloadCsv(`profit-and-loss_${data.period_start}_to_${data.period_end}.csv`, rows);
}


function exportBalanceSheetCsv(data: BSResult) {
  const rows: (string | number)[][] = [
    ["Balance Sheet"],
    ["As of", data.as_of, "Currency", data.reporting_currency],
    [],
    ["Section", "Code", "Account", "Amount"],
  ];
  const pushBucket = (title: string, bucket: BSSection) => {
    for (const a of bucket.accounts) {
      rows.push([title, a.code, a.name, a.amount]);
    }
    rows.push([title, "", `Total ${title}`, bucket.total]);
    rows.push([]);
  };
  pushBucket("Assets", data.assets);
  pushBucket("Liabilities", data.liabilities);
  pushBucket("Equity", data.equity);
  rows.push(["", "", "Total Liabilities + Equity", data.total_liabilities_equity]);
  rows.push(["", "", "YTD net income (in equity)", data.ytd_net_income]);
  rows.push(["", "", "Balanced", data.is_balanced ? "yes" : `NO — diff ${data.difference}`]);
  downloadCsv(`balance-sheet_${data.as_of}.csv`, rows);
}


function exportCashFlowCsv(data: CFResult) {
  const rows: (string | number)[][] = [
    ["Cash Flow Statement"],
    ["Method", data.method, "Period", `${data.period_start} to ${data.period_end}`,
     "Currency", data.reporting_currency],
    [],
    ["Section", "Item", "Amount"],
  ];
  const pushSection = (title: string, section: CFSection) => {
    for (const it of section.items) {
      rows.push([title, it.label, it.amount]);
    }
    rows.push([title, `Net ${title}`, section.net]);
    rows.push([]);
  };
  rows.push(["", "Opening cash balance", data.opening_cash]);
  rows.push([]);
  pushSection("Operating activities", data.operating_activities);
  pushSection("Investing activities", data.investing_activities);
  pushSection("Financing activities", data.financing_activities);
  rows.push(["", "Net change in cash", data.net_change]);
  rows.push(["", "Closing cash balance", data.closing_cash]);
  rows.push([]);
  rows.push(["Verification", "Derived closing", data.verification.derived_closing]);
  rows.push(["Verification", "Balance sheet closing", data.verification.balance_sheet_closing]);
  rows.push(["Verification", "Reconciles", data.verification.matches ? "yes" : `NO — diff ${data.verification.difference}`]);
  downloadCsv(`cash-flow_${data.period_start}_to_${data.period_end}.csv`, rows);
}


function exportAgingCsv(data: AgingResult, kind: "ap" | "ar") {
  const partyLabel = kind === "ap" ? "Vendor" : "Customer";
  const reportLabel = kind === "ap" ? "AP Aging" : "AR Aging";
  const rows: (string | number)[][] = [
    [reportLabel],
    ["As of", data.as_of, "Currency", data.reporting_currency],
    [],
    [
      partyLabel + " code", partyLabel + " name", "Reference", "External #",
      "Entity", "Invoice date", "Due date", "Days overdue", "Bucket",
      "Amount (reporting)", "Native amount", "Native currency",
    ],
  ];
  for (const p of data.parties) {
    for (const d of p.docs) {
      rows.push([
        p.party_code, p.party_name, d.reference, d.external_ref,
        d.entity_code, d.invoice_date, d.due_date, d.days_overdue,
        BUCKET_LABELS[d.bucket] ?? d.bucket,
        d.amount, d.native_amount, d.native_currency,
      ]);
    }
  }
  rows.push([]);
  rows.push([partyLabel + " summary"]);
  rows.push([
    partyLabel + " code", partyLabel + " name", "Doc count",
    ...data.buckets.map((b) => BUCKET_LABELS[b] ?? b),
    "Total",
  ]);
  for (const p of data.parties) {
    rows.push([
      p.party_code, p.party_name, p.docs.length,
      ...data.buckets.map((b) => p.buckets[b] ?? "0"),
      p.total,
    ]);
  }
  rows.push([]);
  rows.push([
    "", "", "GRAND TOTAL",
    ...data.buckets.map((b) => data.totals[b] ?? "0"),
    data.grand_total,
  ]);
  downloadCsv(`${kind}-aging_${data.as_of}.csv`, rows);
}
