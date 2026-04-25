"use client";

/* Invoices (AR) — customer invoices with full lifecycle. Mirror of bills.
 *
 *   draft -> pending_approval -> issued (AR JE auto-posts) -> paid (receipt JE auto-posts)
 *                             -> rejected -> draft
 *   draft -> cancelled
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileOutput, Plus, X, CheckCircle2, XCircle, DollarSign, Ban, Send, RotateCcw,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";


interface Entity { id: number; code: string; name: string; functional_currency: string; }
interface Customer { id: number; code: string; name: string; default_currency: string;
                     default_payment_terms_days: number; default_revenue_account: number | null; }
interface Account { id: number; code: string; name: string; account_type: string;
                    account_subtype: string; entity_code: string | null; }

interface Invoice {
  id: number;
  reference: string;
  invoice_number: string;
  entity_code: string;
  customer_code: string;
  customer_name: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  total: string;
  status: string;
  issued_journal_entry: number | null;
  payment_journal_entry: number | null;
  payment_date: string | null;
}

const STATUSES = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending" },
  { key: "issued", label: "Issued" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

function badge(status: string) {
  switch (status) {
    case "paid": return "badge-green";
    case "issued": return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected": return "badge-red";
    case "cancelled": return "badge-gray";
    case "draft": return "badge-gray";
    default: return "badge-gray";
  }
}


export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);

  const load = async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    try {
      const d = await api.get<{ results: Invoice[] } | Invoice[]>("/beakon/invoices/", params);
      setInvoices(Array.isArray(d) ? d : (d.results ?? []));
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [status]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of invoices) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [invoices]);

  const act = async (
    inv: Invoice, path: string, body: object = {}, confirmMsg?: string,
  ) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusyId(inv.id);
    setErr(null);
    try {
      await api.post(`/beakon/invoices/${inv.id}/${path}/`, body);
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
            <FileOutput className="w-5 h-5 text-brand-700" />
            Invoices (AR)
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Customer invoices. Issue auto-posts the AR JE; record-payment auto-posts the receipt JE.
          </p>
        </div>
        <button onClick={() => setDrawer(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Invoice
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
            {loading ? "loading…" : `${invoices.length} invoices`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : invoices.length === 0 ? (
          <div className="py-12 text-center">
            <FileOutput className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No invoices.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Reference</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Invoice #</th>
                  <th className="pb-2 pr-4 font-medium">Invoice date</th>
                  <th className="pb-2 pr-4 font-medium">Due</th>
                  <th className="pb-2 pl-4 font-medium text-right">Total</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                  <th className="pb-2 pl-4 font-medium">JEs</th>
                  <th className="pb-2 pl-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {invoices.map((i) => (
                  <tr key={i.id} className="hover:bg-canvas-50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{i.reference}</td>
                    <td className="py-2 pr-4 text-sm text-gray-900">
                      <span className="font-mono text-xs text-gray-500">{i.customer_code}</span>{" "}
                      {i.customer_name}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{i.entity_code}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 font-mono">{i.invoice_number || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(i.invoice_date)}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(i.due_date)}</td>
                    <td className="py-2 pl-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                      {fmt2(i.total)} <span className="text-gray-400">{i.currency}</span>
                    </td>
                    <td className="py-2 pl-4">
                      <span className={badge(i.status)}>{fmtLabel(i.status)}</span>
                    </td>
                    <td className="py-2 pl-4 text-xs">
                      {i.issued_journal_entry && (
                        <Link href={`/dashboard/journal-entries/${i.issued_journal_entry}`}
                              className="block text-brand-700 hover:underline">
                          issue #{i.issued_journal_entry}
                        </Link>
                      )}
                      {i.payment_journal_entry && (
                        <Link href={`/dashboard/journal-entries/${i.payment_journal_entry}`}
                              className="block text-brand-700 hover:underline">
                          receipt #{i.payment_journal_entry}
                        </Link>
                      )}
                      {!i.issued_journal_entry && !i.payment_journal_entry && (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <div className="inline-flex gap-1">
                        {i.status === "draft" && (
                          <>
                            <button onClick={() => act(i, "submit-for-approval")} disabled={busyId === i.id}
                                    className="text-xs text-brand-700 hover:underline disabled:opacity-50">
                              <Send className="w-3 h-3 inline mr-0.5" />Submit
                            </button>
                            <span className="text-gray-300">·</span>
                            <button onClick={() => act(i, "cancel", {}, `Cancel ${i.reference}?`)}
                                    disabled={busyId === i.id}
                                    className="text-xs text-gray-500 hover:underline disabled:opacity-50">
                              <Ban className="w-3 h-3 inline mr-0.5" />Cancel
                            </button>
                          </>
                        )}
                        {i.status === "pending_approval" && (
                          <>
                            <button onClick={() => act(i, "issue",
                                      {}, `Issue ${i.reference}? This posts the AR JE.`)}
                                    disabled={busyId === i.id}
                                    className="text-xs text-mint-700 hover:underline disabled:opacity-50">
                              <CheckCircle2 className="w-3 h-3 inline mr-0.5" />Issue
                            </button>
                            <span className="text-gray-300">·</span>
                            <button onClick={() => {
                                      const r = prompt("Rejection reason:");
                                      if (r !== null) void act(i, "reject", { reason: r });
                                    }}
                                    disabled={busyId === i.id}
                                    className="text-xs text-red-700 hover:underline disabled:opacity-50">
                              <XCircle className="w-3 h-3 inline mr-0.5" />Reject
                            </button>
                            <span className="text-gray-300">·</span>
                            <button onClick={() => act(i, "return-to-draft")} disabled={busyId === i.id}
                                    className="text-xs text-gray-500 hover:underline disabled:opacity-50">
                              To draft
                            </button>
                          </>
                        )}
                        {i.status === "issued" && (
                          <button onClick={() => setPayTarget(i)} disabled={busyId === i.id}
                                  className="text-xs text-brand-700 hover:underline disabled:opacity-50">
                            <DollarSign className="w-3 h-3 inline mr-0.5" />Record payment
                          </button>
                        )}
                        {i.status === "rejected" && (
                          <button onClick={() => act(i, "return-to-draft")} disabled={busyId === i.id}
                                  className="text-xs text-gray-700 hover:underline disabled:opacity-50">
                            <RotateCcw className="w-3 h-3 inline mr-0.5" />To draft
                          </button>
                        )}
                        {i.status === "paid" && (
                          <span className="text-xs text-gray-400">paid {fmtDate(i.payment_date)}</span>
                        )}
                        {i.status === "cancelled" && (
                          <span className="text-xs text-gray-400">cancelled</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <CreateInvoiceDrawer
          onClose={() => setDrawer(false)}
          onCreated={async () => { setDrawer(false); await load(); }}
        />
      )}
      {payTarget && (
        <PayModal
          invoice={payTarget}
          onClose={() => setPayTarget(null)}
          onPaid={async () => { setPayTarget(null); await load(); }}
        />
      )}
    </div>
  );
}


function CreateInvoiceDrawer({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    entity: "", customer: "", invoice_date: today, due_date: "",
    invoice_number: "", currency: "", description: "", tax_amount: "0.00",
  });
  const [lines, setLines] = useState([
    { revenue_account: "", description: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/").then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Customer[] } | Customer[]>("/beakon/customers/", { is_active: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { account_type: "revenue" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
    ]).then(([es, cs, as]) => {
      setEntities(es); setCustomers(cs); setAccounts(as);
      if (es.length && !form.entity) setForm((f) => ({ ...f, entity: String(es[0].id) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCustomerChange = (cid: string) => {
    const c = customers.find((x) => String(x.id) === cid);
    setForm((f) => ({ ...f, customer: cid, currency: c?.default_currency || f.currency }));
    if (c?.default_revenue_account && lines.length === 1 && !lines[0].revenue_account) {
      setLines([{ ...lines[0], revenue_account: String(c.default_revenue_account) }]);
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
    if (!form.entity || !form.customer) return;
    setBusy(true);
    setErr(null);
    const payload: any = {
      entity: Number(form.entity),
      customer: Number(form.customer),
      invoice_date: form.invoice_date,
      invoice_number: form.invoice_number,
      currency: form.currency || undefined,
      description: form.description,
      tax_amount: form.tax_amount,
      lines: lines
        .filter((l) => l.revenue_account && l.amount)
        .map((l) => ({
          revenue_account_id: Number(l.revenue_account),
          description: l.description,
          amount: l.amount,
        })),
    };
    if (form.due_date) payload.due_date = form.due_date;
    if (payload.lines.length === 0) {
      setErr("Add at least one line with a revenue account and amount.");
      setBusy(false);
      return;
    }
    try {
      await api.post("/beakon/invoices/", payload);
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

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full sm:w-[640px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">New Invoice</h2>
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
              <span className="text-xs font-medium text-gray-600">Customer *</span>
              <select className="input mt-1" value={form.customer}
                      onChange={(e) => onCustomerChange(e.target.value)}>
                <option value="">— select customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
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
              <span className="text-[10px] text-gray-400">Auto from customer terms if blank.</span>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Currency</span>
              <input className="input mt-1 uppercase font-mono" maxLength={3}
                     value={form.currency}
                     onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Customer-facing invoice number</span>
            <input className="input mt-1 font-mono" value={form.invoice_number}
                   onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
                   placeholder="Leave blank to use our reference" />
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
                      onClick={() => setLines([...lines, { revenue_account: "", description: "", amount: "" }])}
                      className="text-xs text-brand-700 hover:underline">
                + Add line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <select className="input col-span-5" value={l.revenue_account}
                          onChange={(e) => updateLine(i, { revenue_account: e.target.value })}>
                    <option value="">— revenue account —</option>
                    {accounts.map((a) => (
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
                    disabled={busy || !form.entity || !form.customer || lines.every((l) => !l.amount)}
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
  invoice, onClose, onPaid,
}: {
  invoice: Invoice;
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ payment_date: today, bank_account: "", reference: "" });
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
      await api.post(`/beakon/invoices/${invoice.id}/record-payment/`, {
        payment_date: form.payment_date,
        bank_account: Number(form.bank_account),
        reference: form.reference,
      });
      await onPaid();
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e?.detail || e || "Failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white rounded-2xl border border-canvas-200 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">Record payment — {invoice.reference}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="rounded-lg bg-canvas-50 p-3 text-sm">
            <div className="text-gray-900 font-medium">{invoice.customer_name}</div>
            <div className="text-xs text-gray-500">{invoice.entity_code} · {invoice.invoice_number || invoice.reference}</div>
            <div className="font-mono text-base mt-1 tabular-nums">
              {fmt2(invoice.total)} {invoice.currency}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Receipt date *</span>
            <input type="date" className="input mt-1" value={form.payment_date}
                   onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Into bank account *</span>
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
                   placeholder="ACH-12345 / Check #542" />
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          <div className="text-[11px] text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
            Recording payment will <strong>auto-post</strong> a receipt journal entry:
            DR selected bank account / CR AR from {invoice.customer_code}.
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy || !form.bank_account} className="btn-primary">
              {busy ? "Posting…" : "Confirm receipt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
