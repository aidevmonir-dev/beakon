"use client";

/* Financial reports — tabs for Trial Balance / P&L / Balance Sheet.
 * Single-entity or consolidated (entity=—all—). Date controls per report.
 * Every figure is computed from posted journal lines at request time. */
import { Fragment, useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";
import NarrativeBox from "@/components/narrative-box";


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
  const monthStart = today.slice(0, 8) + "01";
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [asOf, setAsOf] = useState(today);
  const [tab, setTab] = useState<Tab>("tb");

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/")
      .then((d) => setEntities(Array.isArray(d) ? d : (d.results ?? [])))
      .catch(() => {});
  }, []);

  const scope = entityId
    ? entities.find((e) => e.id.toString() === entityId)?.code || "—"
    : "All entities (consolidated)";

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
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 mb-4 text-sm">
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
              "px-3 py-1.5 rounded-lg border transition-colors " +
              (tab === t.k
                ? "bg-brand-50 border-brand-200 text-brand-800 font-medium"
                : "bg-white border-canvas-200 text-gray-600 hover:bg-canvas-50")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="text-[11px] text-gray-400 mb-3">Scope: {scope}</div>

      {tab === "tb" && <TrialBalance entityId={entityId} asOf={asOf} />}
      {tab === "pnl" && <ProfitLoss entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} />}
      {tab === "bs" && <BalanceSheet entityId={entityId} asOf={asOf} />}
      {tab === "cf" && <CashFlow entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} />}
      {tab === "ap_aging" && <AgingReport kind="ap" entityId={entityId} asOf={asOf} />}
      {tab === "ar_aging" && <AgingReport kind="ar" entityId={entityId} asOf={asOf} />}
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
  entityId, dateFrom, dateTo,
}: { entityId: string; dateFrom: string; dateTo: string }) {
  const params = useMemo(() => {
    const p: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
    if (entityId) p.entity_id = entityId;
    return p;
  }, [entityId, dateFrom, dateTo]);
  const [data, loading, err] = useReport<CFResult>("/beakon/reports/cash-flow/", params, []);

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Cash Flow Statement</h3>
          <p className="text-xs text-gray-400">
            Direct method · {fmtDate(data.period_start)} → {fmtDate(data.period_end)} · {data.reporting_currency}
          </p>
        </div>
        <div className={data.verification.matches ? "badge-green" : "badge-red"}>
          {data.verification.matches
            ? "Reconciles to balance sheet"
            : `OFF by ${fmt2(data.verification.difference)}`}
        </div>
      </div>

      <NarrativeBox reportType="cf" entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} />

      <CFRow label="Opening cash balance" value={data.opening_cash} muted />

      <CFSectionView title="Operating activities" section={data.operating_activities} />
      <CFSectionView title="Investing activities" section={data.investing_activities} />
      <CFSectionView title="Financing activities" section={data.financing_activities} />

      <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-bold text-brand-900">Net change in cash</span>
        <span className="text-lg font-mono font-bold text-brand-900 tabular-nums">
          {fmt2(data.net_change)} {data.reporting_currency}
        </span>
      </div>

      <CFRow label="Closing cash balance" value={data.closing_cash} highlight />

      {!data.verification.matches && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <div className="font-medium mb-1">Cash flow doesn't tie to balance sheet</div>
          <div>Derived: {fmt2(data.verification.derived_closing)} · BS: {fmt2(data.verification.balance_sheet_closing)} · Diff: {fmt2(data.verification.difference)}</div>
          <div className="mt-1 text-[11px] opacity-80">
            Usually means a JE has cash + non-cash lines in different functional currencies, or a cash-to-cash transfer was misclassified.
          </div>
        </div>
      )}
    </div>
  );
}

