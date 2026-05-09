"use client";

import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Compass,
  Landmark,
  ListTree,
  Network,
  Shield,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

type TabCard = {
  tab: string;
  purpose: string;
  productSurface: string;
};

type PhaseCard = {
  title: string;
  summary: string;
  outputs: string[];
};

const explanatoryTabs: TabCard[] = [
  {
    tab: "Notes / Explanation / Big picture expl.",
    purpose: "Design intent, worked examples, and workbook usage notes. The Notes tab also lists three open design items: pension assets (LPP / 3rd pillar), intercompany / related companies, and management-report currency.",
    productSurface: "Blueprint documentation, onboarding, and unresolved-design tracker.",
  },
  {
    tab: "Dimension Ref expl. / Dimension values expl.",
    purpose: "Explains why dimension types and values exist as separate layers.",
    productSurface: "Metadata model for reporting dimensions and validation.",
  },
  {
    tab: "Controlled lists expl. / Master tabs / 09 expl.",
    purpose: "Defines dropdown governance, when an object needs its own master, and how validation rules connect to accounts.",
    productSurface: "Admin dictionaries, reference data, and posting controls.",
  },
  {
    tab: "Data Dictionary",
    purpose: "Column-by-column meanings for every green setup tab (82 rows). Source of truth for field labels, descriptions, and validation hints.",
    productSurface: "Field-level help text in admin UIs, API field docs, and import error messages.",
  },
  {
    tab: "Mapping Percent / Condition Rule / Fx columns / Tax lot",
    purpose: "Reserved explanatory placeholders Thomas left in the workbook for future guidance on universal-mapping percentages, conditional dimension rules, FX-column conventions, and tax-lot mechanics. Currently single-row stubs.",
    productSurface: "Watch-list — confirm with Thomas when these are filled, then fold into the relevant module docs.",
  },
];

const foundationTabs: TabCard[] = [
  {
    tab: "01 CoA Definition",
    purpose: "Defines the chart identity, version, status, effective dates, and base currency.",
    productSurface: "Chart template registry and versioned accounting model.",
  },
  {
    tab: "02 CoA Master",
    purpose: "Stores the account tree, account type, hierarchy, and posting structure.",
    productSurface: "Chart of accounts UI and ledger posting catalogue.",
  },
  {
    tab: "03 CoA Mapping",
    purpose: "Maps local accounts to universal reporting codes, including mapping percent.",
    productSurface: "Cross-entity reporting and normalized analytics layer.",
  },
  {
    tab: "04 Dimensions Reference",
    purpose: "Defines which dimensions exist, where they apply, and who owns them.",
    productSurface: "Dimension-type admin and reporting metadata.",
  },
  {
    tab: "05 Dimension Values",
    purpose: "Stores allowed values and hierarchies for portfolios, custodians, currencies, asset classes, and more.",
    productSurface: "Reusable dimension dictionary and reporting filters.",
  },
  {
    tab: "06 Controlled Lists",
    purpose: "Central source for statuses, yes/no flags, account types, and other controlled values.",
    productSurface: "Dropdown source-of-truth for forms, APIs, and validations.",
  },
  {
    tab: "09 Dimension Validation Rules",
    purpose: "Tells the system which dimensions are required or optional per account and event.",
    productSurface: "Posting validation engine before a journal can be approved or posted.",
  },
];

