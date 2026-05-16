"use client";

/* Bill detail page — view a single Bill record with its line items,
 * status timeline, and linked accrual / payment journal entries.
 *
 * Action buttons mirror the inline actions on the bills list page:
 *   draft            → Submit · Cancel
 *   pending_approval → Approve · Reject · Return to draft
 *   approved         → Mark paid
 *   rejected         → Return to draft
 *   paid / cancelled → (read-only)
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Send, CheckCircle2, XCircle, RotateCcw, Ban, DollarSign, X,
  Sparkles, Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtDateTime, fmtLabel } from "@/lib/format";
import { RationaleDocsPanel, type SourceDoc } from "@/components/rationale-docs-panel";


interface LearningRule {
  id: number;
  vendor_code: string | null;
  vendor_name: string | null;
  scope: string;
  scope_label: string;
  confidence_policy: string;
  confidence_policy_label: string;
  correction_type: string;
  human_instruction: string;
  is_active: boolean;
  created_at: string;
}

interface Correction {
  id: number;
  bill: number;
  vendor: number;
  vendor_code: string | null;
  correction_text: string;
  error_types: string[];
  make_reusable_rule: boolean;
  future_rule_instruction: string;
  promoted_rule: LearningRule | null;
  ai_proposal_snapshot: Record<string, unknown>;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}


interface Line {
  id: number;
  expense_account: number;
  expense_account_code: string;
  expense_account_name: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_code: number | null;
  tax_code_label: string | null;
  tax_code_rate: string | null;
  tax_amount: string;
  line_order: number;
}

interface Bill {
  id: number;
  reference: string;
  bill_number: string;
  entity: number;
  entity_code: string;
  vendor: number;
  vendor_code: string;
  vendor_name: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  status: string;
  description: string;
  explanation: string;
  notes: string;
  lines: Line[];
  documents: SourceDoc[];
  corrections: Correction[];
  accrual_journal_entry: number | null;
  accrual_journal_entry_number: string | null;
  payment_journal_entry: number | null;
  payment_journal_entry_number: string | null;
  payment_bank_account: number | null;
  payment_bank_account_code: string | null;
  payment_reference: string;
  payment_date: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string;
  paid_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "paid": return "badge-green";
    case "approved": return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected": return "badge-red";
    default: return "badge-gray";
  }
}

const ACTIONS_BY_STATUS: Record<string, string[]> = {
  draft: ["submit", "cancel"],
  pending_approval: ["approve", "reject", "return"],
  approved: ["pay"],
  rejected: ["return"],
};


export default function BillDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const b = await api.get<Bill>(`/beakon/bills/${id}/`);
      setBill(b);
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || "Failed to load bill");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [id]);

  const act = async (path: string, body: object = {}, confirmMsg?: string) => {
    if (!bill) return;
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/beakon/bills/${bill.id}/${path}/`, body);
      await load();
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>;
  }
  if (!bill) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-gray-500">{err || "Not found"}</p>
        <Link href="/dashboard/bills"
              className="text-sm text-brand-700 mt-2 inline-block">
          ← Back to bills
        </Link>
      </div>
    );
  }

  const actions = ACTIONS_BY_STATUS[bill.status] || [];

  return (
    <div>
      <Link href="/dashboard/bills"
            className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to bills
      </Link>

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-semibold text-gray-900">{bill.reference}</h1>
            <span className={statusBadge(bill.status)}>{fmtLabel(bill.status)}</span>
          </div>
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{bill.vendor_name}</span>
            <span className="text-gray-400"> · {bill.vendor_code}</span>
            <span className="text-gray-400"> · {bill.entity_code}</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {bill.bill_number && <>Invoice #{bill.bill_number} · </>}
            {fmtDate(bill.invoice_date)}
            {bill.due_date && <> · Due {fmtDate(bill.due_date)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actions.includes("submit") && (
            <button onClick={() => act("submit-for-approval")} disabled={busy}
                    className="btn-primary">
              <Send className="w-4 h-4 mr-1.5" /> Submit for approval
            </button>
          )}
          {actions.includes("approve") && (
            <button onClick={() => act("approve", {},
                      `Approve bill ${bill.reference}? This posts the accrual JE.`)}
                    disabled={busy} className="btn-primary">
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Approve
            </button>
          )}
          {actions.includes("reject") && (
            <button onClick={() => {
              const reason = prompt("Rejection reason:");
              if (reason !== null) void act("reject", { reason });
            }} disabled={busy} className="btn-danger">
              <XCircle className="w-4 h-4 mr-1.5" /> Reject
            </button>
          )}
          {actions.includes("return") && (
            <button onClick={() => act("return-to-draft")} disabled={busy}
                    className="btn-secondary">
              <RotateCcw className="w-4 h-4 mr-1.5" /> Return to draft
            </button>
          )}
          {actions.includes("pay") && (
            <button onClick={() => setPayOpen(true)} disabled={busy}
                    className="btn-primary">
              <DollarSign className="w-4 h-4 mr-1.5" /> Mark paid
            </button>
          )}
          {actions.includes("cancel") && (
            <button onClick={() => act("cancel", {},
                      `Cancel bill ${bill.reference}? This is final.`)}
                    disabled={busy} className="btn-secondary">
              <Ban className="w-4 h-4 mr-1.5" /> Cancel
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="card p-3 mb-4 border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
      )}

      {bill.rejection_reason && (
        <div className="card p-3 mb-4 border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
          <span className="font-semibold">Rejected: </span> {bill.rejection_reason}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Description & Lines (main column) ──────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {bill.description && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                Description
              </h3>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{bill.description}</p>
            </div>
          )}

          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Line items
            </h3>
            {bill.lines.length === 0 ? (
              <p className="text-sm text-gray-400">No lines.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                    <th className="pb-2 pr-3 font-medium">Account</th>
                    <th className="pb-2 pr-3 font-medium">Description</th>
                    <th className="pb-2 pl-3 font-medium text-right">Amount</th>
                    <th className="pb-2 pl-3 font-medium text-right">Tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-canvas-100">
                  {bill.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 pr-3 text-xs">
                        <span className="font-mono text-gray-700">{l.expense_account_code}</span>
                        <span className="text-gray-500"> · {l.expense_account_name}</span>
                      </td>
                      <td className="py-2 pr-3 text-gray-800">{l.description || "—"}</td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums">
                        {fmt2(l.amount)}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono tabular-nums text-gray-500">
                        {l.tax_code_label
                          ? <>{fmt2(l.tax_amount)} <span className="text-gray-400 text-xs">({l.tax_code_label})</span></>
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-canvas-200">
                  <tr>
                    <td colSpan={2} className="pt-3 text-right text-xs text-gray-500">Subtotal</td>
                    <td className="pt-3 pl-3 text-right font-mono tabular-nums">
                      {fmt2(bill.subtotal)}
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={2} className="text-right text-xs text-gray-500">Tax</td>
                    <td className="pl-3 text-right font-mono tabular-nums">
                      {fmt2(bill.tax_amount)}
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={2} className="pt-1 text-right text-sm font-semibold text-gray-900">
                      Total
                    </td>
                    <td className="pt-1 pl-3 text-right font-mono font-semibold tabular-nums text-base text-gray-900">
                      {bill.currency} {fmt2(bill.total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {bill.notes && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                Notes
              </h3>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{bill.notes}</p>
            </div>
          )}
        </div>

        {/* ── Sidebar: Timeline + Linked JEs ─────────────────── */}
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Status timeline
            </h3>
            <ul className="space-y-2 text-xs">
              <TimelineRow label="Created" at={bill.created_at} />
              <TimelineRow label="Submitted" at={bill.submitted_at} />
              <TimelineRow label="Approved" at={bill.approved_at} />
              <TimelineRow label="Rejected" at={bill.rejected_at} />
              <TimelineRow label="Paid" at={bill.paid_at} />
              <TimelineRow label="Cancelled" at={bill.cancelled_at} />
            </ul>
          </div>

          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">
              Linked journal entries
            </h3>
            <ul className="space-y-1.5 text-sm">
              {bill.accrual_journal_entry ? (
                <li>
                  <Link href={`/dashboard/journal-entries/${bill.accrual_journal_entry}`}
                        className="text-brand-700 hover:underline">
                    Accrual · {bill.accrual_journal_entry_number}
                  </Link>
                </li>
              ) : (
                <li className="text-xs text-gray-400">Accrual JE not posted yet</li>
              )}
              {bill.payment_journal_entry ? (
                <li>
                  <Link href={`/dashboard/journal-entries/${bill.payment_journal_entry}`}
                        className="text-brand-700 hover:underline">
                    Payment · {bill.payment_journal_entry_number}
                  </Link>
                </li>
              ) : (
                <li className="text-xs text-gray-400">Payment JE not posted yet</li>
              )}
            </ul>
            {bill.payment_bank_account_code && (
              <p className="text-[11px] text-gray-500 mt-2 pt-2 border-t border-canvas-100">
                Paid from {bill.payment_bank_account_code}
                {bill.payment_reference && <> · ref {bill.payment_reference}</>}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Rationale + source-document cross-check.
       * Spec: every import-transaction screen shows the human's "why this
       * debit/credit" text alongside the original PDF/image so the reviewer
       * can verify the extracted lines against the source.
       * If the bill was prefilled by AI, parseAISource() reads the stable
       * "[AI-EXTRACTED:<model>] from <filename>" prefix on bill.notes so the
       * panel can flag the rationale as an AI proposal. */}
      <RationaleDocsPanel
        parentBasePath={`/beakon/bills/${bill.id}`}
        initialExplanation={bill.explanation || ""}
        initialDocuments={bill.documents}
        explanationLocked={bill.status !== "draft" && bill.status !== "pending_approval"}
        attachmentsLocked={bill.status === "approved" || bill.status === "paid"}
        aiSource={parseAISource(bill.notes)}
        onExplanationSaved={(next) =>
          setBill((b) => (b ? { ...b, explanation: next } : b))
        }
        onDocumentsChanged={(_count) => { /* count surfaced if needed */ }}
      />

      {/* Thomas 2026-05-12: capture what the AI got wrong so Beakon can
          learn for the next invoice from this vendor. Phase A = capture
          history; Phase B will feed these notes back into the next OCR
          extraction prompt automatically. */}
      <CorrectionsPanel
        billId={bill.id}
        vendorName={bill.vendor_name}
        initialCorrections={bill.corrections || []}
        onCorrectionAdded={(next) =>
          setBill((b) => (b ? { ...b, corrections: [next, ...(b.corrections || [])] } : b))
        }
      />

      {payOpen && (
        <PayModal
          bill={bill}
          onClose={() => setPayOpen(false)}
          onPaid={async () => { setPayOpen(false); await load(); }}
        />
      )}
    </div>
  );
}


