"use client";

/* Beakon Engine Workflow — visual end-to-end of how data moves from
 * messy inputs to reviewed financial reports.
 *
 * The hero diagram is a Mermaid flowchart whose source lives in the DB
 * (model: WorkflowDiagram). Operators can edit it in-browser via the
 * "Edit diagram" drawer — saves persist via PATCH and the rendered
 * preview updates live. Below the diagram, the existing 8 stage cards
 * give a clickable drill-down to each live page. */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown, BookCheck, Building2, Calculator, CalendarCheck,
  CheckCircle2, Coins, Database, FileSpreadsheet, FileText, GitBranch,
  Inbox, Landmark, Lock, Maximize2, Minimize2, NotebookPen, Pencil, Receipt,
  Repeat, RotateCcw, Save, Send, Shield, Sparkles, TrendingUp,
  Workflow as WorkflowIcon, X, Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { MermaidDiagram } from "@/components/mermaid-diagram";


// ── Stage spec ────────────────────────────────────────────────────────────

interface StepSpec {
  icon: LucideIcon;
  title: string;
  detail: string;
  href?: string;
}

interface StageSpec {
  n: string;
  name: string;
  blurb: string;
  accent: "blue" | "violet" | "amber" | "rose" | "mint" | "brand" | "gray";
  steps: StepSpec[];
}

