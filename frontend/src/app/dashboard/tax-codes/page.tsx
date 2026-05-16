"use client";

/* Tax Codes — VAT/tax rate registry. Each code links to the GL accounts
 * where output VAT (sales liability) and input VAT (purchase asset) land.
 *
 * Same visual vocabulary as /dashboard/accounts and /dashboard/bank:
 * PageHeader with org context chip, SummaryStat strip, EmptyState with
 * CTA, sticky-header table, drawer for create/edit. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle, ArrowLeft, ArrowUpCircle, Globe, Percent, Plus, Receipt, Search,
  Sparkles, X, ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmtLabel, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";

interface Account { id: number; code: string; name: string; account_type: string; account_subtype: string; }

interface TaxCode {
  id: number;
  code: string;
  name: string;
  country_code: string;
  tax_type: string;
  rate: string;
  output_account: number | null;
  output_account_code: string | null;
  input_account: number | null;
  input_account_code: string | null;
  is_reverse_charge: boolean;
  effective_from: string | null;
  effective_to: string | null;
  active_flag: boolean;
  notes: string;
}

const TAX_TYPES = [
  { value: "STANDARD",       label: "Standard" },
  { value: "REDUCED",        label: "Reduced" },
  { value: "SPECIAL",        label: "Special" },
  { value: "ZERO",           label: "Zero-rated" },
  { value: "EXEMPT",         label: "Exempt" },
  { value: "REVERSE_CHARGE", label: "Reverse charge" },
];

/* Tone per tax type — keeps the table scannable. */
const TYPE_TONE: Record<string, string> = {
  STANDARD:       "bg-brand-50 text-brand-700 ring-brand-100",
  REDUCED:        "bg-emerald-50 text-emerald-700 ring-emerald-100",
  SPECIAL:        "bg-violet-50 text-violet-700 ring-violet-100",
  ZERO:           "bg-sky-50 text-sky-700 ring-sky-100",
  EXEMPT:         "bg-canvas-100 text-gray-600 ring-canvas-200",
  REVERSE_CHARGE: "bg-amber-50 text-amber-700 ring-amber-100",
};

/* Best-effort flag emoji for the country-code chip. Falls back gracefully
 * when the code is non-ISO (e.g. "EU"). */
function flagFor(cc: string): string {
  if (!cc || cc.length !== 2) return "";
  const A = 0x1F1E6;
  const a = "A".charCodeAt(0);
  return String.fromCodePoint(A + cc.toUpperCase().charCodeAt(0) - a)
       + String.fromCodePoint(A + cc.toUpperCase().charCodeAt(1) - a);
}


