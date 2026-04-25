"use client";

/* Vendors — suppliers we pay. Bills, OCR drafts, and future AP aging
 * reference a Vendor. Org-scoped; soft-delete via is_active. */
import { useEffect, useMemo, useState } from "react";
import { Truck, Plus, X, Search } from "lucide-react";
import { api } from "@/lib/api";
import { fmtLabel } from "@/lib/format";


interface Account {
  id: number;
  code: string;
  name: string;
  account_type: string;
  entity_code: string | null;
}

interface Vendor {
  id: number;
  code: string;
  name: string;
  legal_name: string;
  tax_id: string;
  email: string;
  phone: string;
  default_currency: string;
  default_payment_terms_days: number;
  default_expense_account: number | null;
  default_expense_account_code: string | null;
  country: string;
  is_active: boolean;
  notes: string;
}


export default function VendorsPage() {
  const [rows, setRows] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; vendor: Vendor } | null>(null);

  const load = async () => {
    setLoading(true);
    const [vs, as] = await Promise.all([
      api.get<{ results: Vendor[] } | Vendor[]>("/beakon/vendors/")
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { account_type: "expense" })
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => []),
    ]);
    setRows(vs);
    setAccounts(as);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    if (!q) return rows;
    const s = q.toLowerCase();
    return rows.filter((v) =>
      v.name.toLowerCase().includes(s) ||
      v.code.toLowerCase().includes(s) ||
      v.legal_name?.toLowerCase().includes(s) ||
      v.tax_id?.toLowerCase().includes(s) ||
      v.email?.toLowerCase().includes(s),
    );
  }, [rows, q]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-brand-700" />
            Vendors
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Suppliers we pay. Bills and OCR-drafted JEs link here. Soft-delete via Active toggle.
          </p>
        </div>
        <button onClick={() => setDrawer({ mode: "create" })} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Vendor
        </button>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9"
                   placeholder="Search by code, name, tax ID, email…"
                   value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="ml-auto text-xs text-gray-400">
            {loading ? "loading…" : `${visible.length} vendors`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <Truck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No vendors yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Code</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Tax ID</th>
                  <th className="pb-2 pr-4 font-medium">Email</th>
                  <th className="pb-2 pr-4 font-medium">Ccy</th>
                  <th className="pb-2 pr-4 font-medium text-right">Terms</th>
                  <th className="pb-2 pr-4 font-medium">Default DR</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {visible.map((v) => (
                  <tr key={v.id} className="hover:bg-canvas-50 cursor-pointer"
                      onClick={() => setDrawer({ mode: "edit", vendor: v })}>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{v.code}</td>
                    <td className="py-2 pr-4 text-sm text-gray-900 font-medium">
                      {v.name}
                      {v.legal_name && v.legal_name !== v.name && (
                        <div className="text-[11px] text-gray-400">{v.legal_name}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs font-mono text-gray-500">{v.tax_id || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500">{v.email || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{v.default_currency || "—"}</td>
                    <td className="py-2 pr-4 text-right text-xs text-gray-500 tabular-nums">
                      Net {v.default_payment_terms_days}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">
                      {v.default_expense_account_code || "—"}
                    </td>
                    <td className="py-2 pl-4">
                      <span className={v.is_active ? "badge-green" : "badge-gray"}>
                        {v.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <VendorDrawer
          mode={drawer.mode}
          vendor={drawer.mode === "edit" ? drawer.vendor : null}
          accounts={accounts}
          onClose={() => setDrawer(null)}
          onSaved={async () => { setDrawer(null); await load(); }}
        />
      )}
    </div>
  );
}


function VendorDrawer({
  mode, vendor, accounts, onClose, onSaved,
}: {
  mode: "create" | "edit";
  vendor: Vendor | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: vendor?.code ?? "",
    name: vendor?.name ?? "",
    legal_name: vendor?.legal_name ?? "",
    tax_id: vendor?.tax_id ?? "",
    email: vendor?.email ?? "",
    phone: vendor?.phone ?? "",
    default_currency: vendor?.default_currency ?? "",
    default_payment_terms_days: vendor?.default_payment_terms_days ?? 30,
    default_expense_account: vendor?.default_expense_account?.toString() ?? "",
    country: vendor?.country ?? "",
    is_active: vendor?.is_active ?? true,
    notes: vendor?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    const payload: any = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      legal_name: form.legal_name.trim(),
      tax_id: form.tax_id.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      default_currency: form.default_currency.trim().toUpperCase(),
      default_payment_terms_days: Number(form.default_payment_terms_days) || 30,
      default_expense_account: form.default_expense_account
        ? Number(form.default_expense_account) : null,
      country: form.country.trim().toUpperCase().slice(0, 2),
      is_active: form.is_active,
      notes: form.notes,
    };
    try {
      if (mode === "edit" && vendor) {
        await api.patch(`/beakon/vendors/${vendor.id}/`, payload);
      } else {
        await api.post("/beakon/vendors/", payload);
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
      <div className="w-full sm:w-[480px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">
            {mode === "edit" ? `Edit vendor ${vendor?.code}` : "New vendor"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Code *</span>
              <input className="input mt-1 font-mono uppercase" value={form.code}
                     disabled={mode === "edit"}
                     onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Status</span>
              <select className="input mt-1" value={form.is_active ? "1" : "0"}
                      onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === "1" }))}>
                <option value="1">Active</option>
                <option value="0">Archived</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Name *</span>
            <input className="input mt-1" value={form.name}
                   onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Legal name</span>
            <input className="input mt-1" value={form.legal_name}
                   onChange={(e) => setForm((f) => ({ ...f, legal_name: e.target.value }))} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Tax ID</span>
              <input className="input mt-1 font-mono" value={form.tax_id}
                     onChange={(e) => setForm((f) => ({ ...f, tax_id: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Country (ISO)</span>
              <input className="input mt-1 uppercase" maxLength={2} value={form.country}
                     onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Email</span>
              <input className="input mt-1" value={form.email}
                     onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Phone</span>
              <input className="input mt-1" value={form.phone}
                     onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Default currency</span>
              <input className="input mt-1 font-mono uppercase" maxLength={3}
                     value={form.default_currency}
                     onChange={(e) => setForm((f) => ({ ...f, default_currency: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Payment terms (days)</span>
              <input className="input mt-1" type="number" min={0} value={form.default_payment_terms_days}
                     onChange={(e) => setForm((f) => ({ ...f, default_payment_terms_days: Number(e.target.value) }))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Default expense account</span>
            <select className="input mt-1" value={form.default_expense_account}
                    onChange={(e) => setForm((f) => ({ ...f, default_expense_account: e.target.value }))}>
              <option value="">— none —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}{a.entity_code ? ` (${a.entity_code})` : " (shared)"}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-gray-400 mt-0.5 block">
              Pre-fills the debit side on bills drafted from this vendor.
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Notes</span>
            <textarea className="input mt-1" rows={2} value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy || !form.code || !form.name} className="btn-primary">
              {busy ? "Saving…" : mode === "edit" ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
