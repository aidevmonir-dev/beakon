"use client";

/* Home — operational workspace launcher (Phase 1).
 *
 * Per the UI philosophy doc (2026-05-10): the home screen is NOT a
 * dashboard. It is the launcher that opens into the modules the client
 * activated during onboarding.
 *
 * Tile order follows the client onboarding journey:
 *   1. Structure         — gated by `structure_management`
 *   2. Accounting        — gated by `accounting_finance`
 *   3. Travel Expense    — gated by `travel_expense`
 *   4. Employment        — gated by `employment`
 *   5. Documents         — gated by `document_management`
 *   6. Wealth Management — gated by `wealth_oversight`
 *   7. Dashboard         — always visible (workspace metrics)
 *   8. Settings          — always visible
 *
 * The customizable Digits-style widget dashboard moved to
 * /dashboard/overview, behind the "Dashboard" tile.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight, Building2, FileText, Plane, Settings as SettingsIcon,
  Sparkles, TrendingUp, Users, Wallet, Workflow,
} from "lucide-react";
import { api } from "@/lib/api";
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


interface Tile {
  slug: string;
  title: string;
  body: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** If set, only render when this activity is in `selected_activities`. */
  activity?: ActivitySlug;
  accent?: "brand" | "mint" | "neutral";
}


const TILES: Tile[] = [
  {
    slug: "structure",
    title: "Structure",
    body: "Entities, ownership and the relationships between them.",
    href: "/dashboard/structure",
    icon: Building2,
    activity: "structure_management",
    accent: "brand",
  },
  {
    slug: "accounting",
    title: "Accounting",
    body: "Books, journal entries, ledger and period close.",
    href: "/dashboard/journal-entries",
    icon: TrendingUp,
    activity: "accounting_finance",
    accent: "brand",
  },
  {
    slug: "travel",
    title: "Travel Expense",
    body: "Trips, claims, receipts, approvals and reimbursements.",
    href: "/dashboard/travel",
    icon: Plane,
    activity: "travel_expense",
    accent: "mint",
  },
  {
    slug: "employment",
    title: "Employment",
    body: "Employees, contracts and payroll feeds.",
    href: "/dashboard/employment",
    icon: Users,
    activity: "employment",
    accent: "mint",
  },
  {
    slug: "documents",
    title: "Documents",
    body: "Contracts, statements and supporting evidence.",
    href: "/dashboard/documents",
    icon: FileText,
    activity: "document_management",
    accent: "mint",
  },
  {
    slug: "wealth",
    title: "Wealth Management",
    body: "Portfolios, custodian feeds and consolidated performance.",
    href: "/dashboard/bank-feed",
    icon: Wallet,
    activity: "wealth_oversight",
    accent: "brand",
  },
  {
    slug: "dashboard",
    title: "Dashboard",
    body: "Today's cash position, approvals queue and headline KPIs.",
    href: "/dashboard/overview",
    icon: Workflow,
    accent: "neutral",
  },
  {
    slug: "settings",
    title: "Settings",
    body: "Currencies, taxes, dimensions, audit log and team.",
    href: "/dashboard/settings",
    icon: SettingsIcon,
    accent: "neutral",
  },
];


export default function HomePage() {
  const [activities, setActivities] = useState<ActivitySlug[] | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [beakonCurrency, setBeakonCurrency] = useState<string>("");

  useEffect(() => {
    const orgId = typeof window !== "undefined"
      ? localStorage.getItem("organization_id")
      : null;
    if (!orgId) return;
    api.get<OrgPayload>(`/organizations/${orgId}/`)
      .then((org) => {
        setActivities((org.selected_activities ?? []) as ActivitySlug[]);
        setOrgName(org.name || "");
        setBeakonCurrency(org.currency || "");
      })
      .catch(() => setActivities([]));
  }, []);

  // Until we know the activity set, show all tiles. This keeps the
  // launcher useful for legacy orgs that pre-date Activity Selection.
  const visible = TILES.filter((t) =>
    !t.activity || activities === null || activities.includes(t.activity),
  );

  const greeting = greetingFor(new Date());

  return (
    <div className="-m-3 sm:-m-5 min-h-[calc(100vh-7rem)] bg-gradient-to-b from-canvas-100 via-canvas-50 to-white px-3 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 sm:mb-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-brand-100">
              <Sparkles className="h-3 w-3" />
              {orgName ? `${orgName} workspace` : "Your workspace"}
            </span>
            {beakonCurrency && (
              <Link
                href={withOrigin("/dashboard/settings/organization", "/dashboard")}
                title="Beakon Currency — your personal view currency for overall reports. Click to change."
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 transition"
              >
                <span className="text-gray-400">Beakon Currency:</span>
                <span className="font-mono text-brand-700">{beakonCurrency}</span>
              </Link>
            )}
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-[-0.01em] text-gray-900">
            {greeting}.
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Open a module to start working — or add more from Settings later.
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((tile) => (
            <li key={tile.slug}>
              <TileCard tile={tile} />
            </li>
          ))}
        </ul>

        {activities && activities.length === 0 && (
          <p className="mt-8 text-center text-[12.5px] text-gray-500">
            You haven't activated any modules yet. The base tiles
            (Dashboard &amp; Settings) are always available.
          </p>
        )}
      </div>
    </div>
  );
}


function TileCard({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  const accent =
    tile.accent === "brand"
      ? { ring: "ring-brand-100", well: "bg-brand-50 text-brand-700", arrow: "text-brand-700" }
      : tile.accent === "mint"
        ? { ring: "ring-mint-100", well: "bg-mint-50 text-mint-700", arrow: "text-mint-700" }
        : { ring: "ring-canvas-200", well: "bg-canvas-100 text-gray-600", arrow: "text-gray-700" };

  return (
    <Link
      href={tile.href}
      className={
        "group relative flex h-full flex-col rounded-2xl border border-canvas-200/70 bg-white p-5 ring-1 transition " +
        accent.ring +
        " hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]"
      }
    >
      <div className={"mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl " + accent.well}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-[15px] font-semibold text-gray-900">{tile.title}</div>
      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-gray-600">{tile.body}</p>
      <div className={"mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium " + accent.arrow}>
        Open
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}


function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