function TimelineRow({ label, at }: { label: string; at: string | null }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800 font-mono tabular-nums text-[11px]">
        {at ? fmtDateTime(at) : <span className="text-gray-300">—</span>}
      </span>
    </li>
  );
}


// ── Teach Beakon panel ────────────────────────────────────────────────────
// Thomas 2026-05-12 spec: structured correction layer (not free-text only).
// Three inputs: (1) structured error-type checkboxes, (2) plain-English
// explanation of the correction, (3) scope choice — one-off OR reusable
// rule. When the user picks "remember for future invoices" a second
// textarea collects the rule instruction that will become a LearningRule
// in B3. Bills in any status can receive corrections — the goal is to
// teach Beakon, not to mutate the bill itself.
//
// Thomas's verbatim copy is preserved everywhere — button label, panel
// title, intro sentence, scope-radio labels — see project_teach_beakon_spec.

interface ErrorType { key: string; label: string }

const ERROR_TYPES: ErrorType[] = [
  { key: "wrong_account",       label: "Wrong account" },
  { key: "wrong_amount",        label: "Wrong amount" },
  { key: "duplicate_line",      label: "Duplicate line" },
  { key: "vat_treatment_wrong", label: "VAT treatment wrong" },
  { key: "missing_allocation",  label: "Missing recharge/allocation" },
  { key: "wrong_entity",        label: "Wrong entity" },
  { key: "wrong_vendor",        label: "Wrong vendor" },
  { key: "wrong_description",   label: "Wrong description" },
  { key: "other",               label: "Other" },
];


