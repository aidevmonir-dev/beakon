"use client";

/* Platform Admin home — Thomas's cockpit.
 *
 * Aggregates the same `/beakon/admin/customers/` payload into a one-page
 * overview: KPIs, MRR estimate, signups recency, trial-ending alerts,
 * and activity adoption. Everything links into the Customers list /
 * detail screens for the drill-down.
 *
 * No new backend endpoint — the dashboard composes the same list payload
 * already used by /dashboard/admin/customers. One fetch, all data.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowRight, ArrowLeft, Building2, Calendar,
  CheckCircle2, Clock, DollarSign, Globe, LogIn, ShieldAlert, Sparkles,
  TrendingUp, Users, Zap,
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

interface Customer {
  id: number;
  slug: string;
  name: string;
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


interface TrafficKpis {
  logins_today: number;
  logins_7d: number;
  logins_30d: number;
  dau: number;
  wau: number;
  mau: number;
  active_orgs_7d: number;
  total_users: number;
  total_sessions: number;
  active_sessions_now: number;
}

interface DailyPoint { date: string; count: number; }

interface OrgEngagement {
  org_id: number;
  org_slug: string;
  org_name: string;
  logins: number;
  active_users: number;
  actions: number;
}

interface ActiveSession {
  id: number;
  user_email: string | null;
  user_name: string;
  ip: string | null;
  logged_in_at: string | null;
}

interface TrafficData {
  kpis: TrafficKpis;
  logins_by_day:  DailyPoint[];
  actions_by_day: DailyPoint[];
  by_org_7d: OrgEngagement[];
  active_sessions: ActiveSession[];
  window_days: number;
}


const ACTIVITY_LABEL: Record<string, string> = {
  structure_management: "Structure",
  accounting_finance:   "Accounting",
  travel_expense:       "Travel Expense",
  employment:           "Employment",
  wealth_oversight:     "Wealth Management",
  document_management:  "Documents",
};

const ALL_ACTIVITIES = Object.keys(ACTIVITY_LABEL);


export default function PlatformAdminHome() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [traffic, setTraffic] = useState<TrafficData | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await fetchCurrentUser();
        if (!me.is_staff && !me.is_superuser) {
          if (!cancelled) { setForbidden(true); setLoading(false); }
          return;
        }
        // Customers and traffic fetched in parallel — failure on one
        // shouldn't blank the other. Promise.allSettled returns both
        // outcomes so we can render partial data when one endpoint blips.
        const [custRes, trafRes] = await Promise.allSettled([
          api.get<{ customers: Customer[]; totals: Totals }>("/beakon/admin/customers/"),
          api.get<TrafficData>("/beakon/admin/traffic/"),
        ]);
        if (cancelled) return;
        if (custRes.status === "fulfilled") {
          setCustomers(custRes.value.customers || []);
          setTotals(custRes.value.totals || null);
        }
        if (trafRes.status === "fulfilled") {
          setTraffic(trafRes.value);
        }
      } catch (e: any) {
        if (cancelled) return;
        if (e?.status === 403 || e?.error?.status === 403) {
          setForbidden(true);
        } else {
          setError(e?.error?.message || e?.message || "Could not load dashboard");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // ── MRR estimate — sum of monthly-equivalent prices for active subs. ─
  // Yearly plans amortise to /12. Custom-priced (Enterprise) is excluded
  // since the price is null until Thomas books it manually.
  const mrr = useMemo(() => {
    let sum = 0;
    const byCurrency: Record<string, number> = {};
    for (const c of customers) {
      if (c.subscription?.status !== "active") continue;
      if (!c.plan?.price) continue;
      const monthly =
        c.plan.billing_cadence === "yearly"
          ? Number(c.plan.price) / 12
          : Number(c.plan.price);
      if (!Number.isFinite(monthly)) continue;
      sum += monthly;
      byCurrency[c.plan.currency] = (byCurrency[c.plan.currency] || 0) + monthly;
    }
    // Single-currency case is the common one — show that directly. Mixed
    // bag falls back to a per-currency breakdown shown beneath the KPI.
    const currencies = Object.keys(byCurrency);
    return {
      total: sum,
      currency: currencies.length === 1 ? currencies[0] : null,
      byCurrency,
    };
  }, [customers]);

  const trialsEndingSoon = useMemo(() => {
    const cutoff = 14;
    return customers
      .filter((c) =>
        c.subscription?.status === "trial" &&
        c.subscription.days_left !== null &&
        c.subscription.days_left <= cutoff,
      )
      .sort((a, b) => (a.subscription!.days_left ?? 99) - (b.subscription!.days_left ?? 99));
  }, [customers]);

  const recentSignups = useMemo(() => {
    return [...customers]
      .filter((c) => c.created_at)
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, 5);
  }, [customers]);

  // Per-activity adoption: how many orgs picked each module. Renders as
  // a horizontal bar so Thomas can see at a glance which modules are
  // pulling and which are dragging.
  const activityAdoption = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of ALL_ACTIVITIES) counts[a] = 0;
    for (const c of customers) {
      for (const a of c.selected_activities) {
        if (a in counts) counts[a] += 1;
      }
    }
    const max = Math.max(1, ...Object.values(counts), customers.length);
    return ALL_ACTIVITIES.map((slug) => ({
      slug,
      label: ACTIVITY_LABEL[slug],
      count: counts[slug],
      pct: (counts[slug] / max) * 100,
    }));
  }, [customers]);

  const trialEndingSoonCount = trialsEndingSoon.filter(
    (c) => (c.subscription?.days_left ?? 99) <= 7,
  ).length;

  if (forbidden) {
    return (
      <div className="card p-10 text-center max-w-xl mx-auto mt-12">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Access restricted</h2>
        <p className="text-sm text-gray-500">This page is for Beakon staff only.</p>
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
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-display text-[26px] tracking-tight font-medium text-gray-900 leading-none">
              Platform Admin
            </h1>
            <span className="inline-flex items-center rounded-full bg-violet-50 text-violet-700 ring-1 ring-violet-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              Owner cockpit
            </span>
          </div>
          <p className="text-[13px] text-gray-500">
            Snapshot of every Beakon customer, plan, trial and module adoption.
          </p>
        </div>
        <Link href="/dashboard/admin/customers" className="btn-secondary-sm">
          All customers <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-12 text-center">Loading dashboard…</p>
      ) : error ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      ) : (
        <>
          {/* ── KPI row ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mb-5">
            <Kpi
              icon={<Building2 className="w-4 h-4" />}
              label="Customers"
              value={totals?.total ?? 0}
              tone="neutral"
              footer={<>{totals?.active ?? 0} active · {totals?.trial ?? 0} on trial</>}
            />
            <Kpi
              icon={<DollarSign className="w-4 h-4" />}
              label="MRR (active)"
              value={
                mrr.total === 0
                  ? "—"
                  : mrr.currency
                    ? `${mrr.currency} ${formatMoney(mrr.total)}`
                    : formatMoney(mrr.total)
              }
              tone={mrr.total > 0 ? "ok" : "neutral"}
              footer={
                mrr.total === 0
                  ? <>No active subscriptions yet</>
                  : <>Across {totals?.active ?? 0} subscription{totals?.active === 1 ? "" : "s"}</>
              }
            />
            <Kpi
              icon={<Clock className="w-4 h-4" />}
              label="On trial"
              value={totals?.trial ?? 0}
              tone={(totals?.trial ?? 0) > 0 ? "warn" : "neutral"}
              footer={<>{trialsEndingSoon.length} ending within 14 days</>}
            />
            <Kpi
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Trial ending ≤ 7d"
              value={trialEndingSoonCount}
              tone={trialEndingSoonCount > 0 ? "danger" : "ok"}
              footer={
                trialEndingSoonCount > 0
                  ? <>Action needed — Thomas to follow up</>
                  : <>None this week</>
              }
            />
            <Kpi
              icon={<TrendingUp className="w-4 h-4" />}
              label="No plan attached"
              value={totals?.no_plan ?? 0}
              tone={(totals?.no_plan ?? 0) > 0 ? "warn" : "neutral"}
              footer={
                (totals?.no_plan ?? 0) > 0
                  ? <>Workspaces without a subscription</>
                  : <>All workspaces have a plan</>
              }
            />
          </div>

          {/* ── Two-column body — trials + signups + adoption ────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Trials ending soon */}
            <div className="card p-4">
              <h3 className="text-[13px] font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Trials ending soon
              </h3>
              {trialsEndingSoon.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-gray-400 italic">
                  No trials ending in the next 14 days.
                </p>
              ) : (
                <ul className="space-y-2">
                  {trialsEndingSoon.map((c) => {
                    const days = c.subscription?.days_left ?? 0;
                    const tone =
                      days <= 3 ? "bg-rose-50 ring-rose-200 text-rose-700" :
                      days <= 7 ? "bg-amber-50 ring-amber-200 text-amber-700" :
                                  "bg-canvas-50 ring-canvas-200 text-gray-700";
                    return (
                      <li key={c.id}>
                        <Link
                          href={`/dashboard/admin/customers/${c.slug}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-canvas-200 px-2.5 py-2 hover:bg-canvas-50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-medium text-gray-900 truncate">{c.name}</div>
                            <div className="text-[11px] text-gray-500">
                              {c.plan?.name || "—"} ·{" "}
                              {c.subscription?.trial_ends_at ? fmtDate(c.subscription.trial_ends_at) : "—"}
                            </div>
                          </div>
                          <span className={cn(
                            "inline-flex items-center rounded-full ring-1 ring-inset px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap",
                            tone,
                          )}>
                            {days}d left
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Recent signups */}
            <div className="card p-4">
              <h3 className="text-[13px] font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-brand-600" />
                Recent signups
              </h3>
              {recentSignups.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-gray-400 italic">No recent signups.</p>
              ) : (
                <ul className="space-y-2">
                  {recentSignups.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/dashboard/admin/customers/${c.slug}`}
                        className="flex items-center justify-between gap-2 rounded-md border border-canvas-200 px-2.5 py-2 hover:bg-canvas-50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium text-gray-900 truncate">{c.name}</div>
                          <div className="text-[11px] text-gray-500">
                            {c.plan?.name || "No plan"}
                            {c.country && <span className="ml-1.5 text-gray-300">·</span>}
                            {c.country && <span className="ml-1.5">{c.country}</span>}
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-gray-500 whitespace-nowrap">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          {c.created_at ? fmtDate(c.created_at) : "—"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Activity adoption */}
            <div className="card p-4">
              <h3 className="text-[13px] font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                Module adoption
              </h3>
              {customers.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-gray-400 italic">No customers yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {activityAdoption.map((a) => (
                    <li key={a.slug}>
                      <div className="flex items-center justify-between gap-2 text-[12px] mb-1">
                        <span className="text-gray-700 truncate">{a.label}</span>
                        <span className="font-mono tabular-nums text-gray-500">
                          {a.count} / {customers.length}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-canvas-100 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            a.count === customers.length ? "bg-emerald-500" :
                            a.count === 0                 ? "bg-canvas-200" :
                                                            "bg-brand-500",
                          )}
                          style={{ width: `${a.pct}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ── Traffic section ─────────────────────────────────── */}
          {traffic && <TrafficSection data={traffic} />}

          {/* ── Mini-table of all customers ─────────────────────── */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold text-gray-900">All customers</h3>
              <Link href="/dashboard/admin/customers" className="text-[11.5px] text-brand-700 hover:underline">
                Open full list →
              </Link>
            </div>
            {customers.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-gray-400 italic">
                No customers in the system yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                      <th className="pb-2 pr-4 font-medium">Customer</th>
                      <th className="pb-2 pr-4 font-medium">Plan</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium">Activities</th>
                      <th className="pb-2 pl-4 font-medium text-right">Members</th>
                      <th className="pb-2 pl-4 font-medium">Signed up</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-canvas-100">
                    {customers.map((c) => (
                      <tr key={c.id} className="hover:bg-canvas-50">
                        <td className="py-2.5 pr-4">
                          <Link
                            href={`/dashboard/admin/customers/${c.slug}`}
                            className="text-[12.5px] font-medium text-brand-700 hover:underline"
                          >
                            {c.name}
                          </Link>
                          <div className="text-[10.5px] text-gray-400 font-mono">{c.slug}</div>
                        </td>
                        <td className="py-2.5 pr-4 text-[12px] text-gray-700">
                          {c.plan?.name || <span className="text-gray-400 italic">—</span>}
                        </td>
                        <td className="py-2.5 pr-4">
                          <MiniStatusPill sub={c.subscription} />
                        </td>
                        <td className="py-2.5 pr-4 text-[11.5px] text-gray-600">
                          {c.activity_count} / 6
                        </td>
                        <td className="py-2.5 pl-4 text-right text-[12px] text-gray-700 tabular-nums">
                          {c.member_count}
                        </td>
                        <td className="py-2.5 pl-4 text-[11.5px] text-gray-500 whitespace-nowrap">
                          {c.created_at ? fmtDate(c.created_at) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


function formatMoney(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}


function Kpi({
  icon, label, value, footer, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  footer?: React.ReactNode;
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
      <div className="text-[22px] font-semibold leading-none text-gray-900 tabular-nums">{value}</div>
      {footer && <div className="text-[11px] text-gray-500 mt-1.5 leading-snug">{footer}</div>}
    </div>
  );
}


// ── Traffic section — DAU/WAU/MAU + 14-day chart + per-org engagement ─
function TrafficSection({ data }: { data: TrafficData }) {
  const { kpis, logins_by_day, actions_by_day, by_org_7d, active_sessions } = data;

  // Twin-bar chart: scale both series to the same Y-axis so the
  // visual comparison of logins vs actions is honest.
  const maxBar = Math.max(
    1,
    ...logins_by_day.map((p) => p.count),
    ...actions_by_day.map((p) => p.count),
  );

  return (
    <div className="mt-2 mb-4 space-y-4">
      <div className="flex items-center gap-2 mt-2">
        <h2 className="text-[16px] font-semibold text-gray-900 tracking-tight">Traffic</h2>
        <span className="inline-flex items-center rounded-full bg-sky-50 text-sky-700 ring-1 ring-sky-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          Last {data.window_days}d
        </span>
        {kpis.active_sessions_now > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 ml-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            {kpis.active_sessions_now} session{kpis.active_sessions_now === 1 ? "" : "s"} live
          </span>
        )}
      </div>

      {/* ── Traffic KPI row ────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi
          icon={<LogIn className="w-4 h-4" />}
          label="Logins today"
          value={kpis.logins_today}
          tone={kpis.logins_today > 0 ? "ok" : "neutral"}
          footer={<>{kpis.dau} unique user{kpis.dau === 1 ? "" : "s"}</>}
        />
        <Kpi
          icon={<Users className="w-4 h-4" />}
          label="DAU"
          value={kpis.dau}
          tone="neutral"
          footer={<>Distinct users today</>}
        />
        <Kpi
          icon={<Users className="w-4 h-4" />}
          label="WAU"
          value={kpis.wau}
          tone="neutral"
          footer={<>Distinct users last 7d</>}
        />
        <Kpi
          icon={<Users className="w-4 h-4" />}
          label="MAU"
          value={kpis.mau}
          tone="neutral"
          footer={<>Distinct users last 30d</>}
        />
        <Kpi
          icon={<Building2 className="w-4 h-4" />}
          label="Active orgs (7d)"
          value={kpis.active_orgs_7d}
          tone="ok"
          footer={<>Orgs with at least one login</>}
        />
        <Kpi
          icon={<Activity className="w-4 h-4" />}
          label="Sessions live"
          value={kpis.active_sessions_now}
          tone={kpis.active_sessions_now > 0 ? "ok" : "neutral"}
          footer={<>Currently logged in</>}
        />
      </div>

      {/* ── Twin-bar chart ─────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-gray-900">
            Activity — last {data.window_days} days
          </h3>
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-brand-500" /> Logins
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-violet-400" /> Actions
            </span>
          </div>
        </div>
        <div className="flex items-end gap-1 h-32">
          {logins_by_day.map((p, i) => {
            const a = actions_by_day[i] || { count: 0, date: p.date };
            const loginH  = (p.count / maxBar) * 100;
            const actionH = (a.count / maxBar) * 100;
            const day = new Date(p.date);
            const dayLabel = day.toLocaleDateString(undefined, { day: "numeric", month: "short" });
            return (
              <div key={p.date} className="flex-1 flex flex-col items-center group" title={`${dayLabel}: ${p.count} logins · ${a.count} actions`}>
                <div className="flex-1 flex items-end gap-0.5 w-full">
                  <div
                    className="flex-1 bg-brand-500 rounded-t-sm transition-all min-h-[1px]"
                    style={{ height: `${loginH}%` }}
                  />
                  <div
                    className="flex-1 bg-violet-400 rounded-t-sm transition-all min-h-[1px]"
                    style={{ height: `${actionH}%` }}
                  />
                </div>
                <div className="text-[9px] text-gray-400 mt-1 tabular-nums whitespace-nowrap">
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-[11px] text-gray-500 flex justify-between">
          <span>{kpis.logins_30d} logins / 30d</span>
          <span>{kpis.total_sessions} total sessions all-time · {kpis.total_users} registered users</span>
        </div>
      </div>

      {/* ── Per-org engagement + active sessions ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-600" />
            Per-org engagement (last 7d)
          </h3>
          {by_org_7d.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-gray-400 italic">No org activity in the last 7 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                    <th className="pb-2 pr-4 font-medium">Organisation</th>
                    <th className="pb-2 pr-2 font-medium text-right">Logins</th>
                    <th className="pb-2 pr-2 font-medium text-right">Users</th>
                    <th className="pb-2 pl-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-canvas-100">
                  {by_org_7d.map((o) => (
                    <tr key={o.org_id} className="hover:bg-canvas-50">
                      <td className="py-2 pr-4">
                        <Link
                          href={`/dashboard/admin/customers/${o.org_slug}`}
                          className="text-[12.5px] font-medium text-brand-700 hover:underline"
                        >
                          {o.org_name}
                        </Link>
                      </td>
                      <td className="py-2 pr-2 text-right text-[12px] text-gray-800 tabular-nums">{o.logins}</td>
                      <td className="py-2 pr-2 text-right text-[12px] text-gray-800 tabular-nums">{o.active_users}</td>
                      <td className="py-2 pl-2 text-right text-[12px] text-gray-800 tabular-nums">{o.actions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-emerald-600" />
            Active sessions
          </h3>
          {active_sessions.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-gray-400 italic">No active sessions right now.</p>
          ) : (
            <ul className="space-y-1.5">
              {active_sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-canvas-200 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-gray-900 truncate">
                      {s.user_name || s.user_email || "—"}
                    </div>
                    <div className="text-[10.5px] text-gray-500 truncate">
                      {s.user_name && s.user_email && <span>{s.user_email} · </span>}
                      {s.ip || "no ip"}
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-400 tabular-nums whitespace-nowrap">
                    {s.logged_in_at ? fmtDateTime(s.logged_in_at) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}


function MiniStatusPill({ sub }: { sub: Subscription | null }) {
  if (!sub) {
    return (
      <span className="inline-flex items-center rounded-full bg-canvas-50 text-gray-500 ring-1 ring-canvas-200 px-1.5 py-0.5 text-[10px] font-medium">
        no plan
      </span>
    );
  }
  const map = {
    active:    "bg-emerald-50 text-emerald-700 ring-emerald-200",
    trial:     "bg-amber-50 text-amber-700 ring-amber-200",
    expired:   "bg-rose-50 text-rose-700 ring-rose-200",
    cancelled: "bg-canvas-50 text-gray-500 ring-canvas-200",
  };
  return (
    <span className={cn(
      "inline-flex items-center rounded-full ring-1 ring-inset px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
      map[sub.status],
    )}>
      {sub.status}
    </span>
  );
}
