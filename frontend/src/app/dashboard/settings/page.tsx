"use client";

/* Settings — module dashboard.
 *
 * Layout follows Thomas's 2026-05-11 Settings mockup:
 *
 *   Header       title + subtitle, Export + Save Changes buttons
 *   Search bar   "Search settings, users, permissions or ask…"
 *   Tabs         Overview · Organization · Users & Permissions ·
 *                AI & Data Approval · Modules · Billing & Plan ·
 *                Integrations · Security · Audit Log
 *   Stats row    4 KPI cards: Active Users • Enabled Modules •
 *                Security Score • AI Approval Status
 *   Row 1 (3c)   Organization Profile · Users & Permissions ·
 *                AI & Data Approval
 *   Row 2 (3c)   Modules · Security & Access · Recent Audit Activity
 *
 * Data — Organization profile, member counts by role, enabled modules
 * and recent audit events are wired live. Security score, security &
 * access detail rows and the AI-Approval state are placeholders until
 * the corresponding settings models land.
 *
 * Replaces the earlier card-grid Settings hub. Sub-pages still live
 * at /dashboard/settings/organization, /dashboard/settings/activities,
 * /dashboard/audit etc. — the Edit / Manage / View buttons link to
 * them, and the tab nav at the top covers the same surfaces.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Box, CheckCircle2, Clock, Download, Edit3,
  Lock, Save, Search, Shield, ShieldCheck, Sparkles, User, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";


// ── Types ──────────────────────────────────────────────────────────


type ActivitySlug =
  | "structure_management"
  | "accounting_finance"
  | "travel_expense"
  | "employment"
  | "wealth_oversight"
  | "document_management";


interface OrgPayload {
  id: number;
  name: string;
  country?: string;
  currency?: string;
  is_active?: boolean;
  selected_activities?: ActivitySlug[];
}


interface Role { id: number; slug: string; name: string; }
interface MemberUser { id: number; email: string; first_name: string; last_name: string; }
interface OrgMember {
  id: number;
  user: MemberUser;
  role: Role | null;
  is_active: boolean;
}


interface AuditEvent {
  id: number;
  action: string;
  object_type: string;
  object_repr: string;
  actor_name: string | null;
  created_at: string;
}


type ListResult<T> = { results: T[]; count?: number } | T[];

function asArray<T>(r: ListResult<T> | null | undefined): T[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.results ?? []);
}


// ── Tabs ───────────────────────────────────────────────────────────


interface Tab { name: string; href: string; }

const TABS: Tab[] = [
  { name: "Overview",            href: "/dashboard/settings" },
  { name: "Organization",        href: "/dashboard/settings/organization" },
  { name: "Users & Permissions", href: "/dashboard/settings" },
  { name: "AI & Data Approval",  href: "/dashboard/settings" },
  { name: "Modules",             href: "/dashboard/settings/activities" },
  { name: "Billing & Plan",      href: "/dashboard/settings" },
  { name: "Integrations",        href: "/dashboard/settings" },
  { name: "Security",            href: "/dashboard/settings" },
  { name: "Audit Log",           href: "/dashboard/audit" },
];


// ── Modules registry ──────────────────────────────────────────────


interface ModuleRow {
  slug: ActivitySlug | "settings" | "dashboard";
  label: string;
}

const ALL_MODULES: ModuleRow[] = [
  { slug: "structure_management", label: "Structure" },
  { slug: "accounting_finance",   label: "Accounting" },
  { slug: "travel_expense",       label: "Travel Expense Management" },
  { slug: "employment",           label: "Employment" },
  { slug: "document_management",  label: "Documents" },
  { slug: "wealth_oversight",     label: "Wealth Management" },
];


// ── Page ───────────────────────────────────────────────────────────


export default function SettingsDashboardPage() {
  const [org, setOrg] = useState<OrgPayload | null>(null);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    const orgId = typeof window !== "undefined"
      ? localStorage.getItem("organization_id") : null;
    if (!orgId) return;

    void Promise.allSettled([
      api.get<OrgPayload>(`/organizations/${orgId}/`),
      api.get<ListResult<OrgMember>>(`/organizations/${orgId}/members/`),
      api.get<ListResult<AuditEvent>>("/audit/events/"),
    ]).then(([o, m, a]) => {
      if (o.status === "fulfilled") setOrg(o.value);
      if (m.status === "fulfilled") setMembers(asArray(m.value));
      else setMembers([]);
      if (a.status === "fulfilled") setAuditEvents(asArray(a.value).slice(0, 5));
      else setAuditEvents([]);
    });
  }, []);

  // Derived
  const enabledActivities = org?.selected_activities ?? [];
  const enabledCount = enabledActivities.length;
  const totalModules = ALL_MODULES.length;
  const totalUsers = members?.length ?? 0;

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of members ?? []) {
      const slug = (m.role?.slug || "staff").toLowerCase();
      counts[slug] = (counts[slug] || 0) + 1;
    }
    return counts;
  }, [members]);

  // Top 3 roles by count, with friendly labels
  const topRoles = useMemo(() => {
    const entries = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
    const knownLabels: Record<string, string> = {
      admin: "Admins", manager: "Managers", staff: "Staff",
      bookkeeper: "Bookkeepers", viewer: "Viewers", member: "Members",
    };
    return entries.slice(0, 4).map(([slug, count]) => ({
      slug, count, label: knownLabels[slug] ?? capitalize(slug),
    }));
  }, [roleCounts]);

  return (
    <div className="px-1 py-2 sm:px-2 sm:py-4">
      <div className="mx-auto w-full max-w-7xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
              Settings
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Configure your workspace, access, AI preferences and system controls.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 hover:text-gray-900 transition"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </div>
        </div>

        {/* ── Search / Ask bar ───────────────────────────────────── */}
        <div className="mt-6 relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search settings, users, permissions or ask getBeakon…"
            className="w-full rounded-xl border border-canvas-200 bg-white py-3 pl-10 pr-12 text-[13.5px] text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-violet-50 text-violet-700 ring-1 ring-violet-100">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────── */}
        <Tabs />

        {/* ── Stats row ──────────────────────────────────────────── */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Active Users" sub="Across all roles"
            value={members === null ? "—" : String(totalUsers)}
            icon={Users} accent="indigo" />
          <StatCard label="Enabled Modules" sub={`Out of ${totalModules} available`}
            value={org === null ? "—" : String(enabledCount)}
            icon={Box} accent="amber" />
          <StatCard label="Security Score" sub="Strong security posture"
            value={`${PLACEHOLDER_SECURITY_SCORE}%`}
            icon={ShieldCheck} accent="mint" />
          <StatCard label="AI Approval Status" sub={PLACEHOLDER_AI_SUBLINE}
            value={PLACEHOLDER_AI_STATUS}
            icon={Sparkles} accent="violet" />
        </ul>

        {/* ── Row 1 ──────────────────────────────────────────────── */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <OrganizationProfileCard org={org} />
          <UsersPermissionsCard
            roles={topRoles}
            total={totalUsers}
            loaded={members !== null} />
          <AIApprovalCard />
        </div>

        {/* ── Row 2 ──────────────────────────────────────────────── */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ModulesCard enabled={enabledActivities} />
          <SecurityAccessCard />
          <RecentAuditCard events={auditEvents ?? []} />
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


type Accent = "indigo" | "amber" | "mint" | "violet";


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
    accent === "indigo" ? { well: "bg-indigo-50 text-indigo-700", ring: "ring-indigo-100" } :
    accent === "amber"  ? { well: "bg-amber-50 text-amber-700",   ring: "ring-amber-100" } :
    accent === "mint"   ? { well: "bg-mint-50 text-mint-700",     ring: "ring-mint-100" } :
                          { well: "bg-violet-50 text-violet-700", ring: "ring-violet-100" };

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
          <div className="text-[12px] font-medium text-gray-500 truncate">{label}</div>
          <div className="text-[22px] font-semibold text-gray-900 leading-tight tabular-nums mt-0.5 truncate">
            {value}
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500 truncate">{sub}</div>
        </div>
      </div>
    </li>
  );
}


// ── Card wrapper ───────────────────────────────────────────────────


function Card({
  title, icon: Icon, action, children, className,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(
      "flex flex-col rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5",
      className,
    )}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-gray-900">
          {Icon && <Icon className="h-4 w-4 text-gray-500" />}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}


// ── Organization Profile ──────────────────────────────────────────


function OrganizationProfileCard({ org }: { org: OrgPayload | null }) {
  return (
    <Card
      title="Organization Profile"
      icon={Box}
      action={
        <Link href="/dashboard/settings/organization"
          className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11.5px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 transition">
          <Edit3 className="h-3 w-3" />
          Edit
        </Link>
      }
    >
      <dl className="divide-y divide-canvas-100">
        <Row label="Organization Name" value={org?.name ?? "—"} />
        <Row label="Country" value={countryName(org?.country) ?? "—"} />
        <Row label="Beakon Currency" value={
          org?.currency ? `${org.currency} — ${currencyName(org.currency)}` : "—"
        } />
        <Row label="Status" value={
          org === null
            ? "—"
            : <span className="inline-flex items-center rounded-full bg-mint-50 px-2 py-0.5 text-[10.5px] font-medium text-mint-700 ring-1 ring-mint-100">
                {org.is_active === false ? "Inactive" : "Active"}
              </span>
        } />
      </dl>
    </Card>
  );
}


function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[12px] text-gray-500">{label}</dt>
      <dd className="text-[12.5px] text-gray-900 font-medium text-right truncate max-w-[60%]">{value}</dd>
    </div>
  );
}