function CorrectionsPanel({
  billId, vendorName, initialCorrections, onCorrectionAdded,
}: {
  billId: number;
  vendorName: string;
  initialCorrections: Correction[];
  onCorrectionAdded: (c: Correction) => void;
}) {
  const [text, setText] = useState("");
  const [errorTypes, setErrorTypes] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"one_off" | "reusable">("one_off");
  const [futureInstruction, setFutureInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Confirmation banner shown after a successful save. Surfaces whether a
  // LearningRule was promoted (Thomas §6 — the user needs to see that the
  // rule landed somewhere durable).
  const [lastSaved, setLastSaved] = useState<Correction | null>(null);

  const toggleErrorType = (key: string) => {
    setErrorTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const reusable = scope === "reusable";
  const canSave =
    text.trim().length > 0 &&
    (!reusable || futureInstruction.trim().length > 0);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      const created = await api.post<Correction>(
        `/beakon/bills/${billId}/corrections/`,
        {
          correction_text: text.trim(),
          error_types: Array.from(errorTypes),
          make_reusable_rule: reusable,
          future_rule_instruction: reusable ? futureInstruction.trim() : "",
        },
      );
      onCorrectionAdded(created);
      setLastSaved(created);
      // Reset form
      setText("");
      setErrorTypes(new Set());
      setScope("one_off");
      setFutureInstruction("");
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || "Could not save correction.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 card p-4 sm:p-5">
      <div className="flex items-start gap-2 mb-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-mint-50 text-mint-700 ring-1 ring-mint-100">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900 leading-tight">
            Teach Beakon
          </h3>
          <p className="text-[11.5px] text-gray-500 mt-0.5 leading-relaxed">
            Tell Beakon what was wrong with this draft. Beakon will correct
            this journal entry and, if you choose, remember the rule for
            similar invoices in future. Vendor:{" "}
            <span className="font-medium text-gray-700">{vendorName}</span>.
          </p>
        </div>
      </div>

      {err && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {err}
        </div>
      )}

      {lastSaved && (
        // Confirmation tile after save. Two variants: plain "saved" for
        // one-off corrections; richer "rule created" for reusable rules
        // so the user can see what was stored in the registry.
        <div className="mb-3 rounded-lg border border-mint-200 bg-mint-50 px-3 py-2.5 text-xs text-mint-800">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {lastSaved.promoted_rule ? (
                <>
                  <p className="font-semibold leading-tight">
                    Learning rule saved · {lastSaved.promoted_rule.scope_label}
                  </p>
                  <p className="mt-1 leading-relaxed text-mint-900">
                    Beakon will apply this on the next bill from{" "}
                    <span className="font-semibold">
                      {lastSaved.promoted_rule.vendor_name || lastSaved.vendor_code}
                    </span>
                    . Policy: <span className="font-semibold">
                      {lastSaved.promoted_rule.confidence_policy_label}
                    </span>{" "}
                    (you&apos;ll still review the first use).
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold leading-tight">Correction saved</p>
                  <p className="mt-1 leading-relaxed text-mint-900">
                    Recorded for audit. No reusable rule was created.
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLastSaved(null)}
              className="shrink-0 text-mint-700 hover:text-mint-900"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Error type ── */}
      <fieldset className="mb-4">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">
          What was wrong?
        </legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
          {ERROR_TYPES.map((t) => (
            <label
              key={t.key}
              className="inline-flex items-center gap-2 text-[12.5px] text-gray-700 cursor-pointer hover:text-gray-900"
            >
              <input
                type="checkbox"
                checked={errorTypes.has(t.key)}
                onChange={() => toggleErrorType(t.key)}
                disabled={saving}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── Explanation (correction itself) ── */}
      <div className="mb-4">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-1.5">
          Explain the correction
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "Mobile total 137.70 already includes the device instalment 41.90 — that line was added twice. Final payable should reconcile to invoice total 201.80."'
          rows={3}
          className="input w-full text-sm leading-relaxed"
          disabled={saving}
        />
      </div>

      {/* ── Scope ── */}
      <fieldset className="mb-4">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">
          Scope
        </legend>
        <div className="space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="teach-scope"
              checked={scope === "one_off"}
              onChange={() => setScope("one_off")}
              disabled={saving}
              className="mt-0.5 h-3.5 w-3.5 border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-[13px] text-gray-800 leading-tight">
              Fix this draft only
              <span className="block text-[11px] text-gray-500 mt-0.5">
                Apply to this invoice only — do not change future invoices.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="teach-scope"
              checked={scope === "reusable"}
              onChange={() => setScope("reusable")}
              disabled={saving}
              className="mt-0.5 h-3.5 w-3.5 border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-[13px] text-gray-800 leading-tight">
              Fix this draft and remember for future invoices
              <span className="block text-[11px] text-gray-500 mt-0.5">
                Save a reusable rule for similar invoices from this vendor.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {/* ── Future-rule instruction (only when reusable) ── */}
      {reusable && (
        <div className="mb-4">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-1.5">
            How should Beakon treat similar invoices in future?
          </label>
          <textarea
            value={futureInstruction}
            onChange={(e) => setFutureInstruction(e.target.value)}
            placeholder="Example: For Sunrise invoices, do not add device instalments separately when they are already included in the Mobile total. Use the VAT declaration and ensure the JE reconciles to the invoice total."
            rows={3}
            className="input w-full text-sm leading-relaxed"
            disabled={saving}
          />
          <p className="mt-1 text-[11px] text-gray-400 leading-snug">
            Required when you choose to remember the rule. Beakon will apply
            this on the next invoice from {vendorName}.
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !canSave}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Correct &amp; teach Beakon
            </>
          )}
        </button>
      </div>

      {initialCorrections.length > 0 && (
        <div className="mt-5 pt-4 border-t border-canvas-200">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">
            Previous corrections ({initialCorrections.length})
          </h4>
          <ul className="space-y-2.5">
            {initialCorrections.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-canvas-200 bg-canvas-50 px-3 py-2.5"
              >
                {c.error_types?.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {c.error_types.map((k) => (
                      <span
                        key={k}
                        className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-1.5 py-0.5 text-[10px] font-medium"
                      >
                        {ERROR_TYPES.find((t) => t.key === k)?.label || k}
                      </span>
                    ))}
                    {c.make_reusable_rule && (
                      <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200 px-1.5 py-0.5 text-[10px] font-semibold">
                        Reusable rule
                      </span>
                    )}
                  </div>
                )}
                <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {c.correction_text}
                </p>
                {c.make_reusable_rule && c.future_rule_instruction && (
                  <div className="mt-2 pt-2 border-t border-canvas-200/60">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-blue-700 mb-0.5">
                      Future-rule instruction
                    </p>
                    <p className="text-[12.5px] text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {c.future_rule_instruction}
                    </p>
                    {c.promoted_rule && (
                      <p className="mt-1.5 text-[10.5px] text-gray-500">
                        Rule #{c.promoted_rule.id}
                        <span className="text-gray-300"> · </span>
                        {c.promoted_rule.scope_label}
                        <span className="text-gray-300"> · </span>
                        {c.promoted_rule.confidence_policy_label}
                        {!c.promoted_rule.is_active && (
                          <span className="ml-2 text-amber-700 font-medium">(inactive)</span>
                        )}
                      </p>
                    )}
                  </div>
                )}
                <p className="mt-1.5 text-[10.5px] text-gray-500">
                  {c.created_by_name || "Someone"}
                  <span className="text-gray-300"> · </span>
                  <span className="font-mono tabular-nums">{fmtDateTime(c.created_at)}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


/* Parse "[AI-EXTRACTED:<model>] from <filename>" — the stable prefix the
 * bills create drawer writes onto Bill.notes when the draft was prefilled
 * by OCR. Returns null when the bill was created manually so the panel
 * skips the AI provenance strip. */
function parseAISource(notes: string): { model: string; filename: string | null } | null {
  if (!notes) return null;
  const m = notes.match(/^\[AI-EXTRACTED:([^\]]+)\](?:\s+from\s+(\S+))?/);
  if (!m) return null;
  return { model: m[1].trim(), filename: m[2] || null };
}


// ── Pay modal ─────────────────────────────────────────────────────────────
// Re-implemented locally rather than importing from the list page so this
// route doesn't depend on the list module's internals. Same payload shape.

interface BankAccount {
  id: number; code: string; name: string; entity_code: string | null;
}

function PayModal({
  bill, onClose, onPaid,
}: { bill: Bill; onClose: () => void; onPaid: () => Promise<void> }) {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    payment_date: today,
    bank_account: "",
    reference: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ results: BankAccount[] } | BankAccount[]>("/beakon/accounts/",
      { account_subtype: "bank" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d.results ?? []);
        const valid = list.filter((a) => !a.entity_code || a.entity_code === bill.entity_code);
        setAccounts(valid);
        if (valid.length) setForm((f) => ({ ...f, bank_account: String(valid[0].id) }));
      })
      .catch(() => setAccounts([]));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/beakon/bills/${bill.id}/mark-paid/`, {
        payment_date: form.payment_date,
        bank_account: Number(form.bank_account),
        reference: form.reference,
      });
      await onPaid();
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e?.detail || e || "Pay failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4"
         role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white rounded-2xl border border-canvas-200 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">Pay bill {bill.reference}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="rounded-lg bg-canvas-50 p-3 text-sm">
            <div className="text-gray-900 font-medium">{bill.vendor_name}</div>
            <div className="text-xs text-gray-500">{bill.entity_code} · {bill.bill_number || bill.reference}</div>
            <div className="font-mono text-base mt-1 tabular-nums">
              {bill.currency} {fmt2(bill.total)}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Payment date *</span>
            <input type="date" className="input mt-1" value={form.payment_date}
                   onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">From bank account *</span>
            <select className="input mt-1" value={form.bank_account}
                    onChange={(e) => setForm((f) => ({ ...f, bank_account: e.target.value }))}>
              <option value="">— pick a bank account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}{a.entity_code ? ` (${a.entity_code})` : " (shared)"}
                </option>
              ))}
            </select>
            {accounts.length === 0 && (
              <span className="text-[10px] text-amber-700 mt-1 block">
                No bank accounts on {bill.entity_code}. Create one in Chart of Accounts first.
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Reference</span>
            <input className="input mt-1 font-mono" value={form.reference}
                   onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                   placeholder="WIRE-12345 / Check #1042" />
          </label>
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>
          )}
          <div className="text-[11px] text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
            Marking paid will <strong>auto-post</strong> a payment journal entry:
            DR {bill.vendor_code} payable / CR selected bank account.
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy || !form.bank_account} className="btn-primary">
              {busy ? "Posting…" : "Confirm payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