const masterTabs: TabCard[] = [
  {
    tab: "07 Loan Master",
    purpose: "Loan contracts (lombard, mortgage, related-party, private, convertible) with side, currency, counterparty, facility ref, and 49 columns of contract metadata.",
    productSurface: "Credit module — loan instruments and AP/AR-side debt tracking.",
  },
  {
    tab: "08 Instrument Master",
    purpose: "Securities and investment instruments with type, strategy, default portfolio, custodian, and pricing fields.",
    productSurface: "Investment master data and holdings setup.",
  },
  {
    tab: "10 Counterparty Master",
    purpose: "Banks, brokers, schools, vendors, and other external counterparties.",
    productSurface: "Counterparty register feeding AP, AR, and bank-feed routing.",
  },
  {
    tab: "11 Related Party Master",
    purpose: "Family members, related entities, trusts, and other related parties for compliance reporting.",
    productSurface: "Related-party register and disclosure flagging.",
  },
  {
    tab: "12 Bank Account Master",
    purpose: "Client operating and transactional bank accounts with currency, IBAN, and routing detail.",
    productSurface: "Bank feed configuration and cash account references.",
  },
  {
    tab: "13 Custodian Master",
    purpose: "Custody banks and brokerage booking centers separate from operating banks.",
    productSurface: "Custody reporting and investment account routing.",
  },
  {
    tab: "14 Portfolio Master",
    purpose: "Operating, family, investment, and private-market portfolios used as default tags on JEs.",
    productSurface: "Portfolio reporting, default dimension tagging, and allocation views.",
  },
  {
    tab: "15 Property Master",
    purpose: "Real-asset holdings (residential, commercial, land) with valuation and ownership detail.",
    productSurface: "Specialist module — property holdings beyond the core ledger.",
  },
  {
    tab: "16 Policy Master",
    purpose: "Insurance and life-policy contracts with premium, beneficiary, and value detail.",
    productSurface: "Specialist module — insurance policy register.",
  },
  {
    tab: "17 Tax Lot Master",
    purpose: "Position-level lots per instrument: open date, acquisition cost, remaining quantity, custodian, and portfolio. Powers FIFO / spec-ID realized-gain logic.",
    productSurface: "Lot-level holdings ledger driving realized gains and cost-basis methods.",
  },
];

const buildPhases: PhaseCard[] = [
  {
    title: "Phase 1 - Metadata kernel",
    summary: "Load and manage the workbook's structural tabs before touching workflows.",
    outputs: [
      "CoA definition and version registry",
      "Chart of accounts hierarchy",
      "Controlled lists and dimension type setup",
      "Dimension values and validation rule storage",
    ],
  },
  {
    title: "Phase 2 - Posting controls",
    summary: "Use the metadata to enforce journal quality at entry time.",
    outputs: [
      "Account selection by active CoA version",
      "Required dimension checks by account",
      "Approval-ready journal state validation",
      "Audit trail for metadata and posting decisions",
    ],
  },
  {
    title: "Phase 3 - Wealth masters",
    summary: "Introduce the master tabs that make wealth-management accounting specific.",
    outputs: [
      "Instrument, loan, bank account, custodian, and portfolio masters",
      "Counterparty and related-party relationships",
      "Default dimension assignment from masters into journals",
      "Searchable reference pages for operations teams",
    ],
  },
  {
    title: "Phase 4 - Reporting and positions",
    summary: "Exploit the mapping and tax-lot tabs for investment-grade reporting.",
    outputs: [
      "Universal CoA reporting layer",
      "Portfolio and custodian filtered reports",
      "Tax-lot aware gains and holdings detail",
      "Cross-portfolio and cross-entity analytics",
    ],
  },
  {
    title: "Phase 5 - Specialist modules",
    summary: "Extend into property, insurance, pensions, and related-party structures after the kernel is stable.",
    outputs: [
      "Property and policy modules",
      "Pension / pillar asset support",
      "Intercompany and related company treatment",
      "Additional private wealth workflows driven by the same metadata spine",
    ],
  },
];

const priorities = [
  "Keep the accounting kernel generic; make wealth-specific behavior come from reference data, not hardcoded screens.",
  "Treat CoA versioning and mapping as first-class objects so reporting survives future model changes.",
  "Use dimension validation rules at posting time, not only in reporting, to stop bad data early.",
  "Separate masters for bank accounts, custodians, portfolios, instruments, loans, property, and policies exactly as the workbook does.",
];

const openQuestions = [
  "Pension assets (LPP, 3rd pillar) are called out in the Notes tab and need a confirmed modeling approach.",
  "Intercompany and related-company treatment also appears as an unresolved design item in the Notes tab.",
  "Management-report currency is flagged separately and likely needs a reporting-currency layer beyond base-currency setup.",
];

