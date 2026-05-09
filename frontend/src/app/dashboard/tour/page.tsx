"use client";

/* Beakon Tour — meeting-ready walkthrough of the platform.
 *
 * Reads live workspace state from /beakon/workbook-implementation/ so
 * every count and sample ID is real, not seeded for a fake demo entity.
 *
 * Structure mirrors the architecture PDF (2026-04-30):
 *   1. Hero with the "Accounting, without the work" tagline + live counts
 *   2. Workbook → DB evidence (primary artefact)
 *   3. The 16-layer architecture mapped to what's live today
 *   4. The four engine builds with their live page links
 *   5. Masters at a glance — every workbook master + row count + sample IDs
 *   6. What's next on the build queue
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight, BookCheck, Building2, Calculator, CalendarCheck,
  CheckCircle2, Coins, Database, FileSpreadsheet, Inbox, Landmark,
  Layers, ListTree, MinusCircle, Network, NotebookPen, Receipt, Repeat,
  Send, Shield, Sparkles, TrendingUp, Workflow,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";


// ── Types ─────────────────────────────────────────────────────────────────

interface ImplTab {
  tab: string;
  type: "data" | "extension";
  model: string;
  db_table: string;
  field_count: number;
  row_count: number;
  sample_ids: string[];
  url: string;
}

interface ImplResponse {
  organization: string;
  workbook: string;
  architecture_pdf: string;
  tabs: ImplTab[];
  totals: {
    tab_count: number;
    data_tabs: number;
    extension_tabs: number;
    total_rows: number;
    fully_loaded_count: number;
  };
}


// ── Page ──────────────────────────────────────────────────────────────────

export default function BeakonTourPage() {
  const [impl, setImpl] = useState<ImplResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<ImplResponse>("/beakon/workbook-implementation/")
      .then(setImpl)
      .catch((e) => setErr(e?.error?.message || e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Beakon Tour"
        description="Live walkthrough of what the platform does today. Every count below is read from your database in real time — no seed data required."
      />

      <HeroCard impl={impl} loading={loading} err={err} />

      <WorkbookEvidenceCard impl={impl} />

      <ArchitectureLayersSection />

      <EngineBuildsSection />

      <MastersAtGlanceSection impl={impl} loading={loading} />

      <PendingCard />

      <p className="mt-10 mb-6 text-center text-[11px] text-gray-400">
        Sources: <em>Beakon Founder Working Paper</em> (17 Apr 2026) ·{" "}
        <em>CoA Workbook v2</em> (17 Apr 2026) ·{" "}
        <em>Beakon Architecture</em> (30 Apr 2026).
      </p>
    </div>
  );
}


// ── Hero ──────────────────────────────────────────────────────────────────

function HeroCard({
  impl, loading, err,
}: { impl: ImplResponse | null; loading: boolean; err: string | null }) {
  return (
    <div className="mt-6 rounded-2xl border border-canvas-200/70 bg-gradient-to-br from-brand-50/70 via-white to-white shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-700 ring-1 ring-inset ring-brand-100">
            <Workflow className="h-3 w-3" />
            16-layer architecture · live status
          </span>
          <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-gray-900 leading-tight">
            Accounting, without the work.
          </h2>
          <p className="mt-1 text-sm text-gray-500 leading-relaxed max-w-xl">
            AI assists. Humans approve. The accounting engine validates. Every workbook tab,
            every dimension, every validation rule Thomas wrote is live in this system —
            and the engine refuses to post a journal entry that violates them.
          </p>
        </div>
        <Link href="/dashboard/blueprint/implementation" className="btn-primary shrink-0 self-start">
          <FileSpreadsheet className="w-4 h-4 mr-1.5" />
          Open Workbook → DB evidence
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroStat
          label="Workbook tabs in DB"
          value={loading ? "—" : `${impl?.totals.data_tabs ?? 0} / 17`}
          sub={impl ? `${impl.totals.fully_loaded_count} loaded with data` : "loading…"}
          accent
        />
        <HeroStat
          label="Total rows"
          value={loading ? "—" : (impl?.totals.total_rows ?? 0).toLocaleString()}
          sub="across every workbook table"
        />
        <HeroStat
          label="Architecture extensions"
          value={loading ? "—" : `${impl?.totals.extension_tabs ?? 0}`}
          sub="Pension · Commitment · Tax · Recognition"
        />
        <HeroStat
          label="Organization"
          value={loading ? "—" : (impl?.organization ?? "—")}
          sub={err ? "could not reach API" : "live workspace"}
        />
      </div>
    </div>
  );
}

function HeroStat({
  label, value, sub, accent,
}: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl px-3.5 py-3 ring-1 ring-inset",
      accent ? "bg-white ring-brand-100" : "bg-white/60 ring-canvas-200/70",
    )}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
        {label}
      </p>
      <p className={cn(
        "mt-1 text-lg font-semibold tracking-tight tabular-nums leading-none",
        accent ? "text-brand-800" : "text-gray-900",
      )}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[10px] text-gray-500">{sub}</p>}
    </div>
  );
}


// ── Workbook → DB evidence shortcut ──────────────────────────────────────

function WorkbookEvidenceCard({ impl }: { impl: ImplResponse | null }) {
  return (
    <Link
      href="/dashboard/blueprint/implementation"
      className="mt-5 group block rounded-2xl border border-mint-200 bg-gradient-to-br from-mint-50/70 via-white to-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] transition-shadow"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 shrink-0 rounded-2xl bg-white ring-1 ring-inset ring-mint-200 flex items-center justify-center">
            <FileSpreadsheet className="h-5 w-5 text-mint-700" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mint-700">
              Primary meeting artefact
            </p>
            <h3 className="mt-0.5 text-base font-semibold tracking-tight text-gray-900">
              Workbook → Database evidence
            </h3>
            <p className="mt-1 text-sm text-gray-600 leading-relaxed max-w-2xl">
              Every tab in <em>{impl?.workbook ?? "the CoA workbook"}</em> mapped to a live
              Django model + Postgres table. Click any row to drill into the actual data.
            </p>
          </div>
        </div>
        {impl && (
          <div className="grid grid-cols-2 gap-2 shrink-0">
            <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-mint-200">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Tabs loaded</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-mint-700">
                {impl.totals.fully_loaded_count} / {impl.totals.tab_count}
              </p>
            </div>
            <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-mint-200">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Total rows</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                {impl.totals.total_rows.toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-mint-700 group-hover:text-mint-800">
        Open evidence page
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}


// ── 16-layer architecture map ────────────────────────────────────────────

type LayerStatus = "live" | "partial" | "roadmap";
interface LayerSpec {
  n: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
  status: LayerStatus;
  link?: string;
  linkLabel?: string;
}

const LAYERS: LayerSpec[] = [
  {
    n: "1",
    title: "Client Experience",
    blurb: "Dashboard cockpit, reporting access, approval inbox.",
    icon: Inbox,
    status: "partial",
    link: "/dashboard",
    linkLabel: "Open dashboard",
  },
  {
    n: "2",
    title: "Data Intake",
    blurb: "Bank CSV import, supplier bills, manual upload.",
    icon: Landmark,
    status: "partial",
    link: "/dashboard/bank",
    linkLabel: "Bank feed",
  },
  {
    n: "3",
    title: "Document Intelligence",
    blurb: "OCR, classification, AI bill drafting from a PDF.",
    icon: NotebookPen,
    status: "partial",
    link: "/dashboard/bills",
    linkLabel: "Bills (try AI draft)",
  },
  {
    n: "4",
    title: "Accounting Engine",
    blurb: "Double-entry validation, period locks, FX, audit trail, VAT, recognition, closing.",
    icon: BookCheck,
    status: "live",
    link: "/dashboard/journal-entries",
    linkLabel: "Journal entries",
  },
  {
    n: "5",
    title: "Chart of Accounts",
    blurb: "Versioned charts, universal mapping layer, source → universal codes.",
    icon: Layers,
    status: "live",
    link: "/dashboard/blueprint/data/coa-definitions",
    linkLabel: "CoA definitions",
  },
  {
    n: "6",
    title: "Dimensions & Multi-Entity",
    blurb: "21 dimensions, hierarchical values, per-entity scoping. Engine refuses bad postings.",
    icon: Network,
    status: "live",
    link: "/dashboard/blueprint/data/dimension-types",
    linkLabel: "Dimensions",
  },
  {
    n: "7",
    title: "AI Assistance",
    blurb: "Bill drafting, anomaly detection, ask-Beakon, narrative reports.",
    icon: Sparkles,
    status: "partial",
    link: "/dashboard/anomalies",
    linkLabel: "Anomalies",
  },
  {
    n: "8",
    title: "Workflow",
    blurb: "Bill / Invoice / JE state machines. Month-end orchestrator pending.",
    icon: Workflow,
    status: "partial",
    link: "/dashboard/approvals",
    linkLabel: "Approval queue",
  },
  {
    n: "9",
    title: "Approval & Human Review",
    blurb: "Four-eyes posting, period locks, change history, rejection reasons.",
    icon: Shield,
    status: "live",
    link: "/dashboard/audit",
    linkLabel: "Audit log",
  },
  {
    n: "10",
    title: "Reporting",
    blurb: "TB, P&L, BS, CF, AR/AP aging, VAT report, account ledger drill-down.",
    icon: TrendingUp,
    status: "live",
    link: "/dashboard/reports",
    linkLabel: "Reports",
  },
  {
    n: "11",
    title: "Budgeting",
    blurb: "Budget setup, variance, forecasting from actuals.",
    icon: Calculator,
    status: "roadmap",
  },
  {
    n: "12",
    title: "Service Delivery",
    blurb: "Software / software+support / fully-managed tiers; user-role catalogue.",
    icon: Building2,
    status: "partial",
  },
  {
    n: "13",
    title: "Integration",
    blurb: "Swiss bank API feeds, ELM/Swissdec, e-signature, portfolio data.",
    icon: Network,
    status: "roadmap",
  },
  {
    n: "14",
    title: "Security",
    blurb: "RBAC, audit logs, HSTS/secure cookies in prod, JWT auth.",
    icon: Shield,
    status: "live",
  },
  {
    n: "15",
    title: "Infrastructure",
    blurb: "Currently Fly.io; AWS Zurich migration on roadmap for Swiss residency.",
    icon: Database,
    status: "partial",
  },
  {
    n: "16",
    title: "AI Infrastructure",
    blurb: "Model routing by task complexity, prompt logging, per-client AI usage.",
    icon: Sparkles,
    status: "roadmap",
  },
];

function ArchitectureLayersSection() {
  const live = LAYERS.filter((l) => l.status === "live").length;
  const partial = LAYERS.filter((l) => l.status === "partial").length;
  const roadmap = LAYERS.filter((l) => l.status === "roadmap").length;
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          The 16-layer architecture
        </h2>
        <p className="text-[11px] text-gray-500">
          <span className="badge-green">●</span> {live} live ·{" "}
          <span className="badge-yellow">●</span> {partial} partial ·{" "}
          <span className="badge-gray">●</span> {roadmap} roadmap
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {LAYERS.map((l) => (
          <LayerCard key={l.n} layer={l} />
        ))}
      </div>
    </section>
  );
}

function LayerCard({ layer }: { layer: LayerSpec }) {
  const Icon = layer.icon;
  const statusBadge = {
    live: <span className="badge-green">Live</span>,
    partial: <span className="badge-yellow">Partial</span>,
    roadmap: <span className="badge-gray">Roadmap</span>,
  }[layer.status];

  const inner = (
    <div className="rounded-xl border border-canvas-200/70 bg-white p-4 h-full hover:shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="h-8 w-8 rounded-lg bg-brand-50 ring-1 ring-inset ring-brand-100 flex items-center justify-center">
          <Icon className="h-4 w-4 text-brand-600" />
        </div>
        {statusBadge}
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
        Layer {layer.n}
      </p>
      <h3 className="text-sm font-semibold text-gray-900 mt-0.5">{layer.title}</h3>
      <p className="text-xs text-gray-600 mt-1.5 leading-snug">{layer.blurb}</p>
      {layer.link && layer.linkLabel && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700">
          {layer.linkLabel}
          <ArrowRight className="h-3 w-3" />
        </p>
      )}
    </div>
  );
  return layer.link ? <Link href={layer.link}>{inner}</Link> : inner;
}


// ── The four engine builds ───────────────────────────────────────────────

interface BuildSpec {
  n: string;
  title: string;
  blurb: string;
  service: string;
  link: string;
  linkLabel: string;
  icon: LucideIcon;
}

const BUILDS: BuildSpec[] = [
  {
    n: "#1",
    title: "Disbursements",
    blurb: "Rebillable cost lines bundle into a draft client invoice. Engine refuses to bill the same line twice.",
    service: "DisbursementService",
    link: "/dashboard/disbursements",
    linkLabel: "Pending rebillables",
    icon: Send,
  },
  {
    n: "#2",
    title: "VAT engine",
    blurb: "Per-line tax codes route Output VAT to the right liability and Input VAT to the right asset. Net = output − input.",
    service: "TaxCode + VATReportService",
    link: "/dashboard/reports/vat",
    linkLabel: "VAT report",
    icon: Calculator,
  },
  {
    n: "#3",
    title: "Closing entries",
    blurb: "Generates the period-close JE: zero every revenue + expense account, offset to Retained Earnings, idempotent.",
    service: "ClosingEntriesService",
    link: "/dashboard/periods",
    linkLabel: "Periods (run close)",
    icon: CalendarCheck,
  },
  {
    n: "#4",
    title: "Recognition rules",
    blurb: "Multi-period prepaid / deferred / accrued allocation. The Nov–Apr $1,000 example from the founder paper.",
    service: "RecognitionRule + RecognitionService",
    link: "/dashboard/recognition",
    linkLabel: "Recognition rules",
    icon: Repeat,
  },
];

function EngineBuildsSection() {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Engine builds shipped
        </h2>
        <p className="text-[11px] text-gray-500">
          Layer 4 (Accounting Engine) extensions from the architecture PDF.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {BUILDS.map((b) => (
          <BuildCard key={b.n} build={b} />
        ))}
      </div>
    </section>
  );
}

function BuildCard({ build }: { build: BuildSpec }) {
  const Icon = build.icon;
  return (
    <Link
      href={build.link}
      className="group block rounded-xl border border-canvas-200/70 bg-white p-4 hover:shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition-shadow"
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-2xl bg-brand-50 ring-1 ring-inset ring-brand-100 flex items-center justify-center">
          <Icon className="h-5 w-5 text-brand-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
              Build {build.n}
            </span>
            <span className="badge-green">Live</span>
          </div>
          <h3 className="mt-0.5 text-sm font-semibold text-gray-900">{build.title}</h3>
          <p className="text-xs text-gray-600 mt-1.5 leading-snug">{build.blurb}</p>
          <p className="mt-2 text-[11px] font-mono text-gray-500">{build.service}</p>
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 group-hover:text-brand-900">
            {build.linkLabel}
            <ArrowRight className="h-3 w-3" />
          </p>
        </div>
      </div>
    </Link>
  );
}


// ── Masters at a glance ──────────────────────────────────────────────────

function MastersAtGlanceSection({
  impl, loading,
}: { impl: ImplResponse | null; loading: boolean }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          Workbook tabs at a glance
        </h2>
        <p className="text-[11px] text-gray-500">
          Live row counts. Click any row to inspect the data.
        </p>
      </div>
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading live counts…</p>
        ) : !impl ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            Could not reach the workbook-implementation endpoint.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                <th className="py-2 px-3 text-left font-medium">Workbook tab</th>
                <th className="py-2 px-3 text-center font-medium">Fields</th>
                <th className="py-2 px-3 text-center font-medium">Rows</th>
                <th className="py-2 px-3 text-center font-medium">Sample IDs</th>
                <th className="py-2 px-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-canvas-100">
              {impl.tabs.map((t) => (
                <tr key={t.db_table} className="hover:bg-canvas-50">
                  <td className="py-2 px-3 font-medium text-gray-900 whitespace-nowrap">
                    {t.tab}
                    {t.type === "extension" && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-blue-700 font-semibold">ext.</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-gray-700">{t.field_count}</td>
                  <td className="py-2 px-3 text-center tabular-nums">
                    {t.row_count > 0 ? (
                      <span className="inline-flex items-center gap-1 font-medium text-mint-700">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t.row_count}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-gray-400">
                        <MinusCircle className="w-3.5 h-3.5" /> 0
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center text-[11px] font-mono text-gray-500">
                    {t.sample_ids.length > 0 ? t.sample_ids.slice(0, 2).join(", ") : "—"}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <Link href={t.url} className="text-xs text-brand-700 hover:underline whitespace-nowrap">
                      View <ArrowRight className="inline w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}


// ── Pending / build queue ────────────────────────────────────────────────

function PendingCard() {
  const pending = [
    { k: "Loan accrual engine",
      v: "Auto-accrue interest by day-count convention on the Loan masters we already store" },
    { k: "Capital-call burndown",
      v: "Post the JE on a capital call and decrement Commitment.unfunded_balance" },
    { k: "Tax-lot disposal P&L",
      v: "Match SELL events to lots via FIFO/LIFO/HIFO + post realised G/L" },
    { k: "Pension valuation engine",
      v: "Vesting + contribution accrual against the Pension master" },
    { k: "Management-report currency (3rd tier)",
      v: "Notes-tab TODO — beyond functional + reporting currencies" },
    { k: "Intercompany related-company semantics",
      v: "Notes-tab TODO — relationship logic beyond IntercompanyGroup" },
    { k: "Pension / Commitment column lists",
      v: "Masters scaffolded; Thomas to define columns like he did for the other tabs" },
    { k: "Budget module",
      v: "Layer 11 — multi-entity budgets, scenario planning, cash-flow forecasting" },
  ];
  return (
    <section className="mt-8 rounded-2xl border border-amber-200/70 bg-amber-50/30 p-5 md:p-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-2xl bg-white ring-1 ring-inset ring-amber-100 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-amber-600" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">
            Build queue
          </p>
          <h3 className="mt-0.5 text-base font-semibold text-gray-900 tracking-tight">
            What&apos;s next on the roadmap
          </h3>
          <p className="mt-1 text-sm text-gray-600 leading-relaxed max-w-2xl">
            The structural spine and the four engine builds are live. Below are the
            time-and-value engines plus the Notes-tab TODOs that need Thomas alignment
            before they ship.
          </p>
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {pending.map((p) => (
          <li key={p.k} className="flex items-start gap-2 rounded-lg bg-white/70 px-3 py-2 ring-1 ring-inset ring-amber-100/70">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-amber-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-900">{p.k}</p>
              <p className="text-[11px] text-gray-500 leading-snug">{p.v}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
