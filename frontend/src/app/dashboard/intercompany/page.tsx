"use client";

/* Intercompany groups — list, inspect member JEs, run the net-to-zero
 * validator. Each group represents one intercompany transaction split
 * across multiple entities; the validator enforces that the lines on
 * intercompany_receivable / intercompany_payable accounts sum to zero
 * in a common reporting currency. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Network, Plus, X, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";


interface MemberEntry {
  id: number;
  entry_number: string;
  entity_code: string;
  date: string;
  status: string;
  currency: string;
  total: string;
}

interface Group {
  id: number;
  reference: string;
  description: string;
  created_at: string;
  entry_count: number;
  member_entries: MemberEntry[];
}


function statusBadge(status: string) {
  switch (status) {
    case "posted": return "badge-green";
    case "approved": return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected": return "badge-red";
    case "reversed": return "badge-gray";
    default: return "badge-gray";
  }
}


export default function IntercompanyPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [checks, setChecks] = useState<Record<number, { ok: boolean; message?: string; details?: any }>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ results: Group[] } | Group[]>("/beakon/intercompany-groups/");
      setGroups(Array.isArray(d) ? d : (d.results ?? []));
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const checkBalance = async (g: Group) => {
    setBusyId(g.id);
    try {
      const r = await api.post<{ ok: boolean; error?: { message: string; details: any } }>(
        `/beakon/intercompany-groups/${g.id}/check-balance/`,
      );
      setChecks((prev) => ({
        ...prev,
        [g.id]: r.ok
          ? { ok: true }
          : { ok: false, message: r.error?.message, details: r.error?.details },
      }));
    } catch (e: any) {
      setChecks((prev) => ({ ...prev, [g.id]: { ok: false, message: e?.message || "Failed" } }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Intercompany</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Each group bundles the JEs that together represent one intercompany
            transaction. The validator ensures lines on intercompany accounts
            net to zero in a common reporting currency before any leg can post.
          </p>
        </div>
        <button onClick={() => setDrawer(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Group
        </button>
      </div>

      <div className="card p-4">
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center">
            <Network className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No intercompany groups yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const check = checks[g.id];
              return (
                <div key={g.id} className="border border-canvas-100 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-500">#{g.id}</span>
                        <span className="text-sm font-medium text-gray-900">
                          {g.reference || "(no reference)"}
                        </span>
                      </div>
                      {g.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{g.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {check && check.ok && (
                        <span className="badge-green">
                          <ShieldCheck className="w-3 h-3 inline mr-0.5" />Balanced
                        </span>
                      )}
                      {check && !check.ok && (
                        <span className="badge-red" title={check.message}>
                          Unbalanced
                          {check.details?.net && ` (net ${check.details.net} ${check.details.reporting_currency})`}
                        </span>
                      )}
                      <button
                        disabled={busyId === g.id}
                        onClick={() => checkBalance(g)}
                        className="text-xs text-brand-700 hover:underline disabled:opacity-50"
                      >
                        {busyId === g.id ? "Checking…" : "Check balance"}
                      </button>
                    </div>
                  </div>

                  {check && !check.ok && check.details?.per_entity && (
                    <div className="mb-2 rounded-md bg-red-50 border border-red-100 p-2 text-xs">
                      <div className="font-medium text-red-800 mb-1">Per-entity net (in {check.details.reporting_currency}):</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-red-700">
                        {Object.entries(check.details.per_entity).map(([code, amt]) => (
                          <div key={code} className="flex justify-between">
                            <span>{code}</span>
                            <span>{amt as string}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wider">
                          <th className="pb-1 pr-4 font-medium">Entry</th>
                          <th className="pb-1 pr-4 font-medium">Entity</th>
                          <th className="pb-1 pr-4 font-medium">Date</th>
                          <th className="pb-1 pl-4 font-medium text-right">Total</th>
                          <th className="pb-1 pl-4 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.member_entries.map((m) => (
                          <tr key={m.id} className="border-t border-canvas-50 hover:bg-canvas-50">
                            <td className="py-1 pr-4">
                              <Link
                                href={`/dashboard/journal-entries/${m.id}`}
                                className="font-mono text-brand-700 hover:underline"
                              >
                                {m.entry_number}
                              </Link>
                            </td>
                            <td className="py-1 pr-4 font-mono text-gray-700">{m.entity_code}</td>
                            <td className="py-1 pr-4 text-gray-500 whitespace-nowrap">{fmtDate(m.date)}</td>
                            <td className="py-1 pl-4 text-right font-mono text-gray-700 tabular-nums whitespace-nowrap">
                              <span className="text-gray-400">{m.currency}</span> {fmt2(m.total)}
                            </td>
                            <td className="py-1 pl-4">
                              <span className={statusBadge(m.status)}>{fmtLabel(m.status)}</span>
                            </td>
                          </tr>
                        ))}
                        {g.member_entries.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-2 text-center text-gray-400 italic">
                              No journal entries linked yet
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {drawer && (
        <GroupDrawer
          onClose={() => setDrawer(false)}
          onCreated={async () => { setDrawer(false); await load(); }}
        />
      )}
    </div>
  );
}


function GroupDrawer({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ reference: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/beakon/intercompany-groups/", {
        reference: form.reference.trim(),
        description: form.description.trim(),
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
      <div className="w-full sm:w-[420px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">New Intercompany Group</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <p className="text-xs text-gray-500">
            Once the group exists, create the member journal entries on each
            entity and tag them with this group via the JE form.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Reference</span>
            <input
              className="input mt-1"
              placeholder="e.g. LOAN-2026-04, WIRE-1234"
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Description</span>
            <textarea
              className="input mt-1"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
