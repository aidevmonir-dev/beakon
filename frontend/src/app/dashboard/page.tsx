"use client";

/* Home — operational workspace launcher (Phase 1).
 *
 * Layout follows Thomas's 2026-05-11 Home mockup:
 *
 *   Header row     • title + subtitle on the left,
 *                    "+ Create" and "Invite" action buttons on the right
 *   Search bar     • global "search anything or ask getBeakon" input
 *                    with an Ask-Beakon sparkle hint on the right
 *   Stats row      • 4 KPI cards: Structures, Entities, Open Tasks,
 *                    AI Recommendations
 *   Getting Started• 4-step progress for the onboarding journey
 *                    (Structure → Accounting → Travel → Employment),
 *                    each step Completed / In progress / Pending
 *   Your Modules   • 8-tile grid (same modules as the launcher;
 *                    each tile shows a small count subtitle)
 *   Right rail     • "Recommended Next Steps" card with onboarding TODOs
 *                    that complete in lock-step with the progress steps
 *
 * Data — fetched in parallel with Promise.allSettled so a single endpoint
 * failure doesn't blank the page. Missing counts render as "—".
 * Module tiles continue to gate by `selected_activities` so a user who
 * only enabled Accounting+Travel doesn't see Employment / Documents /
 * Wealth tiles.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight, BarChart3, BookOpen, CheckCircle2, FileText, Flag,
  FolderOpen, LineChart, Network, Plane, Plus, Search, Settings as SettingsIcon,
  Sparkles, UserPlus, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { withOrigin } from "@/lib/workflow-back";


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
  currency?: string;
  selected_activities?: ActivitySlug[];
}


interface EntityRow { id: number; parent: number | null; }
interface AccountRow { id: number; }
interface ClaimRow { id: number; status?: string; }
interface EmployeeRow { id: number; }
interface DocumentRow { id: number; }
interface PortfolioRow { id: number; }
interface JERow { id: number; status?: string; }

type ListResult<T> = { results: T[]; count?: number } | T[];

function asArray<T>(r: ListResult<T> | null | undefined): T[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.results ?? []);
}


interface Counts {
  structures: number | null;        // top-level entities (parent IS null)
  entities: number | null;
  accounts: number | null;          // chart-of-accounts rows; drives Accounting step
  openTasks: number | null;         // pending-approval JEs
  aiRecommendations: number | null;
  openClaims: number | null;
  totalClaims: number | null;
  employees: number | null;
  documents: number | null;
  portfolios: number | null;
}

const EMPTY_COUNTS: Counts = {
  structures: null, entities: null, accounts: null, openTasks: null,
  aiRecommendations: null, openClaims: null, totalClaims: null,
  employees: null, documents: null, portfolios: null,
};


// ── Tile / module catalogue ─────────────────────────────────────────


type TileTone =
  | "sky" | "emerald" | "amber" | "rose"
  | "indigo" | "violet" | "cyan" | "slate";


interface Tile {
  slug: string;
  title: string;
  body: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  activity?: ActivitySlug;
  tone: TileTone;
  /** Renderer for the small count line under the body. */
  count: (c: Counts) => string;
}


// One palette per module tile — colour identity comes through the icon
// well and hover arrow only. Cards stay neutral white so the launcher
// reads as a professional finance product rather than a candy grid.
const TILE_TONES: Record<TileTone, {
  well: string; arrow: string;
}> = {
  sky:     { well: "bg-sky-50 text-sky-700",         arrow: "group-hover:text-sky-700" },
  emerald: { well: "bg-emerald-50 text-emerald-700", arrow: "group-hover:text-emerald-700" },
  amber:   { well: "bg-amber-50 text-amber-700",     arrow: "group-hover:text-amber-700" },
  rose:    { well: "bg-rose-50 text-rose-700",       arrow: "group-hover:text-rose-700" },
  indigo:  { well: "bg-indigo-50 text-indigo-700",   arrow: "group-hover:text-indigo-700" },
  violet:  { well: "bg-violet-50 text-violet-700",   arrow: "group-hover:text-violet-700" },
  cyan:    { well: "bg-cyan-50 text-cyan-700",       arrow: "group-hover:text-cyan-700" },
  slate:   { well: "bg-slate-100 text-slate-700",    arrow: "group-hover:text-slate-700" },
};