const summaryInstructions = [
  "Focus first on the green tabs because they contain the actual setup data that needs to go into the database.",
  "Treat the brown tabs as explanatory guidance that defines meaning, usage, and relationships between the setup tabs.",
  "Start with 01 CoA Definition, then 02 CoA Master, then 03 CoA Mapping, then 04 Dimension Reference, then 05 Dimension Values, and only after that move into the master tabs.",
  "The later master tabs are critical because they hold the detailed records behind each dimension and must link back cleanly to the accounting structure.",
  "The immediate goal is to get this backbone into the database step by step, then connect it to the Journal Entry screen for testing.",
];

const founderPaperInstructions = [
  "The first source document was the founder working paper PDF, and the current system was built from that paper's product logic and accounting workflow.",
  "This Excel workbook is the next layer: it should now define the database structure behind the accounting rules described in the founder working paper.",
  "Use the founder working paper as the product and workflow reference, and use the Excel workbook as the implementation and master-data reference.",
  "The blueprint should therefore be read in sequence: founder paper first, workbook second, database setup third, journal-entry linkage fourth.",
];

// Verbatim email Thomas sent with the second workbook. Kept word-for-word so
// Thomas can confirm we read it correctly — paraphrasing here would lose the
// instruction "focus on the green tabs".
const thomasEmailBullets = [
  "01 COA Definition: in there you will have the various COA's. For now, we start with the wealth management COA, we will add others as we build this system: Trading company, Operating company, Holding company etc.",
  "02 CoA Master: The actual Chart of Accounts with all the different accounts. This is not final yet but shows the main accounts we will have in this division.",
  "03 CoA Mapping: How the accounts from the above COA will map to the universal COA.",
  "04 Dimension Reference: This holds the various dimensions we will have for the above COA.",
  "05 Dimension Values: this holds the various values of each dimension.",
  "Etc — critical are the later Master tabs which hold the details for each dimension.",
];

// Phase 1 priorities from the founder working paper (PDF, page 3-4) mapped
// to the live product surfaces we have already built. This lets Thomas
// confirm at a glance that every named priority is covered.
type Phase1Item = { item: string; surface: string; status: "Built" | "Partial" | "Pending" };
const phase1Priorities: Phase1Item[] = [
  { item: "Entity master",                        surface: "/dashboard/entities",         status: "Built" },
  { item: "Chart of accounts structure",          surface: "/dashboard/accounts",         status: "Built" },
  { item: "Journal entry engine",                 surface: "/dashboard/journal-entries",  status: "Built" },
  { item: "Journal lines",                        surface: "Journal entry detail",        status: "Built" },
  { item: "Debit / credit integrity",             surface: "Posting service",             status: "Built" },
  { item: "Approval status logic",                surface: "/dashboard/approvals",        status: "Built" },
  { item: "Audit trail",                          surface: "/dashboard/audit",            status: "Built" },
  { item: "Period control",                       surface: "/dashboard/periods",          status: "Built" },
  { item: "Reporting engine foundation",          surface: "/dashboard/reports",          status: "Built" },
  { item: "Drill-down: report → entry → source",  surface: "Reports → JE → Documents",    status: "Partial" },
  { item: "Treatment of currencies and FX",       surface: "/dashboard/fx-rates",         status: "Built" },
  { item: "Treatment of intercompany entries",    surface: "/dashboard/intercompany",     status: "Partial" },
];

// PDF "What Should Come Next" — second-wave items after the kernel.
type NextItem = { item: string; surface: string; status: "Built" | "Partial" | "Pending" };
const nextItems: NextItem[] = [
  { item: "Bank feed ingestion",            surface: "/dashboard/bank",      status: "Built" },
  { item: "Invoice / receipt ingestion",    surface: "/dashboard/bills + /invoices", status: "Built" },
  { item: "AI-drafted journal entries",     surface: "Anomalies surface only today",  status: "Pending" },
  { item: "Investment / wealth reporting",  surface: "Driven by Phase 3-4 of workbook",  status: "Pending" },
  { item: "Local compliance transformation",surface: "Not started",          status: "Pending" },
];

