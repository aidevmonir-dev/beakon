"use client";

/* Project showcase / demo page — organized module walkthrough with a
 * comment textarea per section so the reviewer can leave notes live.
 * Comments persist to localStorage under `demo-comment-{id}`.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Printer,
  Download,
  CheckCircle2,
  Circle,
  Layers,
  Zap,
  GitBranch,
  Database,
  Cloud,
  Lock,
  Users,
  Bot,
} from "lucide-react";

/* ──────────────────────────── module spec ────────────────────────────── */

type ModuleStatus = "shipped" | "partial" | "planned";

interface ModuleSpec {
  id: string;
  phase: 1 | 2 | 3 | 4;
  name: string;
  status: ModuleStatus;
  purpose: string;
  keyFeatures: string[];
  endpoints: string[];
  tryIt?: { label: string; href: string }[];
}

const MODULES: ModuleSpec[] = [
  // ── Phase 1 ──────────────────────────────────────────────────────────
  {
    id: "accounts", phase: 1, name: "Accounts", status: "shipped",
    purpose: "User identity, email-based auth, session management, email verification, and password reset flows.",
    keyFeatures: [
      "Email-based login (no usernames)",
      "JWT auth with 7-day refresh rotation + blacklist",
      "Email verification + password reset tokens",
      "Login history tracking per session",
    ],
    endpoints: [
      "POST /api/v1/auth/register/",
      "POST /api/v1/auth/login/",
      "POST /api/v1/auth/logout/",
      "GET /api/v1/auth/me/",
    ],
  },
  {
    id: "organizations", phase: 1, name: "Organizations", status: "shipped",
    purpose: "Multi-tenant workspaces with roles and members — every ledger entry scopes to an org.",
    keyFeatures: [
      "Org creation + profile (name, currency, timezone, fiscal year)",
      "Role-based access: Owner, Admin, Accountant, Finance Manager, AP/AR Clerk, Viewer",
      "Member invite flow with permission grants",
      "x-organization-id header drives tenant isolation",
    ],
    endpoints: [
      "GET/POST /api/v1/organizations/",
      "POST /api/v1/organizations/{id}/members/invite/",
      "GET/POST /api/v1/organizations/{id}/roles/",
    ],
  },
  {
    id: "ledger", phase: 1, name: "Ledger (Double-Entry Core)", status: "shipped",
    purpose: "The accounting engine. Chart of accounts, journal entries, double-entry posting, reversals, fiscal period locks.",
    keyFeatures: [
      "Chart of Accounts with hierarchy and subtypes (bank, AR, AP, COGS, etc.)",
      "Balanced journal entries — DB-level CHECK constraints enforce debit=credit",
      "Draft → Posted → Reversed workflow",
      "Trial balance with period filters",
      "Period lock: closed months refuse new posts",
    ],
    endpoints: [
      "GET/POST /api/v1/accounts/",
      "GET/POST /api/v1/journal-entries/",
      "POST /api/v1/journal-entries/{id}/post/",
      "POST /api/v1/journal-entries/{id}/reverse/",
      "GET /api/v1/reports/trial-balance/",
    ],
    tryIt: [
      { label: "Chart of Accounts", href: "/dashboard/accounts" },
      { label: "Journal Entries", href: "/dashboard/journal-entries" },
    ],
  },
  {
    id: "audit", phase: 1, name: "Audit Log", status: "shipped",
    purpose: "Who changed what, when. Every create/update/post/approve writes an audit row.",
    keyFeatures: [
      "Actor (user / system / ai) + action + object + changes diff",
      "IP + user agent captured on auth events",
      "Indexed by object_type + object_id for drill-down",
    ],
    endpoints: ["GET /api/v1/audit/events/"],
    tryIt: [{ label: "Audit Log", href: "/dashboard/audit" }],
  },
  {
    id: "api", phase: 1, name: "API Foundation", status: "shipped",
    purpose: "REST conventions, pagination, filtering, versioning (/api/v1/), DRF + JWT + CORS for the Next.js client.",
    keyFeatures: [
      "DRF with consistent error format: {error: {code, message, details}}",
      "django-filter for list endpoints",
      "Custom IsOrganizationMember + HasPermission classes",
      "Cursor-style ordering controls (?ordering=-date)",
    ],
    endpoints: [
      "~120 endpoints across 18 modules",
      "All under /api/v1/ namespace",
    ],
  },

  // ── Phase 2 ──────────────────────────────────────────────────────────
  {
    id: "banking", phase: 2, name: "Banking", status: "shipped",
    purpose: "Bank accounts + CSV import + transaction feed. Bridges real bank activity into the ledger.",
    keyFeatures: [
      "Link BankAccount to a COA ledger account (1:1)",
      "CSV importer with configurable column mapping + date format",
      "SHA1 dedup key on (bank_account, date, amount, description)",
      "Categorize → auto-creates draft JE (DR expense / CR bank)",
    ],
    endpoints: [
      "POST /api/v1/bank-accounts/{id}/import/",
      "POST /api/v1/bank-transactions/{id}/categorize/",
      "POST /api/v1/bank-transactions/bulk-categorize/",
    ],
    tryIt: [{ label: "Bank Feed", href: "/dashboard/bank" }],
  },
  {
    id: "reconciliation", phase: 2, name: "Reconciliation", status: "shipped",
    purpose: "Match bank statement to ledger. Rule-based auto-matcher + exception queue + finalize guard.",
    keyFeatures: [
      "Auto-match on signed amount + date tolerance (±5 days default)",
      "1-to-1, many-to-1, 1-to-many match types",
      "Exceptions surfaced for unmatched bank txns + orphan ledger lines",
      "Finalize blocked until difference = $0.00 and zero open exceptions",
      "Mirrors Digits' Start → Build → Match → Finalize flow",
    ],
    endpoints: [
      "POST /api/v1/reconciliation/sessions/",
      "POST /api/v1/reconciliation/sessions/{id}/build/",
      "POST /api/v1/reconciliation/sessions/{id}/matches/",
      "POST /api/v1/reconciliation/sessions/{id}/finalize/",
    ],
    tryIt: [],
  },
  {
    id: "vendors", phase: 2, name: "Vendors", status: "shipped",
    purpose: "Suppliers, contractors, payees. Linked from bills and bank transactions.",
    keyFeatures: [
      "US-focused: EIN/tax_id, payment terms, bank details (ACH/wire/check)",
      "Default expense account per vendor (drives AI suggestions)",
      "Contacts subresource + bank remittance details",
    ],
    endpoints: [
      "GET/POST /api/v1/vendors/",
      "GET /api/v1/vendors/{id}/transactions/",
      "GET/POST /api/v1/vendors/{id}/bank-details/",
    ],
    tryIt: [],
  },
  {
    id: "customers", phase: 2, name: "Customers", status: "shipped",
    purpose: "Invoice recipients and AR relationships. Separate billing + shipping addresses.",
    keyFeatures: [
      "Default revenue account per customer",
      "Contacts subresource",
      "Payment terms drive due-date math on invoices",
    ],
    endpoints: ["GET/POST /api/v1/customers/"],
    tryIt: [],
  },
  {
    id: "documents", phase: 2, name: "Documents (Vault)", status: "shipped",
    purpose: "File storage for receipts, bills, contracts, statements. Polymorphic link to any object.",
    keyFeatures: [
      "Local FileField storage (swap to S3 via settings.STORAGES)",
      "Polymorphic DocumentLink → bill, invoice, vendor, customer, JE, bank txn",
      "Tag system for folder-less organization",
      "OCRResult model prewired (Tesseract/Textract/Claude pluggable)",
    ],
    endpoints: [
      "POST /api/v1/documents/upload/",
      "GET /api/v1/documents/linked/?type=bill&id=42",
    ],
    tryIt: [],
  },
  {
    id: "reports", phase: 2, name: "Financial Reports", status: "shipped",
    purpose: "Stateless P&L, Balance Sheet, Cash Flow, General Ledger, Vendor Spend, Customer Revenue reports.",
    keyFeatures: [
      "All reports compute live from posted journal lines — always in sync",
      "P&L splits Revenue/COGS/OpEx/Other (subtype-driven)",
      "Balance Sheet verifies Assets = Liabilities + Equity at ±$0.01",
      "Cash Flow uses direct method (bank-touching JEs by counter-account)",
    ],
    endpoints: [
      "GET /api/v1/reports/profit-loss/",
      "GET /api/v1/reports/balance-sheet/",
      "GET /api/v1/reports/cash-flow/",
      "GET /api/v1/reports/general-ledger/",
    ],
    tryIt: [{ label: "Reports", href: "/dashboard/reports" }],
  },
  {
    id: "dashboards", phase: 2, name: "Dashboards", status: "shipped",
    purpose: "Aggregator endpoints for the home-screen widgets — cash position, AR/AP, trends, profit, activity.",
    keyFeatures: [
      "Single /dashboards/summary/ call returns everything the home page needs",
      "Revenue + Expense monthly trends (configurable lookback)",
      "Recent-activity feed derived from AuditEvent",
    ],
    endpoints: [
      "GET /api/v1/dashboards/summary/",
      "GET /api/v1/dashboards/cash-position/",
      "GET /api/v1/dashboards/receivables-payables/",
    ],
    tryIt: [{ label: "Dashboard", href: "/dashboard" }],
  },
  {
    id: "notifications", phase: 2, name: "Notifications", status: "shipped",
    purpose: "Event-driven + scanner-driven alerts (bill due, invoice overdue, recon exception).",
    keyFeatures: [
      "Idempotent scanners — dedup by {type}:{id}:{yyyymmdd}",
      "Per-user preferences (in-app vs email, digest frequency)",
      "Polymorphic deep-link into the triggering object",
    ],
    endpoints: [
      "GET /api/v1/notifications/",
      "POST /api/v1/notifications/scan/",
      "GET/PATCH /api/v1/notifications/preferences/",
    ],
  },

  // ── Phase 3 ──────────────────────────────────────────────────────────
  {
    id: "ap", phase: 3, name: "Accounts Payable (Bills)", status: "shipped",
    purpose: "Bill lifecycle: draft → needs_review → approved → partially_paid → paid. Auto-posts ledger entries.",
    keyFeatures: [
      "Multi-line bills with per-line tax",
      "On approval: DR expense(s) / CR AP — posts a balanced JE",
      "On payment: DR AP / CR bank",
      "Payment overpayment + state-guard protection",
      "Aging report (current / 1-30 / 31-60 / 61-90 / 90+)",
    ],
    endpoints: [
      "GET/POST /api/v1/bills/",
      "POST /api/v1/bills/{id}/approve/",
      "POST /api/v1/bills/{id}/pay/",
      "GET /api/v1/bills/aging/",
    ],
    tryIt: [],
  },
  {
    id: "ar", phase: 3, name: "Accounts Receivable (Invoices)", status: "shipped",
    purpose: "Invoice lifecycle + payments received + credit notes + recurring invoice templates.",
    keyFeatures: [
      "On send: DR AR / CR revenue",
      "On payment: DR bank / CR AR",
      "Credit notes: reduce AR balance without touching cash",
      "Recurring invoice templates stored (scheduler deferred)",
      "AR aging + overdue detection",
    ],
    endpoints: [
      "GET/POST /api/v1/invoices/",
      "POST /api/v1/invoices/{id}/send/",
      "POST /api/v1/invoices/{id}/pay/",
      "GET/POST /api/v1/credit-notes/",
    ],
    tryIt: [],
  },
  {
    id: "ai", phase: 3, name: "AI Layer", status: "shipped",
    purpose: "Hybrid LLM + rule-based intelligence across categorization, Ask Finance, and narrative analysis.",
    keyFeatures: [
      "Transaction categorization: similarity-matcher first, Claude fallback",
      "Ask Finance: Claude answers grounded on trial balance + open bills/invoices",
      "Narrative Analysis: per-vendor/customer month-over-month delta cards",
      "Every LLM call logged to PromptLog with token cost + latency",
      "Feedback loop (AIFeedback) foundation for learning from corrections",
    ],
    endpoints: [
      "POST /api/v1/ai/suggest-categorization/",
      "POST /api/v1/ai/ask/",
      "GET /api/v1/ai/narratives/expenses/",
      "GET /api/v1/ai/narratives/revenue/",
    ],
    tryIt: [],
  },
  {
    id: "tasks", phase: 3, name: "Tasks (Checklist)", status: "shipped",
    purpose: "Finance to-dos + month-end close checklist templates + comments.",
    keyFeatures: [
      "Priority + status workflow (pending → in_progress → completed)",
      "Polymorphic link — tasks attach to any bill/invoice/recon session",
      "Checklist groups tasks; auto-completes when every child is done",
      "Comments thread per task",
    ],
    endpoints: [
      "GET/POST /api/v1/tasks/",
      "POST /api/v1/tasks/{id}/complete/",
      "GET/POST /api/v1/checklists/",
    ],
    tryIt: [],
  },

  // ── Phase 4 ──────────────────────────────────────────────────────────
  {
    id: "subscriptions", phase: 4, name: "Subscriptions", status: "planned",
    purpose: "SaaS plan management, trial, usage limits, Stripe billing integration.",
    keyFeatures: [
      "Plan tiers + feature gating",
      "Trial management",
      "Stripe recurring billing",
    ],
    endpoints: ["— not yet built —"],
  },
  {
    id: "integrations", phase: 4, name: "Integrations", status: "planned",
    purpose: "External system connections: Plaid bank feeds, email-bill intake, Stripe payments, webhooks.",
    keyFeatures: [
      "Plaid bank feed (supersedes CSV import)",
      "Email-to-bill ingestion via IMAP",
      "Generic webhook engine for outbound events",
    ],
    endpoints: ["— not yet built —"],
  },
  {
    id: "public_api", phase: 4, name: "Public API", status: "planned",
    purpose: "Third-party developer access: API keys, OAuth, rate limiting, idempotency.",
    keyFeatures: [
      "API key management UI",
      "Scoped permissions per key",
      "Webhooks for external subscribers",
    ],
    endpoints: ["— not yet built —"],
  },
];

