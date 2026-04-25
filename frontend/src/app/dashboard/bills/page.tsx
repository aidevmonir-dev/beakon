"use client";

/* Bills (AP) — vendor bills with full lifecycle.
 *
 *   draft -> pending_approval -> approved (accrual JE auto-posts) -> paid (payment JE auto-posts)
 *                             -> rejected -> draft
 *   draft -> cancelled
 *
 * v1 keeps it on a single page: list + filter + create modal + inline
 * approve/reject/pay actions. A future bills/[id] detail page can show
 * the linked accrual & payment JEs and full audit history. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Receipt, Plus, X, CheckCircle2, XCircle, DollarSign, RotateCcw, Ban, Send,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";


interface Entity { id: number; code: string; name: string; functional_currency: string; }
interface Vendor { id: number; code: string; name: string; default_currency: string;
                   default_payment_terms_days: number; default_expense_account: number | null;
                   default_expense_account_code: string | null; }
interface Account { id: number; code: string; name: string; account_type: string;
                    account_subtype: string; entity_code: string | null; }

interface Bill {
  id: number;
  reference: string;
  bill_number: string;
  entity_code: string;
  vendor_code: string;
  vendor_name: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  total: string;
  status: string;
  accrual_journal_entry: number | null;
  payment_journal_entry: number | null;
  payment_date: string | null;
}

const STATUSES = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

function badge(status: string) {
  switch (status) {
    case "paid": return "badge-green";
    case "approved": return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected": return "badge-red";
    case "cancelled": return "badge-gray";
    case "draft": return "badge-gray";
    default: return "badge-gray";
  }
}


export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<Bill | null>(null);

  const load = async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    try {
      const d = await api.get<{ results: Bill[] } | Bill[]>("/beakon/bills/", params);
      setBills(Array.isArray(d) ? d : (d.results ?? []));
    } catch {
      setBills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [status]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of bills) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [bills]);

  const act = async (
    bill: Bill,
    path: string,
    body: object = {},
    confirmMsg?: string,
  ) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusyId(bill.id);
    setErr(null);
    try {
      await api.post(`/beakon/bills/${bill.id}/${path}/`, body);
      await load();
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || `Action failed`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-brand-700" />
            Bills (AP)
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Vendor bills. Approval auto-posts the accrual JE; mark-as-paid auto-posts the payment JE.
          </p>
        </div>
        <button onClick={() => setDrawer(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Bill
        </button>
      </div>

      {err && (
        <div className="card p-3 mb-3 border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-1 mb-4 text-xs">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStatus(s.key)}
              className={
                "px-2.5 py-1 rounded-full border transition-colors " +
                (status === s.key
                  ? "bg-brand-50 border-brand-200 text-brand-800"
                  : "bg-white border-canvas-200 text-gray-600 hover:bg-canvas-50")
              }
            >
              {s.label}{s.key && counts[s.key] ? ` (${counts[s.key]})` : ""}
            </button>
          ))}
          <span className="ml-auto text-gray-400">
            {loading ? "loading…" : `${bills.length} bills`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : bills.length === 0 ? (
          <div className="py-12 text-center">
            <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No bills.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Reference</th>
                  <th className="pb-2 pr-4 font-medium">Vendor</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Bill #</th>
                  <th className="pb-2 pr-4 font-medium">Invoice date</th>
                  <th className="pb-2 pr-4 font-medium">Due</th>
                  <th className="pb-2 pl-4 font-medium text-right">Total</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                  <th className="pb-2 pl-4 font-medium">JEs</th>
                  <th className="pb-2 pl-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {bills.map((b) => (
                  <tr key={b.id} className="hover:bg-canvas-50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{b.reference}</td>
                    <td className="py-2 pr-4 text-sm text-gray-900">
                      <span className="font-mono text-xs text-gray-500">{b.vendor_code}</span>{" "}
                      {b.vendor_name}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{b.entity_code}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 font-mono">{b.bill_number || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(b.invoice_date)}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(b.due_date)}</td>
                    <td className="py-2 pl-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                      {fmt2(b.total)} <span className="text-gray-400">{b.currency}</span>
                    </td>
                    <td className="py-2 pl-4">
                      <span className={badge(b.status)}>{fmtLabel(b.status)}</span>
                    </td>
                    <td className="py-2 pl-4 text-xs">
                      {b.accrual_journal_entry && (
                        <Link href={`/dashboard/journal-entries/${b.accrual_journal_entry}`}
                              className="block text-brand-700 hover:underline">
                          accrual #{b.accrual_journal_entry}
                        </Link>
                      )}
                      {b.payment_journal_entry && (
                        <Link href={`/dashboard/journal-entries/${b.payment_journal_entry}`}
                              className="block text-brand-700 hover:underline">
                          payment #{b.payment_journal_entry}
                        </Link>
                      )}
                      {!b.accrual_journal_entry && !b.payment_journal_entry && (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <ActionButtons
                        bill={b}
                        busy={busyId === b.id}
                        onSubmit={() => act(b, "submit-for-approval")}
                        onApprove={() => act(b, "approve",
                          {}, `Approve bill ${b.reference}? This posts the accrual JE.`)}
                        onReject={() => {
                          const reason = prompt("Rejection reason:");
                          if (reason !== null) void act(b, "reject", { reason });
                        }}
                        onReturn={() => act(b, "return-to-draft")}
                        onPay={() => setPayTarget(b)}
                        onCancel={() => act(b, "cancel",
                          {}, `Cancel bill ${b.reference}? This is final.`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <CreateBillDrawer
          onClose={() => setDrawer(false)}
          onCreated={async () => { setDrawer(false); await load(); }}
        />
      )}
      {payTarget && (
        <PayModal
          bill={payTarget}
          onClose={() => setPayTarget(null)}
          onPaid={async () => { setPayTarget(null); await load(); }}
        />
      )}
    </div>
  );
}


function ActionButtons({
  bill, busy, onSubmit, onApprove, onReject, onReturn, onPay, onCancel,
}: {
  bill: Bill; busy: boolean;
  onSubmit: () => void; onApprove: () => void; onReject: () => void;
  onReturn: () => void; onPay: () => void; onCancel: () => void;
}) {
  return (
    <div className="inline-flex gap-1">
      {bill.status === "draft" && (
        <>
          <button onClick={onSubmit} disabled={busy}
                  className="text-xs text-brand-700 hover:underline disabled:opacity-50">
            <Send className="w-3 h-3 inline mr-0.5" />Submit
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={onCancel} disabled={busy}
                  className="text-xs text-gray-500 hover:underline disabled:opacity-50">
            <Ban className="w-3 h-3 inline mr-0.5" />Cancel
          </button>
        </>
      )}
      {bill.status === "pending_approval" && (
        <>
          <button onClick={onApprove} disabled={busy}
                  className="text-xs text-mint-700 hover:underline disabled:opacity-50">
            <CheckCircle2 className="w-3 h-3 inline mr-0.5" />Approve
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={onReject} disabled={busy}
                  className="text-xs text-red-700 hover:underline disabled:opacity-50">
            <XCircle className="w-3 h-3 inline mr-0.5" />Reject
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={onReturn} disabled={busy}
                  className="text-xs text-gray-500 hover:underline disabled:opacity-50">
            To draft
          </button>
        </>
      )}
      {bill.status === "approved" && (
        <button onClick={onPay} disabled={busy}
                className="text-xs text-brand-700 hover:underline disabled:opacity-50">
          <DollarSign className="w-3 h-3 inline mr-0.5" />Pay
        </button>
      )}
      {bill.status === "rejected" && (
        <button onClick={onReturn} disabled={busy}
                className="text-xs text-gray-700 hover:underline disabled:opacity-50">
          <RotateCcw className="w-3 h-3 inline mr-0.5" />To draft
        </button>
      )}
      {bill.status === "paid" && (
        <span className="text-xs text-gray-400">paid {fmtDate(bill.payment_date)}</span>
      )}
      {bill.status === "cancelled" && (
        <span className="text-xs text-gray-400">cancelled</span>
      )}
    </div>
  );
}


function CreateBillDrawer({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    entity: "",
    vendor: "",
    invoice_date: today,
    due_date: "",
    bill_number: "",
    currency: "",
    description: "",
    tax_amount: "0.00",
  });
  const [lines, setLines] = useState([
    { expense_account: "", description: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/").then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Vendor[] } | Vendor[]>("/beakon/vendors/", { is_active: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { account_type: "expense" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
    ]).then(([es, vs, as]) => {
      setEntities(es); setVendors(vs); setAccounts(as);
      if (es.length && !form.entity) setForm((f) => ({ ...f, entity: String(es[0].id) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When vendor changes, prefill currency + first line's expense account
  const onVendorChange = (vid: string) => {
    const v = vendors.find((x) => String(x.id) === vid);
    setForm((f) => ({
      ...f, vendor: vid,
      currency: v?.default_currency || f.currency,
    }));
    if (v?.default_expense_account && lines.length === 1 && !lines[0].expense_account) {
      setLines([{ ...lines[0], expense_account: String(v.default_expense_account) }]);
    }
  };

  const lineSum = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
    [lines],
  );
  const taxNum = parseFloat(form.tax_amount) || 0;
  const total = lineSum + taxNum;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.entity || !form.vendor || lines.length === 0) return;
    setBusy(true);
    setErr(null);
    const payload: any = {
      entity: Number(form.entity),
      vendor: Number(form.vendor),
      invoice_date: form.invoice_date,
      bill_number: form.bill_number,
      currency: form.currency || undefined,
      description: form.description,
      tax_amount: form.tax_amount,
      lines: lines
        .filter((l) => l.expense_account && l.amount)
        .map((l) => ({
          expense_account_id: Number(l.expense_account),
          description: l.description,
          amount: l.amount,
        })),
    };
    if (form.due_date) payload.due_date = form.due_date;
    if (payload.lines.length === 0) {
      setErr("Add at least one line with an expense account and amount.");
      setBusy(false);
      return;
    }
    try {
      await api.post("/beakon/bills/", payload);
      await onCreated();
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e?.detail || e || "Failed"));
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (i: number, patch: Partial<typeof lines[0]>) => {
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  };

  const acctsForLine = accounts;  // shared + entity-scoped already filtered by API

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full sm:w-[640px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">New Bill</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Entity *</span>
              <select className="input mt-1" value={form.entity}
                      onChange={(e) => setForm((f) => ({ ...f, entity: e.target.value }))}>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Vendor *</span>
              <select className="input mt-1" value={form.vendor}
                      onChange={(e) => onVendorChange(e.target.value)}>
                <option value="">— select vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.code} · {v.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Invoice date *</span>
              <input type="date" className="input mt-1" value={form.invoice_date}
                     onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Due date</span>
              <input type="date" className="input mt-1" value={form.due_date}
                     onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
              <span className="text-[10px] text-gray-400">Auto from vendor terms if blank.</span>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Currency</span>
              <input className="input mt-1 uppercase font-mono" maxLength={3}
                     value={form.currency}
                     onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Vendor's bill number</span>
            <input className="input mt-1 font-mono" value={form.bill_number}
                   onChange={(e) => setForm((f) => ({ ...f, bill_number: e.target.value }))}
                   placeholder="INV-12345" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Description</span>
            <textarea className="input mt-1" rows={2} value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>

          <div className="border-t border-canvas-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Lines</span>
              <button type="button"
                      onClick={() => setLines([...lines, { expense_account: "", description: "", amount: "" }])}
                      className="text-xs text-brand-700 hover:underline">
                + Add line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <select className="input col-span-5" value={l.expense_account}
                          onChange={(e) => updateLine(i, { expense_account: e.target.value })}>
                    <option value="">— expense account —</option>
                    {acctsForLine.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                  <input className="input col-span-5" placeholder="Description"
                         value={l.description}
                         onChange={(e) => updateLine(i, { description: e.target.value })} />
                  <input className="input col-span-2 text-right font-mono" placeholder="Amount"
                         type="number" step="0.01" value={l.amount}
                         onChange={(e) => updateLine(i, { amount: e.target.value })} />
                  {lines.length > 1 && (
                    <button type="button"
                            onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                            className="col-span-12 text-xs text-red-600 hover:underline text-right -mt-1">
                      Remove line
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-canvas-100">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Tax</span>
              <input className="input mt-1 text-right font-mono" type="number" step="0.01"
                     value={form.tax_amount}
                     onChange={(e) => setForm((f) => ({ ...f, tax_amount: e.target.value }))} />
            </label>
            <div className="flex items-end justify-end pb-2">
              <span className="text-sm text-gray-500 mr-2">Total:</span>
              <span className="text-lg font-mono font-semibold text-gray-900 tabular-nums">
                {fmt2(total)} {form.currency || "—"}
              </span>
            </div>
          </div>

          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 break-words">
              {err}
            </div>
          )}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit"
                    disabled={busy || !form.entity || !form.vendor || lines.every((l) => !l.amount)}
                    className="btn-primary">
              {busy ? "Saving…" : "Create draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function PayModal({
  bill, onClose, onPaid,
}: {
  bill: Bill;
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    payment_date: today,
    bank_account: "",
    reference: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { account_subtype: "bank" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d.results ?? []);
        setAccounts(list);
        if (list.length && !form.bank_account) {
          setForm((f) => ({ ...f, bank_account: String(list[0].id) }));
        }
      })
      .catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
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
              {fmt2(bill.total)} {bill.currency}
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
                  {a.code} · {a.name}{a.entity_code ? ` (${a.entity_code})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Reference</span>
            <input className="input mt-1 font-mono" value={form.reference}
                   onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                   placeholder="WIRE-12345 / Check #1042" />
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
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