function fmtCount(n: number | null, singular: string, plural?: string): string {
  if (n === null) return "—";
  const word = n === 1 ? singular : (plural ?? `${singular}s`);
  return `${n} ${word}`;
}


const TILES: Tile[] = [
  {
    slug: "structure", title: "Structure",
    body: "Organize entities, ownership and hierarchy.",
    href: "/dashboard/structure", icon: Network, tone: "sky",
    activity: "structure_management",
    count: (c) => fmtCount(c.structures, "structure"),
  },
  {
    slug: "accounting", title: "Accounting",
    body: "Manage books, transactions and financials.",
    href: "/dashboard/accounting", icon: BookOpen, tone: "emerald",
    activity: "accounting_finance",
    count: (c) => fmtCount(c.entities, "entity", "entities"),
  },
  {
    slug: "travel", title: "Travel Expense Management",
    body: "Manage travel, claims and reimbursements.",
    href: "/dashboard/travel", icon: Plane, tone: "amber",
    activity: "travel_expense",
    count: (c) => fmtCount(c.openClaims, "open claim"),
  },
  {
    slug: "employment", title: "Employment",
    body: "Manage employees, roles and onboarding.",
    href: "/dashboard/employment", icon: Users, tone: "rose",
    activity: "employment",
    count: (c) => fmtCount(c.employees, "employee"),
  },
  {
    slug: "documents", title: "Documents",
    body: "Centralize, store and manage documents.",
    href: "/dashboard/documents", icon: FolderOpen, tone: "indigo",
    activity: "document_management",
    count: (c) => fmtCount(c.documents, "document"),
  },
  {
    slug: "wealth", title: "Wealth Management",
    body: "Track portfolios, holdings and performance.",
    href: "/dashboard/wealth", icon: LineChart, tone: "violet",
    activity: "wealth_oversight",
    count: (c) => fmtCount(c.portfolios, "portfolio"),
  },
  {
    slug: "dashboard", title: "Dashboard",
    body: "View insights, KPIs and performance overview.",
    href: "/dashboard/overview", icon: BarChart3, tone: "cyan",
    count: () => "Insights & KPIs",
  },
  {
    slug: "settings", title: "Settings",
    body: "Configure preferences, access and integrations.",
    href: "/dashboard/settings", icon: SettingsIcon, tone: "slate",
    count: () => "Security enabled",
  },
];


// ── Getting Started steps ───────────────────────────────────────────


type StepStatus = "completed" | "in_progress" | "pending";


interface Step {
  name: string;
  activity: ActivitySlug;
  status: (c: Counts, activities: ActivitySlug[]) => StepStatus;
}


function stepState(
  hasData: boolean, activitySelected: boolean,
): StepStatus {
  if (hasData) return "completed";
  if (activitySelected) return "in_progress";
  return "pending";
}


const STEPS: Step[] = [
  { name: "Structure", activity: "structure_management",
    status: (c, a) => stepState((c.entities ?? 0) > 0, a.includes("structure_management")) },
  { name: "Accounting", activity: "accounting_finance",
    status: (c, a) => stepState((c.accounts ?? 0) > 0, a.includes("accounting_finance")) },
  { name: "Travel Expense Management", activity: "travel_expense",
    status: (c, a) => stepState((c.totalClaims ?? 0) > 0, a.includes("travel_expense")) },
  { name: "Employment", activity: "employment",
    status: (c, a) => stepState((c.employees ?? 0) > 0, a.includes("employment")) },
];


// ── Recommended Next Steps card ─────────────────────────────────────


interface NextStep {
  key: string;
  title: string;
  body: string;
  href: string;
  tone: TileTone;
  icon: React.ComponentType<{ className?: string }>;
  done: (c: Counts) => boolean;
}


const NEXT_STEPS: NextStep[] = [
  { key: "structure",
    title: "Complete structure setup",
    body: "Define your entities and hierarchy.",
    href: "/dashboard/structure",
    tone: "sky", icon: Network,
    done: (c) => (c.entities ?? 0) > 0 },
  { key: "chart",
    title: "Select chart template",
    body: "Choose a chart of accounts.",
    href: "/dashboard/accounting-setup",
    tone: "emerald", icon: BookOpen,
    done: (c) => (c.accounts ?? 0) > 0 },
  { key: "suppliers",
    title: "Add first suppliers",
    body: "Set up vendors and suppliers.",
    href: "/dashboard/vendors",
    tone: "amber", icon: FileText,
    done: () => false },
  { key: "invite",
    title: "Invite team member",
    body: "Collaborate with your team.",
    href: "/dashboard/settings",
    tone: "violet", icon: UserPlus,
    done: () => false },
];


