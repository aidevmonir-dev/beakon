"use client";

/* Learning Rules — the registry of "next time, do this instead" rules
 * the AI honours when prefilling bill drafts. Rules are created when a
 * reviewer files a BillCorrection with "make reusable rule" checked;
 * this page is where the team manages them after the fact:
 *
 *   - Edit the human instruction or confidence policy
 *   - Toggle active / inactive when a rule has gone stale
 *   - See the success / override counters from the feedback loop (B6)
 *
 * Read-only fields (counters, provenance, audit) are surfaced but not
 * editable — the API enforces the same.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Sparkles, Search, ToggleLeft, ToggleRight,
  CheckCircle2, AlertTriangle, FileText, X,
} from "lucide-react";
import { api } from "@/lib/api";


interface LearningRule {
  id: number;
  vendor: number | null;
  vendor_code: string | null;
  vendor_name: string | null;
  customer_number: string;
  entity: number | null;
  invoice_pattern: string;
  trigger_conditions: Record<string, unknown>;
  correction_type: string;
  human_instruction: string;
  structured_accounting_logic: Record<string, unknown>;
  scope: string;
  scope_label: string;
  confidence_policy: string;
  confidence_policy_label: string;
  created_from_invoice: number | null;
  created_from_correction: number | null;
  approved_by_name: string | null;
  approved_at: string | null;
  last_used: string | null;
  success_count: number;
  override_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}


const POLICIES = [
  { value: "auto_apply", label: "Auto-apply" },
  { value: "suggest_high_confidence", label: "Suggest (high confidence)" },
  { value: "require_review", label: "Require review" },
];

const SCOPES = [
  { value: "one_time", label: "One-time" },
  { value: "vendor", label: "Vendor" },
  { value: "vendor_customer_number", label: "Vendor + customer number" },
  { value: "entity", label: "Entity" },
  { value: "invoice_pattern", label: "Invoice pattern" },
];


function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString();
}


export default function LearningRulesPage() {
  const [rows, setRows] = useState<LearningRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<LearningRule | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ results: LearningRule[] } | LearningRule[]>(
        "/beakon/learning-rules/",
      );
      setRows(Array.isArray(d) ? d : (d.results ?? []));
    } catch {
      setRows([]);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    let r = rows;
    if (!showInactive) r = r.filter((x) => x.is_active);
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((x) =>
        (x.vendor_name ?? "").toLowerCase().includes(s) ||
        (x.vendor_code ?? "").toLowerCase().includes(s) ||
        x.human_instruction.toLowerCase().includes(s) ||
        x.correction_type.toLowerCase().includes(s) ||
        x.customer_number.toLowerCase().includes(s) ||
        x.invoice_pattern.toLowerCase().includes(s),
      );
    }
    return r;
  }, [rows, q, showInactive]);

  const toggleActive = async (rule: LearningRule) => {
    const url = rule.is_active
      ? `/beakon/learning-rules/${rule.id}/deactivate/`
      : `/beakon/learning-rules/${rule.id}/activate/`;
    try {
      await api.post(url);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to toggle rule");
    }
  };

  return (
    <div>
      <Link
        href="/dashboard/accounting"
        className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Accounting
      </Link>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            Learning Rules
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            How Beakon should behave next time. Rules are created when you
            check &ldquo;Make this a reusable rule&rdquo; on a bill correction.
            Edit the instruction, change the confidence policy, or deactivate
            a rule that&apos;s gone stale.
          </p>
        </div>
      </div>

      {err && (
        <div className="mb-3 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search vendor, instruction, customer number…"
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
          <div className="ml-auto text-xs text-gray-400">
            {visible.length} {visible.length === 1 ? "rule" : "rules"}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            <Sparkles className="w-6 h-6 mx-auto text-gray-300 mb-2" />
            No learning rules yet. They appear here once reviewers correct an
            AI-prefilled bill and check &ldquo;Make this a reusable rule&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-4 font-medium">Vendor</th>
                  <th className="py-2 pr-4 font-medium">Scope</th>
                  <th className="py-2 pr-4 font-medium">Instruction</th>
                  <th className="py-2 pr-4 font-medium">Policy</th>
                  <th className="py-2 pr-4 font-medium text-right">Successes</th>
                  <th className="py-2 pr-4 font-medium text-right">Overrides</th>
                  <th className="py-2 pr-4 font-medium">Last used</th>
                  <th className="py-2 pr-4 font-medium">Active</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="py-2 pr-4 align-top">
                      <div className="text-gray-900">{r.vendor_name ?? "—"}</div>
                      {r.vendor_code && (
                        <div className="text-[11px] text-gray-400">{r.vendor_code}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 align-top text-gray-700">{r.scope_label}</td>
                    <td className="py-2 pr-4 align-top max-w-md">
                      <div className="text-gray-900 line-clamp-2">{r.human_instruction}</div>
                      {r.correction_type && (
                        <div className="text-[11px] text-gray-400 mt-0.5">{r.correction_type.replace(/_/g, " ")}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 align-top text-gray-700">{r.confidence_policy_label}</td>
                    <td className="py-2 pr-4 align-top text-right">
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="w-3 h-3" /> {r.success_count}
                      </span>
                    </td>
                    <td className="py-2 pr-4 align-top text-right">
                      {r.override_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <AlertTriangle className="w-3 h-3" /> {r.override_count}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 align-top text-gray-500 text-xs">{fmtDate(r.last_used)}</td>
                    <td className="py-2 pr-4 align-top">
                      <button
                        onClick={() => toggleActive(r)}
                        className="inline-flex items-center text-xs"
                        title={r.is_active ? "Click to deactivate" : "Click to activate"}
                      >
                        {r.is_active
                          ? <ToggleRight className="w-5 h-5 text-emerald-600" />
                          : <ToggleLeft className="w-5 h-5 text-gray-300" />}
                      </button>
                    </td>
                    <td className="py-2 align-top">
                      <button
                        onClick={() => setEditing(r)}
                        className="text-xs text-brand-700 hover:text-brand-800 underline-offset-2 hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditRuleDrawer
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
          onError={(m) => setErr(m)}
        />
      )}
    </div>
  );
}


function EditRuleDrawer({
  rule, onClose, onSaved, onError,
}: {
  rule: LearningRule;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [instruction, setInstruction] = useState(rule.human_instruction);
  const [policy, setPolicy] = useState(rule.confidence_policy);
  const [scope, setScope] = useState(rule.scope);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!instruction.trim()) {
      onError("Instruction can't be empty");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/beakon/learning-rules/${rule.id}/`, {
        human_instruction: instruction.trim(),
        confidence_policy: policy,
        scope,
      });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white h-full overflow-y-auto p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-600" />
              Edit Learning Rule
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {rule.vendor_name ?? "—"}{rule.vendor_code ? ` · ${rule.vendor_code}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Instruction for next time
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={5}
              className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600"
            >
              {SCOPES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Confidence policy</label>
            <select
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-600"
            >
              {POLICIES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              Auto-apply silently uses the rule; Suggest needs a single click;
              Require review always shows the proposal alongside the original.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-3 text-xs text-gray-500 space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              {rule.created_from_invoice
                ? <Link
                    href={`/dashboard/bills/${rule.created_from_invoice}`}
                    className="text-brand-700 hover:underline"
                  >
                    Created from bill #{rule.created_from_invoice}
                  </Link>
                : "Created without a source bill"}
            </div>
            <div>Successes: <span className="text-emerald-700 font-medium">{rule.success_count}</span></div>
            <div>Overrides: <span className={rule.override_count > 0 ? "text-amber-700 font-medium" : ""}>{rule.override_count}</span></div>
            <div>Approved by: {rule.approved_by_name ?? "—"} on {fmtDate(rule.approved_at)}</div>
            <div>Last used: {fmtDate(rule.last_used)}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
