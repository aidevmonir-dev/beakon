"use client";

/* Travel & Expense — claim detail.
 *
 * Three regions:
 *   • header card — trip title, dates, status, action buttons
 *   • lines table — add / edit / remove receipts (only while editable)
 *   • totals strip — counts + claim-currency total
 *
 * Status transitions go through dedicated endpoints (submit / approve
 * / reject / reimburse) so timestamps and approver are set
 * server-side. The page reloads the claim after each transition.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle, ArrowRight, Calendar, CheckCircle2, Clock, Edit3,
  FileText, Plane, Plus, Receipt, Trash2, User, Wallet, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import WorkflowBack from "@/components/workflow-back";
import {
  formatDateRange, formatMoney, STATUS_TONE, StatusPill, TripStatus,
} from "../page";


interface TripExpense {
  id: number;
  claim: number;
  date: string | null;
  category: string;
  category_label: string;
  description: string;
  merchant: string;
  amount: string;
  currency: string;
  fx_rate: string | null;
  amount_in_claim_currency: string;
  vat_amount: string | null;
  receipt_url: string;
  billable_to_client: boolean;
}


interface TripClaim {
  id: number;
  title: string;
  purpose: string;
  destination: string;
  entity: number;
  entity_code: string;
  currency: string;
  total_amount: string | null;
  is_editable: boolean;
  start_date: string | null;
  end_date: string | null;
  status: TripStatus;
  status_label: string;
  rejection_reason: string;
  notes: string;
  created_by: number;
  created_by_email: string;
  approver: number | null;
  approver_email: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  reimbursed_at: string | null;
  expenses: TripExpense[];
}


const CATEGORIES: { value: string; label: string }[] = [
  { value: "transport",     label: "Transport (flight, train, taxi)" },
  { value: "accommodation", label: "Accommodation" },
  { value: "meals",         label: "Meals" },
  { value: "per_diem",      label: "Per diem" },
  { value: "entertainment", label: "Entertainment" },
  { value: "fuel",          label: "Fuel" },
  { value: "mileage",       label: "Mileage" },
  { value: "conference",    label: "Conference / training" },
  { value: "other",         label: "Other" },
];


const CURRENCIES = ["CHF", "EUR", "USD", "GBP", "JPY", "CAD", "AUD", "AED", "SGD"];


export default function TripClaimDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);

  const [claim, setClaim] = useState<TripClaim | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const data = await api.get<TripClaim>(`/beakon/trip-claims/${id}/`);
      setClaim(data);
    } catch {
      setError("Could not load claim.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); /* eslint-disable-line */ }, [id]);

  const [meId, setMeId] = useState<number | null>(null);
  useEffect(() => {
    api.get<{ id: number }>("/auth/me/").then((u) => setMeId(u.id)).catch(() => {});
  }, []);

  if (loading && !claim) {
    return (
      <div>
        <PageHeader title="Trip claim" description="Loading…" />
        <div className="mt-5 h-48 rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse" />
      </div>
    );
  }

  if (error || !claim) {
    return (
      <div>
        <PageHeader title="Trip claim" />
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error || "Claim not found."}</span>
        </div>
      </div>
    );
  }

  const total = Number(claim.total_amount || 0);

  return (
    <div>
      <PageHeader
        title={claim.title}
        description={claim.destination ? `Trip to ${claim.destination}` : "Trip claim"}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={claim.status} label={claim.status_label} />
          </div>
        }
      />

      <div className="mt-2 mb-4">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref="/dashboard/travel" />
        </Suspense>
      </div>

      <ClaimHeader claim={claim} meId={meId} onChanged={() => void reload()} onDeleted={() => router.push("/dashboard/travel")} />

      <ExpensesPanel claim={claim} onChanged={() => void reload()} />

      <TotalsStrip count={claim.expenses.length} total={total} currency={claim.currency} />
    </div>
  );
}


// ── Header card with action buttons ──────────────────────────────