function countryName(code: string | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    CH: "Switzerland", DE: "Germany", FR: "France", IT: "Italy", LU: "Luxembourg",
    GB: "United Kingdom", US: "United States", CA: "Canada", AE: "United Arab Emirates",
  };
  return map[code] ?? code;
}


function currencyName(code: string): string {
  const map: Record<string, string> = {
    CHF: "Swiss Franc (CHF)", EUR: "Euro (EUR)", USD: "US Dollar (USD)",
    GBP: "British Pound (GBP)", AED: "UAE Dirham (AED)",
  };
  return map[code] ?? code;
}


// ── Users & Permissions ───────────────────────────────────────────


function UsersPermissionsCard({
  roles, total, loaded,
}: {
  roles: { slug: string; count: number; label: string }[];
  total: number;
  loaded: boolean;
}) {
  return (
    <Card
      title="Users & Permissions"
      icon={Users}
      action={
        <Link href="/dashboard/settings"
          className="text-[11.5px] font-medium text-brand-700 hover:text-brand-800">
          Manage users
        </Link>
      }
    >
      {!loaded ? (
        <div className="text-[12.5px] text-gray-500">Loading…</div>
      ) : roles.length === 0 ? (
        <div className="text-[12.5px] text-gray-500">No members yet.</div>
      ) : (
        <ul className="divide-y divide-canvas-100">
          {roles.map((r) => (
            <li key={r.slug} className="flex items-center gap-3 py-2.5">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas-100 text-gray-600">
                <User className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1 text-[12.5px] text-gray-700">{r.label}</span>
              <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{r.count}</span>
            </li>
          ))}
          <li className="flex items-center justify-between pt-3 mt-1 border-t-2 border-canvas-100">
            <span className="text-[12.5px] font-semibold text-gray-900">Total Users</span>
            <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{total}</span>
          </li>
        </ul>
      )}
    </Card>
  );
}


