"use client";

/* Beakon home — intentionally minimal per the founder working paper:
 *   "internal usefulness before external marketing"
 * Shows what an internal reviewer actually needs to do their work:
 *   - how many entities they have
 *   - how many JEs are waiting on approval
 *   - the last few JEs posted
 *   - quick links to the real working pages. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import {
  Building2, FileText, Inbox, BarChart3, CreditCard, ChevronRight, Compass, Layers,
} from "lucide-react";


interface Entity {
  id: number;
  code: string;
  name: string;
  functional_currency: string;
  is_active: boolean;
}

interface JESummary {
  id: number;
  entry_number: string;
  entity_code: string;
  date: string;
  status: string;
  memo: string;
  total_debit_functional: string;
}

interface JournalListing {
  count: number;
  entries: JESummary[];
}


export default function HomePage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [pendingJEs, setPendingJEs] = useState<JESummary[]>([]);
  const [recentJEs, setRecentJEs] = useState<JESummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/").then((d) => {
        // DRF may or may not paginate — handle both shapes.
        const list = Array.isArray(d) ? d : (d.results ?? []);
        setEntities(list);
      }).catch(() => {}),
      api.get<JournalListing>("/beakon/reports/journal-listing/", {
        status: "pending_approval", limit: "10",
      }).then((d) => setPendingJEs(d.entries || [])).catch(() => {}),
      api.get<JournalListing>("/beakon/reports/journal-listing/", {
        status: "posted", limit: "5",
      }).then((d) => setRecentJEs(d.entries || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const activeEntities = entities.filter((e) => e.is_active);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Home</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Phase 1 accounting demo: entity, chart, journals, approvals, reporting.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatCard
          label="Active entities"
          value={loading ? "…" : activeEntities.length.toString()}
          icon={<Building2 className="w-5 h-5 text-brand-700" />}
          href="/dashboard/entities"
        />
        <StatCard
          label="Awaiting approval"
          value={loading ? "…" : pendingJEs.length.toString()}
          icon={<Inbox className="w-5 h-5 text-yellow-600" />}
          href="/dashboard/journal-entries?status=pending_approval"
          tone={pendingJEs.length > 0 ? "amber" : "neutral"}
        />
        <StatCard
          label="Posted recently"
          value={loading ? "…" : recentJEs.length.toString()}
          icon={<FileText className="w-5 h-5 text-mint-600" />}
          href="/dashboard/journal-entries?status=posted"
        />
      </div>

      {/* Approval inbox */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Approval inbox</h2>
          <Link href="/dashboard/journal-entries?status=pending_approval"
                className="text-xs text-brand-700 hover:underline">
            See all →
          </Link>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : pendingJEs.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing pending. Create a draft JE to start the flow.</p>
        ) : (
          <ul className="divide-y divide-canvas-100">
            {pendingJEs.slice(0, 5).map((je) => (
              <li key={je.id} className="py-2 flex items-center gap-3">
                <span className="text-xs font-mono text-gray-500 w-20">{je.entry_number}</span>
                <span className="text-xs text-gray-500 w-16">{je.entity_code}</span>
                <span className="text-xs text-gray-500 w-24">{je.date}</span>
                <span className="flex-1 text-sm text-gray-800 truncate">{je.memo || "—"}</span>
                <Link href={`/dashboard/journal-entries/${je.id}`}
                      className="text-xs text-brand-700 hover:underline flex items-center">
                  Review <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recently posted */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Recently posted</h2>
          <Link href="/dashboard/journal-entries?status=posted"
                className="text-xs text-brand-700 hover:underline">
            See all →
          </Link>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : recentJEs.length === 0 ? (
          <p className="text-sm text-gray-500">No posted entries yet.</p>
        ) : (
          <ul className="divide-y divide-canvas-100">
            {recentJEs.map((je) => (
              <li key={je.id} className="py-2 flex items-center gap-3">
                <span className="text-xs font-mono text-gray-500 w-20">{je.entry_number}</span>
                <span className="text-xs text-gray-500 w-16">{je.entity_code}</span>
                <span className="text-xs text-gray-500 w-24">{formatDate(je.date)}</span>
                <span className="flex-1 text-sm text-gray-800 truncate">{je.memo || "—"}</span>
                <Link href={`/dashboard/journal-entries/${je.id}`}
                      className="text-xs text-brand-700 hover:underline flex items-center">
                  Open <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <QuickLink href="/dashboard/tour"
                   icon={<Compass className="w-4 h-4" />}
                   label="Start Demo Walkthrough" />
        <QuickLink href="/dashboard/coa-definitions"
                   icon={<Layers className="w-4 h-4" />}
                   label="Open CoA Layer" />
        <QuickLink href="/dashboard/journal-entries"
                   icon={<FileText className="w-4 h-4" />}
                   label="Create a Journal Entry" />
        <QuickLink href="/dashboard/bank"
                   icon={<CreditCard className="w-4 h-4" />}
                   label="Import Bank CSV" />
        <QuickLink href="/dashboard/reports"
                   icon={<BarChart3 className="w-4 h-4" />}
                   label="Run a Report" />
      </div>
    </div>
  );
}


function StatCard({
  label, value, icon, href, tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  href: string;
  tone?: "amber" | "neutral";
}) {
  return (
    <Link
      href={href}
      className={
        "card p-4 flex items-center justify-between hover:shadow-md transition-shadow " +
        (tone === "amber" ? "border-yellow-200 bg-yellow-50/30" : "")
      }
    >
      <div>
        <p className="text-[11px] text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
      </div>
      <div>{icon}</div>
    </Link>
  );
}

function QuickLink({
  href, icon, label,
}: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="card px-4 py-3 flex items-center justify-between hover:shadow-md transition-shadow"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
        {icon}
        {label}
      </span>
      <ChevronRight className="w-4 h-4 text-gray-300" />
    </Link>
  );
}