const STAGES: StageSpec[] = [
  {
    n: "1",
    name: "Intake",
    blurb: "Real-world inputs land in Beakon. Format-agnostic: PDFs, CSVs, manual entries.",
    accent: "blue",
    steps: [
      { icon: Landmark, title: "Bank CSV imported",
        detail: "Statement → BankTransaction (status: NEW)",
        href: "/dashboard/bank" },
      { icon: FileText, title: "Supplier PDF uploaded",
        detail: "→ SourceDocument with the original file",
        href: "/dashboard/bills" },
      { icon: NotebookPen, title: "Manual JE drafted",
        detail: "Operator types lines directly",
        href: "/dashboard/journal-entries" },
      { icon: Receipt, title: "Customer invoice drafted",
        detail: "AR side: Invoice + InvoiceLine[]",
        href: "/dashboard/invoices" },
    ],
  },
  {
    n: "2",
    name: "Document Intelligence",
    blurb: "AI reads documents and proposes structure — extraction + classification, not posting.",
    accent: "violet",
    steps: [
      { icon: Sparkles, title: "OCR + extraction",
        detail: "Amount, VAT, currency, due date, vendor, reference",
        href: "/dashboard/bills" },
      { icon: Zap, title: "AI account coding",
        detail: "Suggests expense/revenue account + dimensions",
        href: "/dashboard/bills" },
      { icon: GitBranch, title: "Rebillable flag detection",
        detail: "Marks pass-through costs (DHL example) for client invoice later",
        href: "/dashboard/disbursements" },
    ],
  },
  {
    n: "3",
    name: "Draft staging",
    blurb: "Document becomes a typed object with state. Operator can edit; nothing's posted.",
    accent: "amber",
    steps: [
      { icon: FileText, title: "Bill (DRAFT)",
        detail: "Lines, vendor, currency, tax codes per line",
        href: "/dashboard/bills" },
      { icon: Receipt, title: "Invoice (DRAFT)",
        detail: "Lines, customer, currency, tax codes per line",
        href: "/dashboard/invoices" },
      { icon: NotebookPen, title: "Journal Entry (DRAFT)",
        detail: "Lines, accounts, dimensions, FX rate",
        href: "/dashboard/journal-entries" },
    ],
  },
  {
    n: "4",
    name: "Engine validation",
    blurb: "The accounting engine refuses to advance a draft that violates any rule. Hard guarantee.",
    accent: "rose",
    steps: [
      { icon: BookCheck, title: "Double-entry balance",
        detail: "DR sum = CR sum in functional currency or refused" },
      { icon: Lock, title: "Period not closed",
        detail: "Locked period blocks new posts; soft-close allows reversals only",
        href: "/dashboard/periods" },
      { icon: Shield, title: "Dimension rules (Tab 09)",
        detail: "311 rules from the workbook enforced live — refuses missing dims",
        href: "/dashboard/blueprint/data/dimension-validation-rules" },
      { icon: Coins, title: "FX rate captured",
        detail: "Native + functional amounts + as-of-date rate stamped per line",
        href: "/dashboard/fx-rates" },
    ],
  },
  {
    n: "5",
    name: "Human review (four-eyes)",
    blurb: "Submit-by ≠ approve-by. Engine enforces the separation — same user can&apos;t do both.",
    accent: "amber",
    steps: [
      { icon: Inbox, title: "Submit for approval",
        detail: "Status: DRAFT → PENDING_APPROVAL · stamped with user + timestamp",
        href: "/dashboard/approvals" },
      { icon: CheckCircle2, title: "Approve",
        detail: "Different user clicks approve · ApprovalAction audit row written" },
      { icon: GitBranch, title: "Reject (with reason)",
        detail: "Returns to DRAFT · rejection_reason captured verbatim" },
    ],
  },
  {
    n: "6",
    name: "Posted to ledger",
    blurb: "Immutable ledger commit. Reversal is the only way to correct after this point.",
    accent: "mint",
    steps: [
      { icon: Database, title: "JE status = POSTED",
        detail: "JournalLine constraints enforced at the database level" },
      { icon: Shield, title: "AuditEvent recorded",
        detail: "User · IP · before/after diff captured system-wide",
        href: "/dashboard/audit" },
      { icon: NotebookPen, title: "ApprovalAction trail",
        detail: "Per-JE history of every state transition with actor + note" },
    ],
  },
  {
    n: "7",
    name: "Downstream engines",
    blurb: "Posted JEs feed time-and-value engines that fire automatically or on demand.",
    accent: "brand",
    steps: [
      { icon: Repeat, title: "Recognition",
        detail: "Multi-period prepaid / deferred / accrued posts per schedule",
        href: "/dashboard/recognition" },
      { icon: Calculator, title: "VAT routing",
        detail: "Per-line tax goes to Output VAT (sales) / Input VAT (purchases)",
        href: "/dashboard/reports/vat" },
      { icon: Send, title: "Disbursements",
        detail: "Rebillable cost lines bundle into a draft client invoice",
        href: "/dashboard/disbursements" },
      { icon: Coins, title: "FX revaluation",
        detail: "Period-end re-translation of monetary balances",
        href: "/dashboard/periods" },
      { icon: CalendarCheck, title: "Period close",
        detail: "P&L accounts zeroed → Retained Earnings (idempotent)",
        href: "/dashboard/periods" },
    ],
  },
  {
    n: "8",
    name: "Reports & evidence",
    blurb: "The full chain — report line → JE → source document → audit row — is one click each direction.",
    accent: "gray",
    steps: [
      { icon: TrendingUp, title: "Trial Balance · P&L · BS · Cash Flow",
        detail: "All ledger-driven · drill-down to source",
        href: "/dashboard/reports" },
      { icon: Calculator, title: "VAT report",
        detail: "Output − Input = Net payable, by tax code",
        href: "/dashboard/reports/vat" },
      { icon: Inbox, title: "AR / AP aging",
        detail: "Outstanding receivables and payables",
        href: "/dashboard/reports" },
      { icon: FileSpreadsheet, title: "Workbook → DB evidence",
        detail: "Live row counts proving every workbook tab is loaded",
        href: "/dashboard/blueprint/implementation" },
      { icon: Shield, title: "Audit log",
        detail: "Every state change traceable",
        href: "/dashboard/audit" },
    ],
  },
];


// ── Page ──────────────────────────────────────────────────────────────────

