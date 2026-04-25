"use client";

/* Bank accounts — list + create + link into the ledger. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, Plus, X, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";


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
  account: number;
  account_code: string;
  currency: string;
  is_active: boolean;
}


export default function BankPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);

  const load = async () => {
    setLoading(true);
    const [ents, accs, bks] = await Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/").then((d) =>
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

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Bank Feed</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            CSV import → categorize → draft JE → approval → posted. One feeder per the
            blueprint's Objective 3.
          </p>
        </div>
        <button onClick={() => setDrawer(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Bank Account
        </button>
      </div>

      <div className="card p-4">
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : banks.length === 0 ? (
          <div className="py-12 text-center">
            <CreditCard className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No bank accounts connected.</p>
            <p className="text-xs text-gray-400 mt-1">
              Create one linked to a <code className="text-[11px]">bank</code>-subtype account in your CoA.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-canvas-100">
            {banks.map((b) => (
              <li key={b.id} className="py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-brand-700" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{b.name}</span>
                    <span className="text-xs text-gray-500">{b.bank_name}</span>
                    {b.account_number_last4 && (
                      <span className="text-[11px] font-mono text-gray-400">
                        ••{b.account_number_last4}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {b.entity_code} · COA {b.account_code} · {b.currency}
                  </div>
                </div>
                <span className={b.is_active ? "badge-green" : "badge-gray"}>
                  {b.is_active ? "Active" : "Inactive"}
                </span>
                <Link href={`/dashboard/bank/${b.id}`}
                      className="text-xs text-brand-700 hover:underline flex items-center gap-0.5">
                  Open <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </li>
            ))}
          </ul>
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
                     placeholder="Mercury" />
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