// ── AI & Data Approval ────────────────────────────────────────────


function AIApprovalCard() {
  // TODO: wire to a future /organizations/{id}/ai-policy/ endpoint.
  return (
    <Card
      title="AI & Data Approval"
      icon={Sparkles}
      action={
        <Link href="/dashboard/settings"
          className="text-[11.5px] font-medium text-brand-700 hover:text-brand-800">
          Activate Advanced AI
        </Link>
      }
    >
      <ul className="space-y-2.5">
        <li className="flex items-start justify-between gap-3 py-1">
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-gray-900">Basic AI</div>
            <div className="text-[11px] text-gray-500">Document summary, insights, suggestions</div>
          </div>
          <span className="shrink-0 inline-flex items-center rounded-full bg-mint-50 px-2 py-0.5 text-[10.5px] font-medium text-mint-700 ring-1 ring-mint-100">Enabled</span>
        </li>
        <li className="flex items-start justify-between gap-3 py-1">
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-gray-900">Advanced AI</div>
            <div className="text-[11px] text-gray-500">Advanced reasoning, deep analytics</div>
          </div>
          <span className="shrink-0 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 ring-1 ring-amber-100">Not Activated</span>
        </li>
        <li className="flex items-start justify-between gap-3 py-1">
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-gray-900">Approved Infrastructure</div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 text-[11.5px] text-gray-700">
            AWS Bedrock / Claude
            <CheckCircle2 className="h-3 w-3 text-mint-600" />
          </span>
        </li>
      </ul>
      <div className="mt-3 flex items-start gap-2 rounded-lg bg-violet-50/60 ring-1 ring-violet-100 p-2.5">
        <Shield className="h-3.5 w-3.5 text-violet-700 mt-0.5 shrink-0" />
        <p className="text-[11px] text-violet-900 leading-relaxed">
          AI responses follow your data policies and approvals.
        </p>
      </div>
    </Card>
  );
}


