"use client";

/* "Choose your plan" — the page that opens after a visitor clicks
 * "Create Workspace" on the Stage 0 entry screen.
 *
 * Per the UI philosophy doc (2026-05-10):
 *   - Calm, premium, intentional pacing — never ERP-y
 *   - The plan choice should feel like the start of "building your
 *     organization digitally", not a pricing wall
 *
 * Design intent vs. /pricing:
 *   /pricing = comprehensive marketing page (Tiers + Assist + Partner
 *              tiers + Bexio comparison + FAQ). Reachable from the
 *              marketing landing for cold prospects researching cost.
 *   /get-started = focused plan picker for committed visitors who
 *              already clicked "Create Workspace". Just the four
 *              SaaS tiers, each leading directly into /register.
 *              Lighter visual weight, calm onboarding energy.
 *
 * Each plan card links to /register?plan=<slug>; the register page
 * already reads the param and the existing /setup wizard carries it
 * through to the trial activation.
 */
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight, BarChart3, Briefcase, Check, Landmark, Rocket, Sparkles,
} from "lucide-react";
import Logo from "@/components/logo";
import WorkflowBack from "@/components/workflow-back";


interface Plan {
  slug: string;
  name: string;
  price: string;
  cadence?: string;
  audience: string;
  icon: React.ComponentType<{ className?: string }>;
  features: string[];
  popular?: boolean;
  cta: { label: string; href: string };
}


const PLANS: Plan[] = [
  {
    slug: "starter",
    name: "Starter",
    price: "CHF 79",
    cadence: "/ month",
    audience: "Single company",
    icon: Rocket,
    features: [
      "1 entity",
      "AI transaction classification",
      "Bank reconciliation",
      "Swiss VAT-ready",
      "P&L + balance sheet",
    ],
    cta: { label: "Start 30-day trial", href: "/register?plan=starter" },
  },
  {
    slug: "professional",
    name: "Professional",
    price: "CHF 199",
    cadence: "/ month",
    audience: "Up to 5 entities",
    icon: BarChart3,
    features: [
      "Up to 5 entities",
      "Intercompany detection",
      "Multi-currency",
      "Advanced AI validation",
      "Priority support",
    ],
    popular: true,
    cta: { label: "Start 30-day trial", href: "/register?plan=professional" },
  },
  {
    slug: "family",
    name: "Family Office",
    price: "CHF 490",
    cadence: "/ month",
    audience: "Multi-entity / complex",
    icon: Landmark,
    features: [
      "Unlimited entities",
      "Full intercompany automation",
      "Consolidation-ready data",
      "Investment tracking",
      "Cross-entity dashboards",
    ],
    cta: { label: "Start 30-day trial", href: "/register?plan=family" },
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    price: "Custom",
    audience: "Firms &amp; platforms",
    icon: Briefcase,
    features: [
      "Unlimited users / entities",
      "Client management layer",
      "API access",
      "White-label option",
      "Dedicated SLA",
    ],
    cta: { label: "Book a call", href: "/contact?plan=enterprise" },
  },
];


export default function GetStartedPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas-50">
      {/* Soft ambient gradient — same vocabulary as Stage 0. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(70%_50%_at_15%_-10%,rgba(58,168,136,0.10),transparent_60%),radial-gradient(60%_45%_at_100%_100%,rgba(35,79,96,0.08),transparent_60%)]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 sm:py-14">
        {/* Top bar — logo + Back to entry */}
        <div className="flex items-center justify-between gap-4">
          <Logo variant="horizontal" size={32} />
          <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
            <WorkflowBack fallbackHref="/" fallbackLabel="entry" />
          </Suspense>
        </div>

        {/* Welcome — Stage 1 wording, condensed */}
        <div className="mt-12 sm:mt-16 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700 ring-1 ring-brand-100">
            <Sparkles className="h-3 w-3" />
            Step 1 of 5 · Pick a plan
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900 sm:text-[40px] sm:leading-[1.1]">
            Let&apos;s build your{" "}
            <span className="italic font-normal text-brand-700">workspace</span>.
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-gray-600 sm:text-[16px]">
            The intelligent operating system for structures, accounting,
            and organizational management. Pick a plan to start your
            <strong className="font-semibold text-gray-800"> 30-day trial</strong>
            {" "}— no credit card needed, change plan anytime.
          </p>
        </div>

        {/* Plan picker — calm grid, no hard sell */}
        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <li key={plan.slug}>
              <PlanCard plan={plan} />
            </li>
          ))}
        </ul>

        {/* Footer reassurances */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-canvas-200 pt-6 text-[12px] text-gray-500">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <Reassurance>30-day trial</Reassurance>
            <Reassurance>No credit card</Reassurance>
            <Reassurance>Hosted in Switzerland</Reassurance>
            <Reassurance>Swiss-VAT &amp; ELM-ready</Reassurance>
          </div>
          <Link
            href="/pricing"
            className="text-gray-500 hover:text-brand-700 hover:underline"
          >
            See full pricing &amp; partner tiers →
          </Link>
        </div>
      </div>
    </main>
  );
}


function PlanCard({ plan }: { plan: Plan }) {
  const Icon = plan.icon;
  return (
    <div
      className={
        "relative flex h-full flex-col rounded-2xl bg-white p-5 transition " +
        (plan.popular
          ? "border-2 border-brand-300 shadow-[0_18px_40px_-18px_rgba(35,79,96,0.25)]"
          : "border border-canvas-200/80 hover:border-brand-200 hover:shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]")
      }
    >
      {plan.popular && (
        <span className="absolute -top-2.5 left-5 rounded-full bg-brand-600 px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-white">
          Recommended
        </span>
      )}

      <div className="flex items-start justify-between">
        <div
          className={
            "inline-flex h-9 w-9 items-center justify-center rounded-xl " +
            (plan.popular
              ? "bg-brand-50 text-brand-700"
              : "bg-canvas-100 text-gray-600")
          }
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-4 text-[15px] font-semibold tracking-tight text-gray-900">
        {plan.name}
      </div>
      <div className="mt-0.5 text-[12px] text-gray-500"
           dangerouslySetInnerHTML={{ __html: plan.audience }} />

      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-[28px] font-semibold tracking-tight text-gray-900 leading-none">
          {plan.price}
        </span>
        {plan.cadence && (
          <span className="text-[12px] text-gray-500">{plan.cadence}</span>
        )}
      </div>

      <ul className="mt-5 space-y-1.5 border-t border-canvas-100 pt-4 text-[12.5px] text-gray-700">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-1.5 leading-snug">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href={plan.cta.href}
        className={
          "mt-5 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition " +
          (plan.popular
            ? "bg-brand-600 text-white hover:bg-brand-700"
            : "bg-canvas-100 text-gray-800 hover:bg-canvas-200")
        }
      >
        {plan.cta.label}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}


function Reassurance({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="h-3 w-3 text-mint-600" />
      {children}
    </span>
  );
}
