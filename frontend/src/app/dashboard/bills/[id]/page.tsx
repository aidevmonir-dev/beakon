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
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtDateTime, fmtLabel } from "@/lib/format";


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
  notes: string;
  lines: Line[];
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
