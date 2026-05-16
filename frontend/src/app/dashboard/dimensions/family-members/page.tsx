"use client";

/* Family members — workbook tab 11 Related-Party Master, filtered to
 * person-form parties (individuals: spouse, children, parents, etc.).
 * Drives the FAM dimension on personal expense allocation, school fees,
 * allowances, and beneficiary tracking. */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Users, Plus, X, Search } from "lucide-react";
import { api } from "@/lib/api";


const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];


interface FamilyMember {
  id: number;
  related_party_id: string;
  related_party_name: string;
  short_name: string;
  related_party_type: string;
  party_form: string;
  relationship_to_client: string;
  country_code: string;
  base_currency: string;
  beneficiary_flag: boolean;
  family_expense_eligible_flag: boolean;
  related_party_since: string | null;
  status: string;
  active_flag: boolean;
  notes: string;
}


function statusBadge(s: string): string {
  return s === "ACTIVE" ? "badge-green" : "badge-gray";
}


export default function FamilyMembersPage() {
  const [rows, setRows] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; member: FamilyMember } | null>(null);

  const load = async () => {
    setLoading(true);
    const d = await api.get<{ results: FamilyMember[] } | FamilyMember[]>(
      "/beakon/related-parties/",
      { party_form: "PERSON", page_size: "500" },
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
            <Users className="w-5 h-5 text-rose-600" />
            Family members
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Individuals connected to the client — spouse, children, parents, dependents.
            Tagged on the FAM dimension for personal expense allocation, allowances,
            and beneficiary tracking.
          </p>
        </div>
        <button onClick={() => setDrawer({ mode: "create" })} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New family member
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
            {loading ? "loading…" : `${visible.length} member${visible.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {rows.length === 0 ? "No family members yet." : "No members match the filter."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">ID</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Relationship</th>
                  <th className="pb-2 pr-4 font-medium">Country</th>
                  <th className="pb-2 pr-4 font-medium">Ccy</th>
                  <th className="pb-2 pr-4 font-medium">Roles</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {visible.map((m) => (
                  <tr key={m.id} className="hover:bg-canvas-50 cursor-pointer"
                      onClick={() => setDrawer({ mode: "edit", member: m })}>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{m.related_party_id}</td>
                    <td className="py-2 pr-4 text-sm text-gray-900 font-medium">
                      {m.related_party_name || "—"}
                      {m.short_name && m.short_name !== m.related_party_name && (
                        <div className="text-[11px] text-gray-400">{m.short_name}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500">{m.relationship_to_client || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{m.country_code || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-500">{m.base_currency || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500">
                      {[
                        m.beneficiary_flag && "Beneficiary",
                        m.family_expense_eligible_flag && "Family expense",
                      ].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pl-4">
                      <span className={statusBadge(m.status)}>{m.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <MemberDrawer
          mode={drawer.mode}
          member={drawer.mode === "edit" ? drawer.member : null}
          onClose={() => setDrawer(null)}
          onSaved={async () => { setDrawer(null); await load(); }}
        />
      )}
    </div>
  );
}


function MemberDrawer({
  mode, member, onClose, onSaved,
}: {
  mode: "create" | "edit";
  member: FamilyMember | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    related_party_id: member?.related_party_id ?? "",
    related_party_name: member?.related_party_name ?? "",
    short_name: member?.short_name ?? "",
    relationship_to_client: member?.relationship_to_client ?? "",
    country_code: member?.country_code ?? "",
    base_currency: member?.base_currency ?? "",
    related_party_since: member?.related_party_since ?? "",
    beneficiary_flag: member?.beneficiary_flag ?? false,
    family_expense_eligible_flag: member?.family_expense_eligible_flag ?? true,
    status: member?.status ?? "ACTIVE",
    active_flag: member?.active_flag ?? true,
    notes: member?.notes ?? "",
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
      related_party_type: "INDIVIDUAL",  // pin so this page only ever creates individuals
      party_form: "PERSON",
      relationship_to_client: form.relationship_to_client.trim(),
      country_code: form.country_code.trim().toUpperCase().slice(0, 4),
      base_currency: form.base_currency.trim().toUpperCase().slice(0, 3),
      related_party_since: form.related_party_since || null,
      beneficiary_flag: form.beneficiary_flag,
      family_expense_eligible_flag: form.family_expense_eligible_flag,
      status: form.status,
      active_flag: form.active_flag,
      notes: form.notes,
    };
    try {
      if (mode === "edit" && member) {
        await api.patch(`/beakon/related-parties/${member.id}/`, payload);
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
      <div className="w-full sm:w-[480px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">
            {mode === "edit" ? `Edit ${member?.related_party_id}` : "New family member"}
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
                     placeholder="FAM_SPOUSE / FAM_CHILD1"
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
            <span className="text-xs font-medium text-gray-600">Full name *</span>
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
              <span className="text-xs font-medium text-gray-600">Relationship</span>
              <input className="input mt-1" value={form.relationship_to_client}
                     placeholder="Spouse / Child / Parent"
                     onChange={(e) => setForm((f) => ({ ...f, relationship_to_client: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Country</span>
              <input className="input mt-1 font-mono uppercase" maxLength={4} value={form.country_code}
                     onChange={(e) => setForm((f) => ({ ...f, country_code: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Currency</span>
              <input className="input mt-1 font-mono uppercase" maxLength={3} value={form.base_currency}
                     onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Since</span>
              <input type="date" className="input mt-1" value={form.related_party_since}
                     onChange={(e) => setForm((f) => ({ ...f, related_party_since: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={form.beneficiary_flag}
                     onChange={(e) => setForm((f) => ({ ...f, beneficiary_flag: e.target.checked }))} />
              Beneficiary
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={form.family_expense_eligible_flag}
                     onChange={(e) => setForm((f) => ({ ...f, family_expense_eligible_flag: e.target.checked }))} />
              Family expense eligible
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
              {busy ? "Saving…" : mode === "edit" ? "Save" : "Add member"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
