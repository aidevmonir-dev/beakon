"use client";

/* Travel Expense — claims list.
 *
 * Was at /dashboard/travel until 2026-05-11 when the new Travel
 * Expense Management dashboard took that URL. Functionality is
 * unchanged — full list view with status filter chips and the
 * create → submit → approve → reimburse loop.
 *
 * Shared types and helpers live in `../_lib` so the dashboard and the
 * detail view consume the same `TripClaim` / `StatusPill` / formatters.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, CalendarRange, Filter, Plane, Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import {
  type TripClaim, type TripStatus, STATUS_TONE, StatusPill,
  formatDateRange, formatMoney,
} from "../_lib";


const STATUS_FILTERS: { slug: TripStatus | "all"; label: string }[] = [
  { slug: "all",        label: "All" },
  { slug: "draft",      label: "Draft" },
  { slug: "submitted",  label: "Pending approval" },
  { slug: "approved",   label: "Approved" },
  { slug: "rejected",   label: "Rejected" },
  { slug: "reimbursed", label: "Reimbursed" },
];


export default function TravelExpensesListPage() {
  const [claims, setClaims] = useState<TripClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TripStatus | "all">("all");
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    const params: Record<string, string> = {};
    if (filter !== "all") params.status = filter;
    api.get<{ results: TripClaim[] } | TripClaim[]>("/beakon/trip-claims/", params)
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        setClaims(list);
      })
      .catch(() => setError("Could not load claims."))
      .finally(() => setLoading(false));
  }, [filter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    claims.forEach((c) => { out[c.status] = (out[c.status] || 0) + 1; });
    return out;
  }, [claims]);

  return (
    <div>
      <PageHeader
        title="Travel Expense"
        description="Trips, receipts and reimbursement workflow. Submit a claim, your approver reviews, and an approved claim moves into reimbursement."
        actions={
          <Link href="/dashboard/travel/new" className="btn-primary text-sm">
            <Plus className="w-4 h-4 mr-1.5" />
            New trip claim
          </Link>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        <Filter className="h-3.5 w-3.5 text-gray-400 mr-1" />
        {STATUS_FILTERS.map((f) => {
          const active = filter === f.slug;
          const count = f.slug === "all" ? claims.length : (counts[f.slug] || 0);
          return (
            <button
              key={f.slug}
              type="button"
              onClick={() => setFilter(f.slug)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ring-1 transition-colors",
                active
                  ? "bg-brand-50 text-brand-800 ring-brand-200"
                  : "bg-white text-gray-600 ring-canvas-200 hover:text-gray-900",
              )}
            >
              {f.label}
              {filter === "all" && f.slug !== "all" && count > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-canvas-100 px-1 text-[10px] font-semibold text-gray-600">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="mt-5 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[88px] rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse"
            />
          ))}
        </div>
      ) : claims.length === 0 ? (
        <EmptyClaims />
      ) : (
        <ul className="mt-5 space-y-3">
          {claims.map((claim) => (
            <li key={claim.id}>
              <ClaimRow claim={claim} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


function ClaimRow({ claim }: { claim: TripClaim }) {
  const total = Number(claim.total_amount || 0);
  const dateRange = formatDateRange(claim.start_date, claim.end_date);
  const tone = STATUS_TONE[claim.status];

  return (
    <Link
      href={`/dashboard/travel/${claim.id}`}
      className="group flex items-start gap-3 rounded-2xl border border-canvas-200/70 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]"
    >
      <div className={cn("shrink-0 h-10 w-10 rounded-xl flex items-center justify-center", tone.iconWell)}>
        <Plane className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-gray-900 truncate">{claim.title}</span>
          <StatusPill status={claim.status} label={claim.status_label} />
          {claim.entity_code && (
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-gray-400">
              {claim.entity_code}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
          {claim.destination && (
            <>
              <span>{claim.destination}</span>
              <span className="text-canvas-300">·</span>
            </>
          )}
          {dateRange && (
            <>
              <span className="inline-flex items-center gap-1">
                <CalendarRange className="h-3 w-3" />
                {dateRange}
              </span>
              <span className="text-canvas-300">·</span>
            </>
          )}
          <span>
            {claim.expense_count} {claim.expense_count === 1 ? "line" : "lines"}
          </span>
          <span className="text-canvas-300">·</span>
          <span className="font-mono text-gray-700">
            {formatMoney(total, claim.currency)}
          </span>
        </div>
      </div>
      <ArrowRight className="self-center h-4 w-4 text-gray-300 transition group-hover:text-brand-700 group-hover:translate-x-0.5" />
    </Link>
  );
}


function EmptyClaims() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-canvas-300 bg-canvas-50/40 p-10 text-center">
      <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <Plane className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900">No trip claims yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 leading-relaxed">
        Start a claim for an upcoming or recent trip. Add your receipts as
        you go, then submit for approval.
      </p>
      <Link href="/dashboard/travel/new" className="btn-primary mt-5 inline-flex">
        <Plus className="w-4 h-4 mr-1.5" />
        New trip claim
      </Link>
    </div>
  );
}
