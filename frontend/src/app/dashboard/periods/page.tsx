"use client";

/* Fiscal periods — scoped per-entity (different entities can have different
 * close states). Create new periods + soft-close / hard-close / reopen. */
import { useEffect, useMemo, useState } from "react";
import { Calendar, Plus, Lock, Unlock, X, Repeat } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtLabel } from "@/lib/format";


interface Entity { id: number; code: string; name: string; functional_currency: string; }

interface Period {
  id: number;
  entity: number;
  entity_code: string;
  name: string;
  period_type: string;
  start_date: string;
  end_date: string;
  status: string;
  closed_at: string | null;
  closed_by: number | null;
}


function statusBadge(status: string) {
  switch (status) {
    case "open": return "badge-green";
    case "soft_close": return "badge-yellow";
    case "closed": return "badge-gray";
    default: return "badge-gray";
  }
}


export default function PeriodsPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityId, setEntityId] = useState<string>("");
  const [drawer, setDrawer] = useState(false);

  const load = async () => {
    setLoading(true);
    const [ents, pers] = await Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/").then((d) =>
        Array.isArray(d) ? d : (d.results ?? []),
      ).catch(() => []),
      api.get<{ results: Period[] } | Period[]>("/beakon/periods/").then((d) =>
        Array.isArray(d) ? d : (d.results ?? []),
      ).catch(() => []),
    ]);
    setEntities(ents);
    setPeriods(pers);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() =>
    periods.filter((p) => !entityId || p.entity.toString() === entityId),
    [periods, entityId]);

  const closePeriod = async (p: Period, status: "soft_close" | "closed") => {
    try {
      await api.post(`/beakon/periods/${p.id}/close/`, { status });
      await load();
    } catch (e: any) {
      alert(e?.error?.message || "Failed");
    }
  };

  const reopenPeriod = async (p: Period) => {
    if (!confirm(`Reopen ${p.name}?\nClosed JEs will be editable again.`)) return;
    try {
      await api.post(`/beakon/periods/${p.id}/reopen/`);
      await load();
    } catch (e: any) {
      alert(e?.error?.message || "Failed");
    }
  };

  const runRevaluation = async (p: Period) => {
    if (!confirm(
      `Run FX revaluation for ${p.name} (entity ${p.entity_code}) ` +
      `as of ${p.end_date}?\n\nThis creates a DRAFT journal entry — you'll ` +
      `need to approve and post it.`,
    )) return;
    try {
      const r = await api.post<{ created: boolean; entry_number?: string; message?: string }>(
        "/beakon/fx-revaluation/",
        { entity: p.entity, as_of: p.end_date },
      );
      if (r.created) {
        alert(`Created draft ${r.entry_number}. Find it in Approvals or Journal Entries.`);
      } else {
        alert(r.message || "Nothing to revalue.");
      }
    } catch (e: any) {
      alert(e?.error?.message || e?.message || "Revaluation failed");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Periods</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Per-entity accounting periods. <span className="text-mint-600 font-medium">Open</span> accepts
            new JEs. <span className="text-yellow-600 font-medium">Soft-close</span> blocks new JEs but
            allows reversals. <span className="text-gray-500 font-medium">Closed</span> is fully locked.
          </p>
        </div>
        <button onClick={() => setDrawer(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Period
        </button>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-4 text-xs">
          <select className="input max-w-xs"
                  value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">All entities</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No periods yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Start</th>
                  <th className="pb-2 pr-4 font-medium">End</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pl-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-canvas-50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{p.entity_code}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{p.name}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500">{fmtLabel(p.period_type)}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(p.start_date)}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(p.end_date)}</td>
                    <td className="py-2 pr-4">
                      <span className={statusBadge(p.status)}>{fmtLabel(p.status)}</span>
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => runRevaluation(p)}
                                className="text-xs text-brand-700 hover:underline"
                                title="Run FX revaluation as of this period's end date">
                          <Repeat className="w-3 h-3 inline mr-0.5" />FX reval
                        </button>
                        <span className="text-gray-300">·</span>
                        {p.status === "open" && (
                          <>
                            <button onClick={() => closePeriod(p, "soft_close")}
                                    className="text-xs text-yellow-700 hover:underline">
                              Soft-close
                            </button>
                            <span className="text-gray-300">·</span>
                            <button onClick={() => closePeriod(p, "closed")}
                                    className="text-xs text-gray-700 hover:underline">
                              <Lock className="w-3 h-3 inline mr-0.5" />Close
                            </button>
                          </>
                        )}
                        {p.status === "soft_close" && (
                          <>
                            <button onClick={() => closePeriod(p, "closed")}
                                    className="text-xs text-gray-700 hover:underline">
                              <Lock className="w-3 h-3 inline mr-0.5" />Close
                            </button>
                            <span className="text-gray-300">·</span>
                            <button onClick={() => reopenPeriod(p)}
                                    className="text-xs text-mint-700 hover:underline">
                              <Unlock className="w-3 h-3 inline mr-0.5" />Reopen
                            </button>
                          </>
                        )}
                        {p.status === "closed" && (
                          <button onClick={() => reopenPeriod(p)}
                                  className="text-xs text-mint-700 hover:underline">
                            <Unlock className="w-3 h-3 inline mr-0.5" />Reopen
                          </button>
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
        <PeriodDrawer
          entities={entities}
          onClose={() => setDrawer(false)}
          onCreated={async () => { setDrawer(false); await load(); }}
        />
      )}
    </div>
  );
}


function PeriodDrawer({
  entities, onClose, onCreated,
}: { entities: Entity[]; onClose: () => void; onCreated: () => Promise<void> }) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    entity: entities[0]?.id?.toString() || "",
    name: today.toLocaleString("en-US", { month: "long", year: "numeric" }),
    period_type: "month",
    start_date: monthStart,
    end_date: monthEnd,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/beakon/periods/", {
        entity: Number(form.entity),
        name: form.name.trim(),
        period_type: form.period_type,
        start_date: form.start_date,
        end_date: form.end_date,
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
          <h2 className="text-base font-semibold">New Period</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
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
            <span className="text-xs font-medium text-gray-600">Name *</span>
            <input className="input mt-1" value={form.name}
                   onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Type *</span>
            <select className="input mt-1" value={form.period_type}
                    onChange={(e) => setForm((f) => ({ ...f, period_type: e.target.value }))}>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Start *</span>
              <input type="date" className="input mt-1" value={form.start_date}
                     onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">End *</span>
              <input type="date" className="input mt-1" value={form.end_date}
                     onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
            </label>
          </div>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy || !form.entity} className="btn-primary">
              {busy ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