export default function WorkflowPage() {
  return (
    <div className="w-full">
      <PageHeader
        title="Engine workflow"
        description="From messy inputs to reviewed financial reports — every stage of how Beakon's accounting engine processes a transaction. Click any box to open the live page."
      />

      {/* Hero — principles strip + big diagram side by side on wide screens */}
      <div className="mt-5 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-4">
        {/* Left rail: principles + footer note */}
        <div className="space-y-3">
          <div className="rounded-xl border border-canvas-200/70 bg-white p-4 space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
              Three principles
            </p>
            <Principle
              icon={Sparkles}
              label="AI assists"
              text="OCR, account coding, anomaly detection, narrative — never posts."
            />
            <Principle
              icon={CheckCircle2}
              label="Humans approve"
              text="Four-eyes review with rejection reasons and full state history."
            />
            <Principle
              icon={BookCheck}
              label="Engine validates"
              text="Double-entry, period locks, dimension rules, FX — hard guarantees."
            />
          </div>
          <div className="rounded-xl border border-canvas-200/70 bg-canvas-50/50 p-4">
            <div className="flex items-start gap-2">
              <WorkflowIcon className="h-4 w-4 text-gray-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-gray-600 leading-snug">
                A DHL invoice (or a bank-fed dividend, or a manual JE) enters at stage 1 and
                walks the same path every time. The accounting engine is the system of record;
                AI never posts directly.
              </p>
            </div>
          </div>
        </div>

        {/* Right: full-width diagram */}
        <div className="min-w-0">
          <FlowDiagram />
        </div>
      </div>

      {/* Stage-by-stage drill-down — 2-column grid on wide screens */}
      <div className="mt-8 mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Stage-by-stage detail</h2>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Click any box to open the live page where that step happens.
        </p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {STAGES.map((stage) => (
          <StageCard key={stage.n} stage={stage} />
        ))}
      </div>
    </div>
  );
}


// ── Hero Mermaid flow diagram (editable) ─────────────────────────────────

interface DiagramResp {
  id: number;
  code: string;
  name: string;
  description: string;
  mermaid_src: string;
  updated_by_email: string | null;
  updated_at: string;
}

function FlowDiagram() {
  const [diagram, setDiagram] = useState<DiagramResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<DiagramResp>("/beakon/workflow-diagrams/ENGINE_FLOW/")
      .then(setDiagram)
      .catch((e) => setErr(e?.error?.message || e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Esc closes fullscreen
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <div className="rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-6 h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900 truncate">
            {diagram?.name || "End-to-end engine flow"}
          </h2>
          <p className="text-[11px] text-gray-500 truncate">
            One transaction · one path · one audit trail
            {diagram?.updated_by_email && (
              <span className="ml-2 text-gray-400">
                · last edited by {diagram.updated_by_email}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setExpanded(true)}
            disabled={!diagram}
            className="btn-secondary text-xs disabled:opacity-50"
            title="Expand to full screen"
          >
            <Maximize2 className="w-3.5 h-3.5 mr-1" /> Expand
          </button>
          <button
            onClick={() => setEditing(true)}
            disabled={!diagram}
            className="btn-secondary text-xs disabled:opacity-50"
            title="Edit the Mermaid source"
          >
            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit diagram
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-12 text-center">Loading diagram…</p>
      ) : err ? (
        <p className="text-sm text-red-600 py-4">{err}</p>
      ) : diagram ? (
        <div className="flex-1 overflow-auto">
          <MermaidDiagram
            source={diagram.mermaid_src}
            id="engine-flow"
            className="w-full [&_svg]:!max-w-none [&_svg]:!w-full [&_svg]:h-auto"
          />
        </div>
      ) : null}

      {editing && diagram && (
        <EditDiagramDrawer
          diagram={diagram}
          onClose={() => setEditing(false)}
          onSaved={(d) => { setDiagram(d); setEditing(false); }}
        />
      )}

      {expanded && diagram && (
        <FullscreenDiagram
          diagram={diagram}
          onClose={() => setExpanded(false)}
          onEdit={() => { setExpanded(false); setEditing(true); }}
        />
      )}
    </div>
  );
}

