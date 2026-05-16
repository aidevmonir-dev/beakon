"use client";

/* Reusable detail screen for a single hierarchical DimensionType (Location,
 * Cost Centre, and similar). Renders DimensionValue rows as a parent→child
 * tree, lets you add values and toggle active. Edit is deferred — same
 * convention as Subaccounts.
 *
 * Pages embed this with a `typeCode` (the DimensionType.code) plus
 * presentational props (title, icon, blurb). All data flow goes through
 * the standard DimensionValue endpoints — no per-axis backend wiring.
 */

import Link from "next/link";
import { ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ChevronDown, ChevronRight, Loader2, Plus, Search, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";


export interface DimensionValue {
  id: number;
  dimension_type: number;
  dimension_type_code: string;
  code: string;
  name: string;
  parent_value_code: string;
  description: string;
  active_flag: boolean;
  external_reference?: string;
  notes?: string;
}

interface ApiResp<T> { results?: T[]; count?: number; }

interface DimensionType {
  id: number;
  code: string;
  name: string;
}


export interface DimensionValueManagerProps {
  typeCode: string;            // e.g. "LOCATION", "CC"
  title: string;                // "Location"
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  iconColor: string;            // tailwind text-* class
  rail: string;                 // tailwind bg-* class
  addLabel?: string;            // "Add location"
  codePlaceholder?: string;     // "EU_CH"
  namePlaceholder?: string;     // "Switzerland"
}


export default function DimensionValueManager(p: DimensionValueManagerProps) {
  const [values, setValues] = useState<DimensionValue[]>([]);
  const [dimType, setDimType] = useState<DimensionType | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<DimensionValue | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    setLoading(true); setErr(null);
    Promise.all([
      api.get<ApiResp<DimensionValue> | DimensionValue[]>(
        "/beakon/dimension-values/", { type: p.typeCode, page_size: "500" },
      )
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => [] as DimensionValue[]),
      api.get<ApiResp<DimensionType> | DimensionType[]>(
        "/beakon/dimension-types/", { search: p.typeCode },
      )
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => [] as DimensionType[]),
    ])
      .then(([vals, types]) => {
        setValues(vals);
        const match = types.find((t) => t.code === p.typeCode);
        setDimType(match ?? null);
      })
      .catch((e) => setErr(e?.error?.message || e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [p.typeCode]);

  useEffect(() => { reload(); }, [reload]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => values.filter((v) => {
    if (!showInactive && !v.active_flag) return false;
    if (!q) return true;
    return `${v.code} ${v.name} ${v.description}`.toLowerCase().includes(q);
  }), [values, q, showInactive]);

  // Build a parent→children map; root = values whose parent_value_code is
  // blank or doesn't resolve to a known sibling.
  const byParent = useMemo(() => {
    const m = new Map<string, DimensionValue[]>();
    const knownCodes = new Set(filtered.map((v) => v.code));
    for (const v of filtered) {
      const key = v.parent_value_code && knownCodes.has(v.parent_value_code)
        ? v.parent_value_code : "";
      const arr = m.get(key) ?? [];
      arr.push(v);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.code.localeCompare(b.code));
    return m;
  }, [filtered]);

  const roots = byParent.get("") ?? [];
  const totals = {
    all: values.length,
    active: values.filter((v) => v.active_flag).length,
    roots: (byParent.get("") ?? []).length,
  };

  const toggleNode = (code: string) =>
    setExpanded((p) => {
      const next = new Set(p);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });

  const handleToggleActive = async (v: DimensionValue) => {
    try {
      await api.patch(`/beakon/dimension-values/${v.id}/`, { active_flag: !v.active_flag });
      reload();
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || "Failed to toggle");
    }
  };

  return (
    <div>
      <Link href="/dashboard/dimensions"
            className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Dimensions
      </Link>

      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
            <p.icon className={cn("w-5 h-5", p.iconColor)} /> {p.title}
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-[640px]">{p.blurb}</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          disabled={!dimType}
          className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-60"
        >
          <Plus className="w-3.5 h-3.5" /> {p.addLabel ?? `Add ${p.title.toLowerCase()}`}
        </button>
      </div>

      {/* ── Stat strip ─────────────────────────────────────── */}
      {!loading && !err && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
          <StatCard label="Values" value={totals.all.toString()} mono />
          <StatCard label="Active" value={totals.active.toString()} accent="bg-emerald-500" mono />
          <StatCard label="Top-level" value={totals.roots.toString()} accent={p.rail} mono />
          <StatCard label="Inactive" value={(totals.all - totals.active).toString()} accent="bg-gray-300" mono />
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${p.title.toLowerCase()}…`}
            className="input pl-9 w-full"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show inactive
        </label>
      </div>

      {loading ? (
        <div className="card p-8 flex items-center justify-center text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading {p.title.toLowerCase()}…
        </div>
      ) : err ? (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
      ) : !dimType ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          The <span className="font-mono">{p.typeCode}</span> dimension is not configured
          for this organisation yet. Apply the latest migrations and reload.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          {q
            ? `No ${p.title.toLowerCase()} match that search.`
            : `No ${p.title.toLowerCase()} yet — click "${p.addLabel ?? "Add"}" to create the first one.`}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-[0.12em] border-b border-canvas-100">
                <th className="pl-5 pr-2 py-2.5 w-[180px] font-medium">Code</th>
                <th className="pr-4 py-2.5 font-medium">Name</th>
                <th className="hidden md:table-cell pr-4 py-2.5 font-medium">Description</th>
                <th className="pr-4 py-2.5 text-right font-medium w-[100px]">Status</th>
                <th className="pr-3 py-2.5 w-[80px]" />
              </tr>
            </thead>
            <tbody>
              {roots.map((root) => (
                <TreeRow
                  key={root.id}
                  node={root}
                  depth={0}
                  byParent={byParent}
                  expanded={expanded}
                  onToggleExpand={toggleNode}
                  onToggleActive={handleToggleActive}
                  onEdit={setEditing}
                  rail={p.rail}
                />
              ))}
            </tbody>
          </table>
          <div className="px-5 py-2 text-[11px] text-gray-500 border-t border-canvas-100 bg-canvas-50/40 flex items-center justify-between">
            <span>
              Showing {filtered.length} of {values.length} {p.title.toLowerCase()}
            </span>
            <span className="font-mono tabular-nums">
              {totals.active} active · {totals.all - totals.active} inactive
            </span>
          </div>
        </div>
      )}

      {(creating || editing) && dimType && (
        <ValueFormModal
          mode={editing ? "edit" : "create"}
          initial={editing}
          dimensionTypeId={dimType.id}
          siblings={values}
          codePlaceholder={p.codePlaceholder}
          namePlaceholder={p.namePlaceholder}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}


function TreeRow({
  node, depth, byParent, expanded, onToggleExpand, onToggleActive, onEdit, rail,
}: {
  node: DimensionValue;
  depth: number;
  byParent: Map<string, DimensionValue[]>;
  expanded: Set<string>;
  onToggleExpand: (code: string) => void;
  onToggleActive: (v: DimensionValue) => void;
  onEdit: (v: DimensionValue) => void;
  rail: string;
}) {
  const children = byParent.get(node.code) ?? [];
  const hasChildren = children.length > 0;
  const isOpen = expanded.has(node.code);

  return (
    <>
      <tr className="group transition-colors hover:bg-brand-50/30">
        <td className="pl-5 pr-2 py-2 font-mono text-[11px] text-gray-500 tabular-nums">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 18}px` }}>
            {depth === 0 && (
              <span className={cn("w-1 h-5 mr-2 rounded-full", rail)} />
            )}
            {hasChildren ? (
              <button
                onClick={() => onToggleExpand(node.code)}
                className="mr-1 text-gray-400 hover:text-gray-700"
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="inline-block w-[18px]" />
            )}
            <span>{node.code}</span>
          </div>
        </td>
        <td className="pr-4 py-2 min-w-0">
          <button
            onClick={() => onEdit(node)}
            className="text-left text-sm text-gray-900 hover:text-brand-700 truncate"
            title="Edit"
          >
            {node.name}
          </button>
        </td>
        <td className="hidden md:table-cell pr-4 py-2 text-xs text-gray-500 truncate max-w-[360px]">
          {node.description || <span className="text-gray-300">—</span>}
        </td>
        <td className="pr-4 py-2 text-right">
          <button
            onClick={() => onToggleActive(node)}
            className={cn(
              "inline-flex items-center text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset transition-colors",
              node.active_flag
                ? "bg-emerald-50 text-emerald-700 ring-emerald-100 hover:bg-emerald-100"
                : "bg-gray-50 text-gray-500 ring-gray-200 hover:bg-gray-100",
            )}
            title={node.active_flag ? "Click to deactivate" : "Click to activate"}
          >
            {node.active_flag ? "Active" : "Inactive"}
          </button>
        </td>
        <td className="pr-3 py-2 text-right">
          <button
            onClick={() => onEdit(node)}
            className="text-[11px] text-gray-400 hover:text-brand-700"
          >
            Edit
          </button>
        </td>
      </tr>
      {isOpen && children.map((c) => (
        <TreeRow
          key={c.id}
          node={c}
          depth={depth + 1}
          byParent={byParent}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          onToggleActive={onToggleActive}
          onEdit={onEdit}
          rail={rail}
        />
      ))}
    </>
  );
}