export default function BlueprintPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Blueprint"
        description="Software blueprint generated from Thomas's workbook dated 2026-04-17. This page turns the spreadsheet tabs into product modules, build order, and implementation rules for the wealth management model."
        context={
          <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
            <span className="rounded-full border border-canvas-200 bg-white px-3 py-1">
              Founder paper: 2026 04 17-Beakon Founder Working Paper.pdf
            </span>
            <span className="rounded-full border border-canvas-200 bg-white px-3 py-1">
              Source workbook: 2026 04 17-DRAFT-CoA-Wealth management v2.xlsx
            </span>
            <span className="rounded-full border border-canvas-200 bg-white px-3 py-1">
              30 tabs reviewed (17 setup · 13 explanatory)
            </span>
            <span className="rounded-full border border-canvas-200 bg-white px-3 py-1">
              Scope: wealth management accounting model
            </span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Link href="/dashboard/blueprint/implementation" className="btn-primary">
              Workbook → DB evidence
            </Link>
            <Link href="/dashboard/tour" className="btn-secondary">
              View Live Product
            </Link>
          </div>
        }
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="card p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-brand-50 p-2.5 text-brand-700">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">What the workbook is really defining</h2>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                This is not only a chart-of-accounts file. It is a full metadata-driven operating model:
                chart versions, universal mappings, dimensions, validation rules, and wealth-specific master
                data that should drive software behavior.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<ListTree className="h-5 w-5 text-brand-700" />}
              label="Foundation tabs"
              value="7"
              note="CoA, dimensions, lists, validation"
            />
            <StatCard
              icon={<Building2 className="h-5 w-5 text-brand-700" />}
              label="Master domains"
              value="10"
              note="Loan, instrument, counterparty, related party, bank, custody, portfolio, property, policy, tax lot"
            />
            <StatCard
              icon={<Network className="h-5 w-5 text-brand-700" />}
              label="Control model"
              value="Rule-driven"
              note="Per-account dimensions and mappings"
            />
            <StatCard
              icon={<Shield className="h-5 w-5 text-brand-700" />}
              label="Design stance"
              value="Metadata first"
              note="Behavior from data, not code branches"
            />
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold text-gray-900">Immediate product stance</h2>
          <div className="mt-4 space-y-3">
            {priorities.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-700" />
                <p className="text-sm leading-6 text-gray-600">{item}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-4 card p-5">
        <h2 className="text-base font-semibold text-gray-900">Thomas's Summary Instruction</h2>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          This workbook is the backbone of the system: the accounting rules. The goal is to load the
          setup data into the database first, understand exactly how each tab links to the next, and
          only then connect that structure to journal entry testing.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-canvas-200 bg-canvas-50/70 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Email summary
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-700">
              Thomas says this second workbook is more advanced than the first one, and the team should
              focus on the green tabs as the actual database setup data. The brown tabs explain how the
              structure works. The CoA, mappings, dimensions, values, and later master tabs together form
              the accounting backbone that must be loaded into the database before linking the model to
              the journal-entry workflow.
            </p>
          </div>

          <div className="rounded-2xl border border-canvas-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Build instruction
            </div>
            <div className="mt-3 space-y-2">
              {summaryInstructions.map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-700" />
                  <p className="text-sm leading-6 text-gray-700">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 card p-5">
        <h2 className="text-base font-semibold text-gray-900">Founder Paper Instruction</h2>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          The original source was the founder working paper PDF at
          {" "}
          <span className="font-medium text-gray-800">D:\Thomas\2026 04 17-Beakon Founder Working Paper.pdf</span>.
          That document defined the system vision and is the basis of the product already built.
          This Excel workbook should now be treated as the structured accounting-model layer that
          pushes that first paper into the database.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-canvas-200 bg-canvas-50/70 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Sequence
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-700">
              First, the founder working paper defined what Beakon should be. Then the second Excel
              file defined the detailed CoA, dimensions, mappings, and master data needed to store
              those accounting rules properly. The blueprint should show that this workbook is not a
              replacement for the first paper, but the operational schema that follows it.
            </p>
          </div>

          <div className="rounded-2xl border border-canvas-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Working rule
            </div>
            <div className="mt-3 space-y-2">
              {founderPaperInstructions.map((item) => (
                <div key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-700" />
                  <p className="text-sm leading-6 text-gray-700">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 card p-5">
        <h2 className="text-base font-semibold text-gray-900">Thomas's email — verbatim</h2>
        <p className="mt-1 text-sm leading-6 text-gray-600">
          Captured exactly as Thomas described the workbook mechanism. Use this as the canonical
          interpretation rather than paraphrased summaries elsewhere on this page.
        </p>

        <div className="mt-4 rounded-2xl border border-canvas-200 bg-canvas-50/70 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
            From Thomas
          </div>
          <p className="mt-2 text-sm leading-6 text-gray-700">
            &ldquo;This first version is just amazing!!! I didn&rsquo;t expect that you could action this in
            no time! From my part, pls see attached the second Excel table with the CoA for the wealth
            management division. This version is much more advanced to the first version, again, focus on
            the <span className="font-semibold text-emerald-700">GREEN colored tabs</span> to see the actual
            setup data that need to go into the database. The first tabs in <span className="font-semibold text-amber-700">BROWN color</span> are
            explanatory tabs. The CoA is built on the following mechanism:&rdquo;
          </p>
          <ul className="mt-3 space-y-2">
            {thomasEmailBullets.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                <span className="text-sm leading-6 text-gray-700">{b}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-6 text-gray-700">
            &ldquo;We will need to find out how to put all the above into the database and how one tab
            links to the other. Step by step! The attached is the backbone of the system → the accounting
            rules! Once we have this in the database, we will then link this to the Journal Entry screen
            and we can test the system.&rdquo;
          </p>
        </div>
      </section>

      <section className="mt-4 card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Founder paper Phase 1 — coverage check</h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              Each priority listed in the founder working paper (PDF page 3-4) mapped to the live product
              surface that delivers it today. Two items remain partial; flag in the Thomas review.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400 mb-2">
              Phase 1 priorities (Objective 1 + Phase 1 list)
            </div>
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-canvas-200 text-gray-500">
                  <th className="pb-2 pr-3 font-medium">Priority</th>
                  <th className="pb-2 pr-3 font-medium">Surface</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {phase1Priorities.map((p) => (
                  <tr key={p.item}>
                    <td className="py-2 pr-3 text-gray-700">{p.item}</td>
                    <td className="py-2 pr-3 text-gray-500">{p.surface}</td>
                    <td className="py-2"><StatusPill status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400 mb-2">
              &ldquo;What Should Come Next&rdquo; — second wave
            </div>
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-canvas-200 text-gray-500">
                  <th className="pb-2 pr-3 font-medium">Item</th>
                  <th className="pb-2 pr-3 font-medium">Surface</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {nextItems.map((p) => (
                  <tr key={p.item}>
                    <td className="py-2 pr-3 text-gray-700">{p.item}</td>
                    <td className="py-2 pr-3 text-gray-500">{p.surface}</td>
                    <td className="py-2"><StatusPill status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mt-4 card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Recommended build order</h2>
            <p className="mt-1 text-sm text-gray-500">
              Build the metadata spine first, then let workflows, masters, and reporting sit on top of it.
            </p>
          </div>
          <Link href="/dashboard/accounts" className="text-sm font-medium text-brand-700 hover:underline">
            Start from the accounting kernel <ArrowRight className="ml-1 inline h-4 w-4" />
          </Link>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-5">
          {buildPhases.map((phase, idx) => (
            <article key={phase.title} className="rounded-2xl border border-canvas-200 bg-canvas-50/60 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                Step {idx + 1}
              </div>
              <h3 className="mt-2 text-sm font-semibold text-gray-900">{phase.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">{phase.summary}</p>
              <ul className="mt-3 space-y-2">
                {phase.outputs.map((output) => (
                  <li key={output} className="text-sm text-gray-600">
                    - {output}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <BlueprintSection
          title="Explanatory tabs"
          description="These tabs should become product documentation and admin guidance, not just ignored spreadsheet notes."
          items={explanatoryTabs}
        />
        <BlueprintSection
          title="Foundation tabs"
          description="These define the core accounting metadata and must exist before posting or reporting is expanded."
          items={foundationTabs}
        />
        <BlueprintSection
          title="Master data tabs"
          description="These tabs turn the generic accounting kernel into a wealth management operating model."
          items={masterTabs}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-5">
          <h2 className="text-base font-semibold text-gray-900">What this means for the software</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-canvas-200 text-gray-500">
                  <th className="pb-2 pr-4 font-medium">Workbook signal</th>
                  <th className="pb-2 pr-4 font-medium">Software requirement</th>
                  <th className="pb-2 font-medium">Why it matters</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                <tr>
                  <td className="py-3 pr-4 text-gray-700">CoA_ID, Version_No, Status, Effective dates</td>
                  <td className="py-3 pr-4 text-gray-700">Versioned chart registry with active/inactive lifecycle</td>
                  <td className="py-3 text-gray-500">Future chart changes should not break history.</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 text-gray-700">Universal CoA mapping and mapping percent</td>
                  <td className="py-3 pr-4 text-gray-700">Normalized reporting layer across entities and products</td>
                  <td className="py-3 text-gray-500">Needed for consolidated analytics and future productization.</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 text-gray-700">Dimension types, values, and validation rules</td>
                  <td className="py-3 pr-4 text-gray-700">Rule engine on journal lines and import flows</td>
                  <td className="py-3 text-gray-500">Stops incomplete postings before approval.</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 text-gray-700">Separate masters for bank, custodian, portfolio, instrument, loan</td>
                  <td className="py-3 pr-4 text-gray-700">Dedicated reference-data modules with relationships</td>
                  <td className="py-3 text-gray-500">Prevents overloading the entity/account model with wealth specifics.</td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 text-gray-700">Tax lot master and investment-specific accounts</td>
                  <td className="py-3 pr-4 text-gray-700">Position-aware holdings and realized gain logic</td>
                  <td className="py-3 text-gray-500">Wealth reporting needs lot-level truth, not only account balances.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold text-gray-900">Open design questions</h2>
          <div className="mt-4 space-y-3">
            {openQuestions.map((item) => (
              <div key={item} className="rounded-2xl border border-yellow-200 bg-yellow-50/50 p-3">
                <p className="text-sm leading-6 text-gray-700">{item}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-canvas-200 bg-canvas-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Landmark className="h-4 w-4 text-brand-700" />
              Suggested next implementation slice
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Build admin surfaces for CoA definition, dimensions, dimension values, and validation rules first.
              Those four pieces unlock cleaner journal entry validation and make the later master-data pages much
              easier to add without rewiring the posting engine.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function BlueprintSection({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: TabCard[];
}) {
  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <article key={item.tab} className="rounded-2xl border border-canvas-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">{item.tab}</h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">{item.purpose}</p>
            <div className="mt-3 rounded-xl bg-canvas-50 px-3 py-2 text-sm text-gray-700">
              <span className="font-medium text-gray-900">Software surface:</span> {item.productSurface}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: "Built" | "Partial" | "Pending" }) {
  const styles =
    status === "Built"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "Partial"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles}`}>
      {status}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-canvas-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{label}</div>
          <div className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-gray-900">{value}</div>
        </div>
        <div className="rounded-2xl bg-canvas-50 p-2.5">{icon}</div>
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-500">{note}</p>
    </div>
  );
}
