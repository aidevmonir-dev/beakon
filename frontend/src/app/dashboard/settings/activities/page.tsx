"use client";

/* Activities — turn modules on or off after onboarding.
 *
 * The launcher (per the UI philosophy doc) filters tiles by the org's
 * `selected_activities`. Stage 4 of /setup tells the user "you can turn
 * more on at any time" — this page is what makes that true.
 *
 * Saving updates `Organization.selected_activities`; the launcher reads
 * the array on next visit, so a freshly-toggled activity appears as a
 * tile immediately on the home screen.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, Briefcase, Building2, Check, FileText,
  Plane, Save, Sparkles, TrendingUp, Users, Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import WorkflowBack from "@/components/workflow-back";


type ActivitySlug =
  | "structure_management"
  | "accounting_finance"
  | "travel_expense"
  | "employment"
  | "wealth_oversight"
  | "document_management";


interface Activity {
  slug: ActivitySlug;
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Where the launcher tile sends the user once activated. Lets us
   *  render a quick "Open" link for already-active modules. */
  href: string;
}


const ACTIVITIES: Activity[] = [
  {
    slug: "structure_management",
    title: "Structure Management",
    body: "Entities, ownership, holdings and the relationships between them.",
    icon: Building2,
    href: "/dashboard/structure",
  },
  {
    slug: "accounting_finance",
    title: "Accounting & Finance",
    body: "Books, ledger, bills, invoices, period close and reporting.",
    icon: TrendingUp,
    href: "/dashboard/journal-entries",
  },
  {
    slug: "travel_expense",
    title: "Travel Expense Management",
    body: "Trips, claims, receipts, approvals and reimbursements.",
    icon: Plane,
    href: "/dashboard/travel",
  },
  {
    slug: "employment",
    title: "Employment",
    body: "Employees, contracts and payroll feeds — the canonical roster.",
    icon: Users,
    href: "/dashboard/employment",
  },
  {
    slug: "wealth_oversight",
    title: "Wealth Oversight",
    body: "Portfolios, custodian feeds, performance and consolidation.",
    icon: Wallet,
    href: "/dashboard/bank-feed",
  },
  {
    slug: "document_management",
    title: "Document Management",
    body: "Contracts, statements, supporting evidence and AI-assisted classification.",
    icon: FileText,
    href: "/dashboard/documents",
  },
];


interface OrgPayload {
  id: number;
  selected_activities: ActivitySlug[];
}


export default function ActivitiesSettingsPage() {
  const [orgId, setOrgId] = useState<number | null>(null);
  const [original, setOriginal] = useState<Set<ActivitySlug>>(new Set());
  const [selected, setSelected] = useState<Set<ActivitySlug>>(new Set());

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const id = typeof window !== "undefined"
      ? localStorage.getItem("organization_id")
      : null;
    if (!id) { setLoading(false); return; }
    api.get<OrgPayload>(`/organizations/${id}/`)
      .then((org) => {
        setOrgId(org.id);
        const slugs = new Set((org.selected_activities ?? []) as ActivitySlug[]);
        setOriginal(new Set(slugs));
        setSelected(slugs);
      })
      .catch(() => setError("Could not load activities."))
      .finally(() => setLoading(false));
  }, []);

  const dirty = useMemo(() => {
    if (original.size !== selected.size) return true;
    for (const s of original) if (!selected.has(s)) return true;
    return false;
  }, [original, selected]);

  const toggle = (slug: ActivitySlug) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    setSavedAt(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !dirty) return;
    setSaving(true); setError("");
    try {
      const payload = { selected_activities: Array.from(selected) };
      await api.patch(`/organizations/${orgId}/`, payload);
      setOriginal(new Set(selected));
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err?.detail || "Failed to save activities.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Activities"
        description="Turn modules on or off. Activated modules appear as tiles on your home screen — turning one off hides its tile but keeps your data."
      />

      <div className="mt-2 mb-4">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref="/dashboard/settings" />
        </Suspense>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[120px] rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse" />
          ))}
        </div>
      ) : (
        <form onSubmit={save}>
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {savedAt && !dirty && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-mint-200 bg-mint-50 p-3 text-xs text-mint-800">
              <Check className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Activities saved. Your home screen tiles update on next visit.</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ACTIVITIES.map((a) => {
              const active = selected.has(a.slug);
              const wasActive = original.has(a.slug);
              const turningOn = active && !wasActive;
              const turningOff = !active && wasActive;
              return (
                <ActivityCard
                  key={a.slug}
                  activity={a}
                  active={active}
                  turningOn={turningOn}
                  turningOff={turningOff}
                  onToggle={() => toggle(a.slug)}
                />
              );
            })}
          </div>

          <p className="mt-5 text-[11.5px] text-gray-500 inline-flex items-center gap-1.5">
            <Briefcase className="h-3 w-3 text-gray-400" />
            Compliance, fiduciary and trustee features only activate later, when
            you turn on regulated activities.
          </p>

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-canvas-100 pt-4">
            {dirty && (
              <span className="text-[12px] text-gray-500">
                {pluralize(diffCount(original, selected), "unsaved change")}
              </span>
            )}
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || !dirty}
            >
              {saving ? "Saving…" : <>Save activities <Save className="w-4 h-4 ml-1.5" /></>}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}


function ActivityCard({
  activity, active, turningOn, turningOff, onToggle,
}: {
  activity: Activity;
  active: boolean;
  turningOn: boolean;
  turningOff: boolean;
  onToggle: () => void;
}) {
  const Icon = activity.icon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "text-left rounded-2xl border p-4 transition-colors",
        active
          ? "border-brand-300 bg-brand-50/30 ring-1 ring-brand-200"
          : "border-canvas-200 bg-white hover:bg-canvas-50",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "shrink-0 h-10 w-10 rounded-xl flex items-center justify-center",
            active ? "bg-brand-100 text-brand-700" : "bg-canvas-100 text-gray-500",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13.5px] font-semibold text-gray-900">{activity.title}</h3>
            {active && !turningOn && !turningOff && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-brand-700">
                <Check className="h-2.5 w-2.5" />
                On
              </span>
            )}
            {turningOn && (
              <span className="inline-flex items-center gap-1 rounded-full bg-mint-100 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-mint-700">
                <Sparkles className="h-2.5 w-2.5" />
                Will turn on
              </span>
            )}
            {turningOff && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-amber-800">
                Will turn off
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-gray-600 leading-relaxed">{activity.body}</p>
          {active && !turningOn && !turningOff && (
            <a
              href={activity.href}
              onClick={(e) => e.stopPropagation()}
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-700 hover:underline"
            >
              Open module
              <ArrowRight className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </button>
  );
}


function diffCount<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  for (const x of a) if (!b.has(x)) n++;
  for (const x of b) if (!a.has(x)) n++;
  return n;
}


function pluralize(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}
