"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Briefcase,
  Building2,
  Check,
  Globe2,
  Handshake,
  Landmark,
  LineChart,
  Rocket,
  Scale,
  Shield,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import Logo from "@/components/logo";

type Tier = {
  name: string;
  price: string;
  cadence?: string;
  audience: string;
  icon: typeof Rocket;
  features: string[];
  highlight?: boolean;
  cta: { label: string; href: string };
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    price: "CHF 79",
    cadence: "/ month",
    audience: "Single company / simple setup",
    icon: Rocket,
    features: [
      "1 Entity",
      "AI Transaction Classification",
      "Bank Reconciliation",
      "Swiss VAT-Ready Setup",
      "Receipt Scanning",
      "Payroll Data Prep (ELM-Ready)",
      "P&L + Balance Sheet Reports",
    ],
    cta: { label: "Start 30-day trial", href: "/register?plan=starter" },
  },
  {
    name: "Professional",
    price: "CHF 199",
    cadence: "/ month",
    audience: "SMEs / growing structures",
    icon: BarChart3,
    features: [
      "Up to 5 Entities",
      "Intercompany Detection",
      "Advanced AI Validation",
      "Multi-Currency",
      "Payroll Data Prep (ELM-Ready)",
      "Priority Support",
    ],
    highlight: true,
    cta: { label: "Start 30-day trial", href: "/register?plan=professional" },
  },
  {
    name: "Family Office",
    price: "CHF 490",
    cadence: "/ month",
    audience: "Complex / multi-entity structures",
    icon: Landmark,
    features: [
      "Unlimited Entities",
      "Full Intercompany Automation",
      "Consolidation-Ready Data",
      "Investment Tracking",
      "Cross-Entity Dashboards",
      "AI Financial Commentary",
    ],
    cta: { label: "Start 30-day trial", href: "/register?plan=family" },
  },
  {
    name: "Enterprise / Fiduciary",
    price: "Custom",
    audience: "Larger firms / platforms",
    icon: Briefcase,
    features: [
      "Unlimited Users / Entities",
      "Client Management Layer",
      "API Access",
      "White-Label Option",
      "Dedicated SLA",
      "Custom Integrations",
    ],
    cta: { label: "Book a call", href: "/contact?plan=enterprise" },
  },
];

const ASSIST_PLANS = [
  {
    name: "Assist Basic",
    price: "CHF 250 / month",
    bestFor: "Light Support",
    icon: Users,
    includes: [
      "Weekly Transaction Review",
      "AI Output Validation",
      "Basic Error Correction",
      "Email Support",
    ],
  },
  {
    name: "Assist Plus",
    price: "CHF 650 / month",
    bestFor: "Active SMEs",
    icon: Users,
    includes: [
      "Daily Transaction Review",
      "Journal Validation",
      "Exception Handling",
      "Monthly Close & VAT Review Support",
    ],
  },
  {
    name: "Assist Premium",
    price: "CHF 1,800+ / month",
    bestFor: "Family Offices",
    icon: Building2,
    includes: [
      "Dedicated Accountant",
      "Full Bookkeeping Oversight",
      "Intercompany Monitoring",
      "Monthly Reporting Support",
    ],
  },
];

const PARTNER_TIERS = [
  {
    name: "Certified Partner",
    icon: BadgeCheck,
    body: "CHF 1,500–2,500 base / month + CHF 150–300 per client entity.",
  },
  {
    name: "Reference Price",
    icon: Tag,
    body: "CHF 200 per client entity. Priced against accounting work removed, not against Bexio-style software licences.",
  },
  {
    name: "Managed Partner",
    icon: Users,
    body: "Add Accounting Team support at CHF 400–1,000 per client, or use a revenue-share model for high-volume partners.",
  },
  {
    name: "Rule",
    icon: Scale,
    body: "Either the partner pays enough that Beakon wins, or they do not get access.",
  },
];

