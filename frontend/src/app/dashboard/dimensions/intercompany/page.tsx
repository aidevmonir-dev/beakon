"use client";

/* Inter-company — workbook tab 11 Related-Party Master, filtered to
 * entity-form parties (companies, trusts, foundations, partnerships).
 * These are the counterparties that show up in RP-tagged journal lines.
 *
 * Distinct from /dashboard/intercompany which lists IntercompanyGroup
 * (the JE-grouping for net-to-zero elimination across entities). */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Plus, X, Search } from "lucide-react";
import { api } from "@/lib/api";


const ENTITY_TYPES = [
  { value: "COMPANY", label: "Company" },
  { value: "TRUST", label: "Trust" },
  { value: "FOUNDATION", label: "Foundation" },
  { value: "PARTNERSHIP", label: "Partnership" },
];
const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];


interface RelatedParty {
  id: number;
  related_party_id: string;
  related_party_name: string;
  short_name: string;
  related_party_type: string;
  party_form: string;
  relationship_to_client: string;
  ownership_percent: string | null;
  country_code: string;
  jurisdiction_code: string;
  base_currency: string;
  status: string;
  active_flag: boolean;
  notes: string;
}


function statusBadge(s: string): string {
  return s === "ACTIVE" ? "badge-green" : "badge-gray";
}


export default function IntercompanyMasterPage() {
  const [rows, setRows] = useState<RelatedParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; party: RelatedParty } | null>(null);

  const load = async () => {
    setLoading(true);
    const d = await api.get<{ results: RelatedParty[] } | RelatedParty[]>(
      "/beakon/related-parties/",
      { party_form: "ENTITY", page_size: "500" },
    )
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
      v.related_party_id.toLowerCase().includes(s) ||
      v.related_party_name?.toLowerCase().includes(s) ||
      v.short_name?.toLowerCase().includes(s) ||
      v.relationship_to_client?.toLowerCase().includes(s),
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
            <Building2 className="w-5 h-5 text-amber-600" />
            Inter-company
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Related companies, trusts, foundations, and partnerships. Tagged on
            the RP dimension whenever a posting affects a related-party balance.
          </p>
        </div>
        <button onClick={() => setDrawer({ mode: "create" })} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New entity
        </button>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9"
                   placeholder="Search by ID, name, relationship…"
                   value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="ml-auto text-xs text-gray-400">
            {loading ? "loading…" : `${visible.length} entit${visible.length === 1 ? "y" : "ies"}`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {rows.length === 0 ? "No related entities yet." : "No entities match the filter."}
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
                  <th className="pb-2 pr-4 font-medium">Relationship</th>
                  <th className="pb-2 pr-4 font-medium text-right">Ownership</th>
                  <th className="pb-2 pr-4 font-medium">Country</th>
                  <th className="pb-2 pr-4 font-medium">Ccy</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {visible.map((p) => (
                  <tr key={p.id} className="hover:bg-canvas-50 cursor-pointer"
                      onClick={() => setDrawer({ mode: "edit", party: p })}>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{p.related_party_id}</td>
                    <td className="py-2 pr-4 text-sm text-gray-900 font-medium">
                      {p.related_party_name || "—"}
                      {p.short_name && p.short_name !== p.related_party_name && (
                        <div className="text-[11px] text-gray-400">{p.short_name}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">
                      {ENTITY_TYPES.find((t) => t.value === p.related_party_type)?.label ?? p.related_party_type ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">{p.relationship_to_client || "—"}</td>
                    <td className="py-2 pr-4 text-right text-xs text-gray-700 tabular-nums">
                      {p.ownership_percent != null && p.ownership_percent !== "" ? `${p.ownership_percent}%` : "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{p.country_code || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{p.base_currency || "—"}</td>
                    <td className="py-2 pl-4">
                      <span className={statusBadge(p.status)}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <PartyDrawer
          mode={drawer.mode}
          party={drawer.mode === "edit" ? drawer.party : null}
          onClose={() => setDrawer(null)}
          onSaved={async () => { setDrawer(null); await load(); }}
        />
      )}
    </div>
  );
}


function PartyDrawer({
  mode, party, onClose, onSaved,
}: {
  mode: "create" | "edit";
  party: RelatedParty | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    related_party_id: party?.related_party_id ?? "",
    related_party_name: party?.related_party_name ?? "",
    short_name: party?.short_name ?? "",
    related_party_type: party?.related_party_type ?? "COMPANY",
    relationship_to_client: party?.relationship_to_client ?? "",
    ownership_percent: party?.ownership_percent ?? "",
    country_code: party?.country_code ?? "",
    jurisdiction_code: party?.jurisdiction_code ?? "",
    base_currency: party?.base_currency ?? "",
    status: party?.status ?? "ACTIVE",
    active_flag: party?.active_flag ?? true,
    notes: party?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      related_party_id: form.related_party_id.trim(),
      related_party_name: form.related_party_name.trim(),
      short_name: form.short_name.trim(),
      related_party_type: form.related_party_type,
      party_form: "ENTITY",  // pin so this page only ever creates entities
      relationship_to_client: form.relationship_to_client.trim(),
      ownership_percent: form.ownership_percent || null,
      country_code: form.country_code.trim().toUpperCase().slice(0, 4),
      jurisdiction_code: form.jurisdiction_code.trim().toUpperCase(),
      base_currency: form.base_currency.trim().toUpperCase().slice(0, 3),
      status: form.status,
      active_flag: form.active_flag,
      notes: form.notes,
    };
    try {
      if (mode === "edit" && party) {
        await api.patch(`/beakon/related-parties/${party.id}/`, payload);
      } else {
        await api.post("/beakon/related-parties/", payload);
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
            {mode === "edit" ? `Edit ${party?.related_party_id}` : "New related entity"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">ID *</span>
              <input className="input mt-1 font-mono" required value={form.related_party_id}
                     disabled={mode === "edit"}
                     placeholder="RP_HOLDCO_001"
                     onChange={(e) => setForm((f) => ({ ...f, related_party_id: e.target.value }))} />
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
            <span className="text-xs font-medium text-gray-600">Name *</span>
            <input className="input mt-1" required value={form.related_party_name}
                   onChange={(e) => setForm((f) => ({ ...f, related_party_name: e.target.value }))} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Short name</span>
              <input className="input mt-1" value={form.short_name}
                     onChange={(e) => setForm((f) => ({ ...f, short_name: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Type</span>
              <select className="input mt-1" value={form.related_party_type}
                      onChange={(e) => setForm((f) => ({ ...f, related_party_type: e.target.value }))}>
                {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Relationship to client</span>
            <input className="input mt-1" value={form.relationship_to_client}
                   placeholder="e.g. Holding company, Investment subsidiary"
                   onChange={(e) => setForm((f) => ({ ...f, relationship_to_client: e.target.value }))} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Ownership %</span>
              <input type="number" step="0.01" className="input mt-1 tabular-nums" value={form.ownership_percent}
                     onChange={(e) => setForm((f) => ({ ...f, ownership_percent: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Base currency</span>
              <input className="input mt-1 font-mono uppercase" maxLength={3} value={form.base_currency}
                     onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Country (ISO)</span>
              <input className="input mt-1 font-mono uppercase" maxLength={4} value={form.country_code}
                     onChange={(e) => setForm((f) => ({ ...f, country_code: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Jurisdiction</span>
              <input className="input mt-1 font-mono uppercase" value={form.jurisdiction_code}
                     onChange={(e) => setForm((f) => ({ ...f, jurisdiction_code: e.target.value }))} />
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
              {busy ? "Saving…" : mode === "edit" ? "Save" : "Create entity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
