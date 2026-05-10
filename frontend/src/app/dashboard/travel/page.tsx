"use client";

/* Travel & Expense — claims list.
 *
 * Per the UI philosophy doc (2026-05-10), this is a full operational
 * workflow (claims, receipts, approvals, reimbursements). v1 ships
 * the create → submit → approve → reimburse loop; AP/journal posting
 * for the actual cash leg is a separate workstream.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, CalendarRange, CheckCircle2, Clock,
  FileText, Filter, Plane, Plus, Wallet, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";


export interface TripClaim {
  id: number;
  title: string;
  destination: string;
  purpose: string;
  entity: number;
  entity_code: string;
  currency: string;
  total_amount: string | null;
  expense_count: number;
  status: TripStatus;
  status_label: string;
  start_date: string | null;
  end_date: string | null;
  created_by: number;
  created_by_email: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  reimbursed_at: string | null;
  created_at: string;
}


export type TripStatus =
  | "draft" | "submitted" | "approved" | "rejected" | "reimbursed";


const STATUS_FILTERS: { slug: TripStatus | "all"; label: string }[] = [
  { slug: "all",        label: "All" },
  { slug: "draft",      label: "Draft" },
  { slug: "submitted",  label: "Pending approval" },
  { slug: "approved",   label: "Approved" },
  { slug: "rejected",   label: "Rejected" },
  { slug: "reimbursed", label: "Reimbursed" },
];


export default function TravelClaimsPage() {
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


export const STATUS_TONE: Record<TripStatus, { pill: string; iconWell: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft:      { pill: "bg-canvas-100 text-gray-700 ring-canvas-200",     iconWell: "bg-canvas-100 text-gray-600",  icon: FileText },
  submitted:  { pill: "bg-amber-50 text-amber-800 ring-amber-200",       iconWell: "bg-amber-50 text-amber-700",   icon: Clock },
  approved:   { pill: "bg-mint-50 text-mint-800 ring-mint-200",          iconWell: "bg-mint-50 text-mint-700",     icon: CheckCircle2 },
  rejected:   { pill: "bg-rose-50 text-rose-800 ring-rose-200",          iconWell: "bg-rose-50 text-rose-700",     icon: X },
  reimbursed: { pill: "bg-brand-50 text-brand-800 ring-brand-200",       iconWell: "bg-brand-50 text-brand-700",   icon: Wallet },
};


export function StatusPill({ status, label }: { status: TripStatus; label: string }) {
  const tone = STATUS_TONE[status];
  const Icon = tone.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider ring-1",
      tone.pill,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
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


// ── Formatters ────────────────────────────────────────────────────


export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "CHF",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}


export function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "";
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  const fmt = (d: Date) => d.toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  if (s && e) {
    if (s.toDateString() === e.toDateString()) return fmt(s);
    return `${fmt(s)} → ${fmt(e)}`;
  }
  return fmt((s ?? e)!);
}
