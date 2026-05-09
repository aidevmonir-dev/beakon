"use client";

/* Disbursements — bundle rebillable journal lines into a draft client invoice.
 * Mirrors the architecture-PDF DHL example: post a cost flagged rebillable,
 * then aggregate into one invoice to recover from the client. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Receipt, Send } from "lucide-react";
import { api } from "@/lib/api";
import { fmtAccounting, fmtDate } from "@/lib/format";

interface Entity { id: number; code: string; name: string; }
interface Customer { id: number; code: string; name: string; default_currency: string; }
interface Account { id: number; code: string; name: string; account_type: string; }

interface PendingLine {
  id: number;
  journal_entry: number;
  journal_entry_id: number;
  journal_entry_number: string;
  journal_entry_date: string;
  entity_id: number;
  entity_code: string;
  account: number;
  account_code: string;
  account_name: string;
  description: string;
  debit: string;
  credit: string;
  currency: string;
  rebill_client_dimension_value: number | null;
  client_code: string | null;
  client_name: string | null;
}

interface PendingSummaryRow {
  client_dimension_value_id: number | null;
  client_code: string | null;
  client_name: string | null;
  currency: string;
  total_amount: string;
  line_count: number;
}

export default function DisbursementsPage() {
  const router = useRouter();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lines, setLines] = useState<PendingLine[]>([]);
  const [summary, setSummary] = useState<PendingSummaryRow[]>([]);
  const [entityId, setEntityId] = useState("");
  const [currency, setCurrency] = useState("");
  const [clientId, setClientId] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showDrawer, setShowDrawer] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const lineParams: Record<string, string> = {};
    const summaryParams: Record<string, string> = {};
    if (entityId) {
      lineParams.entity = entityId;
      summaryParams.entity = entityId;
    }
    if (currency) lineParams.currency = currency;
    if (clientId) lineParams.client_dimension_value = clientId;

    const [ents, custs, accs, pls, sum] = await Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
        .then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Customer[] } | Customer[]>("/beakon/customers/", { page_size: "500" })
        .then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/",
        { account_type: "revenue", is_active: "true", page_size: "500" })
        .then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<PendingLine[]>("/beakon/disbursements/pending/", lineParams)
        .catch(() => [] as PendingLine[]),
      api.get<PendingSummaryRow[]>("/beakon/disbursements/summary/", summaryParams)
        .catch(() => [] as PendingSummaryRow[]),
    ]);
    setEntities(ents);
    setCustomers(custs);
    setAccounts(accs);
    setLines(pls);
    setSummary(sum);
    setSelected(new Set());
    setLoading(false);
  };

  useEffect(() => { void load(); }, [entityId, currency, clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Distinct client options sourced from current pending lines (always
  // accurate — never shows clients with nothing to recover).
  const clientOptions = useMemo(() => {
    const seen = new Map<string, { id: number; code: string; name: string }>();
    for (const l of lines) {
      if (l.rebill_client_dimension_value && l.client_code) {
        const key = String(l.rebill_client_dimension_value);
        if (!seen.has(key)) {
          seen.set(key, {
            id: l.rebill_client_dimension_value,
            code: l.client_code,
            name: l.client_name ?? l.client_code,
          });
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [lines]);

  // Group lines by client_code for display (UNASSIGNED grouped together).
  const grouped = useMemo(() => {
    const groups = new Map<string, { code: string; name: string; lines: PendingLine[] }>();
    for (const l of lines) {
      const key = l.client_code ?? "__UNASSIGNED__";
      const name = l.client_code ? (l.client_name ?? l.client_code) : "Unassigned";
      const code = l.client_code ?? "—";
      if (!groups.has(key)) groups.set(key, { code, name, lines: [] });
      groups.get(key)!.lines.push(l);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === "__UNASSIGNED__") return 1;
        if (b === "__UNASSIGNED__") return -1;
        return a.localeCompare(b);
      });
  }, [lines]);

  const selectedLines = lines.filter((l) => selected.has(l.id));
  const selectedCcy = useMemo(() => {
    const set = new Set(selectedLines.map((l) => l.currency));
    return set.size === 1 ? Array.from(set)[0] : "";
  }, [selectedLines]);
  const selectedTotal = useMemo(
    () => selectedLines.reduce((acc, l) => acc + Number(l.debit), 0),
    [selectedLines],
  );
  const selectedClients = useMemo(() => {
    const set = new Set(selectedLines.map((l) => l.client_code).filter(Boolean));
    return Array.from(set);
  }, [selectedLines]);
  const mixedClients = selectedClients.length > 1;

  const toggle = (id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroup = (groupLines: PendingLine[]) => {
    const ids = groupLines.map((l) => l.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const next = new Set(s);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === lines.length && lines.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(lines.map((l) => l.id)));
    }
  };

  const canCreateInvoice = selectedLines.length > 0 && selectedCcy.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Disbursements</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Rebillable journal lines waiting to be invoiced to a client.
            Pick lines that share one currency, click <strong>Create invoice</strong> to bundle them
            into a draft client invoice.
          </p>
        </div>
        <button
          onClick={() => setShowDrawer(true)}
          disabled={!canCreateInvoice}
          className="btn-primary disabled:opacity-50"
        >
          <Send className="w-4 h-4 mr-1.5" />
          Create invoice ({selectedLines.length})
        </button>
      </div>

      {/* Summary banner — per-client roll-up of pending recoveries */}
      {summary.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-medium text-gray-700">Pending recoveries by client</h2>
            <span className="text-[11px] text-gray-400">
              {summary.reduce((a, r) => a + r.line_count, 0)} line
              {summary.reduce((a, r) => a + r.line_count, 0) !== 1 ? "s" : ""} across{" "}
              {summary.length} group{summary.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {summary.map((r, i) => {
              const isFiltered = clientId === String(r.client_dimension_value_id ?? "");
              return (
                <button
                  key={i}
                  onClick={() => setClientId(
                    isFiltered ? "" : String(r.client_dimension_value_id ?? "")
                  )}
                  disabled={r.client_dimension_value_id == null}
                  className={`text-left rounded border px-3 py-2 transition ${
                    isFiltered
                      ? "border-mint-400 bg-mint-50/60"
                      : "border-canvas-100 bg-canvas-50/40 hover:bg-canvas-50"
                  } ${r.client_dimension_value_id == null ? "opacity-60 cursor-default" : ""}`}
                  title={r.client_dimension_value_id == null
                    ? "Lines with no client assigned"
                    : `Filter to ${r.client_code}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs font-medium text-gray-700 truncate">
                      {r.client_code ?? "Unassigned"}
                    </span>
                    <span className="text-[11px] text-gray-400 shrink-0">
                      {r.line_count} ln
                    </span>
                  </div>
                  {r.client_name && r.client_name !== r.client_code && (
                    <div className="text-[11px] text-gray-500 truncate">{r.client_name}</div>
                  )}
                  <div className="font-mono tabular-nums text-sm font-medium text-gray-900 mt-0.5">
                    {fmtAccounting(r.total_amount)}{" "}
                    <span className="text-[11px] text-gray-500">{r.currency}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-4 text-xs">
          <select className="input max-w-xs" value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}>
            <option value="">All entities</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
            ))}
          </select>
          <select className="input max-w-xs" value={clientId}
                  onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
            ))}
          </select>
          <input className="input max-w-[120px]" placeholder="Currency"
                 value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          {selectedLines.length > 0 && (
            <div className="ml-auto text-xs text-gray-600">
              <span className="font-mono tabular-nums font-medium">
                {fmtAccounting(selectedTotal)}
              </span>{" "}
              {selectedCcy
                ? selectedCcy
                : <span className="text-amber-600">⚠ mixed currencies</span>}
              {mixedClients && (
                <span className="ml-2 text-amber-600">⚠ mixed clients</span>
              )}{" "}
              selected
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : lines.length === 0 ? (
          <div className="py-12 text-center">
            <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              No pending rebillables. Cost lines flagged <code>is_rebillable</code> show up here once posted.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-2">
                    <input type="checkbox"
                           checked={selected.size === lines.length && lines.length > 0}
                           onChange={toggleAll} />
                  </th>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">JE</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Account</th>
                  <th className="pb-2 pr-4 font-medium">Description</th>
                  <th className="pb-2 pr-4 font-medium text-right">Amount</th>
                  <th className="pb-2 pr-4 font-medium">Ccy</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([key, group]) => {
                  const groupTotalsByCcy = group.lines.reduce<Record<string, number>>(
                    (acc, l) => {
                      acc[l.currency] = (acc[l.currency] ?? 0) + Number(l.debit);
                      return acc;
                    },
                    {},
                  );
                  const allSelected = group.lines.every((l) => selected.has(l.id));
                  const someSelected = group.lines.some((l) => selected.has(l.id));
                  return (
                    <GroupBlock
                      key={key}
                      group={group}
                      groupTotalsByCcy={groupTotalsByCcy}
                      allSelected={allSelected}
                      someSelected={someSelected}
                      selected={selected}
                      onToggleGroup={() => toggleGroup(group.lines)}
                      onToggleLine={toggle}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDrawer && (
        <CreateInvoiceDrawer
          customers={customers}
          entities={entities}
          accounts={accounts}
          lines={selectedLines}
          currency={selectedCcy}
          onClose={() => setShowDrawer(false)}
          onCreated={async (invoiceId) => {
            setShowDrawer(false);
            await load();
            router.push(`/dashboard/invoices/${invoiceId}`);
          }}
        />
      )}
    </div>
  );
}

function GroupBlock({
  group, groupTotalsByCcy, allSelected, someSelected, selected,
  onToggleGroup, onToggleLine,
}: {
  group: { code: string; name: string; lines: PendingLine[] };
  groupTotalsByCcy: Record<string, number>;
  allSelected: boolean;
  someSelected: boolean;
  selected: Set<number>;
  onToggleGroup: () => void;
  onToggleLine: (id: number) => void;
}) {
  return (
    <>
      <tr className="bg-canvas-50/60 border-t border-canvas-100">
        <td className="py-1.5 pr-2">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={onToggleGroup}
            title={allSelected ? "Deselect all in group" : "Select all in group"}
          />
        </td>
        <td colSpan={5} className="py-1.5 pr-4 text-xs">
          <span className="font-medium text-gray-700">
            {group.code === "—" ? "Unassigned" : group.code}
          </span>
          {group.name !== group.code && group.code !== "—" && (
            <span className="text-gray-500"> · {group.name}</span>
          )}
          <span className="text-[11px] text-gray-400 ml-2">
            ({group.lines.length} line{group.lines.length !== 1 ? "s" : ""})
          </span>
        </td>
        <td className="py-1.5 pr-4 text-right text-xs font-medium text-gray-700">
          {Object.entries(groupTotalsByCcy).map(([ccy, total], i) => (
            <span key={ccy}>
              {i > 0 && <span className="text-gray-400 mx-1">+</span>}
              <span className="font-mono tabular-nums">{fmtAccounting(total)}</span>
              <span className="text-gray-400 ml-1">{ccy}</span>
            </span>
          ))}
        </td>
        <td />
      </tr>
      {group.lines.map((l) => (
        <tr key={l.id} className={`hover:bg-canvas-50 ${selected.has(l.id) ? "bg-mint-50/40" : ""}`}>
          <td className="py-2 pr-2 pl-4">
            <input type="checkbox" checked={selected.has(l.id)}
                   onChange={() => onToggleLine(l.id)} />
          </td>
          <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(l.journal_entry_date)}</td>
          <td className="py-2 pr-4 font-mono text-xs">
            <Link
              href={`/dashboard/journal-entries/${l.journal_entry_id}`}
              className="text-mint-700 hover:underline"
            >
              {l.journal_entry_number}
            </Link>
          </td>
          <td className="py-2 pr-4 font-mono text-xs text-gray-600">{l.entity_code}</td>
          <td className="py-2 pr-4 font-mono text-xs">
            {l.account_code} · <span className="text-gray-600">{l.account_name}</span>
          </td>
          <td className="py-2 pr-4 text-xs text-gray-700">{l.description || "—"}</td>
          <td className="py-2 pr-4 text-right tabular-nums font-mono text-xs">
            {fmtAccounting(l.debit)}
          </td>
          <td className="py-2 pr-4 text-xs text-gray-500">{l.currency}</td>
        </tr>
      ))}
    </>
  );
}

function CreateInvoiceDrawer({
  customers, entities, accounts, lines, currency, onClose, onCreated,
}: {
  customers: Customer[];
  entities: Entity[];
  accounts: Account[];
  lines: PendingLine[];
  currency: string;
  onClose: () => void;
  onCreated: (invoiceId: number) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const entityIdsInSelection = Array.from(new Set(lines.map((l) => l.entity_id)));
  const defaultEntity = entityIdsInSelection.length === 1 ? entityIdsInSelection[0].toString() : "";

  // Auto-pick customer: if all selected lines share one client_code AND a
  // customer exists with that code, pre-select it. The operator can still
  // override.
  const matchedCustomer = useMemo(() => {
    const codes = Array.from(new Set(lines.map((l) => l.client_code).filter(Boolean)));
    if (codes.length !== 1) return "";
    const cust = customers.find((c) => c.code === codes[0]);
    return cust ? String(cust.id) : "";
  }, [lines, customers]);

  const [form, setForm] = useState({
    entity: defaultEntity,
    customer: matchedCustomer,
    invoice_date: today,
    due_date: "",
    description: "",
  });
  const [method, setMethod] = useState<"net" | "gross">("net");
  const [recoveryAccount, setRecoveryAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = lines.reduce((acc, l) => acc + Number(l.debit), 0);
  const distinctClients = Array.from(new Set(lines.map((l) => l.client_code).filter(Boolean)));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (method === "gross" && !recoveryAccount) {
      setErr("Pick a recovery account for the gross method, or switch to Net.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const payload: Record<string, unknown> = {
        entity: Number(form.entity),
        customer: Number(form.customer),
        journal_line_ids: lines.map((l) => l.id),
        invoice_date: form.invoice_date,
        due_date: form.due_date || null,
        description: form.description,
      };
      if (method === "gross" && recoveryAccount) {
        payload.recovery_account = Number(recoveryAccount);
      }
      const r = await api.post<{ id: number }>(
        "/beakon/disbursements/create-invoice/", payload,
      );
      await onCreated(r.id);
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
          <h2 className="text-base font-semibold">Create disbursement invoice</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <span className="sr-only">Close</span>×
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="bg-canvas-50 rounded p-3 text-xs text-gray-600">
            <strong>{lines.length}</strong> line{lines.length !== 1 ? "s" : ""} ·{" "}
            <span className="font-mono tabular-nums font-medium text-gray-900">
              {fmtAccounting(total)} {currency}
            </span>
            {distinctClients.length === 1 && (
              <div className="mt-1 text-[11px] text-gray-500">
                Client tag on lines: <span className="font-mono">{distinctClients[0]}</span>
                {matchedCustomer && (
                  <span className="text-mint-700"> · matched to a customer record</span>
                )}
              </div>
            )}
            {distinctClients.length > 1 && (
              <div className="mt-1 text-[11px] text-amber-700">
                ⚠ Selected lines tag {distinctClients.length} different clients —
                make sure the chosen customer is correct.
              </div>
            )}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Entity *</span>
            <select className="input mt-1" required value={form.entity}
                    onChange={(e) => setForm((f) => ({ ...f, entity: e.target.value }))}>
              <option value="">— pick —</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Customer *</span>
            <select className="input mt-1" required value={form.customer}
                    onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}>
              <option value="">— pick —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Invoice date *</span>
              <input className="input mt-1" type="date" required value={form.invoice_date}
                     onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Due date</span>
              <input className="input mt-1" type="date" value={form.due_date}
                     onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
            </label>
          </div>

          {/* Net vs Gross method — accounting choice, not a hidden default */}
          <div className="border border-canvas-100 rounded p-3 bg-canvas-50/40">
            <div className="text-xs font-medium text-gray-700 mb-1.5">Recovery method</div>
            <label className="flex items-start gap-2 mb-1.5 cursor-pointer">
              <input type="radio" className="mt-0.5" checked={method === "net"}
                     onChange={() => setMethod("net")} />
              <div>
                <div className="text-xs font-medium text-gray-700">Net (default)</div>
                <div className="text-[11px] text-gray-500 leading-snug">
                  Recovery credits the original expense account. Cost is netted to
                  zero in the P&amp;L — what most pass-through disbursements use.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" className="mt-0.5" checked={method === "gross"}
                     onChange={() => setMethod("gross")} />
              <div className="flex-1">
                <div className="text-xs font-medium text-gray-700">Gross</div>
                <div className="text-[11px] text-gray-500 leading-snug">
                  Recovery posts to a separate disbursement-income account.
                  Cost stays in the P&amp;L; recovery shows as revenue.
                </div>
                {method === "gross" && (
                  <select
                    className="input mt-2 text-xs"
                    value={recoveryAccount}
                    onChange={(e) => setRecoveryAccount(e.target.value)}
                    required
                  >
                    <option value="">— pick recovery account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600">Description</span>
            <textarea className="input mt-1" rows={2} value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm">
              {busy ? "Creating…" : "Create draft invoice"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