// ── Modules ───────────────────────────────────────────────────────


function ModulesCard({ enabled }: { enabled: ActivitySlug[] }) {
  const enabledSet = new Set(enabled);
  return (
    <Card title="Modules" icon={Box}>
      <ul className="divide-y divide-canvas-100">
        {ALL_MODULES.map((m) => {
          const isOn = m.slug === "structure_management" /* always always on for now */ || enabledSet.has(m.slug as ActivitySlug);
          return (
            <li key={m.slug} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[12.5px] text-gray-700">{m.label}</span>
              {isOn ? (
                <span className="inline-flex items-center rounded-full bg-mint-50 px-2 py-0.5 text-[10.5px] font-medium text-mint-700 ring-1 ring-mint-100">
                  Enabled
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-canvas-100 px-2 py-0.5 text-[10.5px] font-medium text-gray-600 ring-1 ring-canvas-200">
                  Off
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}


// ── Security & Access ─────────────────────────────────────────────


function SecurityAccessCard() {
  // TODO: wire to per-org security policy + last review timestamp.
  return (
    <Card title="Security & Access" icon={Shield}>
      <dl className="divide-y divide-canvas-100">
        <Row label="Two-Factor Authentication" value={
          <span className="inline-flex items-center rounded-full bg-mint-50 px-2 py-0.5 text-[10.5px] font-medium text-mint-700 ring-1 ring-mint-100">
            Enabled
          </span>
        } />
        <Row label="Session Timeout"        value="30 minutes" />
        <Row label="Password Policy"        value="Strong (12+ chars, 2FA)" />
        <Row label="Last Security Review"   value="May 5, 2024" />
      </dl>
      <div className="mt-3 pt-2">
        <Link href="/dashboard/settings"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View security settings
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </Card>
  );
}


// ── Recent Audit Activity ─────────────────────────────────────────


function RecentAuditCard({ events }: { events: AuditEvent[] }) {
  return (
    <Card
      title="Recent Audit Activity"
      icon={Clock}
      action={
        <Link href="/dashboard/audit"
          className="text-[11.5px] font-medium text-brand-700 hover:text-brand-800">
          View all
        </Link>
      }
    >
      {events.length === 0 ? (
        <div className="text-[12.5px] text-gray-500">No recent activity.</div>
      ) : (
        <ul className="space-y-3">
          {events.slice(0, 4).map((e) => (
            <li key={e.id} className="flex items-start gap-3">
              <AuditIcon objectType={e.object_type} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-gray-900 leading-tight">
                  {humanizeAudit(e)}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">{fmtTimestamp(e.created_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


function AuditIcon({ objectType }: { objectType: string }) {
  const k = objectType.toLowerCase();
  const Icon =
    k.includes("user") || k.includes("invite") || k.includes("member") ? User :
    k.includes("role") || k.includes("permission")                    ? Lock :
    k.includes("ai") || k.includes("approval")                        ? Sparkles :
    k.includes("module") || k.includes("activity")                    ? Box :
    k.includes("security") || k.includes("password")                  ? Shield :
    k.includes("warn") || k.includes("alert")                         ? AlertTriangle :
                                                                        Clock;
  return (
    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas-100 text-gray-600">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}


function humanizeAudit(e: AuditEvent): string {
  if (e.object_repr) return e.object_repr;
  const verb = e.action.toLowerCase().replace(/_/g, " ");
  const noun = e.object_type.toLowerCase().replace(/_/g, " ");
  return `${capitalize(noun)} ${verb}`.trim();
}


function fmtTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}


function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}


// ── Aggregate-level placeholders ──────────────────────────────────


// TODO: derive from a policy score — 2FA + password strength + recent
//   review date + permission-hygiene checks.
const PLACEHOLDER_SECURITY_SCORE = 92;
// TODO: read from a future Organization.ai_policy field
//   ("basic" | "advanced").
const PLACEHOLDER_AI_STATUS = "Basic Enabled";
const PLACEHOLDER_AI_SUBLINE = "Advanced AI not activated";