const PHASE_NAMES: Record<number, string> = {
  1: "Phase 1 — Foundation",
  2: "Phase 2 — Operational MVP",
  3: "Phase 3 — AP / AR / AI",
  4: "Phase 4 — Integrations",
};

/* ──────────────────────────── page ────────────────────────────────────── */

export default function DemoPage() {
  const [comments, setComments] = useState<Record<string, string>>({});
  const [reviewer, setReviewer] = useState("Thomas Alina");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("demo-comments-v1");
      if (raw) setComments(JSON.parse(raw));
      const r = localStorage.getItem("demo-reviewer");
      if (r) setReviewer(r);
    } catch {
      // ignore
    }
  }, []);

  const setComment = (id: string, val: string) => {
    const next = { ...comments, [id]: val };
    setComments(next);
    try {
      localStorage.setItem("demo-comments-v1", JSON.stringify(next));
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      // ignore
    }
  };

  const onReviewerChange = (v: string) => {
    setReviewer(v);
    try { localStorage.setItem("demo-reviewer", v); } catch { /* ignore */ }
  };

  const exportMarkdown = () => {
    const lines: string[] = [];
    lines.push(`# Beakon — Module Walkthrough`);
    lines.push(``);
    lines.push(`**Reviewer**: ${reviewer}`);
    lines.push(`**Date**: ${new Date().toLocaleString()}`);
    lines.push(``);
    for (const phase of [1, 2, 3, 4] as const) {
      lines.push(`## ${PHASE_NAMES[phase]}`);
      lines.push(``);
      for (const m of MODULES.filter((x) => x.phase === phase)) {
        lines.push(`### ${m.name} — ${m.status}`);
        lines.push(``);
        lines.push(m.purpose);
        lines.push(``);
        lines.push(`**Key features**`);
        for (const f of m.keyFeatures) lines.push(`- ${f}`);
        lines.push(``);
        const c = comments[m.id]?.trim();
        if (c) {
          lines.push(`**${reviewer}'s comment:**`);
          lines.push(`> ${c.replace(/\n/g, "\n> ")}`);
          lines.push(``);
        }
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `beakon-review-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = {
    shipped: MODULES.filter((m) => m.status === "shipped").length,
    partial: MODULES.filter((m) => m.status === "partial").length,
    planned: MODULES.filter((m) => m.status === "planned").length,
    commented: Object.values(comments).filter((v) => v.trim()).length,
  };

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-mint-50 text-mint-700 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider mb-2">
            <Sparkles className="w-3 h-3" />
            Project walkthrough
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Beakon — Module Walkthrough
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            A guided tour of what's been built, organized by phase. Leave
            notes in each section — they'll save to your browser automatically
            and you can export them as Markdown at the end.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="btn-secondary"
          >
            <Printer className="w-4 h-4 mr-1.5" /> Print
          </button>
          <button onClick={exportMarkdown} className="btn-primary">
            <Download className="w-4 h-4 mr-1.5" /> Export Notes
          </button>
        </div>
      </div>

      {/* ── Reviewer + save indicator ──────────────────────────────── */}
      <div className="card p-4 mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 whitespace-nowrap">Reviewer:</label>
          <input
            value={reviewer}
            onChange={(e) => onReviewerChange(e.target.value)}
            className="input w-56"
          />
        </div>
        <div className="text-xs text-gray-400">
          {savedAt ? `Notes auto-saved at ${savedAt}` : "Notes save to this browser automatically"}
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="Modules shipped" value={`${counts.shipped} / ${MODULES.length}`} tone="green" />
        <StatCard label="Phase 4 remaining" value={counts.planned.toString()} />
        <StatCard label="API endpoints" value="~120" />
        <StatCard label="Notes taken" value={counts.commented.toString()} tone="blue" />
      </div>

      {/* ── Architecture SVG ───────────────────────────────────────── */}
      <div className="card p-5 mb-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          <Layers className="w-4 h-4 inline mr-1.5 text-brand-700" />
          System architecture
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Three-tier with an AI augmentation layer. Postgres is the source of
          truth; Django services enforce double-entry invariants.
        </p>
        <ArchitectureSVG />
      </div>

      {/* ── Project mapping chart ──────────────────────────────────── */}
      <div className="card p-5 mb-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          <Layers className="w-4 h-4 inline mr-1.5 text-brand-700" />
          Project map — how the 21 modules fit together
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Each module is a Django app. Arrows show primary dependencies —
          upper layers are prerequisites for the ones below. Mint = shipped,
          grey = planned (Phase 4).
        </p>
        <ProjectMapSVG />
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 mt-3 border-t border-canvas-100 pt-3">
          <LegendSwatch color="#d3f2e7" border="#56bd9e" label="Identity" />
          <LegendSwatch color="#e6edf2" border="#5c96ac" label="Accounting core" />
          <LegendSwatch color="#eef5f8" border="#8ab6c7" label="Operations" />
          <LegendSwatch color="#f4f7fa" border="#b6d2dd" label="Workflows" />
          <LegendSwatch color="#fefcea" border="#e0c877" label="Intelligence" />
          <LegendSwatch color="#f9fafb" border="#d1d5db" label="Reporting &amp; UX" />
          <LegendSwatch color="#ffffff" border="#e5e7eb" label="Phase 4 (planned)" dashed />
        </div>
      </div>

      {/* ── Data flow SVG ──────────────────────────────────────────── */}
      <div className="card p-5 mb-5">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          <GitBranch className="w-4 h-4 inline mr-1.5 text-brand-700" />
          Example flow — bank transaction → paid bill
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          How a single bill moves through the system and what journal entries it produces.
        </p>
        <FlowSVG />
      </div>

      {/* ── Tech stack ─────────────────────────────────────────────── */}
      <div className="card p-5 mb-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">
          <Database className="w-4 h-4 inline mr-1.5 text-brand-700" />
          Tech stack
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <TechCol title="Backend" items={["Django 6.0", "DRF 3.15", "PostgreSQL", "Simple JWT", "django-filter"]} />
          <TechCol title="Frontend" items={["Next.js 16", "React 19", "Tailwind 4", "TypeScript 6", "Lucide icons"]} />
          <TechCol title="AI" items={["Anthropic Python SDK", "Claude Haiku (categorize)", "Claude Sonnet (Ask Finance)", "Rule-based fallback"]} />
          <TechCol title="Ops" items={["Whitenoise static files", "Local file storage", "CORS for cross-origin", "Env-driven config"]} />
        </div>
      </div>

      {/* ── Per-module walkthrough with comment boxes ──────────────── */}
      {[1, 2, 3, 4].map((phase) => (
        <section key={phase} className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <PhaseDot phase={phase as 1 | 2 | 3 | 4} />
            {PHASE_NAMES[phase]}
            <span className="text-xs font-normal text-gray-400">
              {MODULES.filter((m) => m.phase === phase && m.status === "shipped").length}
              /
              {MODULES.filter((m) => m.phase === phase).length} shipped
            </span>
          </h2>

          <div className="space-y-3">
            {MODULES.filter((m) => m.phase === phase).map((m) => (
              <ModuleCard
                key={m.id}
                module={m}
                comment={comments[m.id] || ""}
                onCommentChange={(v) => setComment(m.id, v)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* ── Footer CTA ─────────────────────────────────────────────── */}
      <div className="card p-5 text-center bg-brand-50 border-brand-100">
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          Ready to export your notes?
        </h3>
        <p className="text-xs text-gray-600 mb-3">
          Export as Markdown — one file with reviewer, date, and every comment
          under its module. Drop it into Linear/Notion/email directly.
        </p>
        <button onClick={exportMarkdown} className="btn-primary">
          <Download className="w-4 h-4 mr-1.5" /> Export Review Notes
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────── subcomponents ──────────────────────────── */

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "green" | "blue" }) {
  const color =
    tone === "green" ? "text-mint-600" :
    tone === "blue" ? "text-brand-700" : "text-gray-900";
  return (
    <div className="card p-4">
      <p className="text-[11px] text-gray-400 mb-1 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function PhaseDot({ phase }: { phase: 1 | 2 | 3 | 4 }) {
  const colors = {
    1: "bg-mint-500",
    2: "bg-mint-500",
    3: "bg-mint-500",
    4: "bg-gray-300",
  };
  return <span className={`w-2.5 h-2.5 rounded-full ${colors[phase]}`} />;
}

function TechCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{title}</p>
      <ul className="space-y-1 text-gray-700 text-sm">
        {items.map((i) => <li key={i}>· {i}</li>)}
      </ul>
    </div>
  );
}

function ModuleCard({
  module: m,
  comment,
  onCommentChange,
}: {
  module: ModuleSpec;
  comment: string;
  onCommentChange: (v: string) => void;
}) {
  const statusBadge = {
    shipped: "badge-green",
    partial: "badge-yellow",
    planned: "badge-gray",
  }[m.status];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{m.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">{m.purpose}</p>
        </div>
        <span className={statusBadge}>{m.status}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Key features
          </p>
          <ul className="space-y-1 text-sm text-gray-700">
            {m.keyFeatures.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-mint-500 flex-shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            API endpoints
          </p>
          <ul className="space-y-1 text-xs text-gray-600 font-mono">
            {m.endpoints.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          {m.tryIt && m.tryIt.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-gray-400">Live:</span>
              {m.tryIt.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className="text-xs text-brand-700 hover:underline"
                >
                  → {t.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Comment box */}
      <div className="mt-4 pt-4 border-t border-canvas-100">
        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
          Reviewer note
        </label>
        <textarea
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="What do you think of this module? Gaps, priorities, suggestions…"
          className="w-full rounded-lg border border-canvas-200 bg-canvas-50 px-3 py-2 text-sm placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 min-h-[60px]"
          rows={2}
        />
      </div>
    </div>
  );
}

/* ──────────────────────────── SVG diagrams ───────────────────────────── */

function ArchitectureSVG() {
  return (
    <svg viewBox="0 0 900 340" className="w-full h-auto max-w-4xl mx-auto">
      <defs>
        <linearGradient id="boxG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f4f7fa" />
        </linearGradient>
        <marker id="arrowTeal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#3aa888" />
        </marker>
      </defs>

      {/* User / browser */}
      <g>
        <rect x="30" y="130" width="160" height="80" rx="10" fill="url(#boxG)" stroke="#d6e1e9" />
        <text x="110" y="158" textAnchor="middle" fontSize="13" fontWeight="600" fill="#111827">Browser</text>
        <text x="110" y="180" textAnchor="middle" fontSize="11" fill="#6b7280">Next.js 16 UI</text>
        <text x="110" y="196" textAnchor="middle" fontSize="10" fill="#9ca3af">Tailwind · React 19</text>
      </g>

      {/* Django API */}
      <g>
        <rect x="280" y="60" width="200" height="220" rx="10" fill="url(#boxG)" stroke="#d6e1e9" />
        <text x="380" y="88" textAnchor="middle" fontSize="13" fontWeight="600" fill="#111827">Django REST API</text>
        <text x="380" y="108" textAnchor="middle" fontSize="10" fill="#6b7280">/api/v1/ · JWT · CORS</text>
        <line x1="300" y1="120" x2="460" y2="120" stroke="#e5e7eb" />

        <text x="380" y="142" textAnchor="middle" fontSize="11" fill="#111827" fontWeight="500">Apps (18)</text>
        <text x="380" y="160" textAnchor="middle" fontSize="10" fill="#6b7280">accounts · organizations · ledger</text>
        <text x="380" y="174" textAnchor="middle" fontSize="10" fill="#6b7280">banking · reconciliation · ap · ar</text>
        <text x="380" y="188" textAnchor="middle" fontSize="10" fill="#6b7280">vendors · customers · documents</text>
        <text x="380" y="202" textAnchor="middle" fontSize="10" fill="#6b7280">reports · dashboards · notifications</text>
        <text x="380" y="216" textAnchor="middle" fontSize="10" fill="#6b7280">ai · tasks · audit · api</text>
        <line x1="300" y1="230" x2="460" y2="230" stroke="#e5e7eb" />
        <text x="380" y="250" textAnchor="middle" fontSize="10" fill="#6b7280">Services enforce</text>
        <text x="380" y="264" textAnchor="middle" fontSize="10" fill="#3aa888" fontWeight="500">double-entry invariants</text>
      </g>

      {/* Postgres */}
      <g>
        <rect x="570" y="50" width="170" height="130" rx="10" fill="url(#boxG)" stroke="#d6e1e9" />
        <text x="655" y="78" textAnchor="middle" fontSize="13" fontWeight="600" fill="#111827">PostgreSQL</text>
        <text x="655" y="98" textAnchor="middle" fontSize="10" fill="#6b7280">Source of truth</text>
        <line x1="590" y1="110" x2="720" y2="110" stroke="#e5e7eb" />
        <text x="655" y="130" textAnchor="middle" fontSize="10" fill="#6b7280">CHECK constraints</text>
        <text x="655" y="146" textAnchor="middle" fontSize="10" fill="#6b7280">Transactional JE writes</text>
        <text x="655" y="162" textAnchor="middle" fontSize="10" fill="#6b7280">All monetary = DECIMAL(19,4)</text>
      </g>

      {/* Anthropic */}
      <g>
        <rect x="570" y="200" width="170" height="90" rx="10" fill="url(#boxG)" stroke="#d6e1e9" />
        <text x="655" y="228" textAnchor="middle" fontSize="13" fontWeight="600" fill="#111827">Anthropic Claude</text>
        <text x="655" y="248" textAnchor="middle" fontSize="10" fill="#6b7280">Optional — falls back</text>
        <text x="655" y="262" textAnchor="middle" fontSize="10" fill="#6b7280">to rule-based when absent</text>
        <text x="655" y="278" textAnchor="middle" fontSize="10" fill="#3aa888" fontWeight="500">Haiku + Sonnet</text>
      </g>

      {/* Arrows */}
      <line x1="190" y1="170" x2="280" y2="170" stroke="#3aa888" strokeWidth="2" markerEnd="url(#arrowTeal)" />
      <text x="235" y="162" textAnchor="middle" fontSize="10" fill="#6b7280">HTTPS</text>

      <line x1="480" y1="115" x2="570" y2="115" stroke="#3aa888" strokeWidth="2" markerEnd="url(#arrowTeal)" />
      <text x="525" y="107" textAnchor="middle" fontSize="10" fill="#6b7280">SQL</text>

      <line x1="480" y1="245" x2="570" y2="245" stroke="#3aa888" strokeWidth="2" markerEnd="url(#arrowTeal)" />
      <text x="525" y="237" textAnchor="middle" fontSize="10" fill="#6b7280">API</text>
    </svg>
  );
}

function LegendSwatch({
  color, border, label, dashed,
}: { color: string; border: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-4 h-3 rounded-sm"
        style={{
          background: color,
          border: `1px ${dashed ? "dashed" : "solid"} ${border}`,
        }}
      />
      {label}
    </span>
  );
}

function ProjectMapSVG() {
  /* Layered architecture map. Each layer is a colored band. Modules within
   * a layer are sibling boxes. Arrows from a layer's bottom edge connect
   * into the layer below. Phase-4 boxes are dashed.
   *
   * Coordinates are hand-positioned for readability — don't change values
   * in isolation, update as a system. */

  type Box = {
    id: string; label: string; x: number; y: number;
    w?: number; h?: number; planned?: boolean;
  };

  const BW = 124;   // default box width
  const BH = 46;    // default box height

  const layers = [
    {
      name: "Identity & tenancy",
      y: 30, h: 70,
      fill: "#d3f2e7", stroke: "#56bd9e",
      boxes: [
        { id: "accounts",      label: "accounts",      x: 340, y: 47 },
        { id: "organizations", label: "organizations", x: 486, y: 47 },
        { id: "api",           label: "api (DRF + JWT)", x: 632, y: 47, w: 150 },
      ],
    },
    {
      name: "Accounting core",
      y: 130, h: 70,
      fill: "#e6edf2", stroke: "#5c96ac",
      boxes: [
        { id: "ledger", label: "ledger (CORE)",
          x: 360, y: 147, w: 180 },
        { id: "audit",  label: "audit", x: 580, y: 147 },
      ],
    },
    {
      name: "Operations",
      y: 230, h: 70,
      fill: "#eef5f8", stroke: "#8ab6c7",
      boxes: [
        { id: "banking",    label: "banking",    x:  60, y: 247 },
        { id: "vendors",    label: "vendors",    x: 200, y: 247 },
        { id: "customers",  label: "customers",  x: 340, y: 247 },
        { id: "documents",  label: "documents",  x: 480, y: 247 },
        { id: "notifications", label: "notifications", x: 620, y: 247, w: 140 },
        { id: "tasks",      label: "tasks",      x: 778, y: 247 },
      ],
    },
    {
      name: "Workflows",
      y: 330, h: 70,
      fill: "#f4f7fa", stroke: "#b6d2dd",
      boxes: [
        { id: "reconciliation", label: "reconciliation", x:  60, y: 347, w: 140 },
        { id: "ap", label: "ap (bills)",       x: 220, y: 347 },
        { id: "ar", label: "ar (invoices)",    x: 360, y: 347 },
      ],
    },
    {
      name: "Intelligence",
      y: 430, h: 70,
      fill: "#fefcea", stroke: "#e0c877",
      boxes: [
        { id: "ai", label: "ai — categorize · ask · narrate",
          x: 300, y: 447, w: 300 },
      ],
    },
    {
      name: "Reporting & UX",
      y: 530, h: 70,
      fill: "#f9fafb", stroke: "#d1d5db",
      boxes: [
        { id: "reports",    label: "reports",    x: 260, y: 547 },
        { id: "dashboards", label: "dashboards", x: 400, y: 547 },
      ],
    },
    {
      name: "Phase 4 — integrations (planned)",
      y: 630, h: 70,
      fill: "#ffffff", stroke: "#e5e7eb",
      boxes: [
        { id: "subscriptions", label: "subscriptions", x: 220, y: 647, planned: true },
        { id: "integrations",  label: "integrations",  x: 360, y: 647, planned: true },
        { id: "public_api",    label: "public_api",    x: 500, y: 647, planned: true },
      ],
    },
  ];

  /* Primary dependency arrows — from child (below) up to parent (above).
   * Rendered head-down so the chart reads top-to-bottom. */
  const edges: Array<{ from: string; to: string; label?: string }> = [
    // Identity → Core
    { from: "accounts", to: "ledger" },
    { from: "organizations", to: "ledger" },
    // Core → Operations
    { from: "ledger", to: "banking" },
    { from: "ledger", to: "vendors" },
    { from: "ledger", to: "customers" },
    { from: "organizations", to: "documents" },
    { from: "organizations", to: "notifications" },
    { from: "organizations", to: "tasks" },
    // Operations → Workflows
    { from: "banking", to: "reconciliation" },
    { from: "vendors", to: "ap" },
    { from: "customers", to: "ar" },
    // Workflows + Operations → Intelligence
    { from: "banking", to: "ai" },
    { from: "ap", to: "ai" },
    { from: "ar", to: "ai" },
    { from: "documents", to: "ai" },
    // Workflows + Core → Reporting
    { from: "ledger", to: "reports" },
    { from: "ap", to: "reports" },
    { from: "ar", to: "reports" },
    { from: "reports", to: "dashboards" },
  ];

  // Build a lookup of center points for arrow anchoring.
  const centers: Record<string, { cx: number; cy: number; w: number; h: number; y: number }> = {};
  for (const layer of layers) {
    for (const b of layer.boxes) {
      const w = (b as Box).w ?? BW;
      const h = (b as Box).h ?? BH;
      centers[b.id] = {
        cx: b.x + w / 2, cy: b.y + h / 2, w, h, y: b.y,
      };
    }
  }

  return (
    <svg viewBox="0 0 900 720" className="w-full h-auto max-w-5xl mx-auto">
      <defs>
        <marker id="mapArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
        </marker>
      </defs>

      {/* Layer bands */}
      {layers.map((layer, i) => (
        <g key={layer.name}>
          <rect
            x="20" y={layer.y} width="860" height={layer.h}
            fill={layer.fill} stroke={layer.stroke}
            strokeWidth="1" rx="6"
            strokeDasharray={i === layers.length - 1 ? "4 3" : undefined}
            opacity="0.55"
          />
          <text
            x="32" y={layer.y + 16}
            fontSize="10" fontWeight="600"
            fill={layer.stroke}
            style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}
          >
            {layer.name}
          </text>
        </g>
      ))}

      {/* Dependency arrows — drawn before boxes so they sit behind */}
      {edges.map((e, i) => {
        const a = centers[e.from];
        const b = centers[e.to];
        if (!a || !b) return null;
        // Anchor at the vertical midpoint of the source's bottom edge and
        // the destination's top edge so arrows don't overlap boxes.
        const x1 = a.cx;
        const y1 = a.y + a.h;
        const x2 = b.cx;
        const y2 = b.y;
        return (
          <path
            key={i}
            d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2 - 2}`}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="1.25"
            markerEnd="url(#mapArrow)"
          />
        );
      })}

      {/* Module boxes */}
      {layers.map((layer) => (
        <g key={`boxes-${layer.name}`}>
          {layer.boxes.map((b) => {
            const w = (b as Box).w ?? BW;
            const h = (b as Box).h ?? BH;
            const isCore = b.id === "ledger";
            return (
              <g key={b.id}>
                <rect
                  x={b.x} y={b.y} width={w} height={h} rx="8"
                  fill="#ffffff"
                  stroke={isCore ? "#234f60" : layer.stroke}
                  strokeWidth={isCore ? 2 : 1}
                  strokeDasharray={(b as Box).planned ? "4 3" : undefined}
                />
                <text
                  x={b.x + w / 2} y={b.y + h / 2 + 4}
                  textAnchor="middle"
                  fontSize="12"
                  fontWeight={isCore ? 700 : 500}
                  fill={(b as Box).planned ? "#9ca3af" : "#111827"}
                >
                  {b.label}
                </text>
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

function FlowSVG() {
  /* Horizontal flow of 5 steps with the journal-entry pair shown at each stage. */
  const steps = [
    { title: "1. Bill received", sub: "Vendor sends invoice → create draft Bill" },
    { title: "2. Submit + Approve", sub: "Accrual JE: DR expense · CR AP" },
    { title: "3. Bank feed arrives", sub: "CSV/Plaid import → BankTransaction rows" },
    { title: "4. Pay bill", sub: "Payment JE: DR AP · CR Bank" },
    { title: "5. Reconcile", sub: "Match txn ↔ JE · difference must be $0" },
  ];
  return (
    <svg viewBox="0 0 1000 170" className="w-full h-auto max-w-4xl mx-auto">
      <defs>
        <marker id="arrowG" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#5c96ac" />
        </marker>
      </defs>
      {steps.map((s, i) => {
        const x = 20 + i * 195;
        return (
          <g key={i}>
            <rect x={x} y="40" width="175" height="90" rx="10"
                  fill="#ffffff" stroke="#d6e1e9" />
            <text x={x + 87} y="65" textAnchor="middle" fontSize="12" fontWeight="600" fill="#111827">{s.title}</text>
            <text x={x + 87} y="85" textAnchor="middle" fontSize="10" fill="#6b7280">
              <tspan x={x + 87} dy="0">{s.sub.split("·")[0]?.trim()}</tspan>
              {s.sub.includes("·") && (
                <tspan x={x + 87} dy="14" fill="#3aa888" fontWeight="500">{s.sub.split("·")[1]?.trim()}</tspan>
              )}
            </text>
            {i < steps.length - 1 && (
              <line
                x1={x + 175} y1="85" x2={x + 195} y2="85"
                stroke="#5c96ac" strokeWidth="2" markerEnd="url(#arrowG)"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
