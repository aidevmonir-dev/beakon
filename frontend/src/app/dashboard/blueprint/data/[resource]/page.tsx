"use client";

/* Generic workbook-tab data browser.
 *
 * One page renders any of the 17 workbook tabs (and the few extensions
 * we added on top) by reading config from `lib/workbook-resources.ts`.
 *
 * Each entry in WORKBOOK_RESOURCES says: which API endpoint to fetch,
 * which columns to render, what to call it. */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Database, Search } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import {
  WORKBOOK_RESOURCES,
  getResourceConfig,
  type ColumnSpec,
} from "@/lib/workbook-resources";

interface ApiResponse<T> {
  count?: number;
  next?: string | null;
  results?: T[];
}

export default function ResourcePage() {
  const params = useParams<{ resource: string }>();
  const resource = params?.resource ?? "";
  const config = getResourceConfig(resource);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!config) {
      setLoading(false);
      setErr(`Unknown resource: ${resource}`);
      return;
    }
    setLoading(true);
    setErr(null);
    api.get<ApiResponse<Record<string, unknown>> | Record<string, unknown>[]>(
      `${config.endpoint}/`,
      { page_size: "1000" },
    )
      .then((d) => {
        if (Array.isArray(d)) {
          setRows(d);
          setCount(d.length);
        } else {
          setRows(d.results ?? []);
          setCount(d.count ?? (d.results?.length ?? 0));
        }
      })
      .catch((e) => setErr(e?.error?.message || e?.message || "Failed"))
      .finally(() => setLoading(false));
  }, [resource, config]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((r) =>
      Object.values(r).some((v) =>
        v != null && String(v).toLowerCase().includes(q),
      ),
    );
  }, [rows, query]);

  if (!config) {
    return (
      <div className="max-w-6xl">
        <Link href="/dashboard/blueprint/implementation"
              className="text-xs text-brand-700 hover:underline inline-flex items-center mb-3">
          <ArrowLeft className="w-3 h-3 mr-1" /> Back to evidence
        </Link>
        <div className="card p-6">
          <p className="text-sm text-red-600">Unknown resource: <code>{resource}</code></p>
          <p className="text-xs text-gray-500 mt-2">
            Known resources:{" "}
            {WORKBOOK_RESOURCES.map((r, i) => (
              <span key={r.slug}>
                {i > 0 && ", "}
                <Link href={`/dashboard/blueprint/data/${r.slug}`}
                      className="text-brand-700 underline">{r.slug}</Link>
              </span>
            ))}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <Link href="/dashboard/blueprint/implementation"
            className="text-xs text-brand-700 hover:underline inline-flex items-center mb-3">
        <ArrowLeft className="w-3 h-3 mr-1" /> Back to Workbook → DB evidence
      </Link>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{config.title}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Workbook tab <strong className="text-gray-700">{config.tab}</strong> · API{" "}
            <code className="font-mono text-gray-600">{config.endpoint}/</code>
            {count != null && (
              <span className="ml-2 inline-flex items-center gap-1 text-mint-700">
                <Database className="w-3 h-3" /> {count} rows in DB
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter rows…"
              className="input pl-7 text-xs"
            />
          </div>
          <span className="text-xs text-gray-400">
            Showing {filtered.length}{filtered.length !== rows.length && ` of ${rows.length}`} row{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : err ? (
          <p className="text-sm text-red-600 py-4">{err}</p>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            {rows.length === 0 ? "No data in this table." : "No rows match the filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  {config.columns.map((c) => (
                    <th key={c.key} className="pb-2 px-2 font-medium whitespace-nowrap text-center">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((row, i) => (
                  <tr key={(row.id as number) ?? i} className="hover:bg-canvas-50">
                    {config.columns.map((c) => (
                      <td key={c.key} className={cellClass(c)}>
                        {renderValue(row[c.key], c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function cellClass(c: ColumnSpec): string {
  const base = "py-1.5 px-2 align-middle text-center";
  if (c.hint === "decimal") return `${base} tabular-nums`;
  if (c.hint === "code") return `${base} font-mono text-xs text-gray-700`;
  if (c.hint === "date") return `${base} text-xs text-gray-500 whitespace-nowrap`;
  if (c.hint === "flag") return `${base} text-xs`;
  return `${base} text-gray-800`;
}

function renderValue(v: unknown, c: ColumnSpec): React.ReactNode {
  if (v == null || v === "") return <span className="text-gray-300">—</span>;
  if (c.hint === "flag") {
    const truthy = v === true || v === "Yes" || v === "yes" || v === "YES" || v === "True" || v === 1;
    const falsy = v === false || v === "No" || v === "no" || v === "NO" || v === "False" || v === 0;
    if (truthy) return <span className="badge-green">Yes</span>;
    if (falsy) return <span className="badge-gray">No</span>;
    return <span className="text-xs text-gray-500">{String(v)}</span>;
  }
  if (c.hint === "date" && typeof v === "string") return fmtDate(v);
  if (c.hint === "decimal") return formatDecimal(v);
  if (typeof v === "string" && v.length > 80) return v.slice(0, 80) + "…";
  return String(v);
}

/** Format an API decimal (string or number) for display:
 *  · thousand separators
 *  · whole-number values render with no decimals (5000000 → 5,000,000)
 *  · sub-unit values (|n| < 1, e.g. FX rates) keep up to 4 decimals
 *  · everything else gets 2 decimals
 *  · trailing zeros beyond the minimum are trimmed
 */
function formatDecimal(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(String(v));
  if (!Number.isFinite(n)) return String(v);
  const abs = Math.abs(n);
  // Whole-number → no decimals (Coverage 5000000 → "5,000,000",
  // Deductible 5000 → "5,000", Original Qty 1000 → "1,000")
  if (Number.isInteger(n)) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  // Sub-unit fractions need extra precision to keep FX rates readable.
  const maxFrac = abs > 0 && abs < 1 ? 4 : 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFrac,
  });
}