// ── Page ────────────────────────────────────────────────────────────


export default function HomePage() {
  const [activities, setActivities] = useState<ActivitySlug[] | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [beakonCurrency, setBeakonCurrency] = useState<string>("");
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);

  useEffect(() => {
    const orgId = typeof window !== "undefined"
      ? localStorage.getItem("organization_id")
      : null;
    if (!orgId) return;

    void api.get<OrgPayload>(`/organizations/${orgId}/`).then((org) => {
      setActivities((org.selected_activities ?? []) as ActivitySlug[]);
      setOrgName(org.name || "");
      setBeakonCurrency(org.currency || "");
    }).catch(() => setActivities([]));

    // Parallel counts — Promise.allSettled so partial failure still
    // renders a useful Home. Each endpoint returns either a paginated
    // {count, results} or a bare array; asArray() collapses both.
    void Promise.allSettled([
      api.get<ListResult<EntityRow>>("/beakon/entities/"),
      api.get<ListResult<AccountRow>>("/beakon/accounts/"),
      api.get<ListResult<ClaimRow>>("/beakon/trip-claims/"),
      api.get<ListResult<EmployeeRow>>("/beakon/employees/"),
      api.get<ListResult<DocumentRow>>("/beakon/documents/"),
      api.get<ListResult<PortfolioRow>>("/beakon/portfolios/"),
      api.get<ListResult<JERow>>("/beakon/journal-entries/", { status: "pending_approval" }),
    ]).then(([ent, acc, clm, emp, doc, prt, je]) => {
      const entities = ent.status === "fulfilled" ? asArray(ent.value) : [];
      const accounts = acc.status === "fulfilled" ? asArray(acc.value) : [];
      const claims = clm.status === "fulfilled" ? asArray(clm.value) : [];
      const employees = emp.status === "fulfilled" ? asArray(emp.value) : [];
      const documents = doc.status === "fulfilled" ? asArray(doc.value) : [];
      const portfolios = prt.status === "fulfilled" ? asArray(prt.value) : [];
      const pendingJEs = je.status === "fulfilled" ? asArray(je.value) : [];

      const OPEN_STATUSES = new Set(["draft", "submitted", "in_progress", "pending", "pending_approval"]);
      const openClaims = claims.filter(
        (c) => c.status === undefined || OPEN_STATUSES.has(c.status),
      ).length;

      setCounts({
        structures: entities.filter((e) => e.parent === null).length,
        entities: entities.length,
        accounts: accounts.length,
        openTasks: pendingJEs.length,
        aiRecommendations: 0,
        openClaims,
        totalClaims: claims.length,
        employees: employees.length,
        documents: documents.length,
        portfolios: portfolios.length,
      });
    });
  }, []);

  const acts = activities ?? [];
  // Until we know the activity set, show all tiles. Keeps the launcher
  // useful for legacy orgs that pre-date Activity Selection.
  const visibleTiles = TILES.filter((t) =>
    !t.activity || activities === null || acts.includes(t.activity),
  );

  const steps = STEPS.map((s) => ({ ...s, _status: s.status(counts, acts) }));
  const pctComplete = Math.round(
    (steps.filter((s) => s._status === "completed").length / steps.length) * 100,
  );

  const greeting = greetingFor(new Date());

  return (
    <div className="px-1 py-2 sm:px-2 sm:py-4">
      <div className="mx-auto w-full max-w-7xl">
        {/* ── Header row ───────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
              {orgName ? `Home — ${orgName}` : `${greeting}`}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Your getBeakon workspace — start where you need.
            </p>
            {beakonCurrency && (
              <Link
                href={withOrigin("/dashboard/settings/organization", "/dashboard")}
                title="Beakon Currency — your personal view currency for overall reports. Click to change."
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 transition"
              >
                <span className="text-gray-400">Beakon Currency:</span>
                <span className="font-mono text-brand-700">{beakonCurrency}</span>
              </Link>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start">
            <Link
              href="/dashboard/journal-entries"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-brand-800 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create
            </Link>
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 hover:text-gray-900 transition"
            >
              <UserPlus className="h-4 w-4" />
              Invite
            </Link>
          </div>
        </div>

        {/* ── Search / Ask bar ─────────────────────────────────── */}
        <div className="mt-6 group relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search anything or ask getBeakon…"
            className="w-full rounded-xl border border-canvas-200 bg-white py-3 pl-10 pr-12 text-[13.5px] text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <span
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-700 ring-1 ring-brand-100"
            title="Ask Beakon"
            aria-hidden
          >
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>

        {/* ── Stats row ────────────────────────────────────────── */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Structures" value={counts.structures}
            icon={Network} accent="brand" />
          <StatCard label="Entities" value={counts.entities}
            icon={BookOpen} accent="indigo" />
          <StatCard label="Open Tasks" value={counts.openTasks}
            icon={CheckCircle2} accent="mint" />
          <StatCard label="AI Recommendations" value={counts.aiRecommendations}
            icon={Sparkles} accent="violet" />
        </ul>

        {/* ── Main + right rail ───────────────────────────────── */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <GettingStarted steps={steps} pct={pctComplete} />
            <YourModules tiles={visibleTiles} counts={counts} />
          </div>
          <aside className="lg:col-span-1">
            <NextStepsCard counts={counts} />
          </aside>
        </div>

        {activities && activities.length === 0 && (
          <p className="mt-8 text-center text-[12.5px] text-gray-500">
            You haven&apos;t activated any modules yet. The base tiles
            (Dashboard &amp; Settings) are always available.
          </p>
        )}
      </div>
    </div>
  );
}


// ── Stat card ───────────────────────────────────────────────────────


function StatCard({
  label, value, icon: Icon, accent,
}: {
  label: string;
  value: number | null;
  icon: React.ComponentType<{ className?: string }>;
  accent: "brand" | "indigo" | "mint" | "violet";
}) {
  const tone =
    accent === "brand"  ? "bg-brand-50 text-brand-700"   :
    accent === "indigo" ? "bg-indigo-50 text-indigo-700" :
    accent === "mint"   ? "bg-mint-50 text-mint-700"     :
                          "bg-violet-50 text-violet-700";

  return (
    <li className="flex items-center gap-3 rounded-xl border border-canvas-200/70 bg-white p-4">
      <span className={cn(
        "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        tone,
      )}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11.5px] font-medium text-gray-500 truncate">{label}</div>
        <div className="text-[22px] font-semibold text-gray-900 leading-tight tabular-nums">
          {value === null ? "—" : value}
        </div>
      </div>
    </li>
  );
}


