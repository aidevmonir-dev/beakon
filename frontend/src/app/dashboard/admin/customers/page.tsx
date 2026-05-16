"use client";

/* Platform Admin → Customers list.
 *
 * Thomas-only cockpit listing every Beakon client organisation. Renders
 * - 4 KPI tiles (Total / Active / Trial / No plan)
 * - filterable table (name, country, plan, status, activities, members, created)
 * - per-row link to the org's detail view
 *
 * Permission is enforced server-side (IsAdminUser). The client-side
 * guard here just hides the chrome if a non-staff user navigates here.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, BarChart3, Calendar, CheckCircle2, Clock,
  Search, ShieldAlert, Users,
} from "lucide-react";
import { api, fetchCurrentUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";


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

interface Customer {
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
}

interface Totals {
  total: number;
  active: number;
  trial: number;
  cancelled: number;
  expired: number;
  no_plan: number;
}


const STATUS_TABS: { key: string; label: string }[] = [
  { key: "",          label: "All" },
  { key: "active",    label: "Active" },
  { key: "trial",     label: "Trial" },
  { key: "expired",   label: "Expired" },
  { key: "cancelled", label: "Cancelled" },
  { key: "no_plan",   label: "No plan" },
];

const ACTIVITY_LABEL: Record<string, string> = {
  structure_management: "Structure",
  accounting_finance:   "Accounting",
  travel_expense:       "Travel",
  employment:           "Employment",
  wealth_oversight:     "Wealth",
  document_management:  "Documents",
};


export default function PlatformCustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusTab, setStatusTab] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Quick client-side guard — surface a clean message if a non-staff
        // user lands here. Server-side IsAdminUser is still the authority.
        const me = await fetchCurrentUser();
        if (!me.is_staff && !me.is_superuser) {
          if (!cancelled) setForbidden(true);
          if (!cancelled) setLoading(false);
          return;
        }
        const data = await api.get<{ customers: Customer[]; totals: Totals }>(
          "/beakon/admin/customers/",
        );
        if (cancelled) return;
        setCustomers(data.customers || []);
        setTotals(data.totals || null);
      } catch (e: any) {
        if (cancelled) return;
        if (e?.status === 403 || e?.error?.status === 403) {
          setForbidden(true);
        } else {
          setError(e?.error?.message || e?.message || "Could not load customers");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    let rows = customers;
    if (statusTab === "no_plan") {
      rows = rows.filter((c) => !c.subscription);
    } else if (statusTab) {
      rows = rows.filter((c) => c.subscription?.status === statusTab);
    }
    if (q.trim()) {
      const s = q.toLowerCase().trim();
      rows = rows.filter((c) =>
        c.name.toLowerCase().includes(s) ||
        c.slug.toLowerCase().includes(s) ||
        (c.legal_name || "").toLowerCase().includes(s) ||
        (c.country || "").toLowerCase().includes(s) ||
        (c.plan?.name || "").toLowerCase().includes(s),
      );
    }
    return rows;
  }, [customers, statusTab, q]);

  if (forbidden) {
    return (
      <div className="card p-10 text-center max-w-xl mx-auto mt-12">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Access restricted</h2>
        <p className="text-sm text-gray-500">
          This page is for Beakon staff only. If you should have access, ask
          a platform owner to grant the <code className="font-mono">is_staff</code> flag on your account.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/dashboard"
        className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Dashboard
      </Link>

      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="font-display text-[26px] tracking-tight font-medium text-gray-900 leading-none mb-1">
            Customers
          </h1>
          <p className="text-[13px] text-gray-500">
            All client organisations on Beakon. Plan, subscription state,
            selected activities, members.
          </p>
        </div>
      </div>

      {/* ── KPI tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <KpiCard
          icon={<Building2 className="w-4 h-4" />}
          label="Total customers"
          value={totals?.total ?? "—"}
          tone="neutral"
        />
        <KpiCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          label="Active subscriptions"
          value={totals?.active ?? "—"}
          tone="ok"
        />
        <KpiCard
          icon={<Clock className="w-4 h-4" />}
          label="On trial"
          value={totals?.trial ?? "—"}
          tone="warn"
        />
        <KpiCard
          icon={<BarChart3 className="w-4 h-4" />}
          label="No plan attached"
          value={totals?.no_plan ?? "—"}
          tone={totals && totals.no_plan > 0 ? "danger" : "neutral"}
        />
      </div>

      {/* ── Table card ───────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Search name, country, plan…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {STATUS_TABS.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusTab(s.key)}
                className={cn(
                  "px-2.5 py-1 rounded-full border transition-colors",
                  statusTab === s.key
                    ? "bg-brand-50 border-brand-200 text-brand-800"
                    : "bg-white border-canvas-200 text-gray-600 hover:bg-canvas-50",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-12 text-center">Loading customers…</p>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No customers match this filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Country</th>
                  <th className="pb-2 pr-4 font-medium">Plan</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Activities</th>
                  <th className="pb-2 pl-4 font-medium text-right">Members</th>
                  <th className="pb-2 pl-4 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {visible.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-canvas-50 cursor-pointer"
                    onClick={() => router.push(`/dashboard/admin/customers/${c.slug}`)}
                  >
                    <td className="py-3 pr-4">
                      <div className="text-[13px] font-medium text-gray-900">{c.name}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{c.slug}</div>
                    </td>
                    <td className="py-3 pr-4 text-[12px] text-gray-700">
                      {c.country || "—"}
                      <span className="ml-1 text-[10px] text-gray-400">{c.currency}</span>
                    </td>
                    <td className="py-3 pr-4 text-[12px] text-gray-700">
                      {c.plan ? (
                        <>
                          <div>{c.plan.name}</div>
                          <div className="text-[10px] text-gray-400">
                            {c.plan.price
                              ? `${c.plan.currency} ${c.plan.price} / ${c.plan.billing_cadence}`
                              : "custom"}
                          </div>
                        </>
                      ) : (
                        <span className="text-gray-400 italic">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusPill sub={c.subscription} />
                    </td>
                    <td className="py-3 pr-4">
                      {c.selected_activities.length === 0 ? (
                        <span className="text-[11px] text-gray-400">none</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-[280px]">
                          {c.selected_activities.map((a) => (
                            <span
                              key={a}
                              className="inline-flex items-center rounded-full bg-canvas-50 ring-1 ring-canvas-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
                              title={a}
                            >
                              {ACTIVITY_LABEL[a] || a}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pl-4 text-right text-[12px] text-gray-700 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3 h-3 text-gray-400" />
                        {c.member_count}
                      </span>
                    </td>
                    <td className="py-3 pl-4 text-[11px] text-gray-500 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-gray-400" />
                        {c.created_at ? fmtDate(c.created_at) : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        Detail screen with subscription history + member list comes next.
        Today the row click is a placeholder until that page ships.
      </p>
    </div>
  );
}


function KpiCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "ok" | "warn" | "danger" | "neutral";
}) {
  const ring = tone === "ok"     ? "ring-emerald-100 bg-emerald-50/30"
             : tone === "warn"   ? "ring-amber-100 bg-amber-50/40"
             : tone === "danger" ? "ring-rose-100 bg-rose-50/40"
             :                     "ring-canvas-200 bg-white";
  const iconColour = tone === "ok"     ? "text-emerald-600"
                   : tone === "warn"   ? "text-amber-600"
                   : tone === "danger" ? "text-rose-600"
                   :                     "text-gray-500";
  return (
    <div className={cn("rounded-lg ring-1 ring-inset p-3.5", ring)}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={iconColour}>{icon}</span>
        <span className="text-[11px] font-medium text-gray-500 tracking-wide">{label}</span>
      </div>
      <div className="text-[24px] font-semibold leading-none text-gray-900 tabular-nums">
        {value}
      </div>
    </div>
  );
}


function StatusPill({ sub }: { sub: Subscription | null }) {
  if (!sub) {
    return (
      <span className="inline-flex items-center rounded-full bg-canvas-50 text-gray-500 ring-1 ring-canvas-200 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide">
        No plan
      </span>
    );
  }
  const map = {
    active:    { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    trial:     { cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    expired:   { cls: "bg-rose-50 text-rose-700 ring-rose-200" },
    cancelled: { cls: "bg-canvas-50 text-gray-500 ring-canvas-200" },
  } as const;
  const m = map[sub.status];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide",
      m.cls,
    )}>
      {sub.status_label || sub.status}
      {sub.status === "trial" && sub.days_left !== null && (
        <span className="text-[9.5px] font-normal text-amber-700/80 normal-case">
          · {sub.days_left}d left
        </span>
      )}
    </span>
  );
}