/** Fullscreen overlay — diagram fills the viewport. Esc or X closes. */
function FullscreenDiagram({
  diagram, onClose, onEdit,
}: { diagram: DiagramResp; onClose: () => void; onEdit: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between p-3 border-b border-canvas-100">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900 truncate">
            {diagram.name}
          </h2>
          <p className="text-[11px] text-gray-500 truncate">
            {diagram.description || "End-to-end engine flow"}
            {diagram.updated_by_email && (
              <span className="ml-2 text-gray-400">
                · last edited by {diagram.updated_by_email}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onEdit} className="btn-secondary text-xs">
            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
          </button>
          <button onClick={() => window.print()} className="btn-secondary text-xs">
            Print
          </button>
          <button
            onClick={onClose}
            className="btn-secondary text-xs"
            title="Close (Esc)"
          >
            <Minimize2 className="w-3.5 h-3.5 mr-1" /> Exit
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6 bg-canvas-50/30">
        <MermaidDiagram
          source={diagram.mermaid_src}
          id="engine-flow-fullscreen"
          className="mx-auto [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:w-full"
        />
      </div>
      <div className="border-t border-canvas-100 px-3 py-1.5 text-[10px] text-gray-400 text-center">
        Press Esc or click Exit to return
      </div>
    </div>
  );
}

function EditDiagramDrawer({
  diagram, onClose, onSaved,
}: {
  diagram: DiagramResp;
  onClose: () => void;
  onSaved: (d: DiagramResp) => void;
}) {
  const [src, setSrc] = useState(diagram.mermaid_src);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const updated = await api.patch<DiagramResp>(
        `/beakon/workflow-diagrams/${diagram.code}/`,
        { mermaid_src: src },
      );
      onSaved(updated);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "Save failed";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setSrc(diagram.mermaid_src);

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full sm:w-[920px] bg-white border-l border-canvas-200 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <div>
            <h2 className="text-base font-semibold">Edit workflow diagram</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Mermaid <a className="text-brand-700 underline"
                         href="https://mermaid.js.org/syntax/flowchart.html"
                         target="_blank" rel="noreferrer">flowchart syntax</a>{" "}
              · live preview on the right
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden">
          <div className="flex flex-col border-r border-canvas-100 min-h-0">
            <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-b border-canvas-100 bg-canvas-50/50">
              Source
            </div>
            <textarea
              value={src}
              onChange={(e) => setSrc(e.target.value)}
              spellCheck={false}
              className="flex-1 p-4 font-mono text-xs text-gray-800 outline-none resize-none border-0 bg-white"
            />
          </div>
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-b border-canvas-100 bg-canvas-50/50">
              Live preview
            </div>
            <div className="flex-1 p-4 overflow-auto bg-canvas-50/30">
              <MermaidDiagram
                source={src}
                id="engine-flow-edit"
                className="[&_svg]:max-w-full [&_svg]:h-auto"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-canvas-100 p-3 flex items-center justify-between gap-2">
          {err ? (
            <p className="text-xs text-red-600 flex-1">{err}</p>
          ) : (
            <p className="text-[11px] text-gray-400 flex-1">
              Edits save to the database — every operator sees the new diagram on next load.
            </p>
          )}
          <div className="flex gap-2 shrink-0">
            <button onClick={reset} className="btn-secondary text-sm" disabled={busy}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
            </button>
            <button onClick={onClose} className="btn-secondary text-sm" disabled={busy}>
              Cancel
            </button>
            <button onClick={save} disabled={busy} className="btn-primary text-sm">
              <Save className="w-3.5 h-3.5 mr-1" />
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── (legacy hand-positioned SVG kept below as fallback reference, unused) ──

function _LegacyFlowDiagramSVG() {
  return (
    <div className="mt-6 rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-6 overflow-x-auto">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">
          End-to-end engine flow
        </h2>
        <p className="text-[11px] text-gray-500 hidden sm:block">
          One transaction · one path · one audit trail
        </p>
      </div>

      <svg
        viewBox="0 0 1200 1180"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto select-none"
        role="img"
        aria-label="Beakon engine workflow diagram"
      >
        <defs>
          {/* Arrowhead */}
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
          <marker
            id="arrow-mint"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
          </marker>
          <marker
            id="arrow-rose"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
          </marker>
        </defs>

        {/* ── Zone background bands ── */}
        <ZoneBand y={20}  height={90}  fill="#eff6ff" stroke="#bfdbfe" label="1. INTAKE" labelFill="#1e40af" />
        <ZoneBand y={130} height={90}  fill="#f5f3ff" stroke="#ddd6fe" label="2. AI ASSIST" labelFill="#6d28d9" />
        <ZoneBand y={240} height={90}  fill="#fef3c7" stroke="#fde68a" label="3. DRAFT" labelFill="#92400e" />
        <ZoneBand y={350} height={120} fill="#fff1f2" stroke="#fecdd3" label="4. ENGINE VALIDATION" labelFill="#9f1239" />
        <ZoneBand y={490} height={130} fill="#fef3c7" stroke="#fde68a" label="5. HUMAN REVIEW" labelFill="#92400e" />
        <ZoneBand y={640} height={90}  fill="#ecfdf5" stroke="#a7f3d0" label="6. POSTED LEDGER" labelFill="#065f46" />
        <ZoneBand y={750} height={170} fill="#eff6ff" stroke="#bfdbfe" label="7. DOWNSTREAM ENGINES" labelFill="#1e40af" />
        <ZoneBand y={940} height={90}  fill="#f3f4f6" stroke="#e5e7eb" label="8. REPORTS & EVIDENCE" labelFill="#374151" />

        {/* ── 1. Intake row (4 boxes) ── */}
        <Node x={80}   y={40} w={220} h={50} label="Bank CSV"          sub="BankTransaction (NEW)" tone="blue" />
        <Node x={350}  y={40} w={220} h={50} label="Supplier PDF"      sub="SourceDocument upload" tone="blue" />
        <Node x={620}  y={40} w={220} h={50} label="Manual JE"         sub="Operator types lines"  tone="blue" />
        <Node x={890}  y={40} w={220} h={50} label="Customer invoice" sub="Invoice + InvoiceLine[]" tone="blue" />

        {/* Bank CSV / Supplier PDF go through AI; Manual JE / Invoice skip to Draft */}
        <Edge d="M 190 90 L 190 130" />
        <Edge d="M 460 90 L 460 130" />
        <Edge d="M 730 90 C 730 200, 600 200, 600 250" />
        <Edge d="M 1000 90 C 1000 200, 600 200, 600 250" />

        {/* ── 2. AI Assist row (2 boxes) ── */}
        <Node x={80}  y={150} w={420} h={50} label="OCR + field extraction"
              sub="Amount · VAT · vendor · due date · reference" tone="violet" />
        <Node x={550} y={150} w={420} h={50} label="AI categorizer"
              sub="Suggest account · dimensions · rebillable flag" tone="violet" />
        <Edge d="M 290 200 L 290 220" />
        <Edge d="M 760 200 L 760 220" />
        <Edge d="M 290 220 L 600 220" />
        <Edge d="M 760 220 L 600 220" />
        <Edge d="M 600 220 L 600 250" />

        {/* ── 3. Draft staging (single wide box) ── */}
        <Node x={350} y={260} w={500} h={50} label="DRAFT staging"
              sub="Bill · Invoice · JE — operator reviews + edits" tone="amber" />
        <Edge d="M 600 310 L 600 350" />

        {/* ── 4. Validation row (4 checks) ── */}
        <Node x={80}   y={380} w={220} h={70} label="Double-entry balance"
              sub="DR sum = CR sum (functional ccy)" tone="rose" small />
        <Node x={330}  y={380} w={220} h={70} label="Period not closed"
              sub="Locked period blocks new posts" tone="rose" small />
        <Node x={580}  y={380} w={220} h={70} label="Dimension rules"
              sub="Tab 09 · 311 rules enforced live" tone="rose" small />
        <Node x={830}  y={380} w={290} h={70} label="FX rate captured"
              sub="Native + functional + rate per line" tone="rose" small />

        {/* All four converge to validation gate */}
        <Edge d="M 190 450 L 190 470 L 600 470 L 600 490" stroke="#f43f5e" arrow="arrow-rose" />
        <Edge d="M 440 450 L 440 470 L 600 470" stroke="#f43f5e" arrow="arrow-rose" />
        <Edge d="M 690 450 L 690 470 L 600 470" stroke="#f43f5e" arrow="arrow-rose" />
        <Edge d="M 975 450 L 975 470 L 600 470" stroke="#f43f5e" arrow="arrow-rose" />

        {/* ── 5. Human review — decision diamond + branches ── */}
        <Diamond cx={600} cy={555} w={260} h={70} label="All checks pass?" tone="amber" />

        {/* "No" branch — back to draft */}
        <Edge d="M 470 555 L 350 555 L 350 285" stroke="#f43f5e" arrow="arrow-rose" />
        <text x={460} y={545} fontSize="11" fill="#9f1239" fontWeight="600" textAnchor="end">No · returned</text>

        {/* "Yes" branch — proceed to approval */}
        <Edge d="M 600 590 L 600 605" />
        <text x={610} y={600} fontSize="11" fill="#15803d" fontWeight="600">Yes</text>

        <Node x={150} y={605} w={210} h={50} label="Submitted"
              sub="Status: PENDING_APPROVAL" tone="amber" small />
        <Node x={500} y={605} w={210} h={50} label="Reviewed"
              sub="Different user (4-eyes)" tone="amber" small />
        <Node x={840} y={605} w={210} h={50} label="Approved"
              sub="ApprovalAction logged" tone="amber" small />
        <Edge d="M 360 630 L 500 630" />
        <Edge d="M 710 630 L 840 630" />

        {/* Down to ledger */}
        <Edge d="M 945 655 L 945 670 L 600 670 L 600 695" stroke="#10b981" arrow="arrow-mint" />

        {/* ── 6. Posted ledger ── */}
        <Node x={350} y={660} w={500} h={50} label="POSTED to ledger"
              sub="Immutable · AuditEvent + ApprovalAction trail" tone="mint" />
        <Edge d="M 600 710 L 600 760" stroke="#10b981" arrow="arrow-mint" />

        {/* ── 7. Downstream engines (fan-out 5) ── */}
        <Node x={40}   y={770} w={210} h={70} label="Recognition"
              sub="Multi-period auto-JE per schedule" tone="brand" small />
        <Node x={270}  y={770} w={210} h={70} label="VAT routing"
              sub="Output VAT · Input VAT split" tone="brand" small />
        <Node x={500}  y={770} w={210} h={70} label="Disbursements"
              sub="Rebill cost → client invoice" tone="brand" small />
        <Node x={730}  y={770} w={210} h={70} label="FX revaluation"
              sub="Period-end re-translation" tone="brand" small />
        <Node x={960}  y={770} w={200} h={70} label="Period close"
              sub="P&L → Retained Earnings" tone="brand" small />

        {/* Lines from posted to each engine */}
        <Edge d="M 600 760 L 145 770" />
        <Edge d="M 600 760 L 375 770" />
        <Edge d="M 600 760 L 605 770" />
        <Edge d="M 600 760 L 835 770" />
        <Edge d="M 600 760 L 1060 770" />

        {/* From engines down to reports */}
        <Edge d="M 145 840 L 145 880 L 300 880 L 300 950" />
        <Edge d="M 375 840 L 375 880 L 450 880 L 450 950" />
        <Edge d="M 605 840 L 605 880 L 600 880 L 600 950" />
        <Edge d="M 835 840 L 835 880 L 750 880 L 750 950" />
        <Edge d="M 1060 840 L 1060 880 L 900 880 L 900 950" />

        {/* ── 8. Reports row ── */}
        <Node x={150} y={960} w={200} h={50} label="Trial Balance"     sub="Live · drillable"     tone="gray" small />
        <Node x={365} y={960} w={170} h={50} label="P&L · BS · CF"     sub="Period reports"       tone="gray" small />
        <Node x={550} y={960} w={170} h={50} label="VAT report"        sub="Output − Input = Net" tone="gray" small />
        <Node x={735} y={960} w={170} h={50} label="AR / AP aging"     sub="Outstanding bal."     tone="gray" small />
        <Node x={920} y={960} w={170} h={50} label="Audit trail"       sub="Every state change"   tone="gray" small />

        {/* Bottom legend */}
        <text x={20} y={1050} fontSize="11" fill="#475569" fontWeight="600">
          Legend:
        </text>
        <LegendDot x={90}  y={1046} fill="#3b82f6" label="Intake / Reports" />
        <LegendDot x={270} y={1046} fill="#8b5cf6" label="AI assist" />
        <LegendDot x={395} y={1046} fill="#f59e0b" label="Human / Draft" />
        <LegendDot x={555} y={1046} fill="#f43f5e" label="Engine validation" />
        <LegendDot x={720} y={1046} fill="#10b981" label="Posted (immutable)" />
        <LegendDot x={895} y={1046} fill="#0ea5e9" label="Downstream engines" />

        <text x={20} y={1095} fontSize="11" fill="#64748b">
          AI never posts. Engine refuses bad data. Humans approve. Every transition is logged.
        </text>
        <text x={20} y={1118} fontSize="11" fill="#64748b">
          Architecture PDF (2026-04-30) Layer 4 — &ldquo;The accounting engine is the system of record.&rdquo;
        </text>
      </svg>
    </div>
  );
}


// ── SVG primitives ───────────────────────────────────────────────────────

const TONES: Record<string, { fill: string; stroke: string; text: string; sub: string }> = {
  blue:   { fill: "#dbeafe", stroke: "#60a5fa", text: "#1e3a8a", sub: "#1d4ed8" },
  violet: { fill: "#ede9fe", stroke: "#a78bfa", text: "#4c1d95", sub: "#6d28d9" },
  amber:  { fill: "#fef3c7", stroke: "#fbbf24", text: "#78350f", sub: "#b45309" },
  rose:   { fill: "#ffe4e6", stroke: "#fb7185", text: "#881337", sub: "#be123c" },
  mint:   { fill: "#d1fae5", stroke: "#34d399", text: "#064e3b", sub: "#047857" },
  brand:  { fill: "#dbeafe", stroke: "#0ea5e9", text: "#0c4a6e", sub: "#0369a1" },
  gray:   { fill: "#f3f4f6", stroke: "#9ca3af", text: "#1f2937", sub: "#4b5563" },
};

function ZoneBand({
  y, height, fill, stroke, label, labelFill,
}: { y: number; height: number; fill: string; stroke: string; label: string; labelFill: string }) {
  return (
    <g>
      <rect x={10} y={y} width={1180} height={height} rx={10} fill={fill} stroke={stroke} strokeWidth={1} />
      <text x={1180} y={y + 18} fontSize="10" fontWeight="700" fill={labelFill} textAnchor="end" letterSpacing="0.06em">
        {label}
      </text>
    </g>
  );
}

function Node({
  x, y, w, h, label, sub, tone, small,
}: {
  x: number; y: number; w: number; h: number;
  label: string; sub?: string; tone: string; small?: boolean;
}) {
  const t = TONES[tone] ?? TONES.gray;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="white" stroke={t.stroke} strokeWidth={1.5} />
      <rect x={x} y={y} width={4} height={h} rx={2} fill={t.stroke} />
      <text x={x + 16} y={y + (small ? 26 : 22)} fontSize={small ? 12 : 13} fontWeight="700" fill={t.text}>
        {label}
      </text>
      {sub && (
        <text x={x + 16} y={y + (small ? 46 : 40)} fontSize="11" fill={t.sub}>
          {sub}
        </text>
      )}
    </g>
  );
}

function Diamond({
  cx, cy, w, h, label, tone,
}: { cx: number; cy: number; w: number; h: number; label: string; tone: string }) {
  const t = TONES[tone] ?? TONES.gray;
  const points = `${cx},${cy - h/2} ${cx + w/2},${cy} ${cx},${cy + h/2} ${cx - w/2},${cy}`;
  return (
    <g>
      <polygon points={points} fill="white" stroke={t.stroke} strokeWidth={1.5} />
      <text x={cx} y={cy + 5} fontSize="13" fontWeight="700" fill={t.text} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function Edge({ d, stroke = "#94a3b8", arrow = "arrow" }: { d: string; stroke?: string; arrow?: string }) {
  return (
    <path d={d} stroke={stroke} strokeWidth={1.5} fill="none" markerEnd={`url(#${arrow})`} strokeDasharray="0" />
  );
}

function LegendDot({ x, y, fill, label }: { x: number; y: number; fill: string; label: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={5} fill={fill} />
      <text x={x + 10} y={y + 4} fontSize="10" fill="#475569">{label}</text>
    </g>
  );
}


// ── Stage card ────────────────────────────────────────────────────────────

const ACCENTS: Record<StageSpec["accent"], { ring: string; bg: string; chip: string; text: string }> = {
  blue:   { ring: "ring-blue-200",    bg: "bg-blue-50/50",    chip: "bg-blue-100 text-blue-700",       text: "text-blue-800"   },
  violet: { ring: "ring-violet-200",  bg: "bg-violet-50/50",  chip: "bg-violet-100 text-violet-700",   text: "text-violet-800" },
  amber:  { ring: "ring-amber-200",   bg: "bg-amber-50/50",   chip: "bg-amber-100 text-amber-700",     text: "text-amber-800"  },
  rose:   { ring: "ring-rose-200",    bg: "bg-rose-50/50",    chip: "bg-rose-100 text-rose-700",       text: "text-rose-800"   },
  mint:   { ring: "ring-mint-200",    bg: "bg-mint-50/50",    chip: "bg-mint-100 text-mint-700",       text: "text-mint-800"   },
  brand:  { ring: "ring-brand-200",   bg: "bg-brand-50/50",   chip: "bg-brand-100 text-brand-700",     text: "text-brand-800"  },
  gray:   { ring: "ring-canvas-200",  bg: "bg-canvas-50",     chip: "bg-canvas-200 text-gray-700",     text: "text-gray-800"   },
};

function StageCard({ stage }: { stage: StageSpec }) {
  const a = ACCENTS[stage.accent];
  return (
    <div className={`rounded-2xl ring-1 ring-inset ${a.ring} ${a.bg} p-5`}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${a.chip} text-xs font-semibold`}>
          {stage.n}
        </span>
        <h2 className={`text-base font-semibold tracking-tight ${a.text}`}>{stage.name}</h2>
      </div>
      <p className="text-sm text-gray-600 leading-relaxed mb-4">{stage.blurb}</p>
      <div className={`grid gap-2 ${
        stage.steps.length <= 3 ? "sm:grid-cols-3" :
        stage.steps.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" :
        "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      }`}>
        {stage.steps.map((step) => <StepBox key={step.title} step={step} />)}
      </div>
    </div>
  );
}

function StepBox({ step }: { step: StepSpec }) {
  const Icon = step.icon;
  const inner = (
    <div className="rounded-lg bg-white p-3 ring-1 ring-inset ring-canvas-200/70 hover:ring-brand-200 hover:shadow-[0_2px_6px_rgba(15,23,42,0.04)] transition-all h-full">
      <div className="flex items-start gap-2">
        <div className="h-7 w-7 shrink-0 rounded-md bg-canvas-50 ring-1 ring-inset ring-canvas-200 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-gray-600" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 leading-snug">{step.title}</p>
          <p className="mt-1 text-[11px] text-gray-500 leading-snug">{step.detail}</p>
        </div>
      </div>
    </div>
  );
  return step.href ? <Link href={step.href}>{inner}</Link> : inner;
}


// ── Connector between stages ─────────────────────────────────────────────

function Connector() {
  return (
    <div className="flex justify-center py-1.5" aria-hidden="true">
      <ArrowDown className="h-4 w-4 text-gray-300" />
    </div>
  );
}


// ── Principle chips at the top ───────────────────────────────────────────

function Principle({ icon: Icon, label, text }: { icon: LucideIcon; label: string; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="h-9 w-9 shrink-0 rounded-lg bg-brand-50 ring-1 ring-inset ring-brand-100 flex items-center justify-center">
        <Icon className="h-4 w-4 text-brand-700" />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
          {label}
        </p>
        <p className="text-xs text-gray-700 leading-snug">{text}</p>
      </div>
    </div>
  );
}


// ── Card footer ──────────────────────────────────────────────────────────

function CardFooter() {
  return (
    <div className="mt-8 rounded-xl border border-canvas-200/70 bg-canvas-50/50 p-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 shrink-0 rounded-lg bg-white ring-1 ring-inset ring-canvas-200 flex items-center justify-center">
          <WorkflowIcon className="h-4 w-4 text-gray-600" />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-900">
            One transaction · one path · one audit trail
          </p>
          <p className="mt-1 text-[11px] text-gray-500 leading-snug max-w-3xl">
            A DHL invoice (or a bank-fed dividend, or a manual JE) enters at stage 1 and
            walks the same path every time. The accounting engine is the system of record;
            AI never posts directly. Every stage is traceable: report line ↔ journal entry ↔
            source document ↔ audit row.
          </p>
        </div>
      </div>
    </div>
  );
}
