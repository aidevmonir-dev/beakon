"use client";

/* JE approval audit log. Lists every state transition with who + when. */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";
import { api } from "@/lib/api";
import { fmtLabel } from "@/lib/format";


interface Action {
  id: number;
  journal_entry: number;
  action: string;
  from_status: string;
  to_status: string;
  actor: number | null;
  actor_email: string | null;
  note: string;
  at: string;
}


const ACTIONS = [
  { key: "", label: "All" },
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "returned_to_draft", label: "Returned" },
  { key: "posted", label: "Posted" },
  { key: "reversed", label: "Reversed" },
];


function actionColor(a: string) {
  switch (a) {
    case "posted": return "text-mint-700";
    case "approved": return "text-brand-700";
    case "rejected": return "text-red-600";
    case "reversed": return "text-gray-500";
    default: return "text-gray-700";
  }
}


export default function AuditPage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const params: Record<string, string> = { ordering: "-at" };
    if (filter) params.action = filter;
    api.get<{ results: Action[] } | Action[]>("/beakon/approval-actions/", params)
      .then((d) => {
        setActions(Array.isArray(d) ? d : (d.results ?? []));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  const grouped = useMemo(() => {
    const map: Record<string, Action[]> = {};
    for (const a of actions) {
      const day = a.at.slice(0, 10);
      (map[day] = map[day] || []).push(a);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [actions]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-700" />
            Audit Log
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Immutable record of every journal-entry state change.
          </p>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-1 mb-4 text-xs">
          {ACTIONS.map((a) => (
            <button
              key={a.key}
              onClick={() => setFilter(a.key)}
              className={
                "px-2.5 py-1 rounded-full border transition-colors " +
                (filter === a.key
                  ? "bg-brand-50 border-brand-200 text-brand-800"
                  : "bg-white border-canvas-200 text-gray-600 hover:bg-canvas-50")
              }
            >
              {a.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : actions.length === 0 ? (
          <div className="py-12 text-center">
            <Shield className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No actions logged yet.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map(([day, entries]) => (
              <div key={day}>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  {day}
                </div>
                <ul className="divide-y divide-canvas-100">
                  {entries.map((a) => (
                    <li key={a.id} className="py-2.5 flex items-center gap-3">
                      <span className={"text-xs font-semibold w-28 " + actionColor(a.action)}>
                        {fmtLabel(a.action)}
                      </span>
                      <span className="text-xs text-gray-500 w-48">
                        {fmtLabel(a.from_status) || "—"} → {fmtLabel(a.to_status)}
                      </span>
                      <Link href={`/dashboard/journal-entries/${a.journal_entry}`}
                            className="text-xs font-mono text-brand-700 hover:underline w-24">
                        JE #{a.journal_entry}
                      </Link>
                      <span className="text-xs text-gray-500 flex-1 truncate">
                        {a.actor_email || "system"}
                        {a.note && <span className="ml-2 text-gray-400">· {a.note}</span>}
                      </span>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">
                        {new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
