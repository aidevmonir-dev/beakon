"use client";

/* Loans — workbook tab 07 Loan Master. Governed loan agreements
 * (Lombards, mortgages, related-party loans, credit lines). One row
 * per loan; drives interest accrual, principal/interest posting, FX
 * remeasurement on every account that requires LOAN as a dimension. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Banknote, Plus, X, Search } from "lucide-react";
import { api } from "@/lib/api";


const LOAN_TYPES = [
  { value: "LOMBARD", label: "Lombard / margin facility" },
  { value: "MORTGAGE", label: "Mortgage" },
  { value: "PRIVATE_LOAN", label: "Private loan" },
  { value: "RELATED_PARTY_LOAN", label: "Related-party loan" },
  { value: "CONVERTIBLE_LOAN", label: "Convertible loan" },
  { value: "CREDIT_LINE", label: "Credit line" },
];
const LOAN_SIDES = [
  { value: "ASSET", label: "Asset — we lend" },
  { value: "LIABILITY", label: "Liability — we borrow" },
];
const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "MATURED", label: "Matured" },
  { value: "REPAID", label: "Repaid" },
  { value: "DEFAULTED", label: "Defaulted" },
  { value: "CANCELLED", label: "Cancelled" },
];
const RATE_TYPES = [
  { value: "FIXED", label: "Fixed" },
  { value: "FLOATING", label: "Floating" },
];


interface Loan {
  id: number;
  loan_id: string;
  loan_name: string;
  loan_type: string;
  loan_side: string;
  status: string;
  borrower_or_lender_code: string;
  loan_currency: string;
  principal_original: string | null;
  current_principal_outstanding: string | null;
  interest_rate_type: string;
  fixed_rate: string | null;
  reference_rate_code: string;
  start_date: string | null;
  maturity_date: string | null;
  notes: string;
}


function statusBadge(s: string): string {
  if (s === "ACTIVE") return "badge-green";
  if (s === "REPAID") return "badge-gray";
  if (s === "DEFAULTED") return "badge-red";
  if (s === "MATURED") return "badge-yellow";
  return "badge-gray";
}


export default function LoansPage() {
  const [rows, setRows] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; loan: Loan } | null>(null);

  const load = async () => {
    setLoading(true);
    const d = await api.get<{ results: Loan[] } | Loan[]>("/beakon/loans/", { page_size: "500" })
      .then((r) => Array.isArray(r) ? r : (r.results ?? []))
      .catch(() => []);
    setRows(d);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter((v) =>
      v.loan_id.toLowerCase().includes(s) ||
      v.loan_name?.toLowerCase().includes(s) ||
      v.borrower_or_lender_code?.toLowerCase().includes(s) ||
      v.loan_type?.toLowerCase().includes(s),
    );
  }, [rows, q]);

  return (
    <div>
      <Link href="/dashboard/dimensions"
            className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Dimensions
      </Link>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Banknote className="w-5 h-5 text-emerald-600" />
            Loans
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Governed loan agreements — Lombards, mortgages, related-party loans, credit lines.
            Drives interest accrual and the LOAN dimension on every loan-tagged posting.
          </p>
        </div>
        <button onClick={() => setDrawer({ mode: "create" })} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New loan
        </button>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9"
                   placeholder="Search by ID, name, borrower/lender, type…"
                   value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="ml-auto text-xs text-gray-400">
            {loading ? "loading…" : `${visible.length} loan${visible.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <Banknote className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {rows.length === 0 ? "No loans yet." : "No loans match the filter."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">ID</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Side</th>
                  <th className="pb-2 pr-4 font-medium">Ccy</th>
                  <th className="pb-2 pr-4 font-medium text-right">Outstanding</th>
                  <th className="pb-2 pr-4 font-medium">Maturity</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {visible.map((l) => (
                  <tr key={l.id} className="hover:bg-canvas-50 cursor-pointer"
                      onClick={() => setDrawer({ mode: "edit", loan: l })}>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{l.loan_id}</td>
                    <td className="py-2 pr-4 text-sm text-gray-900 font-medium">{l.loan_name || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500">
                      {LOAN_TYPES.find((t) => t.value === l.loan_type)?.label ?? l.loan_type ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">{l.loan_side || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{l.loan_currency || "—"}</td>
                    <td className="py-2 pr-4 text-right text-xs text-gray-700 tabular-nums">
                      {fmtAmount(l.current_principal_outstanding)}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">{l.maturity_date || "—"}</td>
                    <td className="py-2 pl-4">
                      <span className={statusBadge(l.status)}>{l.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <LoanDrawer
          mode={drawer.mode}
          loan={drawer.mode === "edit" ? drawer.loan : null}
          onClose={() => setDrawer(null)}
          onSaved={async () => { setDrawer(null); await load(); }}
        />
      )}
    </div>
  );
}


function fmtAmount(v: string | null): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


function LoanDrawer({
  mode, loan, onClose, onSaved,
}: {
  mode: "create" | "edit";
  loan: Loan | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    loan_id: loan?.loan_id ?? "",
    loan_name: loan?.loan_name ?? "",
    loan_type: loan?.loan_type ?? "",
    loan_side: loan?.loan_side ?? "",
    status: loan?.status ?? "ACTIVE",
    borrower_or_lender_code: loan?.borrower_or_lender_code ?? "",
    loan_currency: loan?.loan_currency ?? "",
    principal_original: loan?.principal_original ?? "",
    current_principal_outstanding: loan?.current_principal_outstanding ?? "",
    interest_rate_type: loan?.interest_rate_type ?? "",
    fixed_rate: loan?.fixed_rate ?? "",
    reference_rate_code: loan?.reference_rate_code ?? "",
    start_date: loan?.start_date ?? "",
    maturity_date: loan?.maturity_date ?? "",
    notes: loan?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      loan_id: form.loan_id.trim(),
      loan_name: form.loan_name.trim(),
      loan_type: form.loan_type,
      loan_side: form.loan_side,
      status: form.status,
      borrower_or_lender_code: form.borrower_or_lender_code.trim(),
      loan_currency: form.loan_currency.trim().toUpperCase(),
      principal_original: form.principal_original || null,
      current_principal_outstanding: form.current_principal_outstanding || null,
      interest_rate_type: form.interest_rate_type,
      fixed_rate: form.fixed_rate || null,
      reference_rate_code: form.reference_rate_code.trim().toUpperCase(),
      start_date: form.start_date || null,
      maturity_date: form.maturity_date || null,
      notes: form.notes,
    };
    try {
      if (mode === "edit" && loan) {
        await api.patch(`/beakon/loans/${loan.id}/`, payload);
      } else {
        await api.post("/beakon/loans/", payload);
      }
      await onSaved();
    } catch (e: any) {
      setErr(JSON.stringify(e?.detail || e || "Failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full sm:w-[520px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">
            {mode === "edit" ? `Edit ${loan?.loan_id}` : "New loan"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Loan ID *</span>
              <input className="input mt-1 font-mono uppercase" required value={form.loan_id}
                     disabled={mode === "edit"}
                     onChange={(e) => setForm((f) => ({ ...f, loan_id: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Status</span>
              <select className="input mt-1" value={form.status}
                      onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Name</span>
            <input className="input mt-1" value={form.loan_name}
                   onChange={(e) => setForm((f) => ({ ...f, loan_name: e.target.value }))} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Type</span>
              <select className="input mt-1" value={form.loan_type}
                      onChange={(e) => setForm((f) => ({ ...f, loan_type: e.target.value }))}>
                <option value="">—</option>
                {LOAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Side</span>
              <select className="input mt-1" value={form.loan_side}
                      onChange={(e) => setForm((f) => ({ ...f, loan_side: e.target.value }))}>
                <option value="">—</option>
                {LOAN_SIDES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Borrower / lender code</span>
            <input className="input mt-1 font-mono" value={form.borrower_or_lender_code}
                   onChange={(e) => setForm((f) => ({ ...f, borrower_or_lender_code: e.target.value }))}
                   placeholder="CP_…  or  RP_…" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Currency</span>
              <input className="input mt-1 font-mono uppercase" maxLength={3} value={form.loan_currency}
                     onChange={(e) => setForm((f) => ({ ...f, loan_currency: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Original principal</span>
              <input type="number" step="0.01" className="input mt-1 tabular-nums" value={form.principal_original}
                     onChange={(e) => setForm((f) => ({ ...f, principal_original: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Outstanding</span>
              <input type="number" step="0.01" className="input mt-1 tabular-nums" value={form.current_principal_outstanding}
                     onChange={(e) => setForm((f) => ({ ...f, current_principal_outstanding: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Rate type</span>
              <select className="input mt-1" value={form.interest_rate_type}
                      onChange={(e) => setForm((f) => ({ ...f, interest_rate_type: e.target.value }))}>
                <option value="">—</option>
                {RATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Fixed rate (%)</span>
              <input type="number" step="0.0001" className="input mt-1 tabular-nums" value={form.fixed_rate}
                     onChange={(e) => setForm((f) => ({ ...f, fixed_rate: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Reference rate</span>
              <input className="input mt-1 font-mono uppercase" value={form.reference_rate_code}
                     placeholder="SARON / SOFR / EURIBOR_3M"
                     onChange={(e) => setForm((f) => ({ ...f, reference_rate_code: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Start date</span>
              <input type="date" className="input mt-1" value={form.start_date}
                     onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Maturity date</span>
              <input type="date" className="input mt-1" value={form.maturity_date}
                     onChange={(e) => setForm((f) => ({ ...f, maturity_date: e.target.value }))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Notes</span>
            <textarea className="input mt-1" rows={2} value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>

          {err && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Saving…" : mode === "edit" ? "Save" : "Create loan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
