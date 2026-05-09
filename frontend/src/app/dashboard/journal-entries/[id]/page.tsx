"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Send, CheckCircle2, XCircle, RotateCcw, Undo2,
  Sparkles, BookOpen, CalendarRange,
  Paperclip, FileText, Trash2, Download, Upload, Loader2, Pencil, Check,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmt2, fmtRate, fmtDate, fmtDateTime, fmtLabel } from "@/lib/format";


/* Journal Entry detail — exposes every state-machine action the kernel
 * supports. The buttons shown depend on the current status:
 *
 *   draft       → Submit for approval
 *   pending     → Approve · Reject · Return to draft
 *   approved    → Post · Return to draft
 *   rejected    → Return to draft
 *   posted      → Reverse
 *   reversed    → (no actions)
 */


interface DimensionChip {
  type: string;   // "BANK" / "PORT" / "CP" / "RP" / "INST" / "CUST" / …
  value: string;  // raw code or fk id
  label: string;  // human label (master short_name when FK)
}

interface Line {
  id: number;
  account: number;
  account_code: string;
  account_name: string;
  description: string;
  debit: string;
  credit: string;
  currency: string;
  exchange_rate: string;
  functional_debit: string;
  functional_credit: string;
  counterparty_entity: number | null;
  counterparty_entity_code: string | null;
  dimension_bank_code: string;
  dimension_custodian_code: string;
  dimension_portfolio_code: string;
  dimension_instrument_code: string;
  dimension_strategy_code: string;
  dimension_asset_class_code: string;
  dimension_maturity_code: string;
  /** Backend-rendered list of every dimension populated on this line.
   * Drives the chip strip below the line's description. */
  dimensions_display?: DimensionChip[];
  line_order: number;
}

interface Action {
  id: number;
  action: string;
  from_status: string;
  to_status: string;
  actor: number | null;
  actor_email: string | null;
  note: string;
  at: string;
}

interface AIStandardReasoning {
  standard: string;
  principle: string;
  explanation: string;
}

interface AIMetadata {
  source: string | null;
  model: string | null;
  mode: string | null;
  confidence: number | null;
  confidence_in_account: number | null;
  suggested_account_reasoning: string | null;
  accounting_standard_reasoning: AIStandardReasoning | null;
  entity_accounting_standard: string | null;
  service_period_start: string | null;
  service_period_end: string | null;
  warnings: string[];
}

interface JE {
  id: number;
  entry_number: string;
  entity: number;
  entity_code: string;
  date: string;
  status: string;
  source_type: string;
  source_ref: string;
  memo: string;
  explanation: string;
  reference: string;
  document_count: number;
  currency: string;
  total_debit_functional: string;
  total_credit_functional: string;
  period: number | null;
  period_name: string | null;
  vendor: number | null;
  vendor_code: string | null;
  vendor_name: string | null;
  customer: number | null;
  customer_code: string | null;
  customer_name: string | null;
  lines: Line[];
  approval_history: Action[];
  ai_metadata: AIMetadata | null;
  reversal_of: number | null;
  reversal_of_number: string | null;
  rejection_reason: string;
}

const ACCOUNTING_STANDARD_LABEL: Record<string, string> = {
  ifrs: "IFRS",
  us_gaap: "US GAAP",
  uk_gaap: "UK GAAP",
  other: "Other / local",
};


const ACTIONS_BY_STATUS: Record<string, string[]> = {
  draft: ["submit"],
  pending_approval: ["approve", "reject", "return"],
  approved: ["post", "return"],
  rejected: ["return"],
  posted: ["reverse"],
  reversed: [],
};

function statusBadge(status: string) {
  switch (status) {
    case "posted": return "badge-green";
    case "approved": return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected": return "badge-red";
    case "reversed": return "badge-gray";
    default: return "badge-gray";
  }
}




