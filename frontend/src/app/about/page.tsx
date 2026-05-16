"use client";

/* Public marketing landing — moved from root after the UI philosophy
 * doc (2026-05-10) made `/` the Stage 0 minimal entry. Reachable via
 * the "Learn more about Beakon" link on the entry screen, the
 * marketing nav, and direct visits.
 *
 * No auth redirect here — logged-in users can browse this page just
 * as well as anonymous visitors.
 */
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Check,
  ChevronRight,
  Landmark,
  LayoutGrid,
  Lock,
  Network,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import Logo from "@/components/logo";

export default function AboutPage() {
  return (
    <div className="bg-brand-950 text-white">
      <PublicHeader />
      <Hero />
      <TrustStrip />
      <CapabilitiesSection />
      <ProcessSection />
      <OutcomesSection />
      <PricingTeaser />
      <ClosingCTA />
      <SiteFooter />
    </div>
  );
}

/* ────────────────────────── HEADER ────────────────────────── */

function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-brand-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center" aria-label="Beakon">
          <Logo
            variant="horizontal"
            size={34}
            colors={{ text: "#ffffff" }}
          />
        </Link>
        <nav className="hidden items-center gap-9 text-[13.5px] text-white/70 md:flex">
          <a href="#capabilities" className="transition hover:text-white">Product</a>
          <Link href="/pricing" className="transition hover:text-white">Pricing</Link>
          <a href="#trust" className="transition hover:text-white">Trust</a>
          <Link href="/contact" className="transition hover:text-white">Contact</Link>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-white/80 transition hover:text-white sm:inline-flex"
          >
            Get started
          </Link>
          <Link
            href="/register"
            className="group inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-950 transition hover:bg-mint-200"
          >
            Start free trial
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ────────────────────────── HERO ────────────────────────── */

