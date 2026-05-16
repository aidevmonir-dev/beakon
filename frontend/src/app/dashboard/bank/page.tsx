"use client";

/* Bank accounts — list with live GL balances, summary stats, and a
 * create drawer. Balance per row comes from the backend's `gl_balance`
 * (sum of posted debit-credit on the linked CoA account).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Building2, ChevronRight, CreditCard, Landmark, Plus, Search, Sparkles, Wallet, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2Fixed } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { SkeletonRow } from "@/components/ui/skeleton";


interface Entity { id: number; code: string; name: string; functional_currency: string; }

interface Account {
  id: number;
  code: string;
  name: string;
  entity: number | null;
  entity_code: string | null;
  account_subtype: string;
}

interface BankAccount {
  id: number;
  name: string;
  bank_name: string;
  account_number_last4: string;
  entity: number;
  entity_code: string;
  entity_name?: string;
  account: number;
  account_code: string;
  currency: string;
  opening_balance?: string;
  gl_balance?: string;
  is_active: boolean;
}


export default function BankPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("");

  const load = async () => {
    setLoading(true);
    const [ents, accs, bks] = await Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? []),
      ).catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", {
        account_subtype: "bank",
      }).then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: BankAccount[] } | BankAccount[]>("/beakon/bank-accounts/").then((d) =>
        Array.isArray(d) ? d : (d.results ?? []),
      ).catch(() => []),
    ]);
    setEntities(ents);
    setAccounts(accs);
    setBanks(bks);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  // ── Derived stats ───────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = banks.filter((b) => b.is_active);
    const byCurrency: Record<string, number> = {};
    for (const b of active) {
      const v = parseFloat(b.gl_balance || "0");
      byCurrency[b.currency] = (byCurrency[b.currency] || 0) + (Number.isFinite(v) ? v : 0);
    }
    const entitiesWithBank = new Set(active.map((b) => b.entity_code));
    return { active, byCurrency, entityCount: entitiesWithBank.size };
  }, [banks]);

  // ── Filtered list (search + entity chip) ───────────────────────────
  const entityCodes = useMemo(() => {
    const codes = Array.from(new Set(banks.map((b) => b.entity_code).filter(Boolean)));
    return codes.sort();
  }, [banks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return banks.filter((b) => {
      if (entityFilter && b.entity_code !== entityFilter) return false;
      if (q) {
        const blob = `${b.name} ${b.bank_name} ${b.entity_code} ${b.entity_name || ""} ${b.currency} ${b.account_number_last4}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [banks, search, entityFilter]);

  // Pick the dominant currency for the headline tile (by total magnitude)
  const headlineCcy = useMemo(() => {
    let best: string | null = null;
    let bestAmt = -Infinity;
    for (const [ccy, total] of Object.entries(stats.byCurrency)) {
      const m = Math.abs(total);
      if (m > bestAmt) { bestAmt = m; best = ccy; }
    }
    return best;
  }, [stats]);

  return (
    <div>
      <Link
        href="/dashboard/accounting"
        className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Accounting
      </Link>
      <PageHeader
        title="Bank Accounts"
        description="Live cash positions across every entity. Each row shows the GL balance — what the ledger actually says, not just what the bank statement claims. Click in to import statements, categorise transactions, and track approvals."
        context={
          <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
            <Landmark className="h-3.5 w-3.5 text-brand-600" />
            <span className="font-medium text-gray-800">{stats.active.length} active</span>
            <span className="text-gray-300">·</span>
            <span className="tabular-nums">{stats.entityCount} entit{stats.entityCount === 1 ? "y" : "ies"}</span>
          </div>
        }
        actions={
          <button onClick={() => setDrawer(true)} className="btn-primary">
            <Plus className="w-4 h-4 mr-1.5" /> New Bank Account
          </button>
        }
      />

      {/* ── Summary tiles ──────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {headlineCcy ? (
          <SummaryStat
            label={`Total ${headlineCcy}`}
            value={`${headlineCcy} ${fmt2Fixed(stats.byCurrency[headlineCcy], 2)}`}
            hint="Sum of GL balances in the dominant currency"
          />
        ) : (
          <SummaryStat label="Total" value="—" hint="No active bank accounts" />
        )}
        <SummaryStat
          label="Active accounts"
          value={stats.active.length}
          hint={banks.length - stats.active.length > 0 ? `${banks.length - stats.active.length} archived` : "All connected"}
        />
        <SummaryStat
          label="Entities covered"
          value={stats.entityCount}
          hint={`of ${entities.length} entities`}
        />
        <SummaryStat
          label="Currencies"
          value={Object.keys(stats.byCurrency).length || 0}
          hint={
            Object.entries(stats.byCurrency)
              .map(([c, v]) => `${c} ${fmt2Fixed(v, 2)}`)
              .join(" · ") || "—"
          }
        />
      </div>

      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="mt-5 mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, bank, last-4, or currency…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-canvas-200 bg-white focus:border-brand-300 focus:outline-none"
          />
        </div>
        <FilterChip active={!entityFilter} onClick={() => setEntityFilter("")}>
          All entities
        </FilterChip>
        {entityCodes.map((code) => (
          <FilterChip
            key={code}
            active={entityFilter === code}
            onClick={() => setEntityFilter(entityFilter === code ? "" : code)}
          >
            {code}
          </FilterChip>
        ))}
        {(search || entityFilter) && (
          <button
            onClick={() => { setSearch(""); setEntityFilter(""); }}
            className="text-xs text-gray-400 hover:text-gray-700 underline ml-1"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400 tabular-nums">
          {loading ? "loading…" : `${filtered.length} of ${banks.length}`}
        </span>
      </div>

      {/* ── List ───────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {loading ? (
          <table className="w-full text-sm">
            <tbody>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={6} />)}</tbody>
          </table>
        ) : banks.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No bank accounts connected"
            description="Create one linked to a bank-subtype account in your CoA."
            primaryAction={{ label: "New Bank Account", icon: Plus, onClick: () => setDrawer(true) }}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No bank accounts match these filters"
            description="Try clearing the search or entity chips above."
            primaryAction={{
              label: "Clear filters",
              onClick: () => { setSearch(""); setEntityFilter(""); },
            }}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-canvas-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Account</th>
                <th className="px-4 py-2.5 text-left font-semibold">Entity</th>
                <th className="px-4 py-2.5 text-left font-semibold">Linked CoA</th>
                <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
                <th className="px-4 py-2.5 text-center font-semibold">Status</th>
                <th className="px-4 py-2.5 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-canvas-100">
              {filtered.map((b) => {
                const bal = parseFloat(b.gl_balance || "0");
                return (
                  <tr key={b.id} className="hover:bg-canvas-50/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                          <CreditCard className="w-4 h-4 text-brand-700" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{b.name}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {b.bank_name || "—"}
                            {b.account_number_last4 && (
                              <span className="font-mono text-gray-400 ml-1.5">··{b.account_number_last4}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">{b.entity_name || b.entity_code}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{b.entity_code}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[11px] font-mono text-gray-600">{b.account_code}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-sm font-semibold tabular-nums text-gray-900">
                        <span className="text-[11px] text-gray-500 font-medium mr-1">{b.currency}</span>{fmt2Fixed(bal, 2)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={b.is_active ? "badge-green" : "badge-gray"}>
                        {b.is_active ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/bank/${b.id}`}
                        className="text-xs text-brand-700 hover:underline flex items-center gap-0.5 justify-end"
                      >
                        Open <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {drawer && (
        <CreateDrawer
          entities={entities}
          accounts={accounts}
          onClose={() => setDrawer(false)}
          onCreated={async () => { setDrawer(false); await load(); }}
        />
      )}
    </div>
  );
}


function CreateDrawer({
  entities, accounts, onClose, onCreated,
}: {
  entities: Entity[];
  accounts: Account[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "", bank_name: "", account_number_last4: "",
    entity: entities[0]?.id?.toString() || "",
    account: "", currency: entities[0]?.functional_currency || "EUR",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Account options filtered by selected entity.
  const availableAccounts = accounts.filter(
    (a) => a.entity === null || a.entity?.toString() === form.entity,
  );

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/beakon/bank-accounts/", {
        name: form.name.trim(),
        bank_name: form.bank_name.trim(),
        account_number_last4: form.account_number_last4.trim(),
        entity: Number(form.entity),
        account: Number(form.account),
        currency: form.currency.trim().toUpperCase(),
      });
      await onCreated();
    } catch (e: any) {
      setErr(JSON.stringify(e?.detail || e || "Failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full sm:w-[440px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">New Bank Account</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Entity *</span>
            <select className="input mt-1" value={form.entity}
                    onChange={(e) => {
                      const ent = entities.find((x) => x.id.toString() === e.target.value);
                      setForm((f) => ({
                        ...f, entity: e.target.value, account: "",
                        currency: ent?.functional_currency || f.currency,
                      }));
                    }}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Linked CoA account *</span>
            <select className="input mt-1" value={form.account}
                    onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}>
              <option value="">— select a bank-subtype account —</option>
              {availableAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}{a.entity_code ? "" : " (shared)"}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-gray-400 mt-0.5 block">
              Only accounts with subtype=<code>bank</code> are listed.
              Create one in Chart of Accounts if needed.
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Name *</span>
            <input className="input mt-1" value={form.name}
                   onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                   placeholder="Operating Checking" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Bank name</span>
              <input className="input mt-1" value={form.bank_name}
                     onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
                     placeholder="UBS Switzerland" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Last 4</span>
              <input className="input mt-1 font-mono" maxLength={4} value={form.account_number_last4}
                     onChange={(e) => setForm((f) => ({ ...f, account_number_last4: e.target.value }))}
                     placeholder="4567" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Currency *</span>
            <input className="input mt-1 uppercase font-mono" maxLength={3}
                   value={form.currency}
                   onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy || !form.entity || !form.account || !form.name}
                    className="btn-primary">
              {busy ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
