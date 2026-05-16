"use client";

/* Travel Expense Management — module dashboard.
 *
 * Wired to live endpoints (2026-05-12):
 *
 *   /beakon/trip-claims/    → KPI counts, Trips Overview, Approvals queue,
 *                             Reimbursed-this-month headline (from
 *                             reimbursed_at + total_amount).
 *   /beakon/trip-expenses/  → Total Expenses-this-month headline,
 *                             Recent Expenses table (joined back to
 *                             claims for the Trip column), Expense by
 *                             Category donut (grouped by `category`
 *                             field, filtered to current month).
 *
 * No new backend code — both endpoints already exist; this is a
 * read-side refactor of the original placeholder page.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Bed, Calendar, Car, ChevronRight, Clock, CreditCard,
  FileText, Flame, MapPin, Plane, Receipt, Sparkles, UtensilsCrossed,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmt2 } from "@/lib/format";
import { type TripClaim, formatDateRange, formatMoney } from "./_lib";


// ── Types ──────────────────────────────────────────────────────────


interface OrgPayload { id: number; name: string; currency?: string; }


/** Mirrors api/serializers/beakon_travel.TripExpenseSerializer. */
interface TripExpense {
  id: number;
  claim: number;
  date: string | null;
  category: string;          // "transport" | "accommodation" | ...
  category_label: string;    // human label
  description: string;
  merchant: string;
  amount: string;
  currency: string;
  fx_rate: string | null;
  amount_in_claim_currency: string;
  vat_amount: string | null;
  receipt_url: string;
  billable_to_client: boolean;
}


type ListResult<T> = { results: T[]; count?: number } | T[];

function asArray<T>(r: ListResult<T> | null | undefined): T[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.results ?? []);
}


// Category code → friendly chip label + colour + row icon.
const CATEGORY_META: Record<string, {
  label: string; chipTone: string; icon: React.ComponentType<{ className?: string }>; iconTone: string; donutColor: string;
}> = {
  transport: {
    label: "Transport",
    chipTone: "bg-mint-50 text-mint-700 ring-mint-100",
    icon: Car,
    iconTone: "bg-mint-50 text-mint-700",
    donutColor: "#14b8a6",
  },
  accommodation: {
    label: "Lodging",
    chipTone: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    icon: Bed,
    iconTone: "bg-indigo-50 text-indigo-700",
    donutColor: "#8b5cf6",
  },
  meals: {
    label: "Meals",
    chipTone: "bg-amber-50 text-amber-700 ring-amber-100",
    icon: UtensilsCrossed,
    iconTone: "bg-amber-50 text-amber-700",
    donutColor: "#f59e0b",
  },
  per_diem: {
    label: "Per Diem",
    chipTone: "bg-teal-50 text-teal-700 ring-teal-100",
    icon: Receipt,
    iconTone: "bg-teal-50 text-teal-700",
    donutColor: "#0ea5e9",
  },
  entertainment: {
    label: "Entertainment",
    chipTone: "bg-rose-50 text-rose-700 ring-rose-100",
    icon: Sparkles,
    iconTone: "bg-rose-50 text-rose-700",
    donutColor: "#ec4899",
  },
  fuel: {
    label: "Fuel",
    chipTone: "bg-orange-50 text-orange-700 ring-orange-100",
    icon: Flame,
    iconTone: "bg-orange-50 text-orange-700",
    donutColor: "#fb923c",
  },
  mileage: {
    label: "Mileage",
    chipTone: "bg-blue-50 text-blue-700 ring-blue-100",
    icon: Calendar,
    iconTone: "bg-blue-50 text-blue-700",
    donutColor: "#2563eb",
  },
  conference: {
    label: "Conference",
    chipTone: "bg-violet-50 text-violet-700 ring-violet-100",
    icon: Sparkles,
    iconTone: "bg-violet-50 text-violet-700",
    donutColor: "#8b5cf6",
  },
  other: {
    label: "Other",
    chipTone: "bg-canvas-100 text-gray-700 ring-canvas-200",
    icon: Receipt,
    iconTone: "bg-canvas-100 text-gray-600",
    donutColor: "#9ca3af",
  },
};


function categoryMeta(code: string) {
  return CATEGORY_META[code] ?? CATEGORY_META.other;
}


// ── Tabs ───────────────────────────────────────────────────────────


interface Tab { name: string; href: string; }