const STATS = [
  { value: "2×", label: "More clients per staff member", icon: Users },
  { value: "30–50%", label: "Reduction in time per client", icon: LineChart },
  { value: "Higher", label: "Margins and profitability", icon: BarChart3 },
];

const PILLARS = [
  {
    icon: Shield,
    title: "Secure & Compliant",
    body: "Bank-level security, Swiss data standards and full compliance with fiduciary regulations.",
  },
  {
    icon: Sparkles,
    title: "AI + Human Expertise",
    body: "AI handles the heavy lifting. Our people ensure accuracy, judgment and quality.",
  },
  {
    icon: Globe2,
    title: "Built to Scale",
    body: "From 10 to 10,000+ clients. Beakon grows with your firm seamlessly.",
  },
  {
    icon: Handshake,
    title: "Partnership Approach",
    body: "We succeed when you do. Transparent, fair and aligned for long-term growth.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-paper-50 text-brand-950">
      {/* ───────────────────── Header ───────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-brand-950/80 text-white backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-10">
          <Link href="/" className="flex items-center" aria-label="Beakon">
            <Logo
              variant="horizontal"
              size={42}
              colors={{ text: "#ffffff" }}
            />
          </Link>
          <nav className="hidden items-center gap-9 text-[13.5px] text-white/70 md:flex">
            <Link href="/#capabilities" className="transition hover:text-white">Product</Link>
            <Link href="/pricing" className="text-white">Pricing</Link>
            <Link href="/#trust" className="transition hover:text-white">Trust</Link>
            <Link href="/contact" className="transition hover:text-white">Contact</Link>
          </nav>
          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="hidden rounded-full px-4 py-2 text-sm font-medium text-white/80 transition hover:text-white sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="group inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-950 transition hover:bg-mint-200"
            >
              Start free trial <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ───────────────────── Hero ───────────────────── */}
      <section className="relative overflow-hidden hero-mesh grain-overlay text-white">
        <div className="absolute inset-0 dot-grid opacity-40" />
        <div className="relative mx-auto max-w-7xl px-6 pt-20 pb-20 sm:px-10 sm:pt-24 sm:pb-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-mint-400/30 bg-mint-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-mint-200">
            <Sparkles className="h-3.5 w-3.5" /> Pricing
          </p>
          <h1 className="mt-6 max-w-4xl text-[clamp(2.4rem,5.4vw,4.8rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
            The AI Operating System
            <br />
            <span className="text-mint-400">for Fiduciary Excellence</span>
          </h1>
          <p className="mt-7 max-w-2xl text-[17px] leading-[1.65] text-white/70">
            Beakon combines intelligent automation with human expertise to
            help fiduciaries scale profitably, reduce costs and deliver
            exceptional client service.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 rounded-full bg-mint-500 px-5 py-3 text-sm font-semibold text-brand-950 shadow-[0_10px_40px_-10px_rgba(58,168,136,0.6)] transition hover:bg-mint-400"
            >
              Start free trial
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a
              href="mailto:hello@getbeakon.com"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:border-white/40 hover:bg-white/10"
            >
              Talk to our team
            </a>
          </div>
        </div>
      </section>

      {/* ───────────────────── Pricing tiers ───────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pt-14 sm:px-10 sm:pt-16">
        <div className="mb-8 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-mint-700">
            Plans
          </p>
          <h2 className="mt-2.5 font-display text-[clamp(1.85rem,3.2vw,2.4rem)] font-light leading-[1.05] tracking-[-0.02em] text-brand-950">
            Pick the structure{" "}
            <em className="italic text-mint-700">that fits</em>.
          </h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-4">
          {TIERS.map((t) => (
            <TierCard key={t.name} tier={t} />
          ))}
        </div>
      </section>

      {/* ───────────────────── Beakon Assist + Partner Access ───────────────────── */}
      <section className="mx-auto mt-16 max-w-7xl px-6 sm:px-10">
        <div className="mb-8 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-mint-700">
            Add-ons
          </p>
          <h2 className="mt-2.5 font-display text-[clamp(1.85rem,3.2vw,2.4rem)] font-light leading-[1.05] tracking-[-0.02em]">
            Add a team. Or invite{" "}
            <em className="italic text-mint-700">your firm</em>.
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          {/* Beakon Assist */}
          <div className="overflow-hidden rounded-[1.4rem] border border-paper-200 bg-white shadow-[0_24px_50px_-30px_rgba(19,43,55,0.12)]">
            <div className="border-b border-paper-200 bg-brand-950 px-6 py-5 text-white">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-mint-300">
                Beakon Assist
              </span>
              <h3 className="mt-1.5 font-display text-[21px] font-light leading-tight tracking-[-0.02em]">
                Accounting capacity, on tap.
              </h3>
              <p className="mt-1.5 text-[13px] text-white/65">
                Add hands-on accounting hours to any plan.
              </p>
            </div>
            <div className="hidden grid-cols-[1fr_1fr_1.4fr] gap-6 border-b border-paper-200 px-6 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-brand-700/60 md:grid">
              <span>Plan</span>
              <span>Best for</span>
              <span>Includes</span>
            </div>
            <ul className="divide-y divide-paper-200">
              {ASSIST_PLANS.map((p) => (
                <li key={p.name} className="px-6 py-4 md:grid md:grid-cols-[1fr_1fr_1.4fr] md:gap-6">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mint-50 text-mint-700">
                      <p.icon className="h-3.5 w-3.5" />
                    </span>
                    <div>
                      <div className="text-[13.5px] font-semibold text-brand-950">{p.name}</div>
                      <div className="font-display text-[16px] font-medium tracking-[-0.02em] text-brand-900">{p.price}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[13px] text-brand-900/70 md:mt-0">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-700/50 md:hidden">
                      Best for
                    </span>
                    <p>{p.bestFor}</p>
                  </div>
                  <div className="mt-2 text-[13px] text-brand-900/70 md:mt-0">
                    <ul className="space-y-1">
                      {p.includes.map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Fiduciary Partner Access */}
          <div className="overflow-hidden rounded-[1.4rem] border border-paper-200 bg-white shadow-[0_24px_50px_-30px_rgba(19,43,55,0.12)]">
            <div className="border-b border-paper-200 bg-gradient-to-br from-mint-600 to-mint-700 px-6 py-5 text-white">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-mint-100">
                Partner Access
              </span>
              <h3 className="mt-1.5 font-display text-[21px] font-light leading-tight tracking-[-0.02em]">
                For firms running multiple clients.
              </h3>
              <p className="mt-1.5 text-[13px] text-white/85">
                Onboard your book onto Beakon, profitably.
              </p>
            </div>
            <ul className="divide-y divide-paper-200">
              {PARTNER_TIERS.map((row) => (
                <li key={row.name} className="flex items-start gap-3.5 px-6 py-4">
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-mint-50 text-mint-700">
                    <row.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[13.5px] font-semibold text-brand-950">{row.name}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-brand-900/70">{row.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ───────────────────── Outcomes / stats ───────────────────── */}
      <section className="mx-auto mt-16 max-w-7xl px-6 sm:px-10">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-mint-700">
              Outcomes
            </p>
            <h3 className="mt-2.5 font-display text-[clamp(1.85rem,3.2vw,2.4rem)] font-light leading-[1.05] tracking-[-0.025em] text-brand-950">
              More capacity.
              <br />
              <em className="italic text-mint-700">Better margins.</em>
              <br />
              Happier clients.
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-brand-900/65">
              Automation paired with human expertise — scales with you, not
              against you.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[1.4rem] bg-paper-200/70 sm:grid-cols-3">
            {STATS.map((s) => (
              <div key={s.label} className="bg-white p-5 transition hover:bg-paper-50">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-mint-50 text-mint-700">
                  <s.icon className="h-4 w-4" />
                </span>
                <div className="mt-3.5 font-display text-[clamp(1.7rem,3vw,2.3rem)] font-light leading-none tracking-[-0.035em] text-brand-950">
                  {s.value}
                </div>
                <div className="mt-2 text-[12.5px] leading-snug text-brand-900/65">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── Value pillars ───────────────────── */}
      <section className="relative mt-16 overflow-hidden bg-brand-950 py-14 text-white sm:py-16">
        <div className="absolute inset-0 dot-grid opacity-30" />
        <div className="relative mx-auto max-w-7xl px-6 sm:px-10">
          <div className="mb-10 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-mint-300">
              The standard
            </p>
            <h2 className="mt-2.5 font-display text-[clamp(1.85rem,3.2vw,2.4rem)] font-light leading-[1.05] tracking-[-0.025em]">
              How Beakon shows up{" "}
              <em className="italic text-mint-300">for the close</em>.
            </h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map((p) => (
              <div key={p.title}>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-mint-500/15 text-mint-300 ring-1 ring-mint-400/30">
                  <p.icon className="h-4 w-4" />
                </span>
                <h4 className="mt-4 text-[11px] font-bold uppercase tracking-[0.22em] text-mint-300">
                  {p.title}
                </h4>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────────────── Closing CTA ───────────────────── */}
      <section className="relative overflow-hidden bg-paper-50 py-20 text-brand-950">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-mint-400/30 to-transparent blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-4xl px-6 text-center sm:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-mint-700">
            Ready when you are
          </p>
          <h2 className="mt-4 font-display text-[clamp(2rem,4vw,3.2rem)] font-light leading-[1.02] tracking-[-0.03em]">
            Let&apos;s build the future of{" "}
            <em className="italic text-mint-700">fiduciary</em> together.
          </h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2 rounded-full bg-brand-950 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-950/20 transition hover:bg-brand-900"
            >
              Start free trial
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a
              href="mailto:hello@getbeakon.com"
              className="inline-flex items-center gap-2 rounded-full border border-brand-950/15 px-5 py-3 text-sm font-semibold text-brand-950 transition hover:border-brand-950/40 hover:bg-white"
            >
              Talk to our team
            </a>
          </div>
        </div>
      </section>

      {/* ───────────────────── Footer ───────────────────── */}
      <footer className="bg-brand-950 text-white">
        <div className="mx-auto max-w-7xl px-6 py-12 sm:px-10">
          <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
            <div>
              <Logo
                variant="horizontal"
                size={32}
                colors={{ text: "#ffffff" }}
              />
              <p className="mt-5 max-w-md font-display text-[19px] font-light italic leading-snug text-white/70">
                Accounting. Reimagined.
              </p>
              <div className="mt-7 flex items-center gap-3">
                <a
                  href="mailto:hello@getbeakon.com"
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[12.5px] text-white/80 transition hover:border-white/30 hover:bg-white/10"
                >
                  hello@getbeakon.com
                </a>
                <a
                  href="https://www.getbeakon.com"
                  className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[12.5px] text-white/80 transition hover:border-white/30 hover:bg-white/10"
                >
                  www.getbeakon.com
                </a>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
              <div>
                <h6 className="text-[11px] font-bold uppercase tracking-[0.22em] text-mint-300">Product</h6>
                <ul className="mt-4 space-y-2.5 text-[13.5px] text-white/65">
                  <li><Link href="/" className="transition hover:text-white">Home</Link></li>
                  <li><Link href="/pricing" className="transition hover:text-white">Pricing</Link></li>
                  <li><Link href="/login" className="transition hover:text-white">Sign in</Link></li>
                </ul>
              </div>
              <div>
                <h6 className="text-[11px] font-bold uppercase tracking-[0.22em] text-mint-300">Use cases</h6>
                <ul className="mt-4 space-y-2.5 text-[13.5px] text-white/65">
                  <li>Family offices</li>
                  <li>Fiduciary firms</li>
                  <li>Multi-entity SMEs</li>
                </ul>
              </div>
              <div>
                <h6 className="text-[11px] font-bold uppercase tracking-[0.22em] text-mint-300">Trust</h6>
                <ul className="mt-4 space-y-2.5 text-[13.5px] text-white/65">
                  <li>Hosted in Switzerland</li>
                  <li>Bank-level security</li>
                  <li><Link href="/contact" className="transition hover:text-white">Contact</Link></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-start gap-3 border-t border-white/10 pt-5 text-[12px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} Beakon — Accounting. Reimagined.</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1">
              <Shield className="h-3.5 w-3.5 text-mint-300" />
              Hosted in Switzerland · Your data, secure.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ────────────────────── Tier Card ────────────────────── */

function TierCard({ tier }: { tier: Tier }) {
  const Icon = tier.icon;
  if (tier.highlight) {
    return (
      <div className="relative">
        <div className="absolute -top-3 left-6 z-10 rounded-full bg-mint-500 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-950 shadow-lg shadow-mint-500/30">
          Most Popular
        </div>
        <div className="relative h-full rounded-[1.4rem] bg-gradient-to-b from-mint-400 via-mint-500 to-mint-700 p-[1.5px] shadow-[0_24px_50px_-20px_rgba(58,168,136,0.45)]">
          <div className="flex h-full flex-col rounded-[calc(1.4rem-1.5px)] bg-white p-5 sm:p-6">
            <TierHeader name={tier.name} audience={tier.audience} Icon={Icon} accent="mint" />
            <TierPrice price={tier.price} cadence={tier.cadence} />
            <TierFeatures features={tier.features} />
            <Link
              href={tier.cta.href}
              className="group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-950 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand-900"
            >
              {tier.cta.label}
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex h-full flex-col rounded-[1.4rem] border border-paper-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-[0_24px_50px_-30px_rgba(19,43,55,0.18)] sm:p-6">
      <TierHeader name={tier.name} audience={tier.audience} Icon={Icon} accent="brand" />
      <TierPrice price={tier.price} cadence={tier.cadence} />
      <TierFeatures features={tier.features} />
      <Link
        href={tier.cta.href}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-brand-950/15 bg-paper-50 px-4 py-2.5 text-[13px] font-semibold text-brand-950 transition hover:border-brand-950/40 hover:bg-white"
      >
        {tier.cta.label}
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function TierHeader({
  name, audience, Icon, accent,
}: {
  name: string;
  audience: string;
  Icon: typeof Rocket;
  accent: "brand" | "mint";
}) {
  return (
    <>
      <span
        className={
          accent === "mint"
            ? "inline-flex h-10 w-10 items-center justify-center rounded-xl bg-mint-50 text-mint-700 ring-1 ring-mint-200"
            : "inline-flex h-10 w-10 items-center justify-center rounded-xl bg-paper-100 text-brand-700"
        }
      >
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="mt-4 font-display text-[21px] font-light leading-tight tracking-[-0.02em] text-brand-950">{name}</h3>
      <p className="mt-1 text-[12.5px] text-brand-900/55">{audience}</p>
    </>
  );
}

function TierPrice({
  price, cadence,
}: {
  price: string;
  cadence?: string;
}) {
  return (
    <div className="mt-4 flex items-baseline gap-1.5">
      <span className="font-display text-[34px] font-light leading-none tracking-[-0.04em] text-brand-950">
        {price}
      </span>
      {cadence && <span className="text-[12.5px] font-medium text-brand-900/55">{cadence}</span>}
    </div>
  );
}

function TierFeatures({ features }: { features: string[] }) {
  return (
    <ul className="mt-5 space-y-2 border-t border-paper-200 pt-4">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2.5 text-[13px] text-brand-900/80">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}
