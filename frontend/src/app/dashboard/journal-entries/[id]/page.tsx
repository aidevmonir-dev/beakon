"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Send, CheckCircle2, XCircle, RotateCcw, Undo2,
  Sparkles, BookOpen,
} from "lucide-react";
import { api } from "@/lib/api";
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
  reference: string;
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-xs text-gray-400">{k}</dt>
      <dd className="text-gray-800 text-right text-xs">{v}</dd>
    </div>
  );
}

function DimensionBadges({ line }: { line: Line }) {
  const tags = [
    line.dimension_bank_code ? `BANK:${line.dimension_bank_code}` : "",
    line.dimension_custodian_code ? `CUST:${line.dimension_custodian_code}` : "",
    line.dimension_portfolio_code ? `PORT:${line.dimension_portfolio_code}` : "",
    line.dimension_instrument_code ? `INST:${line.dimension_instrument_code}` : "",
    line.dimension_strategy_code ? `STR:${line.dimension_strategy_code}` : "",
    line.dimension_asset_class_code ? `ACL:${line.dimension_asset_class_code}` : "",
    line.dimension_maturity_code ? `MAT:${line.dimension_maturity_code}` : "",
  ].filter(Boolean);

  if (tags.length === 0) {
    return <span className="text-xs text-gray-300">—</span>;
  }

  return (
    <div className="flex max-w-[220px] flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-canvas-200 bg-canvas-50 px-2 py-0.5 text-[10px] font-medium text-gray-600"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