const TABS: Tab[] = [
  { name: "Overview",   href: "/dashboard/travel" },
  { name: "Expenses",   href: "/dashboard/travel/expenses" },
  { name: "Trips",      href: "/dashboard/travel/expenses" },
  { name: "Approvals",  href: "/dashboard/approvals" },
  { name: "Policies",   href: "/dashboard/travel" },
  { name: "Reports",    href: "/dashboard/reports" },
  { name: "Settings",   href: "/dashboard/settings" },
];


// ── Page ───────────────────────────────────────────────────────────


export default function TravelDashboardPage() {
  const [currency, setCurrency] = useState("CHF");
  const [claims, setClaims] = useState<TripClaim[] | null>(null);
  const [expenses, setExpenses] = useState<TripExpense[] | null>(null);

  useEffect(() => {
    const orgId = typeof window !== "undefined"
      ? localStorage.getItem("organization_id") : null;
    if (orgId) {
      void api.get<OrgPayload>(`/organizations/${orgId}/`).then((org) => {
        if (org.currency) setCurrency(org.currency);
      }).catch(() => {});
    }
    void Promise.allSettled([
      api.get<ListResult<TripClaim>>("/beakon/trip-claims/"),
      api.get<ListResult<TripExpense>>("/beakon/trip-expenses/"),
    ]).then(([c, e]) => {
      if (c.status === "fulfilled") setClaims(asArray(c.value));
      else setClaims([]);
      if (e.status === "fulfilled") setExpenses(asArray(e.value));
      else setExpenses([]);
    });
  }, []);

  // ── Derived counts ───────────────────────────────────────────────

  const today = useMemo(() => new Date(), []);
  const monthBounds = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const next  = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { start, end: next };
  }, [today]);

  // Pending approvals
  const pendingApprovals = (claims ?? []).filter(
    (c) => c.status === "submitted",
  ).length;

  // Active trips
  const activeTrips = (claims ?? []).filter((c) => {
    if (c.status === "reimbursed" || c.status === "rejected") return false;
    if (!c.end_date) return true;
    return new Date(c.end_date) >= startOfDay(today);
  }).length;

  // Claim lookup for joining trips into expense rows
  const claimById = useMemo(() => {
    const m = new Map<number, TripClaim>();
    for (const c of claims ?? []) m.set(c.id, c);
    return m;
  }, [claims]);

  // Total Expenses This Month — sum of `amount_in_claim_currency` (or
  // `amount` if missing) for expenses dated in the current month.
  const totalExpensesThisMonth = useMemo(() => {
    let sum = 0;
    for (const e of expenses ?? []) {
      if (!e.date) continue;
      const d = new Date(e.date);
      if (d < monthBounds.start || d >= monthBounds.end) continue;
      const v = Number(e.amount_in_claim_currency || e.amount || 0);
      if (Number.isFinite(v)) sum += v;
    }
    return sum;
  }, [expenses, monthBounds]);

  // Reimbursed This Month — sum of claim totals reimbursed in current month
  const reimbursedThisMonth = useMemo(() => {
    let sum = 0;
    for (const c of claims ?? []) {
      if (!c.reimbursed_at) continue;
      const d = new Date(c.reimbursed_at);
      if (d < monthBounds.start || d >= monthBounds.end) continue;
      sum += Number(c.total_amount || 0);
    }
    return sum;
  }, [claims, monthBounds]);

  // Three most recent claims by start_date desc for "Trips Overview"
  const tripsOverview = useMemo(() => {
    const list = (claims ?? []).slice();
    list.sort((a, b) => {
      const da = a.start_date ? new Date(a.start_date).getTime() : 0;
      const db = b.start_date ? new Date(b.start_date).getTime() : 0;
      return db - da;
    });
    return list.slice(0, 3);
  }, [claims]);

  // Approvals queue
  const approvalQueue = useMemo(() => {
    const list = (claims ?? []).filter((c) => c.status === "submitted").slice();
    list.sort((a, b) => {
      const da = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
      const db = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
      return db - da;
    });
    return list.slice(0, 3);
  }, [claims]);

  // Top 5 recent expenses — joined with parent claim for the Trip column.
  const recentExpenses = useMemo<ExpenseRow[]>(() => {
    if (!expenses) return [];
    const list = expenses.slice();
    list.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });
    return list.slice(0, 5).map((e) => {
      const parent = claimById.get(e.claim);
      return {
        id: String(e.id),
        date: e.date ? fmtDate(e.date) : "—",
        description: e.merchant || e.description || categoryMeta(e.category).label,
        descriptionSub: e.description && e.merchant && e.description !== e.merchant
          ? e.description : "",
        trip: parent?.title || "—",
        tripSub: parent?.destination || "",
        category: e.category,
        amount: Number(e.amount_in_claim_currency || e.amount || 0),
        amountCurrency: parent?.currency || e.currency || currency,
        status: deriveExpenseStatus(parent),
      };
    });
  }, [expenses, claimById, currency]);

  // Per-category breakdown for the donut — filtered to current month.
  const categorySegments = useMemo<CategorySegment[]>(() => {
    if (!expenses) return [];
    const buckets = new Map<string, number>();
    for (const e of expenses) {
      if (!e.date) continue;
      const d = new Date(e.date);
      if (d < monthBounds.start || d >= monthBounds.end) continue;
      const v = Number(e.amount_in_claim_currency || e.amount || 0);
      if (!Number.isFinite(v) || v <= 0) continue;
      buckets.set(e.category, (buckets.get(e.category) ?? 0) + v);
    }
    const total = Array.from(buckets.values()).reduce((a, v) => a + v, 0);
    return Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([code, amount]) => ({
        label: categoryMeta(code).label,
        amount,
        pct: total > 0 ? (amount / total) * 100 : 0,
        color: categoryMeta(code).donutColor,
      }));
  }, [expenses, monthBounds]);

  return (
    <div className="px-1 py-2 sm:px-2 sm:py-4">
      <div className="mx-auto w-full max-w-7xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
            Travel Expense Management
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage travel requests, expenses and reimbursements
          </p>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────── */}
        <Tabs />

        {/* ── Stats row ──────────────────────────────────────────── */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Expenses" sub="This Month"
            value={expenses === null
              ? "—"
              : `${currency} ${fmt2(totalExpensesThisMonth)}`}
            icon={FileText} accent="indigo" />
          <StatCard label="Reimbursed" sub="This Month"
            value={claims === null
              ? "—"
              : `${currency} ${fmt2(reimbursedThisMonth)}`}
            icon={CreditCard} accent="mint" />
          <StatCard label="Pending Approvals" sub="Requires Action"
            value={claims === null ? "—" : String(pendingApprovals)}
            icon={Clock} accent="amber" />
          <StatCard label="Active Trips" sub="In Progress"
            value={claims === null ? "—" : String(activeTrips)}
            icon={Plane} accent="violet" />
        </ul>

        {/* ── Row 1 ──────────────────────────────────────────────── */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentExpensesCard rows={recentExpenses}
              loading={expenses === null} />
          </div>
          <TripsOverviewCard trips={tripsOverview} currency={currency}
            loading={claims === null} />
        </div>

        {/* ── Row 2 ──────────────────────────────────────────────── */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ExpenseByCategoryCard segments={categorySegments} currency={currency}
              loading={expenses === null} />
          </div>
          <ApprovalsQueueCard claims={approvalQueue} currency={currency}
            loading={claims === null} />
        </div>
      </div>
    </div>
  );
}


// ── Tabs ───────────────────────────────────────────────────────────


function Tabs() {
  return (
    <div className="mt-5 -mb-px overflow-x-auto border-b border-canvas-200">
      <ul className="flex min-w-max items-center gap-1">
        {TABS.map((t, i) => (
          <li key={t.name}>
            <Link
              href={t.href}
              className={cn(
                "inline-block px-3.5 py-2.5 text-[12.5px] font-medium border-b-2 -mb-px transition-colors",
                i === 0
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-gray-500 hover:text-gray-900 hover:border-canvas-300",
              )}
            >
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}


// ── Stat card ──────────────────────────────────────────────────────


type Accent = "brand" | "mint" | "amber" | "violet" | "indigo";


function StatCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  accent: Accent;
}) {
  const tone =
    accent === "brand"  ? { well: "bg-brand-50 text-brand-700",     ring: "ring-brand-100" } :
    accent === "mint"   ? { well: "bg-mint-50 text-mint-700",       ring: "ring-mint-100" } :
    accent === "amber"  ? { well: "bg-amber-50 text-amber-700",     ring: "ring-amber-100" } :
    accent === "violet" ? { well: "bg-violet-50 text-violet-700",   ring: "ring-violet-100" } :
                          { well: "bg-indigo-50 text-indigo-700",   ring: "ring-indigo-100" };

  return (
    <li className={cn(
      "rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5 ring-1",
      tone.ring,
    )}>
      <div className="flex items-start gap-3">
        <span className={cn(
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
          tone.well,
        )}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[20px] font-semibold text-gray-900 leading-tight tabular-nums">
            {value}
          </div>
          <div className="text-[12px] font-medium text-gray-700 mt-0.5 truncate">{label}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>
        </div>
      </div>
    </li>
  );
}


// ── Card wrapper ───────────────────────────────────────────────────


function Card({
  title, action, children, footer, className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(
      "flex flex-col rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5",
      className,
    )}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14.5px] font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      <div className="mt-4 flex-1">{children}</div>
      {footer && (
        <div className="mt-4 pt-3 border-t border-canvas-100">{footer}</div>
      )}
    </section>
  );
}


function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="h-7 rounded-md bg-canvas-100/80 animate-pulse" />
      ))}
    </ul>
  );
}


