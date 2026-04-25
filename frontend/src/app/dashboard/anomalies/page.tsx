"use client";

/* Anomalies — proactive checks that surface things worth a human look.
 *
 * V1 is fully deterministic (no LLM): duplicate bills, vendor spend
 * spikes, missing recurring vendors, stale approvals, stale bank txns,
 * AP/AR seriously overdue. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, AlertCircle, Info, RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDateTime } from "@/lib/format";


interface Evidence {
  label: string;
  href: string;
  kind: string;
  id: number;
}

interface Anomaly {
  id: string;
  kind: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  evidence: Evidence[];
  amount: string | null;
  currency: string | null;
  detected_at: string;
  suggested_action: string;
}

interface Result {
  as_of: string;
  total: number;
  counts: { high: number; medium: number; low: number };
  anomalies: Anomaly[];
}


function severityIcon(severity: string) {
  if (severity === "high") return <AlertTriangle className="w-4 h-4 text-red-600" />;
  if (severity === "medium") return <AlertCircle className="w-4 h-4 text-yellow-600" />;
  return <Info className="w-4 h-4 text-gray-400" />;
}

function severityRing(severity: string) {
  if (severity === "high") return "border-red-200 bg-red-50/40";
  if (severity === "medium") return "border-yellow-200 bg-yellow-50/40";
  return "border-canvas-100 bg-white";
}

function severityBadge(severity: string) {
  if (severity === "high") return "badge-red";
  if (severity === "medium") return "badge-yellow";
  return "badge-gray";
}


export default function AnomaliesPage() {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"" | "high" | "medium" | "low">("");

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.get<Result>("/beakon/anomalies/"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    if (!data) return [];
    return filter
      ? data.anomalies.filter((a) => a.severity === filter)
      : data.anomalies;
  }, [data, filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-brand-700" />
            Anomalies
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Things worth a human look. Computed live from your ledger — no AI in this v1.
          </p>
        </div>
        <button onClick={load} className="btn-secondary">
          <RefreshCw className={"w-4 h-4 mr-1.5 " + (loading ? "animate-spin" : "")} />
          {loading ? "Scanning…" : "Re-scan"}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5">
          <SummaryCard label="Total" count={data.total} active={!filter}
                       onClick={() => setFilter("")} color="brand" />
          <SummaryCard label="High" count={data.counts.high} active={filter === "high"}
                       onClick={() => setFilter("high")} color="red" />
          <SummaryCard label="Medium" count={data.counts.medium} active={filter === "medium"}
                       onClick={() => setFilter("medium")} color="yellow" />
          <SummaryCard label="Low" count={data.counts.low} active={filter === "low"}
                       onClick={() => setFilter("low")} color="gray" />
        </div>
      )}

      {loading && !data && (
        <p className="text-sm text-gray-400 py-8 text-center">Scanning…</p>
      )}

      {data && visible.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-2">✨</div>
          <p className="text-sm text-gray-700 font-medium">All clear.</p>
          <p className="text-xs text-gray-400 mt-1">
            No anomalies in this severity bucket.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {visible.map((a) => (
          <div key={a.id}
               className={"rounded-lg border p-4 " + severityRing(a.severity)}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5">{severityIcon(a.severity)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <h3 className="text-sm font-semibold text-gray-900">{a.title}</h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={severityBadge(a.severity)}>{a.severity}</span>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                      {a.kind.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-gray-700 mt-1">{a.description}</p>
                <p className="text-xs text-gray-500 mt-2 italic">
                  → {a.suggested_action}
                </p>
                {a.evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-gray-400">Related:</span>
                    {a.evidence.map((e, i) => (
                      <Link key={i} href={e.href}
                            className="font-mono text-brand-700 hover:underline">
                        {e.label}
                      </Link>
                    ))}
                  </div>
                )}
                {a.amount && (
                  <div className="mt-2 text-xs text-gray-500">
                    Amount: <span className="font-mono tabular-nums">{fmt2(a.amount)}</span>
                    {a.currency && <span className="text-gray-400"> {a.currency}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {data && (
        <p className="text-[10px] text-gray-400 mt-4 text-center">
          Last scan: {fmtDateTime(new Date().toISOString())} · as of {data.as_of}
        </p>
      )}
    </div>
  );
}


function SummaryCard({
  label, count, active, onClick, color,
}: {
  label: string; count: number; active: boolean;
  onClick: () => void; color: "brand" | "red" | "yellow" | "gray";
}) {
  const ringMap = {
    brand: active ? "border-brand-300 bg-brand-50" : "border-canvas-200",
    red: active ? "border-red-300 bg-red-50" : "border-canvas-200",
    yellow: active ? "border-yellow-300 bg-yellow-50" : "border-canvas-200",
    gray: active ? "border-gray-300 bg-canvas-50" : "border-canvas-200",
  };
  const numMap = {
    brand: "text-brand-800",
    red: "text-red-700",
    yellow: "text-yellow-700",
    gray: "text-gray-700",
  };
  return (
    <button onClick={onClick}
            className={"text-left rounded-lg border p-3 transition-colors hover:bg-opacity-80 " + ringMap[color]}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={"text-2xl font-semibold tabular-nums mt-1 " + numMap[color]}>{count}</div>
    </button>
  );
}