function Hero() {
  return (
    <section className="relative isolate overflow-hidden hero-mesh grain-overlay">
      <div className="absolute inset-0 dot-grid opacity-50" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-32 h-[40rem] w-[40rem] rounded-full bg-mint-400/20 blur-3xl float-slow"
      />
      <div className="relative mx-auto max-w-7xl px-6 pb-28 pt-24 sm:px-10 sm:pt-32 lg:pb-36">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
          <div>
            <p
              className="inline-flex items-center gap-2 rounded-full border border-mint-400/30 bg-mint-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-mint-200 reveal"
              style={{ animationDelay: "60ms" }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-mint-400 opacity-75 pulse-soft" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint-300" />
              </span>
              AI for Fiduciary Excellence
            </p>

            <h1
              className="mt-7 text-[clamp(2.4rem,5.4vw,4.8rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-white reveal"
              style={{ animationDelay: "180ms" }}
            >
              The AI Operating System
              <br />
              <span className="text-mint-400">for Fiduciary Excellence</span>
            </h1>

            <p
              className="mt-7 max-w-xl text-base leading-[1.65] text-white/70 sm:text-[17px] reveal"
              style={{ animationDelay: "320ms" }}
            >
              Beakon combines intelligent automation with human expertise to
              help fiduciaries scale profitably, reduce costs and deliver
              exceptional client service.
            </p>

            <div
              className="mt-9 flex flex-wrap items-center gap-3 reveal"
              style={{ animationDelay: "440ms" }}
            >
              <Link
                href="/"
                className="group inline-flex items-center gap-2 rounded-full bg-mint-500 px-5 py-3 text-sm font-semibold text-brand-950 shadow-[0_10px_40px_-10px_rgba(58,168,136,0.6)] transition hover:bg-mint-400"
              >
                Get started
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/pricing"
                className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white backdrop-blur transition hover:border-white/30 hover:bg-white/10"
              >
                View pricing
                <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
            </div>

            <ul
              className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-[12.5px] text-white/55 reveal"
              style={{ animationDelay: "560ms" }}
            >
              {[
                "Hosted in Switzerland",
                "Multi-entity / intercompany",
                "Swiss-VAT & ELM-ready",
                "Bank-level security",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-mint-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div
            className="relative reveal"
            style={{ animationDelay: "260ms" }}
          >
            <ProductPreview />
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-paper-50/0" />
    </section>
  );
}

/* ────────────────────── PRODUCT PREVIEW (mock dashboard) ────────────────────── */

function ProductPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-mint-400/20 to-transparent blur-2xl" />
      <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-1 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="rounded-[1.4rem] border border-white/10 bg-brand-950/80">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            </div>
            <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-[10.5px] text-white/40">
              <Lock className="h-3 w-3" />
              app.getbeakon.com / operations
            </div>
            <div className="w-12" />
          </div>

          <div className="grid grid-cols-[140px_1fr] gap-0">
            <aside className="border-r border-white/5 px-3 py-4">
              <div className="mb-4 flex items-center gap-2 px-1">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-700 text-[12px] font-bold text-white">
                  B
                </span>
                <span className="text-[12px] font-semibold tracking-tight text-white/80">
                  Beakon
                </span>
              </div>
              <ul className="space-y-1 text-[11.5px] text-white/55">
                {[
                  ["Dashboard", LayoutGrid, true],
                  ["Tasks", Workflow, false],
                  ["Clients", Building2, false],
                  ["Analytics", BarChart3, false],
                  ["Documents", Briefcase, false],
                  ["Alerts", Bell, false],
                  ["Settings", ShieldCheck, false],
                ].map(([label, Icon, active]) => {
                  const I = Icon as typeof LayoutGrid;
                  const isActive = active as boolean;
                  return (
                    <li
                      key={label as string}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                        isActive ? "bg-white/8 text-white" : "hover:text-white/80"
                      }`}
                    >
                      <I className="h-3.5 w-3.5" />
                      {label as string}
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-white/50">
                  Operations Overview
                </span>
                <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-[10px] font-semibold text-mint-300">
                  Live
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { k: "Clients", v: "128", d: "+12 mo", up: true },
                  { k: "Tasks", v: "342", d: "12 review", up: true },
                  { k: "Excptns", v: "18", d: "Attn.", up: false },
                  { k: "SLA", v: "96%", d: "Met", up: true },
                ].map((t) => (
                  <div
                    key={t.k}
                    className="rounded-xl border border-white/5 bg-white/[0.03] p-2.5"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-white/45">
                      {t.k}
                    </div>
                    <div className="mt-0.5 font-display text-[19px] font-medium tracking-tight text-white">
                      {t.v}
                    </div>
                    <div
                      className={`text-[10px] ${
                        t.up ? "text-mint-300" : "text-amber-300"
                      }`}
                    >
                      {t.d}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3.5 rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-white/70">
                    Daily Task Queue
                  </span>
                  <span className="text-[10px] text-white/35">Today</span>
                </div>
                <ul className="space-y-1.5 text-[11px] text-white/65">
                  {[
                    ["Bank Statement Review", 92, 24],
                    ["Invoice Processing", 68, 68],
                    ["Transaction Matching", 100, 112],
                    ["Journal Entries", 54, 48],
                  ].map(([label, pct, count]) => (
                    <li
                      key={label as string}
                      className="flex items-center gap-2"
                    >
                      <span className="w-32 truncate">{label as string}</span>
                      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-mint-500 to-mint-300"
                          style={{ width: `${pct as number}%` }}
                        />
                      </span>
                      <span className="w-7 text-right tabular-nums text-white/45">
                        {count as number}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-[10.5px]">
                {[
                  ["Missing Documents", "5", "amber"],
                  ["Unusual Transactions", "6", "rose"],
                  ["Approvals Pending", "3", "mint"],
                ].map(([k, v, tone]) => (
                  <div
                    key={k as string}
                    className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5"
                  >
                    <span className="text-white/60">{k as string}</span>
                    <span
                      className={
                        tone === "amber"
                          ? "rounded-full bg-amber-400/15 px-1.5 py-0.5 text-amber-300"
                          : tone === "rose"
                            ? "rounded-full bg-rose-400/15 px-1.5 py-0.5 text-rose-300"
                            : "rounded-full bg-mint-400/15 px-1.5 py-0.5 text-mint-300"
                      }
                    >
                      {v as string}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 -left-6 hidden rotate-[-2deg] rounded-2xl border border-white/10 bg-brand-950/90 p-3 shadow-2xl backdrop-blur sm:block float-slow">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint-500/20 text-mint-300">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="text-[11px]">
            <div className="font-semibold text-white">AI proposed 14 entries</div>
            <div className="text-white/50">Awaiting your review · 2s ago</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── TRUST STRIP ────────────────────────── */

function TrustStrip() {
  const items = [
    "Family Offices",
    "Fiduciary Firms",
    "Multi-entity SMEs",
    "Cross-border Groups",
    "Investment Holdings",
  ];
  return (
    <section
      id="trust"
      className="relative border-y border-white/5 bg-brand-950 py-10"
    >
      <div className="mx-auto max-w-7xl px-6 sm:px-10">
        <p className="text-center text-[11.5px] font-semibold uppercase tracking-[0.32em] text-white/45">
          Built for the people who carry the books
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-12 gap-y-5 text-white/45">
          {items.map((label, i) => (
            <span
              key={label}
              className="font-display text-[19px] italic tracking-tight transition hover:text-white"
            >
              {label}
              {i < items.length - 1 && (
                <span className="ml-12 text-white/15">·</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── CAPABILITIES ────────────────────────── */

const CAPABILITIES = [
  {
    eyebrow: "01 / Classify",
    title: "AI that knows the chart of accounts",
    body: "Beakon proposes entries against your accounting standard, cites the principle behind every choice, and learns from every review you publish.",
    icon: Sparkles,
    points: ["Standard-aware proposals", "Per-entity COA", "Rules engine + AI"],
  },
  {
    eyebrow: "02 / Consolidate",
    title: "Multi-entity, intercompany, multi-currency",
    body: "Cross-entity dashboards, automatic intercompany matching and consolidation-ready data — without months of mapping work.",
    icon: Network,
    points: ["Unlimited entities", "Auto intercompany", "Multi-currency FX"],
  },
  {
    eyebrow: "03 / Oversee",
    title: "Human judgment, where it matters",
    body: "AI handles the heavy lifting, your team approves the close. Every figure is traceable to source, every decision auditable end-to-end.",
    icon: ShieldCheck,
    points: ["Approval workflows", "Full audit trail", "Reviewer comments"],
  },
];

function CapabilitiesSection() {
  return (
    <section
      id="capabilities"
      className="relative overflow-hidden bg-paper-50 text-brand-950"
    >
      <div className="pointer-events-none absolute -top-32 right-0 h-[28rem] w-[28rem] rounded-full bg-mint-500/10 blur-3xl" />
      <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
        <div className="grid items-end gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.28em] text-mint-700">
              Capabilities
            </p>
            <h2 className="mt-4 font-display text-[clamp(2.2rem,4.4vw,3.8rem)] font-light leading-[1.02] tracking-[-0.025em]">
              Accounting that{" "}
              <em className="italic text-mint-700">works ahead of you</em>,
              <br />
              not behind you.
            </h2>
          </div>
          <p className="max-w-xl text-[16.5px] leading-[1.65] text-brand-900/70">
            One operating system that handles classification, consolidation and
            review — built for the structures that traditional bookkeepers
            charge most for, and break most often.
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <article
              key={c.title}
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-paper-200/80 bg-white p-7 transition hover:border-mint-400/60 hover:shadow-[0_30px_60px_-30px_rgba(58,168,136,0.4)]"
            >
              <div className="absolute right-0 top-0 h-32 w-32 -translate-y-12 translate-x-12 rounded-full bg-mint-400/0 blur-2xl transition group-hover:bg-mint-400/30" />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-500">
                    {c.eyebrow}
                  </span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-mint-200 bg-mint-50 text-mint-700">
                    <c.icon className="h-4 w-4" />
                  </span>
                </div>
                <h3 className="mt-6 font-display text-[26px] font-normal leading-[1.1] tracking-[-0.02em] text-brand-950">
                  {c.title}
                </h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-brand-900/65">
                  {c.body}
                </p>
                <ul className="mt-6 space-y-1.5 border-t border-paper-200 pt-5 text-[13px] text-brand-900/70">
                  {c.points.map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-mint-500" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── PROCESS ────────────────────────── */

const PROCESS = [
  {
    n: "01",
    title: "Connect",
    body: "Plug in banks, payroll and existing ledgers. We mirror your actual chart of accounts — not a generic template.",
  },
  {
    n: "02",
    title: "Classify",
    body: "Beakon proposes journal entries against your standard, with the rationale and the rule behind each one cited inline.",
  },
  {
    n: "03",
    title: "Review",
    body: "Approve, edit, or push back. Every approval teaches Beakon how your firm thinks — across every entity you carry.",
  },
  {
    n: "04",
    title: "Report",
    body: "Consolidations, P&Ls, balance sheets and AI commentary, ready when you need them — auditable to source.",
  },
];

function ProcessSection() {
  return (
    <section className="relative bg-brand-950 text-white">
      <div className="absolute inset-0 dot-grid opacity-30" />
      <div className="relative mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
        <div className="max-w-3xl">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.28em] text-mint-300">
            How it works
          </p>
          <h2 className="mt-4 font-display text-[clamp(2.2rem,4.2vw,3.6rem)] font-light leading-[1.02] tracking-[-0.025em]">
            Four moves between{" "}
            <em className="italic text-mint-300">raw bank data</em> and{" "}
            <em className="italic text-mint-300">a defensible close</em>.
          </h2>
        </div>

        <ol className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/5 sm:grid-cols-2 lg:grid-cols-4">
          {PROCESS.map((step) => (
            <li
              key={step.n}
              className="group relative bg-brand-950 p-8 transition hover:bg-brand-900"
            >
              <span className="font-display text-[64px] font-light leading-none tracking-[-0.04em] text-white/12 transition group-hover:text-mint-400/40">
                {step.n}
              </span>
              <h3 className="mt-4 text-[19px] font-semibold tracking-tight text-white">
                {step.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/55">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ────────────────────────── OUTCOMES + QUOTE ────────────────────────── */

function OutcomesSection() {
  const stats = [
    { v: "2×", label: "More clients per staff member" },
    { v: "30–50%", label: "Reduction in time per client" },
    { v: "100%", label: "Audit-traceable to source" },
    { v: "0", label: "Spreadsheets at month-end" },
  ];
  return (
    <section className="relative overflow-hidden bg-paper-50 text-brand-950">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
        <div className="grid gap-16 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <figure className="relative">
            <span className="font-display text-[180px] font-light leading-[0.6] text-mint-700/15 select-none">
              &ldquo;
            </span>
            <blockquote className="-mt-12 max-w-xl font-display text-[clamp(1.6rem,2.6vw,2.4rem)] font-light leading-[1.18] tracking-[-0.015em] text-brand-950">
              We replaced three spreadsheets, two reconciliation tools and a
              monthly &nbsp;crisis with{" "}
              <em className="italic text-mint-700">one system</em> that knows
              our chart of accounts as well as we do.
            </blockquote>
            <figcaption className="mt-7 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-950 text-[13px] font-semibold text-white">
                TA
              </span>
              <div className="text-[13.5px]">
                <div className="font-semibold text-brand-950">
                  Thomas Allina
                </div>
                <div className="text-brand-900/60">
                  Founder, Beakon · former family-office controller
                </div>
              </div>
            </figcaption>
          </figure>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-paper-200/60">
            {stats.map((s) => (
              <div
                key={s.label}
                className="bg-paper-50 p-8 transition hover:bg-white"
              >
                <div className="font-display text-[clamp(2.4rem,4vw,3.2rem)] font-light leading-none tracking-[-0.035em] text-brand-950">
                  {s.v}
                </div>
                <div className="mt-3 text-[13px] leading-snug text-brand-900/65">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── PRICING TEASER ────────────────────────── */

const PRICING_PEEK = [
  {
    name: "Starter",
    price: "CHF 79",
    cadence: "/ mo",
    audience: "Single company",
    icon: Sparkles,
  },
  {
    name: "Professional",
    price: "CHF 199",
    cadence: "/ mo",
    audience: "Up to 5 entities",
    icon: BarChart3,
    popular: true,
  },
  {
    name: "Family Office",
    price: "CHF 490",
    cadence: "/ mo",
    audience: "Unlimited entities",
    icon: Landmark,
  },
  {
    name: "Enterprise",
    price: "Custom",
    audience: "Firms & platforms",
    icon: Briefcase,
  },
];

function PricingTeaser() {
  return (
    <section className="relative bg-brand-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:px-10 sm:py-32">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.28em] text-mint-300">
              Pricing
            </p>
            <h2 className="mt-4 font-display text-[clamp(2.2rem,4.2vw,3.6rem)] font-light leading-[1.02] tracking-[-0.025em]">
              Plans that grow{" "}
              <em className="italic text-mint-300">with the structure</em>,
              not the headcount.
            </h2>
          </div>
          <Link
            href="/pricing"
            className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10"
          >
            See full pricing
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING_PEEK.map((p) => (
            <Link
              href="/pricing"
              key={p.name}
              className={`group relative flex flex-col rounded-2xl border p-6 transition ${
                p.popular
                  ? "border-mint-400/40 bg-gradient-to-br from-mint-500/15 to-transparent"
                  : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
              }`}
            >
              {p.popular && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-mint-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-950">
                  Most Popular
                </span>
              )}
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white/80">
                <p.icon className="h-4 w-4" />
              </span>
              <div className="mt-5 text-[15px] font-semibold tracking-tight text-white">
                {p.name}
              </div>
              <div className="mt-1 text-[12.5px] text-white/55">
                {p.audience}
              </div>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="font-display text-[32px] font-light tracking-[-0.03em] text-white">
                  {p.price}
                </span>
                {p.cadence && (
                  <span className="text-[12.5px] text-white/45">
                    {p.cadence}
                  </span>
                )}
              </div>
              <span className="mt-6 inline-flex items-center gap-1 text-[12px] font-semibold text-mint-300 opacity-0 transition group-hover:opacity-100">
                Compare plans <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── CLOSING CTA ────────────────────────── */

function ClosingCTA() {
  return (
    <section className="relative overflow-hidden bg-paper-50 py-28 text-brand-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-mint-400/30 to-transparent blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-4xl px-6 text-center sm:px-10">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.28em] text-mint-700">
          Ready when you are
        </p>
        <h2 className="mt-5 font-display text-[clamp(2.6rem,5vw,4.6rem)] font-light leading-[1.02] tracking-[-0.03em]">
          Let&apos;s build the future of{" "}
          <em className="italic text-mint-700">fiduciary</em> together.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-[16px] leading-relaxed text-brand-900/65">
          Move your books to an operating system that respects accounting
          correctness — and lets you focus on the judgment calls only your
          team can make.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 rounded-full bg-brand-950 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-brand-950/20 transition hover:bg-brand-900"
          >
            Get started
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
          <a
            href="mailto:hello@getbeakon.com"
            className="inline-flex items-center gap-2 rounded-full border border-brand-950/15 px-6 py-3.5 text-sm font-semibold text-brand-950 transition hover:border-brand-950/30 hover:bg-white"
          >
            Talk to our team
          </a>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── FOOTER ────────────────────────── */

function SiteFooter() {
  const cols = [
    {
      title: "Product",
      links: [
        ["Pricing", "/pricing"],
        ["Get started", "/"],
        ["Sign in", "/login"],
      ],
    },
    {
      title: "Use cases",
      links: [
        ["Family offices", "/pricing"],
        ["Fiduciary firms", "/pricing"],
        ["Multi-entity SMEs", "/pricing"],
      ],
    },
    {
      title: "Trust",
      links: [
        ["Hosted in Switzerland", "#trust"],
        ["Security", "#trust"],
        ["Contact", "/contact"],
      ],
    },
  ];
  return (
    <footer className="bg-brand-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:px-10">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
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
            {cols.map((col) => (
              <div key={col.title}>
                <h6 className="text-[11px] font-bold uppercase tracking-[0.22em] text-mint-300">
                  {col.title}
                </h6>
                <ul className="mt-4 space-y-2.5 text-[13.5px] text-white/65">
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <Link
                        href={href}
                        className="transition hover:text-white"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start gap-4 border-t border-white/10 pt-6 text-[12px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Beakon — Accounting. Reimagined.</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-300" />
            Hosted in Switzerland · Your data, secure.
          </span>
        </div>
      </div>
    </footer>
  );
}