function CFSectionView({ title, section }: { title: string; section: CFSection }) {
  if (section.items.length === 0 && parseFloat(section.net) === 0) {
    return (
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{title}</p>
        <p className="text-xs text-gray-400 italic pl-2">No activity in this section.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {section.items.map((it, i) => {
            const v = parseFloat(it.amount);
            return (
              <tr key={i} className="hover:bg-canvas-50">
                <td className="py-1 pr-4 text-gray-800">{it.label}</td>
                <td className={"py-1 pl-4 text-right font-mono text-xs tabular-nums w-40 " +
                               (v >= 0 ? "text-mint-700" : "text-red-700")}>
                  {v >= 0 ? "" : "−"}{fmt2(Math.abs(v))}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-canvas-100">
            <td className="pt-1 pr-4 text-right text-xs text-gray-500 font-medium">
              Net cash from {title.replace(" activities", "")}
            </td>
            <td className="pt-1 pl-4 text-right font-mono text-sm font-semibold tabular-nums">
              {fmt2(section.net)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CFRow({ label, value, muted, highlight }: {
  label: string; value: string; muted?: boolean; highlight?: boolean;
}) {
  const cls = highlight
    ? "bg-canvas-50 font-semibold py-2 px-3 rounded-lg"
    : "py-2 px-3";
  return (
    <div className={cls + " flex items-center justify-between"}>
      <span className={"text-sm " + (muted ? "text-gray-500" : "")}>{label}</span>
      <span className={"font-mono text-sm tabular-nums " + (muted ? "text-gray-500" : "")}>
        {fmt2(value)}
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
  kind, entityId, asOf,
}: { kind: "ap" | "ar"; entityId: string; asOf: string }) {
  const params = useMemo(() => {
    const p: Record<string, string> = { as_of: asOf };
    if (entityId) p.entity_id = entityId;
    return p;
  }, [entityId, asOf]);
  const path = kind === "ap" ? "/beakon/reports/ap-aging/" : "/beakon/reports/ar-aging/";
  const [data, loading, err] = useReport<AgingResult>(path, params, [kind]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  const partyLabel = kind === "ap" ? "Vendor" : "Customer";
  const title = kind === "ap" ? "AP Aging" : "AR Aging";
  const subtitle = kind === "ap"
    ? "Outstanding bills (approved, not yet paid) by age bucket."
    : "Outstanding invoices (issued, not yet paid) by age bucket.";

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-400">
            {subtitle} As of {fmtDate(data.as_of)} · {data.reporting_currency} ·
            {" "}{data.party_count} {partyLabel.toLowerCase()}{data.party_count === 1 ? "" : "s"} ·
            {" "}{data.document_count} document{data.document_count === 1 ? "" : "s"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-gray-400 uppercase tracking-wider">Total outstanding</div>
          <div className="text-lg font-mono font-semibold text-gray-900 tabular-nums">
            {fmt2(data.grand_total)} {data.reporting_currency}
          </div>
        </div>
      </div>

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
                          {v > 0 ? fmt2(p.buckets[b]) : ""}
                        </td>
                      );
                    })}
                    <td className="py-2 pl-4 text-right font-mono text-sm font-semibold tabular-nums border-l border-canvas-100">
                      {fmt2(p.total)}
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
                                  {fmt2(d.amount)}
                                  {d.native_currency !== data.reporting_currency && (
                                    <span className="text-[10px] text-gray-400 ml-1">
                                      ({fmt2(d.native_amount)} {d.native_currency})
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
                    {fmt2(data.totals[b] ?? "0")}
                  </td>
                ))}
                <td className="pt-2 pl-4 text-right font-mono text-sm font-bold tabular-nums border-l border-canvas-100">
                  {fmt2(data.grand_total)}
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

function TrialBalance({ entityId, asOf }: { entityId: string; asOf: string }) {
  const params = useMemo(() => {
    const p: Record<string, string> = { as_of: asOf };
    if (entityId) p.entity_id = entityId;
    return p;
  }, [entityId, asOf]);
  const [data, loading, err] = useReport<TBResult>("/beakon/reports/trial-balance/", params, []);

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Trial Balance</h3>
          <p className="text-xs text-gray-400">
            As of {fmtDate(data.as_of)} · {data.reporting_currency}
          </p>
        </div>
        <div className={data.totals.is_balanced ? "badge-green" : "badge-red"}>
          {data.totals.is_balanced ? "Balanced" : "OUT OF BALANCE"}
        </div>
      </div>
      <NarrativeBox reportType="tb" entityId={entityId} asOf={asOf} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
              <th className="pb-2 pr-4 font-medium">Code</th>
              <th className="pb-2 pr-4 font-medium">Account</th>
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pl-4 font-medium text-right">Debit</th>
              <th className="pb-2 pl-4 font-medium text-right">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-canvas-100">
            {data.accounts.map((a) => (
              <tr key={a.account_id} className="hover:bg-canvas-50">
                <td className="py-2 pr-4 font-mono text-xs text-gray-700">{a.code}</td>
                <td className="py-2 pr-4 text-sm text-gray-900">{a.name}</td>
                <td className="py-2 pr-4 text-xs text-gray-500">{fmtLabel(a.account_type)}</td>
                <td className="py-2 pl-4 text-right font-mono text-xs tabular-nums">
                  {parseFloat(a.debit) > 0 ? fmt2(a.debit) : ""}
                </td>
                <td className="py-2 pl-4 text-right font-mono text-xs tabular-nums">
                  {parseFloat(a.credit) > 0 ? fmt2(a.credit) : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-canvas-200">
              <td colSpan={3} className="pt-2 pr-4 text-right font-semibold text-sm">Totals</td>
              <td className="pt-2 pl-4 text-right font-mono text-sm text-gray-900 tabular-nums">
                {fmt2(data.totals.total_debits)}
              </td>
              <td className="pt-2 pl-4 text-right font-mono text-sm text-gray-900 tabular-nums">
                {fmt2(data.totals.total_credits)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
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
  entityId, dateFrom, dateTo,
}: { entityId: string; dateFrom: string; dateTo: string }) {
  const params = useMemo(() => {
    const p: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
    if (entityId) p.entity_id = entityId;
    return p;
  }, [entityId, dateFrom, dateTo]);
  const [data, loading, err] = useReport<PnLResult>("/beakon/reports/profit-loss/", params, []);

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Profit &amp; Loss</h3>
        <p className="text-xs text-gray-400">
          {fmtDate(data.period_start)} → {fmtDate(data.period_end)} · {data.reporting_currency}
        </p>
      </div>
      <NarrativeBox reportType="pnl" entityId={entityId} dateFrom={dateFrom} dateTo={dateTo} />
      <Section title="Revenue" bucket={data.revenue} />
      <Section title="Cost of Goods Sold" bucket={data.cogs} />
      <TotalRow label="Gross Profit" value={data.gross_profit} highlight />
      <Section title="Operating Expenses" bucket={data.operating_expenses} />
      <TotalRow label="Operating Income" value={data.operating_income} highlight />
      <Section title="Other Income" bucket={data.other_income} />
      <Section title="Other Expenses" bucket={data.other_expenses} />
      <TotalRow label="Net Income" value={data.net_income} big />
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

function BalanceSheet({ entityId, asOf }: { entityId: string; asOf: string }) {
  const params = useMemo(() => {
    const p: Record<string, string> = { as_of: asOf };
    if (entityId) p.entity_id = entityId;
    return p;
  }, [entityId, asOf]);
  const [data, loading, err] = useReport<BSResult>("/beakon/reports/balance-sheet/", params, []);

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  if (err) return <div className="card p-4 text-red-700 text-sm">{err}</div>;
  if (!data) return null;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Balance Sheet</h3>
          <p className="text-xs text-gray-400">
            As of {fmtDate(data.as_of)} · {data.reporting_currency}
          </p>
        </div>
        <div className={data.is_balanced ? "badge-green" : "badge-red"}>
          {data.is_balanced ? "Balanced" : `DIFF ${fmt2(data.difference)}`}
        </div>
      </div>
      <NarrativeBox reportType="bs" entityId={entityId} asOf={asOf} />
      <Section title="Assets" bucket={data.assets} />
      <TotalRow label="Total Assets" value={data.total_assets} highlight />
      <Section title="Liabilities" bucket={data.liabilities} />
      <Section title="Equity" bucket={data.equity} />
      <TotalRow label="Total Liabilities + Equity" value={data.total_liabilities_equity} big />
      <p className="text-xs text-gray-400">
        YTD net income rolled into equity: {fmt2(data.ytd_net_income)}
      </p>
    </div>
  );
}


/* ─── shared row components ────────────────────────────────────────── */

function Section({
  title, bucket,
}: {
  title: string;
  bucket: { accounts: { code: string; name: string; amount: string }[]; total: string };
}) {
  if (!bucket.accounts.length && parseFloat(bucket.total) === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
        {title}
      </p>
      <table className="w-full text-sm">
        <tbody>
          {bucket.accounts.map((a) => (
            <tr key={a.code} className="hover:bg-canvas-50">
              <td className="py-1 pr-4 font-mono text-xs text-gray-600 w-20">{a.code}</td>
              <td className="py-1 pr-4 text-gray-800">{a.name}</td>
              <td className="py-1 pl-4 text-right font-mono text-xs text-gray-900 tabular-nums w-32">
                {fmt2(a.amount)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-canvas-100">
            <td colSpan={2} className="pt-1 pr-4 text-right text-xs text-gray-500 font-medium">
              {title} subtotal
            </td>
            <td className="pt-1 pl-4 text-right font-mono text-sm font-semibold tabular-nums">
              {fmt2(bucket.total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TotalRow({
  label, value, highlight, big,
}: { label: string; value: string; highlight?: boolean; big?: boolean }) {
  const cls = big
    ? "bg-brand-50 border border-brand-200 text-brand-900 font-bold py-2 px-3 rounded-lg"
    : highlight
    ? "bg-canvas-50 font-semibold py-2 px-3 rounded-lg"
    : "py-2 px-3";
  return (
    <div className={cls + " flex items-center justify-between"}>
      <span className="text-sm">{label}</span>
      <span className="font-mono text-sm tabular-nums">{fmt2(value)}</span>
    </div>
  );
}
