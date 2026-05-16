"use client";

/* Platform Admin → Customer detail.
 *
 * Single-org deep view for Thomas. Shows the org's identity + subscription
 * timeline + member list. Server-side IsAdminUser permission is the
 * authority; the client-side guard mirrors the list page so a non-staff
 * user lands on a clean "Access restricted" card rather than an API error.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Building2, Calendar, CheckCircle2, Clock, Globe,
  Mail, ShieldAlert, Tag, Users, XCircle,
} from "lucide-react";
import { api, fetchCurrentUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDate, fmtDateTime } from "@/lib/format";


interface Plan {
  slug: string;
  name: string;
  price: string | null;
  currency: string;
  billing_cadence: string;
}

interface Subscription {
  status: "trial" | "active" | "expired" | "cancelled";
  status_label: string;
  started_at: string | null;
  trial_ends_at: string | null;
  activated_at: string | null;
  cancelled_at: string | null;
  days_left: number | null;
}

interface Member {
  id: number;
  user_email: string | null;
  user_name: string;
  role: string | null;
  is_active: boolean;
  accepted_at: string | null;
  last_login: string | null;
}

interface CustomerDetail {
  id: number;
  slug: string;
  name: string;
  legal_name: string;
  country: string;
  currency: string;
  is_active: boolean;
  created_at: string | null;
  selected_activities: string[];
  activity_count: number;
  member_count: number;
  last_member_login: string | null;
  plan: Plan | null;
  subscription: Subscription | null;
  members: Member[];
}


const ACTIVITY_LABEL: Record<string, string> = {
  structure_management: "Structure",
  accounting_finance:   "Accounting",
  travel_expense:       "Travel Expense",
  employment:           "Employment",
  wealth_oversight:     "Wealth Management",
  document_management:  "Documents",
};


export default function CustomerDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!slug) return;
      try {
        const me = await fetchCurrentUser();
        if (!me.is_staff && !me.is_superuser) {
          if (!cancelled) { setForbidden(true); setLoading(false); }
          return;
        }
        const data = await api.get<CustomerDetail>(`/beakon/admin/customers/${slug}/`);
        if (!cancelled) setCustomer(data);
      } catch (e: any) {
        if (cancelled) return;
        if (e?.status === 403 || e?.error?.status === 403) {
          setForbidden(true);
        } else if (e?.status === 404 || e?.error?.status === 404) {
          setError("Customer not found.");
        } else {
          setError(e?.error?.message || e?.message || "Could not load customer");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  if (forbidden) {
    return (
      <div className="card p-10 text-center max-w-xl mx-auto mt-12">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Access restricted</h2>
        <p className="text-sm text-gray-500">
          This page is for Beakon staff only.
        </p>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-gray-400 py-12 text-center">Loading customer…</p>;
  }

  if (error || !customer) {
    return (
      <div className="card p-8 text-center max-w-xl mx-auto mt-12">
        <p className="text-sm text-gray-600">{error || "Customer not found."}</p>
        <Link href="/dashboard/admin/customers" className="text-sm text-brand-700 mt-3 inline-block">
          ← Back to all customers
        </Link>
      </div>
    );
  }

  const sub = customer.subscription;
  const plan = customer.plan;

  return (
    <div>
      <Link
        href="/dashboard/admin/customers"
        className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to customers
      </Link>

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="font-display text-[26px] tracking-tight font-medium text-gray-900 leading-none">
              {customer.name}
            </h1>
            <span className={cn(
              "inline-flex items-center rounded-full ring-1 ring-inset px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              customer.is_active
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-canvas-50 text-gray-500 ring-canvas-200",
            )}>
              {customer.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="text-[13px] text-gray-500">
            <span className="font-mono">{customer.slug}</span>
            {customer.legal_name && (
              <>
                <span className="mx-1.5 text-gray-300">·</span>
                {customer.legal_name}
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Facts strip ──────────────────────────────────────── */}
      <div className="card p-3 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <FactCell icon={<Globe className="w-3.5 h-3.5" />} label="Country" value={customer.country || "—"} />
          <FactCell icon={<Tag className="w-3.5 h-3.5" />}   label="Currency" value={customer.currency} />
          <FactCell
            icon={<Calendar className="w-3.5 h-3.5" />}
            label="Customer since"
            value={customer.created_at ? fmtDate(customer.created_at) : "—"}
          />
          <FactCell
            icon={<Users className="w-3.5 h-3.5" />}
            label="Members"
            value={String(customer.member_count)}
          />
          <FactCell
            icon={<Tag className="w-3.5 h-3.5" />}
            label="Activities"
            value={`${customer.activity_count} / 6`}
          />
          <FactCell
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Last login"
            value={customer.last_member_login ? fmtDate(customer.last_member_login) : "—"}
          />
        </div>
      </div>

      {/* ── Two-column body: subscription + activities ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Subscription panel */}
        <div className="card p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Subscription</h3>
          {plan ? (
            <>
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-[18px] font-semibold text-gray-900">{plan.name}</div>
                  <div className="text-[11.5px] text-gray-500">
                    {plan.price
                      ? `${plan.currency} ${plan.price} / ${plan.billing_cadence}`
                      : "Custom pricing"}
                  </div>
                </div>
                {sub && <SubscriptionPill sub={sub} />}
              </div>

              <dl className="text-[12px] space-y-1.5 mt-2 border-t border-canvas-100 pt-3">
                <Row label="Plan slug"     v={plan.slug}      mono />
                <Row label="Billing cadence" v={plan.billing_cadence} />
                {sub?.started_at  && <Row label="Started"      v={fmtDateTime(sub.started_at)} />}
                {sub?.trial_ends_at && (
                  <Row
                    label="Trial ends"
                    v={fmtDateTime(sub.trial_ends_at)}
                    tone={sub.days_left !== null && sub.days_left < 7 ? "warn" : undefined}
                  />
                )}
                {sub?.activated_at && <Row label="Activated"   v={fmtDateTime(sub.activated_at)} tone="ok" />}
                {sub?.cancelled_at && <Row label="Cancelled"   v={fmtDateTime(sub.cancelled_at)} tone="danger" />}
              </dl>
            </>
          ) : (
            <div className="rounded-md border border-canvas-200 bg-canvas-50/40 p-4 text-center">
              <p className="text-[12.5px] text-gray-600">No subscription attached</p>
              <p className="text-[11px] text-gray-400 mt-1">
                This organisation hasn&apos;t selected a plan yet.
              </p>
            </div>
          )}
        </div>

        {/* Activities panel */}
        <div className="card p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Selected activities</h3>
          {customer.selected_activities.length === 0 ? (
            <p className="text-[12px] text-gray-400 italic">No activities selected yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {customer.selected_activities.map((a) => (
                <li key={a} className="flex items-center gap-2 text-[13px] text-gray-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  {ACTIVITY_LABEL[a] || a}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10.5px] text-gray-400 mt-3 pt-3 border-t border-canvas-100">
            Activities drive which modules render in this org&apos;s sidebar.
            Edit via the org owner&apos;s onboarding flow.
          </p>
        </div>
      </div>

      {/* ── Members table ─────────────────────────────────── */}
      <div className="card p-4">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Members ({customer.members.length})</h3>
        {customer.members.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-gray-400 italic">No members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">User</th>
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Joined</th>
                  <th className="pb-2 pr-4 font-medium">Last login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {customer.members.map((m) => (
                  <tr key={m.id} className="hover:bg-canvas-50">
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <div>
                          {m.user_name && (
                            <div className="text-[12.5px] font-medium text-gray-900">{m.user_name}</div>
                          )}
                          <div className={cn(
                            "text-[11.5px]",
                            m.user_name ? "text-gray-500" : "text-gray-700 font-medium",
                          )}>
                            {m.user_email || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-[12px] text-gray-700">
                      {m.role || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      {m.is_active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                          <XCircle className="w-3 h-3" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-[11.5px] text-gray-600 whitespace-nowrap">
                      {m.accepted_at ? fmtDate(m.accepted_at) : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-[11.5px] text-gray-600 whitespace-nowrap">
                      {m.last_login ? fmtDateTime(m.last_login) : <span className="text-gray-400">never</span>}
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


function FactCell({
  icon, label, value,
}: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] text-gray-400 font-medium mb-0.5">
        <span className="text-gray-400">{icon}</span>
        {label}
      </div>
      <div className="text-[13px] font-semibold text-gray-900 truncate leading-tight">{value}</div>
    </div>
  );
}


function Row({
  label, v, mono, tone,
}: {
  label: string;
  v: string;
  mono?: boolean;
  tone?: "ok" | "warn" | "danger";
}) {
  const colour = tone === "ok" ? "text-emerald-700"
              : tone === "warn" ? "text-amber-700"
              : tone === "danger" ? "text-rose-700"
              : "text-gray-800";
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className={cn("text-right", colour, mono && "font-mono tabular-nums")}>{v}</dd>
    </div>
  );
}


function SubscriptionPill({ sub }: { sub: Subscription }) {
  const map = {
    active:    { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    trial:     { cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    expired:   { cls: "bg-rose-50 text-rose-700 ring-rose-200" },
    cancelled: { cls: "bg-canvas-50 text-gray-500 ring-canvas-200" },
  } as const;
  const m = map[sub.status];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
      m.cls,
    )}>
      {sub.status_label || sub.status}
      {sub.status === "trial" && sub.days_left !== null && (
        <span className="text-[10px] font-normal normal-case">· {sub.days_left}d left</span>
      )}
    </span>
  );
}