function ClaimHeader({
  claim, meId, onChanged, onDeleted,
}: {
  claim: TripClaim;
  meId: number | null;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const isOwn = meId !== null && claim.created_by === meId;

  const post = async (action: string, body?: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      await api.post(`/beakon/trip-claims/${claim.id}/${action}/`, body || {});
      onChanged();
      setShowRejectInput(false);
      setRejectReason("");
    } catch (err: any) {
      setError(err?.detail || `Action failed: ${action}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete claim "${claim.title}"? This cannot be undone.`)) return;
    setBusy(true); setError("");
    try {
      await api.delete(`/beakon/trip-claims/${claim.id}/`);
      onDeleted();
    } catch (err: any) {
      setError(err?.detail || "Failed to delete claim.");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-canvas-200/70 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className={cn("shrink-0 h-10 w-10 rounded-xl flex items-center justify-center", STATUS_TONE[claim.status].iconWell)}>
          <Plane className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDateRange(claim.start_date, claim.end_date) || "No dates"}
            </span>
            <span className="text-canvas-300">·</span>
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-gray-400">
              {claim.entity_code}
            </span>
            <span className="text-canvas-300">·</span>
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {claim.created_by_email || "Employee"}
            </span>
            {claim.approver_email && (
              <>
                <span className="text-canvas-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-mint-600" />
                  Approved by {claim.approver_email}
                </span>
              </>
            )}
          </div>
          {claim.purpose && (
            <p className="mt-2 text-[13px] text-gray-700 leading-relaxed">{claim.purpose}</p>
          )}
          {claim.status === "rejected" && claim.rejection_reason && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-800">
              <strong>Rejected:</strong> {claim.rejection_reason}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-canvas-100 pt-4">
        {claim.is_editable && claim.expenses.length > 0 && isOwn && (
          <button
            onClick={() => post("submit")}
            disabled={busy}
            className="btn-primary text-sm"
          >
            <Clock className="w-4 h-4 mr-1.5" />
            Submit for approval
          </button>
        )}

        {claim.status === "submitted" && !isOwn && (
          <>
            <button
              onClick={() => post("approve")}
              disabled={busy}
              className="btn-primary text-sm"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              Approve
            </button>
            <button
              onClick={() => setShowRejectInput((s) => !s)}
              disabled={busy}
              className="btn-secondary text-sm"
            >
              <X className="w-4 h-4 mr-1.5" />
              Reject
            </button>
          </>
        )}

        {claim.status === "submitted" && isOwn && (
          <span className="text-[12px] text-gray-500 italic">
            Waiting on approver — a different user must approve.
          </span>
        )}

        {claim.status === "approved" && (
          <button
            onClick={() => post("reimburse")}
            disabled={busy}
            className="btn-primary text-sm"
          >
            <Wallet className="w-4 h-4 mr-1.5" />
            Mark as reimbursed
          </button>
        )}

        {claim.is_editable && (
          <button
            onClick={remove}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-rose-700 hover:text-rose-900"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete claim
          </button>
        )}
      </div>

      {showRejectInput && claim.status === "submitted" && (
        <div className="mt-3 rounded-lg border border-canvas-200 bg-canvas-50/40 p-3">
          <label className="text-[11.5px] font-medium text-gray-700">Reason</label>
          <textarea
            className="input mt-1.5 min-h-[60px]"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this claim being rejected?"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRejectInput(false)}
              className="text-[12px] text-gray-600 hover:text-gray-900"
            >Cancel</button>
            <button
              type="button"
              onClick={() => post("reject", { reason: rejectReason })}
              disabled={busy || !rejectReason.trim()}
              className="btn-primary text-sm"
            >Reject claim</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Expenses panel ────────────────────────────────────────────────


function ExpensesPanel({
  claim, onChanged,
}: {
  claim: TripClaim;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <div className="mt-5 rounded-2xl border border-canvas-200/70 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-2 border-b border-canvas-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-brand-700" />
          <h2 className="text-[14px] font-semibold text-gray-900">Receipts &amp; expenses</h2>
        </div>
        {claim.is_editable && !adding && editingId === null && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-[12px] font-medium text-brand-700 hover:bg-brand-100 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add receipt
          </button>
        )}
      </div>

      {claim.expenses.length === 0 && !adding ? (
        <div className="px-6 py-10 text-center text-[13px] text-gray-500">
          No receipts yet.
          {claim.is_editable && " Click 'Add receipt' to log your first expense."}
        </div>
      ) : (
        <ul className="divide-y divide-canvas-100">
          {claim.expenses.map((exp) => (
            <li key={exp.id}>
              {editingId === exp.id ? (
                <ExpenseForm
                  claim={claim}
                  expense={exp}
                  onSaved={() => { setEditingId(null); onChanged(); }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ExpenseRow
                  expense={exp}
                  claimCurrency={claim.currency}
                  editable={claim.is_editable}
                  onEdit={() => setEditingId(exp.id)}
                  onDelete={async () => {
                    if (!confirm("Delete this receipt?")) return;
                    try {
                      await api.delete(`/beakon/trip-expenses/${exp.id}/`);
                      onChanged();
                    } catch { /* ignore */ }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <ExpenseForm
          claim={claim}
          expense={null}
          onSaved={() => { setAdding(false); onChanged(); }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}


function ExpenseRow({
  expense, claimCurrency, editable, onEdit, onDelete,
}: {
  expense: TripExpense;
  claimCurrency: string;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sameCurrency = expense.currency === claimCurrency;
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <div className="shrink-0 h-9 w-9 rounded-lg bg-canvas-100 text-gray-600 flex items-center justify-center">
        <Receipt className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-gray-900 truncate">
            {expense.merchant || expense.description || expense.category_label}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-canvas-100 px-2 py-0.5 text-[10.5px] font-medium text-gray-600">
            {expense.category_label}
          </span>
          {expense.billable_to_client && (
            <span className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2 py-0.5 text-[10.5px] font-medium text-mint-700 ring-1 ring-mint-100">
              Billable
            </span>
          )}
        </div>
        <div className="mt-1 text-[11.5px] text-gray-500">
          {expense.date ? new Date(expense.date).toLocaleDateString() : "No date"}
          {expense.description && expense.merchant && (
            <> · <span className="italic">{expense.description}</span></>
          )}
          {expense.receipt_url && (
            <> · <a href={expense.receipt_url} target="_blank" rel="noopener" className="text-brand-700 hover:underline">View receipt</a></>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[13px] font-mono font-semibold text-gray-900">
          {formatMoney(Number(expense.amount_in_claim_currency || 0), claimCurrency)}
        </div>
        {!sameCurrency && (
          <div className="text-[10.5px] text-gray-400 font-mono">
            ({formatMoney(Number(expense.amount), expense.currency)})
          </div>
        )}
      </div>
      {editable && (
        <div className="flex items-center gap-1 ml-1 shrink-0">
          <button
            onClick={onEdit}
            className="rounded-md p-1.5 text-gray-400 hover:bg-canvas-100 hover:text-gray-700"
            title="Edit"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-700"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}


function ExpenseForm({
  claim, expense, onSaved, onCancel,
}: {
  claim: TripClaim;
  expense: TripExpense | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(expense?.date ?? new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(expense?.category ?? "transport");
  const [merchant, setMerchant] = useState(expense?.merchant ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [currency, setCurrency] = useState(expense?.currency ?? claim.currency);
  const [fxRate, setFxRate] = useState(expense?.fx_rate ?? "");
  const [translated, setTranslated] = useState(expense?.amount_in_claim_currency ?? "");
  const [receiptUrl, setReceiptUrl] = useState(expense?.receipt_url ?? "");
  const [billable, setBillable] = useState(expense?.billable_to_client ?? false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sameCurrency = currency === claim.currency;
  const computedTranslated = useMemo(() => {
    if (!amount) return "";
    if (sameCurrency) return amount;
    if (fxRate) {
      const a = Number(amount), r = Number(fxRate);
      if (!isNaN(a) && !isNaN(r)) return (a * r).toFixed(2);
    }
    return translated;
  }, [amount, currency, fxRate, sameCurrency, translated]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!amount) { setError("Amount is required."); return; }

    setBusy(true);
    try {
      const payload: any = {
        claim: claim.id,
        date: date || null,
        category,
        merchant: merchant.trim(),
        description: description.trim(),
        amount,
        currency,
        billable_to_client: billable,
      };
      if (fxRate) payload.fx_rate = fxRate;
      if (computedTranslated) payload.amount_in_claim_currency = computedTranslated;
      if (receiptUrl.trim()) payload.receipt_url = receiptUrl.trim();

      if (expense) {
        await api.patch(`/beakon/trip-expenses/${expense.id}/`, payload);
      } else {
        await api.post("/beakon/trip-expenses/", payload);
      }
      onSaved();
    } catch (err: any) {
      setError(
        err?.detail ||
        err?.amount?.[0] ||
        err?.amount_in_claim_currency?.[0] ||
        "Failed to save receipt.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="border-t-2 border-dashed border-brand-100 bg-brand-50/20 p-5 space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Category">
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Merchant">
          <input type="text" className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="SBB / Hotel Beau-Rivage" />
        </Field>
      </div>

      <Field label="Description">
        <input
          type="text" className="input"
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional — e.g. 'Return flight ZRH↔GVA'"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Amount">
          <input
            type="number" step="0.01" className="input font-mono"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00" required
          />
        </Field>
        <Field label="Currency">
          <select className="input font-mono" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        {!sameCurrency && (
          <>
            <Field label="FX rate" hint={`1 ${currency} = ? ${claim.currency}`}>
              <input
                type="number" step="0.000001" className="input font-mono"
                value={fxRate} onChange={(e) => setFxRate(e.target.value)}
                placeholder="0.000000"
              />
            </Field>
            <Field label={`In ${claim.currency}`}>
              <input
                type="number" step="0.01" className="input font-mono"
                value={computedTranslated} onChange={(e) => setTranslated(e.target.value)}
                placeholder="0.00"
              />
            </Field>
          </>
        )}
      </div>

      <Field label="Receipt URL" hint="Paste a link to the receipt — file uploads land with the Documents module.">
        <input
          type="url" className="input"
          value={receiptUrl} onChange={(e) => setReceiptUrl(e.target.value)}
          placeholder="https://…"
        />
      </Field>

      <label className="flex items-center gap-2 text-[12.5px] text-gray-700 cursor-pointer">
        <input
          type="checkbox" checked={billable}
          onChange={(e) => setBillable(e.target.checked)}
        />
        Billable to a client (rebillable disbursement)
      </label>

      <div className="flex items-center justify-end gap-2 border-t border-canvas-200 pt-3">
        <button type="button" onClick={onCancel} className="text-[13px] text-gray-600 hover:text-gray-900">
          Cancel
        </button>
        <button type="submit" className="btn-primary text-sm" disabled={busy}>
          {busy ? "Saving…" : expense ? "Save receipt" : <>Add receipt <ArrowRight className="w-4 h-4 ml-1.5" /></>}
        </button>
      </div>
    </form>
  );
}


function Field({ label, hint, children }: {
  label: string; hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10.5px] text-gray-400 leading-relaxed">{hint}</span>}
    </label>
  );
}


function TotalsStrip({
  count, total, currency,
}: {
  count: number;
  total: number;
  currency: string;
}) {
  if (count === 0) return null;
  return (
    <div className="mt-5 flex items-center justify-between rounded-2xl border border-canvas-200/70 bg-white px-5 py-3.5">
      <span className="text-[12.5px] text-gray-600 inline-flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 text-gray-400" />
        {count} {count === 1 ? "receipt" : "receipts"}
      </span>
      <span className="text-[14px] font-semibold text-gray-900 font-mono">
        Total: {formatMoney(total, currency)}
      </span>
    </div>
  );
}