function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500 px-4 text-center">
      {text}
    </div>
  );
}


// ── Recent Expenses table ─────────────────────────────────────────


type ExpenseStatus = "Pending" | "Approved" | "Reimbursed" | "Rejected" | "Draft";


interface ExpenseRow {
  id: string;
  date: string;
  description: string;
  descriptionSub: string;
  trip: string;
  tripSub: string;
  category: string;
  amount: number;
  amountCurrency: string;
  status: ExpenseStatus;
}


function deriveExpenseStatus(parent: TripClaim | undefined): ExpenseStatus {
  if (!parent) return "Pending";
  switch (parent.status) {
    case "draft":      return "Draft";
    case "submitted":  return "Pending";
    case "approved":   return "Approved";
    case "reimbursed": return "Reimbursed";
    case "rejected":   return "Rejected";
    default:           return "Pending";
  }
}


function RecentExpensesCard({
  rows, loading,
}: { rows: ExpenseRow[]; loading: boolean }) {
  return (
    <Card
      title="Recent Expenses"
      action={
        <Link href="/dashboard/travel/expenses"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all expenses
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
      footer={
        <Link href="/dashboard/travel/expenses"
          className="block text-center text-[12.5px] font-medium text-brand-700 hover:text-brand-800">
          View all expenses
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <EmptyHint text="No expenses logged yet. Add one from a trip claim." />
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] font-medium text-gray-500">
                <th className="font-medium pb-2 pl-2 pr-3">Date</th>
                <th className="font-medium pb-2 pr-3">Description</th>
                <th className="font-medium pb-2 pr-3">Trip</th>
                <th className="font-medium pb-2 pr-3">Category</th>
                <th className="font-medium pb-2 pr-3 text-right">Amount</th>
                <th className="font-medium pb-2 pr-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-canvas-100">
              {rows.map((e) => {
                const meta = categoryMeta(e.category);
                const Icon = meta.icon;
                return (
                  <tr key={e.id} className="hover:bg-canvas-50/40 transition-colors">
                    <td className="py-3 pl-2 pr-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", meta.iconTone)}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-gray-700">{e.date}</span>
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-gray-900 truncate">{e.description}</div>
                      {e.descriptionSub && (
                        <div className="text-[11px] text-gray-500 truncate">{e.descriptionSub}</div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-medium text-gray-700 truncate">{e.trip}</div>
                      {e.tripSub && (
                        <div className="text-[11px] text-gray-500 truncate">{e.tripSub}</div>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <CategoryChip code={e.category} />
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap text-gray-900">
                      {e.amountCurrency} {fmt2(e.amount)}
                    </td>
                    <td className="py-3 pr-2"><ExpenseStatusPill status={e.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


function CategoryChip({ code }: { code: string }) {
  const meta = categoryMeta(code);
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 whitespace-nowrap",
      meta.chipTone,
    )}>
      {meta.label}
    </span>
  );
}


function ExpenseStatusPill({ status }: { status: ExpenseStatus }) {
  const tone =
    status === "Pending"     ? "bg-amber-50 text-amber-700 ring-amber-100" :
    status === "Approved"    ? "bg-mint-50 text-mint-700 ring-mint-100" :
    status === "Reimbursed"  ? "bg-mint-50 text-mint-700 ring-mint-100" :
    status === "Draft"       ? "bg-canvas-100 text-gray-700 ring-canvas-200" :
                               "bg-rose-50 text-rose-700 ring-rose-100";
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 whitespace-nowrap",
      tone,
    )}>
      {status}
    </span>
  );
}


// ── Trips Overview ────────────────────────────────────────────────


function TripsOverviewCard({
  trips, currency, loading,
}: { trips: TripClaim[]; currency: string; loading: boolean }) {
  return (
    <Card
      title="Trips Overview"
      action={
        <Link href="/dashboard/travel/expenses"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all trips
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
      footer={
        <Link href="/dashboard/travel/expenses"
          className="block text-center text-[12.5px] font-medium text-brand-700 hover:text-brand-800">
          View all trips
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={3} />
      ) : trips.length === 0 ? (
        <EmptyHint text="No trips yet." />
      ) : (
        <ul className="space-y-4">
          {trips.map((t) => {
            const total = Number(t.total_amount || 0);
            const isUpcoming = t.start_date && new Date(t.start_date) > new Date();
            const tone = isUpcoming
              ? "bg-indigo-50 text-indigo-700"
              : t.status === "submitted"
                ? "bg-amber-50 text-amber-700"
                : "bg-brand-50 text-brand-700";
            const stageLabel = isUpcoming
              ? "Upcoming"
              : t.status === "submitted"
                ? "In Progress"
                : t.status_label;
            return (
              <li key={t.id}>
                <Link href={`/dashboard/travel/${t.id}`}
                  className="group block -mx-1 p-1 rounded-md hover:bg-canvas-50/60 transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-gray-900 truncate">{t.title}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5 inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDateRange(t.start_date, t.end_date) || "Dates TBD"}
                      </div>
                      <span className={cn(
                        "mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                        tone,
                      )}>
                        {stageLabel}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-semibold text-gray-900 tabular-nums">
                        {formatMoney(total, t.currency || currency)}
                      </div>
                      <div className="text-[10.5px] text-gray-500">Total Expenses</div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}


// ── Expense by Category (donut + legend) ──────────────────────────


interface CategorySegment { label: string; amount: number; pct: number; color: string; }


function ExpenseByCategoryCard({
  segments, currency, loading,
}: { segments: CategorySegment[]; currency: string; loading: boolean }) {
  const total = segments.reduce((a, s) => a + s.amount, 0);
  return (
    <Card
      title="Expense by Category (This Month)"
      action={
        <Link href="/dashboard/reports"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View full report
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={5} />
      ) : segments.length === 0 ? (
        <EmptyHint text="No expenses logged this month yet." />
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <Donut segments={segments}
            total={`${currency} ${fmt2(total)}`}
            subtitle="Total" />
          <ul className="flex-1 w-full space-y-2.5">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: s.color }} aria-hidden />
                  <span className="text-gray-700 truncate">{s.label}</span>
                </span>
                <span className="text-gray-900 tabular-nums shrink-0">
                  {currency} {fmt2(s.amount)}
                </span>
                <span className="text-gray-500 tabular-nums shrink-0 w-12 text-right">
                  {s.pct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}


function Donut({
  segments, total, subtitle,
}: {
  segments: { pct: number; color: string; label: string }[];
  total: string;
  subtitle: string;
}) {
  const size = 180; const stroke = 26; const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = segments.reduce((a, s) => a + s.pct, 0) || 1;

  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        {segments.map((s) => {
          const len = (s.pct / sum) * c;
          const dasharray = `${len} ${c - len}`;
          const dashoffset = -offset;
          offset += len;
          return (
            <circle
              key={s.label}
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={dasharray} strokeDashoffset={dashoffset}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
        <div className="text-[18px] font-semibold text-gray-900 leading-tight tabular-nums">{total}</div>
        <div className="text-[10.5px] text-gray-500 mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}


// ── Approvals queue ───────────────────────────────────────────────


function ApprovalsQueueCard({
  claims, currency, loading,
}: { claims: TripClaim[]; currency: string; loading: boolean }) {
  return (
    <Card
      title="Approvals"
      action={
        <Link href="/dashboard/approvals"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all approvals
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
      footer={
        <Link href="/dashboard/approvals"
          className="block text-center text-[12.5px] font-medium text-brand-700 hover:text-brand-800">
          View all approvals
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={3} />
      ) : claims.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500">
          Nothing waiting on approval.
        </div>
      ) : (
        <ul className="divide-y divide-canvas-100">
          {claims.map((c) => {
            const total = Number(c.total_amount || 0);
            const submitter = c.created_by_email
              ? c.created_by_email.split("@")[0]
              : "Submitter";
            return (
              <li key={c.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-gray-900 truncate">
                      {prettyName(submitter)}
                    </div>
                    <div className="text-[11.5px] text-gray-500 mt-0.5 truncate inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {c.title || c.destination || "—"}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      Submitted {fmtDate(c.submitted_at)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="text-[13px] font-semibold text-gray-900 tabular-nums">
                      {formatMoney(total, c.currency || currency)}
                    </div>
                    <Link href={`/dashboard/travel/${c.id}`}
                      className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand-700 transition-colors">
                      Review
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}


// ── helpers ───────────────────────────────────────────────────────


function prettyName(slug: string): string {
  return slug.split(/[._-]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}


function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}


function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