// ── Getting Started ─────────────────────────────────────────────────


function GettingStarted({
  steps, pct,
}: { steps: (Step & { _status: StepStatus })[]; pct: number }) {
  return (
    <section className="rounded-xl border border-canvas-200/70 bg-white p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15.5px] font-semibold text-gray-900">Getting Started</h2>
          <p className="mt-0.5 text-[12.5px] text-gray-500">
            Complete the essential steps to set up your workspace.
          </p>
        </div>
        <span className="shrink-0 text-[12px] font-semibold text-brand-700 tabular-nums">
          {pct}% complete
        </span>
      </div>

      <ol className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-0">
        {steps.map((s, i) => (
          <Step key={s.name}
            name={s.name}
            status={s._status}
            isFirst={i === 0}
            isLast={i === steps.length - 1} />
        ))}
      </ol>
    </section>
  );
}


function Step({
  name, status, isFirst, isLast,
}: { name: string; status: StepStatus; isFirst: boolean; isLast: boolean }) {
  const dot =
    status === "completed"
      ? "bg-brand-600 text-white ring-brand-100"
      : status === "in_progress"
        ? "bg-white text-brand-700 ring-brand-200 outline outline-2 outline-brand-200 outline-offset-2"
        : "bg-white text-gray-300 ring-canvas-200";

  const label =
    status === "completed"  ? <span className="text-mint-700">Completed</span> :
    status === "in_progress" ? <span className="text-brand-700">In progress</span> :
                               <span className="text-gray-400">Pending</span>;

  // Connector line color reflects step status (filled if completed).
  const lineLeft  = !isFirst && (status === "completed" || status === "in_progress");
  const lineRight = !isLast  && status === "completed";

  return (
    <li className="relative flex flex-col items-center text-center px-1">
      <div className="relative w-full flex items-center justify-center h-8">
        {/* connectors */}
        <span className={cn(
          "absolute left-0 right-1/2 top-1/2 -translate-y-1/2 h-px",
          lineLeft ? "bg-brand-300" : "bg-canvas-200",
          isFirst && "hidden sm:invisible",
        )} aria-hidden />
        <span className={cn(
          "absolute right-0 left-1/2 top-1/2 -translate-y-1/2 h-px",
          lineRight ? "bg-brand-300" : "bg-canvas-200",
          isLast && "hidden sm:invisible",
        )} aria-hidden />
        <span className={cn(
          "relative inline-flex h-6 w-6 items-center justify-center rounded-full ring-4",
          dot,
        )}>
          {status === "completed" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-current" />
          )}
        </span>
      </div>
      <div className="mt-3 text-[12.5px] font-semibold text-gray-900 leading-snug">{name}</div>
      <div className="text-[11.5px] mt-0.5">{label}</div>
    </li>
  );
}


