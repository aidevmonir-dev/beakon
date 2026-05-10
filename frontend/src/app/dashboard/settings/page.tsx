"use client";

/* Settings hub.
 *
 * The "Settings" tile on the home launcher (per the UI philosophy doc)
 * lands here. It groups the configured-once surfaces (Dimensions, Tax
 * Codes, FX Rates, VAT Report, Audit Log) so they're discoverable from
 * the launcher, not just from the sidebar.
 */
import Link from "next/link";
import {
  ArrowRight, Building2, Calculator, Coins, Compass, Layers, ListTree,
  Percent, PlusCircle, Shield, Tags,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";


interface SettingsItem {
  title: string;
  body: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "configuration" | "reference";
}


const ITEMS: SettingsItem[] = [
  {
    title: "Organization",
    body: "Workspace name, country and your personal Beakon Currency.",
    href: "/dashboard/settings/organization", icon: Building2, group: "configuration",
  },
  {
    title: "Activities",
    body: "Turn modules on or off — they appear on your home screen as tiles.",
    href: "/dashboard/settings/activities", icon: Layers, group: "configuration",
  },
  {
    title: "Accounting Setup",
    body: "Pick a chart template, fiscal year and VAT — per entity.",
    href: "/dashboard/accounting-setup", icon: ListTree, group: "configuration",
  },
  {
    title: "Dimensions",
    body: "All classification axes — financial, operational and reporting.",
    href: "/dashboard/dimensions", icon: Tags, group: "configuration",
  },
  {
    title: "Tax Codes",
    body: "VAT rates and the GL accounts they post to.",
    href: "/dashboard/tax-codes", icon: Percent, group: "configuration",
  },
  {
    title: "FX Rates",
    body: "Live ECB feed — daily fixings + CHF cross-rates.",
    href: "/dashboard/fx-rates", icon: Coins, group: "configuration",
  },
  {
    title: "VAT Report",
    body: "Period summary of input/output VAT by tax code.",
    href: "/dashboard/reports/vat", icon: Calculator, group: "configuration",
  },
  {
    title: "Audit Log",
    body: "Audit trail of every action.",
    href: "/dashboard/audit", icon: Shield, group: "configuration",
  },
  {
    title: "Beakon Tour",
    body: "End-to-end walkthrough of what Beakon does for one entity.",
    href: "/dashboard/tour", icon: Compass, group: "reference",
  },
  {
    title: "New organization",
    body: "Create a new organization (separate books, separate users).",
    href: "/setup", icon: PlusCircle, group: "reference",
  },
];


export default function SettingsHubPage() {
  const configuration = ITEMS.filter((i) => i.group === "configuration");
  const reference = ITEMS.filter((i) => i.group === "reference");

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure your workspace — currencies, taxes, dimensions, audit and team."
      />

      <div className="mt-6 space-y-7">
        <Section title="Configuration" items={configuration} />
        <Section title="Reference" items={reference} />
      </div>

    </div>
  );
}


function Section({ title, items }: { title: string; items: SettingsItem[] }) {
  return (
    <section>
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
        {title}
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.href}>
            <SettingsCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}


function SettingsCard({ item }: { item: SettingsItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="group relative flex h-full flex-col rounded-2xl border border-canvas-200/70 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-100 text-gray-600">
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-[14px] font-semibold text-gray-900">{item.title}</div>
      <p className="mt-1 flex-1 text-[12.5px] leading-relaxed text-gray-600">{item.body}</p>
      <div className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-gray-700">
        Open
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
