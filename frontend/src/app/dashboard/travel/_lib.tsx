/* Shared types + helpers for the Travel Expense module.
 *
 * Folder-private (underscore prefix) so Next.js doesn't treat it as a
 * route segment. Imported by:
 *   /dashboard/travel/page.tsx          (Travel module dashboard)
 *   /dashboard/travel/expenses/page.tsx (claims list)
 *   /dashboard/travel/[id]/page.tsx     (claim detail)
 *   /dashboard/employment/[id]/page.tsx (employee's trip claims list)
 *
 * Centralizing the type + status pill here keeps the dashboard,
 * the list view and the detail view in lock-step when status
 * semantics or formatting evolve.
 */
import { CheckCircle2, Clock, FileText, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";


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


export const STATUS_TONE: Record<
  TripStatus,
  { pill: string; iconWell: string; icon: React.ComponentType<{ className?: string }> }
> = {
  draft:      { pill: "bg-canvas-100 text-gray-700 ring-canvas-200", iconWell: "bg-canvas-100 text-gray-600", icon: FileText },
  submitted:  { pill: "bg-amber-50 text-amber-800 ring-amber-200",   iconWell: "bg-amber-50 text-amber-700",  icon: Clock },
  approved:   { pill: "bg-mint-50 text-mint-800 ring-mint-200",      iconWell: "bg-mint-50 text-mint-700",    icon: CheckCircle2 },
  rejected:   { pill: "bg-rose-50 text-rose-800 ring-rose-200",      iconWell: "bg-rose-50 text-rose-700",    icon: X },
  reimbursed: { pill: "bg-brand-50 text-brand-800 ring-brand-200",   iconWell: "bg-brand-50 text-brand-700",  icon: Wallet },
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
