"use client";

/* Dimensions hub — accounting-software-style landing page that lists
 * every classification axis across the org. Per Thomas's voice memo
 * (2026-05-10): one sidebar entry → this page → drill into a dimension
 * to manage its values. The visual language mirrors the Chart of
 * Accounts and Subaccounts pages so the whole product feels like one
 * accounting suite, not three different surfaces:
 *
 *   - left-rail color accent per category (financial / operational /
 *     reporting / other)
 *   - dense rows with monospace codes and right-aligned counts
 *   - section totals in the group header
 *   - sticky table header on long lists
 *   - stat strip across the top
 *
 * "Dimension" = a classification axis (DimensionType in our schema).
 * "Dimension Value" = a selectable item within that axis.
 * Subaccounts physically live inside the Chart of Accounts but appear
 * here as a synthetic top row so this hub is the single mental model
 * for "all the slicers across the books."
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, BarChart3, Briefcase, ChevronDown, Coins, Layers,
  Loader2, Search, Tag,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Category = "financial" | "operational" | "reporting" | "other";

interface HubRow {
  kind: "dimension_type" | "virtual_subaccount" | "virtual_currency" | "virtual_chart_of_accounts";
  code: string;
  name: string;
  category: Category;
  value_count: number;
  detail_path: string;
}

const CATEGORY_META: Record<Category, {
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  rail: string;
  pill: string;
}> = {
  financial: {
    label: "Financial",
    blurb: "Drive the GL itself — subaccounts and account-shape axes.",
    icon: Coins,
    rail: "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  operational: {
    label: "Operational",
    blurb: "Tag transactions for internal reporting — counterparties, positions, strategies.",
    icon: Briefcase,
    rail: "bg-sky-500",
    pill: "bg-sky-50 text-sky-700 ring-sky-100",
  },
  reporting: {
    label: "Reporting",
    blurb: "Slice the books for management or external views — taxonomies, regions, channels.",
    icon: BarChart3,
    rail: "bg-violet-500",
    pill: "bg-violet-50 text-violet-700 ring-violet-100",
  },
  other: {
    label: "Other",
    blurb: "Uncategorised axes — pick a category to file these under.",
    icon: Tag,
    rail: "bg-gray-400",
    pill: "bg-gray-50 text-gray-600 ring-gray-200",
  },
};

const CATEGORY_ORDER: Category[] = ["financial", "operational", "reporting", "other"];


export default function DimensionsHubPage() {
  const [rows, setRows] = useState<HubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<Category, boolean>>({
    financial: false, operational: false, reporting: false, other: false,
  });

  useEffect(() => {
    setLoading(true); setErr(null);
    api.get<{ rows: HubRow[] }>("/beakon/dimension-types/hub/")
      .then((d) => setRows(d.rows || []))
      .catch((e) => setErr(e?.error?.message || e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q),
    );
  }, [rows, q]);

  const grouped = useMemo(() => {
    const m: Record<Category, HubRow[]> = {
      financial: [], operational: [], reporting: [], other: [],
    };
    for (const r of filtered) m[r.category].push(r);
    for (const arr of Object.values(m)) arr.sort((a, b) => a.code.localeCompare(b.code));
    return m;
  }, [filtered]);

  const sectionCounts = useMemo(() => {
    const m: Record<Category, number> = { financial: 0, operational: 0, reporting: 0, other: 0 };
    for (const r of rows) m[r.category] += r.value_count;
    return m;
  }, [rows]);

  const totals = useMemo(() => ({
    dimensions: rows.length,
    values: rows.reduce((s, r) => s + (r.value_count || 0), 0),
    byCategory: {
      financial: rows.filter((r) => r.category === "financial").length,
      operational: rows.filter((r) => r.category === "operational").length,
      reporting: rows.filter((r) => r.category === "reporting").length,
      other: rows.filter((r) => r.category === "other").length,
    },
  }), [rows]);

  const toggleSection = (k: Category) =>
    setCollapsed((p) => ({ ...p, [k]: !p[k] }));

  const visibleCategories = CATEGORY_ORDER.filter((c) => grouped[c].length > 0);

  return (
    <div>
      <Link
        href="/dashboard/accounting"
        className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Accounting
      </Link>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
            <Layers className="w-5 h-5 text-brand-700" /> Dimensions
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-[640px]">
            Every classification axis in the books — the slicers Beakon uses
            for AI analysis, reporting, permissions, workflows, and predictive
            analytics. Click any axis to manage its values.
          </p>
        </div>
      </div>

      {/* ── Stat strip ─────────────────────────────────────── */}
      {!loading && !err && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
          <StatCard label="Dimensions" value={totals.dimensions.toString()} mono />
          <StatCard label="Total values" value={totals.values.toString()} mono />
          {CATEGORY_ORDER.map((c) =>
            totals.byCategory[c] > 0 ? (
              <StatCard
                key={c}
                label={CATEGORY_META[c].label}
                value={totals.byCategory[c].toString()}
                accent={CATEGORY_META[c].rail}
                mono
              />
            ) : null,
          )}
        </div>
      )}

      {/* ── Search ─────────────────────────────────────────── */}
      <div className="relative mb-4 max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search dimensions…"
          className="input pl-9 w-full"
        />
      </div>

      {loading && (
        <div className="card p-8 flex items-center justify-center text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading dimensions…
        </div>
      )}

      {err && !loading && (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700 inline-flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {err}
        </div>
      )}

      {!loading && !err && filtered.length === 0 && (
        <div className="card p-8 text-center text-sm text-gray-400">
          {q ? "No dimensions match that search." : "No dimensions defined yet."}
        </div>
      )}

      {!loading && !err && filtered.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-[0.12em] border-b border-canvas-100">
                <th className="pl-5 pr-2 py-2.5 w-[140px] font-medium">Code</th>
                <th className="pr-4 py-2.5 font-medium">Dimension</th>
                <th className="hidden md:table-cell pr-4 py-2.5 font-medium">Type</th>
                <th className="pr-4 py-2.5 text-right font-medium">Values</th>
                <th className="pr-3 py-2.5 w-[28px]" />
              </tr>
            </thead>
            {visibleCategories.map((cat) => {
              const items = grouped[cat];
              const meta = CATEGORY_META[cat];
              const isOpen = !collapsed[cat];
              const sectionTotal = items.reduce((s, r) => s + (r.value_count || 0), 0);
              const Icon = meta.icon;
              return (
                <tbody key={cat} className="border-t border-canvas-100">
                  <tr
                    onClick={() => toggleSection(cat)}
                    className="group cursor-pointer bg-canvas-50/40 hover:bg-canvas-50 select-none"
                  >
                    <td className="relative pl-5 pr-2 py-2.5">
                      <span className={cn("absolute left-0 top-0 bottom-0 w-1", meta.rail)} />
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-canvas-200 text-gray-600">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                    </td>
                    <td colSpan={2} className="pr-4 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-gray-900 tracking-tight">
                          {meta.label}
                        </span>
                        <span className="text-[11px] text-gray-400 font-medium">
                          {items.length} {items.length === 1 ? "axis" : "axes"}
                        </span>
                        <span className="hidden lg:inline text-[11px] text-gray-400">
                          · {meta.blurb}
                        </span>
                      </div>
                    </td>
                    <td className="hidden md:table-cell pr-4 py-2.5" />
                    <td className="pr-4 py-2.5 text-right">
                      <span className="font-mono text-[13px] font-semibold text-gray-900 tabular-nums">
                        {sectionTotal}
                      </span>
                    </td>
                    <td className="pr-3 py-2.5">
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 text-gray-400 transition-transform",
                          isOpen ? "" : "-rotate-90",
                        )}
                      />
                    </td>
                  </tr>

                  {isOpen && items.map((row) => (
                    <tr
                      key={`${row.kind}:${row.code}`}
                      className="group transition-colors hover:bg-brand-50/30"
                    >
                      <td className="pl-5 pr-2 py-2 font-mono text-[11px] text-gray-500 tabular-nums">
                        {row.code}
                      </td>
                      <td className="pr-4 py-2 min-w-0">
                        <Link
                          href={row.detail_path}
                          className="flex items-center gap-2 min-w-0 text-sm text-gray-900 hover:text-brand-700"
                        >
                          <span className="truncate">{row.name}</span>
                          {row.kind === "virtual_chart_of_accounts" && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100">
                              Ledger spine
                            </span>
                          )}
                          {row.kind === "virtual_subaccount" && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100">
                              Postable leaves
                            </span>
                          )}
                          {row.kind === "virtual_currency" && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100">
                              ISO 4217
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="hidden md:table-cell pr-4 py-2">
                        <span className={cn(
                          "inline-flex items-center text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset",
                          meta.pill,
                        )}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="pr-4 py-2 text-right font-mono text-sm tabular-nums text-gray-900">
                        {row.value_count}
                      </td>
                      <td className="pr-3 py-2 text-right">
                        <Link
                          href={row.detail_path}
                          className="text-gray-300 group-hover:text-gray-600 transition-colors"
                          title="Open"
                        >
                          <ChevronDown className="-rotate-90 h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
          <div className="px-5 py-2 text-[11px] text-gray-500 border-t border-canvas-100 bg-canvas-50/40 flex items-center justify-between">
            <span>
              Showing {filtered.length} of {rows.length} dimensions
            </span>
            <span className="font-mono tabular-nums">
              {Object.values(sectionCounts).reduce((s, n) => s + n, 0)} total values
            </span>
          </div>
        </div>
      )}
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