export default function TaxCodesPage() {
  const [codes, setCodes] = useState<TaxCode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<TaxCode | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");      // "" = all
  const [activeFilter, setActiveFilter] = useState<string>("");  // "" / "active" / "archived"

  const load = async () => {
    setLoading(true);
    const [tc, acc] = await Promise.all([
      api.get<{ results: TaxCode[] } | TaxCode[]>("/beakon/tax-codes/")
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => [] as TaxCode[]),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/")
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => [] as Account[]),
    ]);
    setCodes(tc);
    setAccounts(acc);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  // ── Stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = codes.filter((c) => c.active_flag);
    const countries = new Set(codes.map((c) => c.country_code).filter(Boolean));
    const rates = active
      .map((c) => parseFloat(c.rate))
      .filter((r) => Number.isFinite(r) && r > 0);
    const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    return {
      total: codes.length,
      active: active.length,
      archived: codes.length - active.length,
      countries: countries.size,
      avgRate,
      types: new Set(codes.map((c) => c.tax_type)).size,
    };
  }, [codes]);

  // ── Filtered list ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return codes.filter((c) => {
      if (typeFilter && c.tax_type !== typeFilter) return false;
      if (activeFilter === "active" && !c.active_flag) return false;
      if (activeFilter === "archived" && c.active_flag) return false;
      if (q) {
        const blob = `${c.code} ${c.name} ${c.country_code} ${c.tax_type} ${c.notes}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [codes, search, typeFilter, activeFilter]);

  return (
    <div>
      <Link
        href="/dashboard/accounting"
        className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Accounting
      </Link>
      <PageHeader
        title="Tax Codes"
        description="VAT and other indirect-tax rates with the GL accounts where output and input VAT land. Bills and invoices pick a code per line — the engine routes per-line VAT to the right ledger automatically."
        context={
          <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
            <Receipt className="h-3.5 w-3.5 text-brand-600" />
            <span className="font-medium text-gray-800">{stats.active} active</span>
            {stats.archived > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="tabular-nums">{stats.archived} archived</span>
              </>
            )}
          </div>
        }
        actions={
          <button onClick={() => setDrawer("new")} className="btn-primary">
            <Plus className="w-4 h-4 mr-1.5" /> New Tax Code
          </button>
        }
      />

      {/* ── Summary tiles ──────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat
          label="Active codes"
          value={stats.active}
          hint={stats.archived > 0 ? `${stats.archived} archived` : "All in use"}
        />
        <SummaryStat
          label="Countries"
          value={stats.countries}
          hint={stats.countries === 1 ? "Single jurisdiction" : "Multi-jurisdiction"}
        />
        <SummaryStat
          label="Tax types in use"
          value={stats.types}
          hint="Standard / reduced / zero / etc."
        />
        <SummaryStat
          label="Average rate"
          value={stats.avgRate ? `${stats.avgRate.toFixed(2)}%` : "—"}
          hint="Across active, non-zero codes"
        />
      </div>

      {/* ── Filters ───────────────────────────────────────────────── */}
      <div className="mt-5 mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name, country, notes…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-canvas-200 bg-white focus:border-brand-300 focus:outline-none"
          />
        </div>
        <FilterChip active={!typeFilter} onClick={() => setTypeFilter("")}>
          All types
        </FilterChip>
        {TAX_TYPES.slice(0, 4).map((t) => (
          <FilterChip
            key={t.value}
            active={typeFilter === t.value}
            onClick={() => setTypeFilter(typeFilter === t.value ? "" : t.value)}
          >
            {t.label}
          </FilterChip>
        ))}
        <span className="text-gray-300">·</span>
        <FilterChip
          active={activeFilter === "active"}
          onClick={() => setActiveFilter(activeFilter === "active" ? "" : "active")}
        >
          Active only
        </FilterChip>
        <FilterChip
          active={activeFilter === "archived"}
          onClick={() => setActiveFilter(activeFilter === "archived" ? "" : "archived")}
        >
          Archived
        </FilterChip>
        {(search || typeFilter || activeFilter) && (
          <button
            onClick={() => { setSearch(""); setTypeFilter(""); setActiveFilter(""); }}
            className="text-xs text-gray-400 hover:text-gray-700 underline ml-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {loading ? (
          <table className="w-full text-sm">
            <tbody>{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} columns={7} />)}</tbody>
          </table>
        ) : codes.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No tax codes yet"
            description="Tax codes route VAT to the right GL accounts on every bill and invoice line. Add one to get started."
            primaryAction={{
              label: "Add CH-VAT-STD (8.1%)",
              icon: Sparkles,
              onClick: () => setDrawer("new"),
            }}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No tax codes match these filters"
            description="Try clearing the search or filter chips above."
            primaryAction={{
              label: "Clear filters",
              onClick: () => { setSearch(""); setTypeFilter(""); setActiveFilter(""); },
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Code · Name</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Country</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Rate</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Output (CR on sales)</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Input (DR on purchases)</th>
                  <th className="px-4 py-2.5 text-center font-semibold w-20">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((c) => {
                  const tone = TYPE_TONE[c.tax_type] ?? "bg-canvas-100 text-gray-600 ring-canvas-200";
                  const rate = parseFloat(c.rate);
                  return (
                    <tr key={c.id} className="hover:bg-canvas-50/40 cursor-pointer"
                        onClick={() => setDrawer(c)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                            <Percent className="w-4 h-4 text-brand-700" />
                          </div>
                          <div>
                            <div className="text-sm font-mono font-semibold text-gray-900">{c.code}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5 max-w-[260px] truncate">{c.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center rounded-full ring-1 ring-inset px-2 py-0.5 text-[10px] font-medium",
                          tone,
                        )}>
                          {fmtLabel(c.tax_type)}
                        </span>
                        {c.is_reverse_charge && c.tax_type !== "REVERSE_CHARGE" && (
                          <span className="ml-1.5 inline-flex rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100 px-1.5 py-0.5 text-[10px]">
                            RC
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-700">
                        {c.country_code ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-base leading-none" aria-hidden>{flagFor(c.country_code)}</span>
                            <span className="font-mono">{c.country_code}</span>
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold tabular-nums text-gray-900">
                          {Number.isFinite(rate) ? rate.toFixed(2) : "—"}<span className="text-gray-400 text-xs ml-0.5">%</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {c.output_account_code ? (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <ArrowUpCircle className="w-3.5 h-3.5 text-rose-500" />
                            <span className="font-mono text-gray-700">{c.output_account_code}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-300 italic">— not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.input_account_code ? (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="font-mono text-gray-700">{c.input_account_code}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-300 italic">non-recoverable</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={c.active_flag ? "badge-green" : "badge-gray"}>
                          {c.active_flag ? "Active" : "Archived"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <TaxCodeDrawer
          tc={drawer === "new" ? null : drawer}
          accounts={accounts}
          onClose={() => setDrawer(null)}
          onSaved={async () => { setDrawer(null); await load(); }}
        />
      )}
    </div>
  );
}

function TaxCodeDrawer({
  tc, accounts, onClose, onSaved,
}: {
  tc: TaxCode | null;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: tc?.code || "",
    name: tc?.name || "",
    country_code: tc?.country_code || "CH",
    tax_type: tc?.tax_type || "STANDARD",
    rate: tc?.rate || "8.10",
    output_account: tc?.output_account?.toString() || "",
    input_account: tc?.input_account?.toString() || "",
    is_reverse_charge: tc?.is_reverse_charge || false,
    effective_from: tc?.effective_from || "",
    effective_to: tc?.effective_to || "",
    active_flag: tc?.active_flag !== false,
    notes: tc?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const liabilityAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "liability" || a.account_subtype === "vat_payable"),
    [accounts],
  );
  const assetAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === "asset" || a.account_subtype === "vat_receivable"),
    [accounts],
  );

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true); setErr(null);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      country_code: form.country_code.trim(),
      tax_type: form.tax_type,
      rate: form.rate,
      output_account: form.output_account ? Number(form.output_account) : null,
      input_account: form.input_account ? Number(form.input_account) : null,
      is_reverse_charge: form.is_reverse_charge,
      effective_from: form.effective_from || null,
      effective_to: form.effective_to || null,
      active_flag: form.active_flag,
      notes: form.notes,
    };
    try {
      if (tc) {
        await api.patch(`/beakon/tax-codes/${tc.id}/`, payload);
      } else {
        await api.post("/beakon/tax-codes/", payload);
      }
      await onSaved();
    } catch (e: any) {
      setErr(e?.error?.message || e?.detail || JSON.stringify(e) || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full sm:w-[480px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">{tc ? "Edit Tax Code" : "New Tax Code"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Code *</span>
              <input className="input mt-1" required value={form.code}
                     onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                     placeholder="CH-VAT-STD" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Country</span>
              <input className="input mt-1" maxLength={4} value={form.country_code}
                     onChange={(e) => setForm((f) => ({ ...f, country_code: e.target.value }))}
                     placeholder="CH" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Name *</span>
            <input className="input mt-1" required value={form.name}
                   onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                   placeholder="Swiss Standard VAT 8.1%" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Type</span>
              <select className="input mt-1" value={form.tax_type}
                      onChange={(e) => setForm((f) => ({ ...f, tax_type: e.target.value }))}>
                {TAX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Rate (%) *</span>
              <input className="input mt-1" type="number" step="0.01" min="0" max="100"
                     required value={form.rate}
                     onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">
              Output VAT account (CR on sales — usually a liability)
            </span>
            <select className="input mt-1" value={form.output_account}
                    onChange={(e) => setForm((f) => ({ ...f, output_account: e.target.value }))}>
              <option value="">— none —</option>
              {liabilityAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">
              Input VAT account (DR on purchases — usually an asset)
            </span>
            <select className="input mt-1" value={form.input_account}
                    onChange={(e) => setForm((f) => ({ ...f, input_account: e.target.value }))}>
              <option value="">— none (non-recoverable) —</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Effective from</span>
              <input className="input mt-1" type="date" value={form.effective_from}
                     onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Effective to</span>
              <input className="input mt-1" type="date" value={form.effective_to}
                     onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))} />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.is_reverse_charge}
                   onChange={(e) => setForm((f) => ({ ...f, is_reverse_charge: e.target.checked }))} />
            <span className="text-xs text-gray-600">Reverse charge (B2B cross-border)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.active_flag}
                   onChange={(e) => setForm((f) => ({ ...f, active_flag: e.target.checked }))} />
            <span className="text-xs text-gray-600">Active</span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Notes</span>
            <textarea className="input mt-1" rows={2} value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm">
              {busy ? "Saving…" : (tc ? "Save" : "Create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