export default function JEDetailPage() {
  const params = useParams<{ id: string }>();
  const [je, setJe] = useState<JE | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setJe(await api.get<JE>(`/beakon/journal-entries/${params.id}/`));
    } catch {
      setError("Entry not found or you don't have access.");
    }
  };

  useEffect(() => { void load(); }, [params.id]);

  const call = async (
    path: string, body: object = {}, success = "OK",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(path, body);
      await load();
    } catch (e: any) {
      const err = e?.error || e;
      setError(err?.message || err?.detail || success + " failed");
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    call(`/beakon/journal-entries/${params.id}/submit-for-approval/`, {});
  const approve = () =>
    call(`/beakon/journal-entries/${params.id}/approve/`, {});
  const post = () =>
    call(`/beakon/journal-entries/${params.id}/post/`, {});
  const returnToDraft = () =>
    call(`/beakon/journal-entries/${params.id}/return-to-draft/`, {});
  const reject = () => {
    const reason = prompt("Rejection reason:");
    if (!reason) return;
    return call(`/beakon/journal-entries/${params.id}/reject/`, { reason });
  };
  const reverse = () => {
    const today = new Date().toISOString().slice(0, 10);
    const date = prompt("Reversal date (YYYY-MM-DD):", today);
    if (!date) return;
    return call(`/beakon/journal-entries/${params.id}/reverse/`, {
      reversal_date: date,
    });
  };

  if (!je && !error) return <p className="text-sm text-gray-400 py-8">Loading…</p>;
  if (error || !je) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-gray-500">{error || "Not found"}</p>
        <Link href="/dashboard/journal-entries" className="text-sm text-brand-700 mt-2 inline-block">
          ← Back to journal entries
        </Link>
      </div>
    );
  }

  const actions = ACTIONS_BY_STATUS[je.status] || [];

  return (
    <div>
      <Link href="/dashboard/journal-entries"
            className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
      </Link>

      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-semibold text-gray-900">{je.entry_number}</h1>
            <span className={statusBadge(je.status)}>{je.status.replace("_", " ")}</span>
          </div>
          <p className="text-sm text-gray-600">
            {je.entity_code} · {fmtDate(je.date)}
            {je.period_name && <span className="text-gray-400"> · {je.period_name}</span>}
            {je.reversal_of_number && (
              <span className="text-gray-400"> · reverses {je.reversal_of_number}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actions.includes("submit") && (
            <button onClick={submit} disabled={busy} className="btn-primary">
              <Send className="w-4 h-4 mr-1.5" /> Submit for Approval
            </button>
          )}
          {actions.includes("approve") && (
            <button onClick={approve} disabled={busy} className="btn-primary">
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Approve
            </button>
          )}
          {actions.includes("post") && (
            <button onClick={post} disabled={busy} className="btn-primary">
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Post
            </button>
          )}
          {actions.includes("reject") && (
            <button onClick={reject} disabled={busy} className="btn-danger">
              <XCircle className="w-4 h-4 mr-1.5" /> Reject
            </button>
          )}
          {actions.includes("return") && (
            <button onClick={returnToDraft} disabled={busy} className="btn-secondary">
              <Undo2 className="w-4 h-4 mr-1.5" /> Return to draft
            </button>
          )}
          {actions.includes("reverse") && (
            <button onClick={reverse} disabled={busy} className="btn-secondary">
              <RotateCcw className="w-4 h-4 mr-1.5" /> Reverse
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {je.rejection_reason && (
        <div className="card p-3 mb-4 border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
          <span className="font-semibold">Rejected: </span> {je.rejection_reason}
        </div>
      )}

      {je.ai_metadata && <AIReasoningPanel meta={je.ai_metadata} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lines */}
        <div className="lg:col-span-2 card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Journal lines</h3>
          <p className="mb-3 text-xs text-gray-500">
            Line-level tags now carry the second workbook&apos;s core dimensions for bank,
            custodian, portfolio, instrument, strategy, asset class, and maturity.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider">
                  <th className="pb-2 pr-4 font-medium border-b border-canvas-100">Account</th>
                  <th className="pb-2 pr-4 font-medium border-b border-canvas-100">Description</th>
                  <th className="pb-2 pr-4 font-medium border-b border-canvas-100">Dimensions</th>
                  <th className="pb-2 pr-4 font-medium text-right border-b border-canvas-100">Debit</th>
                  <th className="pb-2 pr-4 font-medium text-right border-b border-canvas-100">Credit</th>
                  <th className="pb-2 pr-4 font-medium border-b border-canvas-100">Ccy</th>
                  <th className="pb-2 pr-4 font-medium text-right border-b border-canvas-100">Rate</th>
                  <th className="pb-2 pl-4 font-medium text-right border-b border-canvas-100 border-l border-canvas-100">Functional</th>
                </tr>
              </thead>
              <tbody>
                {je.lines.map((l) => (
                  <tr key={l.id} className="hover:bg-canvas-50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700 border-b border-canvas-50 whitespace-nowrap">
                      {l.account_code} · {l.account_name}
                    </td>
                    <td className="py-2 pr-4 text-sm text-gray-800 border-b border-canvas-50">
                      {l.description || "—"}
                    </td>
                    <td className="py-2 pr-4 border-b border-canvas-50">
                      <DimensionBadges line={l} />
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums border-b border-canvas-50">
                      {parseFloat(l.debit) > 0 ? fmt2(l.debit) : ""}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums border-b border-canvas-50">
                      {parseFloat(l.credit) > 0 ? fmt2(l.credit) : ""}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500 border-b border-canvas-50">{l.currency}</td>
                    <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums text-gray-500 border-b border-canvas-50">
                      {fmtRate(l.exchange_rate)}
                    </td>
                    <td className="py-2 pl-4 text-right font-mono text-xs tabular-nums text-gray-600 border-b border-canvas-50 border-l border-canvas-100">
                      {parseFloat(l.functional_debit) > 0
                        ? fmt2(l.functional_debit)
                        : fmt2(l.functional_credit)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} className="pt-3 pr-4 text-right text-xs text-gray-500">
                    Total (functional)
                  </td>
                  <td className="pt-3 pl-4 text-right font-mono text-sm text-gray-900 tabular-nums border-l border-canvas-100">
                    <span className="text-gray-400 mr-1">DR</span>{fmt2(je.total_debit_functional)}
                    <span className="text-gray-300 mx-1">/</span>
                    <span className="text-gray-400 mr-1">CR</span>{fmt2(je.total_credit_functional)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Explanation — long-form rationale for the entry */}
          <ExplanationCard
            jeId={je.id}
            initialText={je.explanation}
            locked={je.status === "posted" || je.status === "reversed"}
            onSaved={(updated) => setJe((prev) => prev ? { ...prev, explanation: updated.explanation, status: updated.status } : prev)}
          />

          {/* Source documents — bills, receipts, contracts, screenshots */}
          <AttachmentsCard
            jeId={je.id}
            locked={je.status === "posted" || je.status === "reversed"}
            onCountChange={(n) => setJe((prev) => prev ? { ...prev, document_count: n } : prev)}
          />
        </div>

        {/* Sidebar: metadata + approval history */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Details</h3>
            <dl className="space-y-1.5 text-sm">
              <Row k="Entity" v={je.entity_code} />
              <Row k="Date" v={fmtDate(je.date)} />
              <Row k="Status" v={fmtLabel(je.status)} />
              <Row k="Memo" v={je.memo || "—"} />
              <Row k="Reference" v={je.reference || "—"} />
              <Row k="Source" v={fmtLabel(je.source_type)} />
              <Row k="Source ref" v={je.source_ref || "—"} />
              {je.vendor_code && (
                <Row k="Vendor" v={`${je.vendor_code} · ${je.vendor_name}`} />
              )}
              {je.customer_code && (
                <Row k="Customer" v={`${je.customer_code} · ${je.customer_name}`} />
              )}
              <Row k="Currency" v={je.currency} />
              <Row k="Period" v={je.period_name || "—"} />
            </dl>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Approval history</h3>
            {je.approval_history.length === 0 ? (
              <p className="text-sm text-gray-400">No actions yet.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {je.approval_history.map((a) => (
                  <li key={a.id} className="border-l-2 border-brand-200 pl-3">
                    <div className="text-xs text-gray-900 font-medium">
                      {fmtLabel(a.from_status) || "—"} → {fmtLabel(a.to_status)}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {a.actor_email || "system"} · {fmtDateTime(a.at)}
                    </div>
                    {a.note && <div className="text-xs text-gray-600 mt-0.5">{a.note}</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AIReasoningPanel({ meta }: { meta: AIMetadata }) {
  const sr = meta.accounting_standard_reasoning;
  const standardCode = meta.entity_accounting_standard || "";
  const standardLabel =
    ACCOUNTING_STANDARD_LABEL[standardCode] || sr?.standard || "—";
  const conf = meta.confidence;
  const confPct =
    typeof conf === "number" && conf >= 0 && conf <= 1
      ? Math.round(conf * 100)
      : null;

  return (
    <div className="card mb-4 border-brand-100 bg-gradient-to-br from-brand-50/60 to-white p-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-2">
        <Sparkles className="w-4 h-4 text-brand-700" />
        <h3 className="text-sm font-semibold text-brand-900">
          AI proposal — why this entry
        </h3>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-brand-800/80">
          <BookOpen className="w-3 h-3" />
          {standardLabel}
          {meta.model && (
            <span className="text-brand-700/60 ml-1.5 font-mono">
              · {meta.model}
            </span>
          )}
          {confPct !== null && (
            <span
              className="ml-1.5 inline-flex items-center rounded-full bg-white/70 px-1.5 py-0.5 font-mono ring-1 ring-inset ring-brand-200"
              title="Overall extraction confidence"
            >
              {confPct}%
            </span>
          )}
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {(meta.service_period_start || meta.service_period_end) && (
          <ServicePeriodCallout
            start={meta.service_period_start}
            end={meta.service_period_end}
            standardLabel={standardLabel}
          />
        )}

        {meta.suggested_account_reasoning && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Account choice
            </div>
            <p className="text-sm text-gray-800 mt-0.5">
              {meta.suggested_account_reasoning}
            </p>
          </div>
        )}

        {sr && (sr.principle || sr.explanation) && (
          <div className="border-t border-brand-100/60 pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-700">
              {standardLabel}
              {sr.principle ? ` · ${sr.principle}` : ""}
            </div>
            <p className="text-sm text-gray-800 mt-1 leading-relaxed">
              {sr.explanation}
            </p>
            <p className="text-[10px] text-gray-400 mt-2 italic">
              Teaching note generated from the entity's accounting standard.
              No paragraph numbers are cited — look up the principle in your
              standard for the authoritative wording.
            </p>
          </div>
        )}

        {meta.warnings && meta.warnings.length > 0 && (
          <div className="border-t border-brand-100/60 pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
              AI warnings — review before approving
            </div>
            <ul className="text-xs text-amber-800 mt-1 space-y-0.5 list-disc pl-4">
              {meta.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ServicePeriodCallout({
  start, end, standardLabel,
}: { start: string | null; end: string | null; standardLabel: string }) {
  // Count distinct calendar months covered, inclusive on both ends. Mirrors
  // the multi-period flag computed in beakon_core/services/ai_drafting.py.
  let months: number | null = null;
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e >= s) {
      months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
    }
  }
  const isMultiPeriod = months !== null && months > 1;

  return (
    <div
      className={cn(
        "rounded-lg p-2.5 ring-1 ring-inset",
        isMultiPeriod
          ? "bg-amber-50/70 ring-amber-200"
          : "bg-canvas-50 ring-canvas-200",
      )}
    >
      <div className="flex items-center gap-2">
        <CalendarRange className={cn(
          "w-3.5 h-3.5",
          isMultiPeriod ? "text-amber-700" : "text-gray-500",
        )} />
        <span className={cn(
          "text-[10px] font-semibold uppercase tracking-wider",
          isMultiPeriod ? "text-amber-800" : "text-gray-500",
        )}>
          Service period
        </span>
        <span className="text-xs text-gray-700">
          {start && end ? `${start} → ${end}` : start || end}
          {months !== null && (
            <span className={cn(
              "ml-2 text-[10px] font-semibold",
              isMultiPeriod ? "text-amber-700" : "text-gray-400",
            )}>
              {months} {months === 1 ? "month" : "months"}
            </span>
          )}
        </span>
      </div>
      {isMultiPeriod && (
        <p className="text-[11px] text-amber-800 mt-1.5 leading-relaxed">
          This invoice covers more than one accounting period. Under {standardLabel} this
          typically requires period allocation: recognise the portion in the current
          period as expense, defer the rest as a prepaid asset, and amortise over the
          remaining months. The AI proposed a single-period booking — review and adjust
          before posting.
        </p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-xs text-gray-400">{k}</dt>
      <dd className="text-gray-800 text-right text-xs">{v}</dd>
    </div>
  );
}

/* Color tone per dimension type — picked so the same dimension always
 * shows the same colour across the dashboard (e.g. PORT is always sky,
 * CP always amber). Anything not in the map gets the neutral fallback. */
const DIM_TONE: Record<string, string> = {
  // Money / where it lives
  BANK: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  CUST: "bg-teal-50 text-teal-700 ring-teal-100",
  // Investment axes
  PORT: "bg-sky-50 text-sky-700 ring-sky-100",
  INST: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  STR:  "bg-violet-50 text-violet-700 ring-violet-100",
  ACL:  "bg-purple-50 text-purple-700 ring-purple-100",
  MAT:  "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100",
  TLOT: "bg-pink-50 text-pink-700 ring-pink-100",
  // People / counterparties
  CP:   "bg-amber-50 text-amber-700 ring-amber-100",
  RP:   "bg-rose-50 text-rose-700 ring-rose-100",
  FAM:  "bg-pink-50 text-pink-700 ring-pink-100",
  ENT:  "bg-brand-50 text-brand-700 ring-brand-100",
  // Holdings
  LOAN: "bg-orange-50 text-orange-700 ring-orange-100",
  PROP: "bg-yellow-50 text-yellow-800 ring-yellow-100",
  POL:  "bg-red-50 text-red-700 ring-red-100",
  PEN:  "bg-cyan-50 text-cyan-700 ring-cyan-100",
  COM:  "bg-blue-50 text-blue-700 ring-blue-100",
  // Other
  TRF:  "bg-gray-100 text-gray-700 ring-gray-200",
  JUR:  "bg-gray-100 text-gray-700 ring-gray-200",
  WAL:  "bg-gray-100 text-gray-700 ring-gray-200",
  RCAT: "bg-gray-100 text-gray-700 ring-gray-200",
  RST:  "bg-gray-100 text-gray-700 ring-gray-200",
};
const DIM_TONE_DEFAULT = "bg-canvas-50 text-gray-600 ring-canvas-200";

function DimensionBadges({ line }: { line: Line }) {
  // Prefer the backend-rendered list (covers all 20+ dimensions, with
  // human labels for FK-backed types). Fall back to the legacy 7 Tier-1
  // string codes if an older serializer didn't include it.
  const chips: DimensionChip[] = (line.dimensions_display && line.dimensions_display.length)
    ? line.dimensions_display
    : ([
        line.dimension_bank_code       && { type: "BANK", value: line.dimension_bank_code,       label: line.dimension_bank_code },
        line.dimension_custodian_code  && { type: "CUST", value: line.dimension_custodian_code,  label: line.dimension_custodian_code },
        line.dimension_portfolio_code  && { type: "PORT", value: line.dimension_portfolio_code,  label: line.dimension_portfolio_code },
        line.dimension_instrument_code && { type: "INST", value: line.dimension_instrument_code, label: line.dimension_instrument_code },
        line.dimension_strategy_code   && { type: "STR",  value: line.dimension_strategy_code,   label: line.dimension_strategy_code },
        line.dimension_asset_class_code&& { type: "ACL",  value: line.dimension_asset_class_code,label: line.dimension_asset_class_code },
        line.dimension_maturity_code   && { type: "MAT",  value: line.dimension_maturity_code,   label: line.dimension_maturity_code },
      ].filter(Boolean) as DimensionChip[]);

  if (chips.length === 0) {
    return <span className="text-xs text-gray-300">—</span>;
  }

  return (
    <div className="flex max-w-[260px] flex-wrap gap-1">
      {chips.map((c, i) => {
        const tone = DIM_TONE[c.type] ?? DIM_TONE_DEFAULT;
        return (
          <span
            key={`${c.type}-${c.value}-${i}`}
            title={`${c.type} = ${c.label}${c.label !== c.value ? ` (${c.value})` : ""}`}
            className={`inline-flex items-center gap-1 rounded-full ring-1 ring-inset px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
          >
            <span className="font-semibold">{c.type}</span>
            <span className="text-gray-300">·</span>
            <span className="font-mono">{c.label}</span>
          </span>
        );
      })}
    </div>
  );
}


/* ── Explanation editor ───────────────────────────────────────────────
 * Long-form rationale for why the entry exists and why each side was
 * debited or credited. Editable while the JE is mutable; locks once
 * posted / reversed (audit trail must preserve what backed the posting).
 */
function ExplanationCard({
  jeId, initialText, locked, onSaved,
}: {
  jeId: number;
  initialText: string;
  locked: boolean;
  onSaved: (updated: { explanation: string; status: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initialText || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setText(initialText || ""); }, [initialText]);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const updated = await api.patch<{ explanation: string; status: string }>(
        `/beakon/journal-entries/${jeId}/explanation/`,
        { explanation: text },
      );
      onSaved(updated);
      setEditing(false);
    } catch (e: any) {
      setErr(e?.error?.message || e?.detail || "Failed to save explanation");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setText(initialText || "");
    setEditing(false);
    setErr(null);
  };

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Explanation</h3>
          <p className="text-[11px] text-gray-500">
            Why this entry exists and why each side was debited or credited.
            Visible to auditors.
          </p>
        </div>
        {!locked && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" /> {initialText ? "Edit" : "Add"}
          </button>
        )}
        {locked && (
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">
            Locked
          </span>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="e.g. We debited Office Rent because the WeWork invoice covered April. Credited Operating Bank because the wire cleared on Apr 30. Booked under operating expenses (not prepaid) since the service period is fully consumed."
            className="input w-full text-sm font-mono"
            disabled={saving}
            autoFocus
          />
          {err && <p className="text-xs text-red-700">{err}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button" onClick={cancel}
              className="btn-secondary text-xs"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button" onClick={save}
              className="btn-primary text-xs inline-flex items-center gap-1"
              disabled={saving}
            >
              {saving
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                : <><Check className="w-3 h-3" /> Save</>}
            </button>
          </div>
        </div>
      ) : initialText ? (
        <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
          {initialText}
        </p>
      ) : (
        <p className="text-sm text-gray-400 italic">
          {locked
            ? "No explanation was recorded for this entry."
            : "Click Add to record why this entry exists."}
        </p>
      )}
    </div>
  );
}


/* ── Attachments card ─────────────────────────────────────────────────
 * Source documents (bills, receipts, contracts, screenshots) attached to
 * this JE. Uses the SourceDocument REST surface; lists non-deleted only.
 * Soft-delete blocked once the JE is posted/reversed by the kernel — UI
 * mirrors that by hiding the trash button.
 */
interface JEDocument {
  id: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  description: string;
  uploaded_by_email: string | null;
  uploaded_at: string;
}

function AttachmentsCard({
  jeId, locked, onCountChange,
}: {
  jeId: number;
  locked: boolean;
  onCountChange: (n: number) => void;
}) {
  const [docs, setDocs] = useState<JEDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reload = async () => {
    setLoading(true); setErr(null);
    try {
      const d = await api.get<JEDocument[]>(`/beakon/journal-entries/${jeId}/documents/`);
      setDocs(d);
      onCountChange(d.length);
    } catch (e: any) {
      setErr(e?.error?.message || e?.detail || "Failed to load attachments");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [jeId]);

  const upload = async (file: File) => {
    setUploading(true); setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;
      const resp = await fetch(
        `${API_BASE}/beakon/journal-entries/${jeId}/documents/`,
        { method: "POST", headers, body: fd },
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body?.detail || body?.error?.message || `HTTP ${resp.status}`);
      }
      await reload();
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (docId: number) => {
    if (!confirm("Remove this attachment? (soft-delete only — file stays in the audit trail)")) return;
    setErr(null);
    try {
      await api.delete(`/beakon/documents/${docId}/`);
      await reload();
    } catch (e: any) {
      setErr(e?.error?.message || e?.detail || "Failed to remove");
    }
  };

  const downloadUrl = (id: number) => `${API_BASE}/beakon/documents/${id}/`;

  return (
    <div className="card p-5 mt-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <Paperclip className="w-4 h-4 text-gray-500" /> Attachments
            {docs.length > 0 && (
              <span className="text-[11px] font-normal text-gray-500">
                ({docs.length})
              </span>
            )}
          </h3>
          <p className="text-[11px] text-gray-500">
            Source documents — bills, receipts, contracts, statements. PDF, image, CSV, email up to 25 MB.
          </p>
        </div>
        {/* Upload is always allowed — auditors often add supporting docs after
         * a JE posts (bank confirmation arrives late, signed contract scanned
         * later, etc.). The kernel only blocks soft-delete on posted/reversed. */}
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-secondary text-xs inline-flex items-center gap-1"
        >
          {uploading
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
            : <><Upload className="w-3 h-3" /> Upload</>}
        </button>
      </div>
      {err && <p className="text-xs text-red-700 mb-2">{err}</p>}
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No attachments yet. Click <span className="font-medium text-gray-600">Upload</span>{" "}
          to attach a bill, receipt, contract, or any supporting document for this entry.
        </p>
      ) : (
        <ul className="divide-y divide-canvas-100">
          {docs.map((d) => (
            <li key={d.id} className="py-2 flex items-center gap-3">
              <FileText className="w-4 h-4 text-gray-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <a
                  href={downloadUrl(d.id)}
                  target="_blank" rel="noreferrer"
                  className="text-sm text-gray-900 hover:underline truncate block"
                  title={d.original_filename}
                >
                  {d.original_filename}
                </a>
                <div className="text-[11px] text-gray-500">
                  {fmtSize(d.size_bytes)} · {d.uploaded_by_email || "system"} · {fmtDateTime(d.uploaded_at)}
                </div>
              </div>
              <a
                href={downloadUrl(d.id)}
                target="_blank" rel="noreferrer"
                className="p-1 text-gray-500 hover:text-gray-900"
                title="Download"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
              {!locked && (
                <button
                  onClick={() => void remove(d.id)}
                  className="p-1 text-gray-400 hover:text-red-600"
                  title="Remove (soft-delete)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