// ── Your Modules ───────────────────────────────────────────────────


function YourModules({
  tiles, counts,
}: {
  tiles: Tile[];
  counts: Counts;
}) {
  return (
    <section>
      <h2 className="text-[13px] font-semibold text-gray-900 mb-3">Your Modules</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.slug}>
            <ModuleTile tile={t} count={t.count(counts)} />
          </li>
        ))}
      </ul>
    </section>
  );
}


function ModuleTile({ tile, count }: { tile: Tile; count: string }) {
  const Icon = tile.icon;
  const tone = TILE_TONES[tile.tone];
  return (
    <Link
      href={tile.href}
      className="group relative flex h-full flex-col rounded-xl border border-canvas-200/70 bg-white p-4 transition hover:border-canvas-300 hover:shadow-[0_2px_8px_-2px_rgba(15,23,42,0.06)]"
    >
      <div className="flex items-start gap-3">
        <span className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tone.well,
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-gray-900">{tile.title}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-gray-500">{tile.body}</p>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-canvas-100 flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-gray-500">{count}</span>
        <ArrowRight className={cn(
          "h-3.5 w-3.5 text-gray-300 transition group-hover:translate-x-0.5",
          tone.arrow,
        )} />
      </div>
    </Link>
  );
}


// ── Recommended Next Steps ────────────────────────────────────────


function NextStepsCard({ counts }: { counts: Counts }) {
  return (
    <section className="rounded-xl border border-canvas-200/70 bg-white p-5 sticky top-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-mint-50 text-mint-700">
          <Flag className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-[14px] font-semibold text-gray-900">Recommended Next Steps</h2>
      </div>

      <ul className="space-y-1">
        {NEXT_STEPS.map((s) => {
          const done = s.done(counts);
          const tone = TILE_TONES[s.tone];
          const StepIcon = s.icon;
          return (
            <li key={s.key}>
              <Link
                href={s.href}
                className={cn(
                  "group flex items-start gap-3 rounded-lg p-2 -mx-2 transition",
                  done
                    ? "text-gray-500"
                    : "hover:bg-canvas-50 text-gray-900",
                )}
              >
                <span className={cn(
                  "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  done
                    ? "bg-mint-50 text-mint-700"
                    : tone.well,
                )}>
                  {done
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : <StepIcon className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn(
                    "text-[12.5px] font-semibold leading-tight",
                    done && "line-through decoration-mint-300/70",
                  )}>
                    {s.title}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-gray-500 leading-relaxed">
                    {s.body}
                  </div>
                </div>
                <ArrowRight className={cn(
                  "mt-1 h-3.5 w-3.5 text-gray-300 transition opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5",
                  tone.arrow,
                )} />
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href="/dashboard/overview"
        className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800 transition-colors"
      >
        View all tasks
        <ArrowRight className="h-3 w-3" />
      </Link>
    </section>
  );
}


// ── helpers ────────────────────────────────────────────────────────


function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