function ValueFormModal({
  mode, initial, dimensionTypeId, siblings, codePlaceholder, namePlaceholder,
  onClose, onSaved,
}: {
  mode: "create" | "edit";
  initial: DimensionValue | null;
  dimensionTypeId: number;
  siblings: DimensionValue[];
  codePlaceholder?: string;
  namePlaceholder?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [parent, setParent] = useState(initial?.parent_value_code ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [active, setActive] = useState(initial?.active_flag ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Eligible parents — any sibling, excluding self.
  const parentOptions = useMemo(() =>
    siblings.filter((s) => s.id !== initial?.id).sort((a, b) => a.code.localeCompare(b.code)),
  [siblings, initial]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!code.trim() || !name.trim()) {
      setError("Code and name are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        dimension_type: dimensionTypeId,
        code: code.trim(),
        name: name.trim(),
        parent_value_code: parent,
        description: description.trim(),
        active_flag: active,
      };
      if (mode === "edit" && initial) {
        await api.patch(`/beakon/dimension-values/${initial.id}/`, payload);
      } else {
        await api.post("/beakon/dimension-values/", payload);
      }
      onSaved();
    } catch (e: any) {
      setError(e?.error?.message || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSave}
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-canvas-200"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-canvas-100">
          <h2 className="text-sm font-semibold text-gray-900">
            {mode === "edit" ? "Edit value" : "Add value"}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">Code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={codePlaceholder ?? "CODE"}
                className="input w-full mt-1 font-mono"
                autoFocus={mode === "create"}
                disabled={mode === "edit"}
              />
              {mode === "edit" && (
                <p className="text-[10px] text-gray-400 mt-1">Code is immutable once created.</p>
              )}
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={namePlaceholder ?? "Display name"}
                className="input w-full mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">Parent</label>
            <select
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              className="input w-full mt-1"
            >
              <option value="">— Top level —</option>
              {parentOptions.map((opt) => (
                <option key={opt.id} value={opt.code}>
                  {opt.code} · {opt.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider text-gray-500 font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input w-full mt-1 min-h-[60px]"
              placeholder="Optional notes shown alongside this value."
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-gray-300"
            />
            Active
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-canvas-100 bg-canvas-50/40">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary text-xs">
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}


function StatCard({
  label, value, accent, mono,
}: { label: string; value: string; accent?: string; mono?: boolean }) {
  return (
    <div className="card relative overflow-hidden px-3 py-2.5">
      {accent && <span className={cn("absolute left-0 top-0 bottom-0 w-0.5", accent)} />}
      <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-medium">{label}</div>
      <div className={cn("text-base text-gray-900 mt-0.5", mono && "font-mono tabular-nums")}>
        {value}
      </div>
    </div>
  );
}
