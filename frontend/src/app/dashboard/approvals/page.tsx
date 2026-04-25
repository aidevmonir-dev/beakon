"use client";

/* Approvals queue — JEs waiting for sign-off. The blueprint (Objective 4)
 * makes this a first-class workflow; the journal-entries page can already
 * filter by pending_approval but having it as its own surface matches how
 * accountants actually work. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckSquare, Check, X, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";


interface JESummary {
  id: number;
  entry_number: string;
  entity_code: string;
  entity_name: string;
  date: string;
  status: string;
  source_type: string;
  source_ref: string;
  memo: string;
  total: string;
  functional_currency: string;
  period: string | null;
  created_by: string | null;
  approved_by: string | null;
}


export default function ApprovalsPage() {
  const [entries, setEntries] = useState<JESummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState<"pending_approval" | "approved" | "rejected">("pending_approval");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ entries: JESummary[] }>(
        "/beakon/reports/journal-listing/", { status: bucket, limit: "500" },
      );
      setEntries(d.entries || []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [bucket]);

  const counts = useMemo(() => ({
    pending: entries.filter((e) => e.status === "pending_approval").length,
    approved: entries.filter((e) => e.status === "approved").length,
    rejected: entries.filter((e) => e.status === "rejected").length,
  }), [entries]);

  const act = async (
    je: JESummary,
    action: "approve" | "reject" | "post" | "return-to-draft",
    extra: Record<string, string> = {},
  ) => {
    setBusyId(je.id);
    setErr(null);
    try {
      await api.post(`/beakon/journal-entries/${je.id}/${action}/`, extra);
      await load();
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || `Failed to ${action} ${je.entry_number}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Approvals</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Journal entries waiting for human sign-off. Blueprint Objective 4 — control before automation.
          </p>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-4 border-b border-canvas-100 pb-3">
          {(["pending_approval", "approved", "rejected"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-medium " +
                (bucket === b
                  ? "bg-brand-50 text-brand-800"
                  : "text-gray-600 hover:bg-canvas-50")
              }
            >
              {b.replace("_", " ")}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400">
            {loading ? "loading…" : `${entries.length} entries`}
          </span>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {err}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center">
            <CheckSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">Nothing in this queue.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Entry</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 pr-4 font-medium">Memo</th>
                  <th className="pb-2 pl-4 font-medium text-right">Total</th>
                  <th className="pb-2 pl-4 font-medium">Submitted by</th>
                  <th className="pb-2 pl-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-canvas-50">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/dashboard/journal-entries/${e.id}`}
                        className="font-mono text-xs text-brand-700 hover:underline"
                      >
                        {e.entry_number}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{e.entity_code}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500">{fmtLabel(e.source_type)}</td>
                    <td className="py-2 pr-4 text-xs text-gray-600 max-w-xs truncate">{e.memo}</td>
                    <td className="py-2 pl-4 text-xs text-gray-700 text-right font-mono tabular-nums whitespace-nowrap">
                      {fmt2(e.total)} <span className="text-gray-400">{e.functional_currency}</span>
                    </td>
                    <td className="py-2 pl-4 text-xs text-gray-500">{e.created_by || "—"}</td>
                    <td className="py-2 pl-4 text-right">
                      <div className="inline-flex gap-1">
                        {bucket === "pending_approval" && (
                          <>
                            <button
                              disabled={busyId === e.id}
                              onClick={() => act(e, "approve")}
                              className="text-xs text-mint-700 hover:underline disabled:opacity-50"
                              title="Approve"
                            >
                              <Check className="w-3 h-3 inline mr-0.5" />Approve
                            </button>
                            <span className="text-gray-300">·</span>
                            <button
                              disabled={busyId === e.id}
                              onClick={() => {
                                const reason = prompt("Reason for rejection?");
                                if (reason) void act(e, "reject", { reason });
                              }}
                              className="text-xs text-red-700 hover:underline disabled:opacity-50"
                              title="Reject"
                            >
                              <X className="w-3 h-3 inline mr-0.5" />Reject
                            </button>
                          </>
                        )}
                        {bucket === "approved" && (
                          <button
                            disabled={busyId === e.id}
                            onClick={() => act(e, "post")}
                            className="text-xs text-brand-700 hover:underline disabled:opacity-50"
                          >
                            Post
                          </button>
                        )}
                        {bucket === "rejected" && (
                          <button
                            disabled={busyId === e.id}
                            onClick={() => act(e, "return-to-draft")}
                            className="text-xs text-gray-700 hover:underline disabled:opacity-50"
                          >
                            <RotateCcw className="w-3 h-3 inline mr-0.5" />To draft
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
    </div>
  );
}
