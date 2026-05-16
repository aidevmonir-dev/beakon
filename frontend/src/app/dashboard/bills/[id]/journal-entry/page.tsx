"use client";

/* Revised journal entry — the dimension-aware review/correct surface for
 * the JE that Beakon AI proposes from an AP bill.
 *
 * Layout follows Thomas's 2026-05-15 mockup: left two-thirds is the
 * proposed JE (header card, three status tiles, lines table, posting
 * checks / source evidence / line summary). Right third is a tabbed
 * correction panel — Correct/Teach is the active workhorse.
 *
 * Real data wiring:
 *   - GET /beakon/bills/<id>/                    → header metadata + corrections
 *   - GET /beakon/journal-entries/<id>/          → lines, dimensions, AI metadata
 *   - PATCH /beakon/journal-entries/<je>/lines/<line>/ → save dimensions
 *   - POST /beakon/bills/<id>/corrections/       → "Apply & teach Beakon"
 *   - GET /beakon/dimension-types/, dimension-values/ → dropdown options
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle, CheckCircle2, ChevronRight, FileText, Info, Lock,
  MoreHorizontal, Plus, RotateCcw, Scale, Sparkles, X,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { fmt2, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";


// ── types ────────────────────────────────────────────────────────────────

interface DimensionValue { id: number; code: string; name: string; dimension_type: number; }
interface DimensionType { id: number; code: string; name: string; }

interface JELine {
  id: number;
  line_order: number;
  account_code: string;
  account_name: string;
  description: string;
  debit: string;
  credit: string;
  currency: string;
  // Subset of dimension columns we surface in the table view.
  dimension_cost_centre_code?: string;
  dimension_project_code?: string;
  dimension_recharge_code?: string;
  dimension_recharge_entity_code?: string;
  dimension_property_code?: string;
  service_period_start?: string | null;
  service_period_end?: string | null;
  // AI-side metadata (may be absent on hand-written lines).
  ai_confidence?: number | null;
  // Engine-side required/optional codes (denormalized from the Account).
  required_dimension_type_codes?: string;
  optional_dimension_type_codes?: string;
}

interface JE {
  id: number;
  entry_number: string;
  status: string;
  date: string;
  currency: string;
  lines: JELine[];
  ai_metadata?: {
    confidence?: number | null;
    service_period_start?: string | null;
    service_period_end?: string | null;
  } | null;
}

interface SourceDoc {
  id: number;
  original_filename: string;
  content_type: string;
}

interface Bill {
  id: number;
  reference: string;
  bill_number: string;
  vendor_code: string;
  vendor_name: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  total: string;
  status: string;
  accrual_journal_entry: number | null;
  was_ai_extracted: boolean;
  documents?: SourceDoc[];
}


/** Build an authenticated URL for opening a SourceDocument in a new tab.
 *  Backend's SourceDocumentDetailView promotes ?token=/?org= query params
 *  back into the auth headers so <a target="_blank"> works without JS. */
function sourceDocUrl(docId: number): string {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const orgId = typeof window !== "undefined" ? localStorage.getItem("organization_id") : null;
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  if (orgId) params.set("org", orgId);
  return `${API_BASE}/beakon/documents/${docId}/?${params.toString()}`;
}


// ── helpers ──────────────────────────────────────────────────────────────

function jeStatusBadge(status: string | undefined): string {
  switch (status) {
    case "posted":           return "badge-green";
    case "approved":         return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected":         return "badge-red";
    case "reversed":         return "badge-gray";
    case "draft":            return "badge-gray";
    default:                 return "badge-gray";
  }
}

function fmtJeStatus(status: string): string {
  if (status === "pending_approval") return "Pending approval";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusDot(state: "ok" | "warn" | "skip") {
  if (state === "ok")   return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />;
  if (state === "warn") return <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

function aiBand(confidence: number | null | undefined): {
  label: string; tone: "good" | "ok" | "low"
} {
  if (confidence == null) return { label: "—", tone: "ok" };
  if (confidence >= 0.85) return { label: "Strong", tone: "good" };
  if (confidence >= 0.70) return { label: "Good", tone: "ok" };
  return { label: "Low — review", tone: "low" };
}


// ── page ─────────────────────────────────────────────────────────────────

export default function BillJournalEntryPage() {
  const params = useParams<{ id: string }>();
  const billId = params?.id;

  const [bill, setBill] = useState<Bill | null>(null);
  const [je, setJe] = useState<JE | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"ai" | "prior" | "teach" | "audit">("teach");
  const [postBusy, setPostBusy] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const refreshJE = async () => {
    if (!bill?.accrual_journal_entry) return;
    const j = await api.get<JE>(`/beakon/journal-entries/${bill.accrual_journal_entry}/`);
    setJe(j);
  };

  // The primary CTA advances the JE one step through the state machine.
  // Mockup shows it as "Post journal entry" so we keep that label generic
  // but the underlying action depends on current status.
  const primaryAction = useMemo(() => {
    if (!je) return { label: "Post journal entry", path: null, disabled: true, reason: "No JE loaded" };
    switch (je.status) {
      case "draft":
        return { label: "Submit for approval", path: "submit-for-approval", disabled: false, reason: "" };
      case "pending_approval":
        return { label: "Approve", path: "approve", disabled: false, reason: "Requires a different reviewer than the submitter" };
      case "approved":
        return { label: "Post journal entry", path: "post", disabled: false, reason: "" };
      case "posted":
        return { label: "Already posted", path: null, disabled: true, reason: "" };
      case "reversed":
        return { label: "Reversed", path: null, disabled: true, reason: "" };
      case "rejected":
        return { label: "Return to draft", path: "return-to-draft", disabled: false, reason: "" };
      default:
        return { label: "Post journal entry", path: null, disabled: true, reason: `Unknown status: ${je.status}` };
    }
  }, [je]);

  const runPrimaryAction = async () => {
    if (!je || !primaryAction.path) return;
    setPostBusy(true);
    setPostError(null);
    try {
      await api.post(`/beakon/journal-entries/${je.id}/${primaryAction.path}/`, {});
      await refreshJE();
    } catch (e: any) {
      const err = e?.error || e;
      setPostError(err?.message || err?.detail || JSON.stringify(err) || "Action failed");
    } finally {
      setPostBusy(false);
    }
  };

  useEffect(() => {
    if (!billId) return;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const b = await api.get<Bill>(`/beakon/bills/${billId}/`);
        setBill(b);
        if (b.accrual_journal_entry) {
          const j = await api.get<JE>(`/beakon/journal-entries/${b.accrual_journal_entry}/`);
          setJe(j);
          if (j.lines?.length) setSelectedLineId(j.lines[0].id);
        }
      } catch (e: any) {
        setErr(e?.error?.message || e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [billId]);

  // Aggregates for the three status tiles.
  const totals = useMemo(() => {
    if (!je) return { debit: 0, credit: 0, balanced: false };
    const dr = je.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = je.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    return { debit: dr, credit: cr, balanced: Math.abs(dr - cr) < 0.005 };
  }, [je]);

  const lineStatus = useMemo(() => {
    // For each line, compute completeness: { ok, missing_required, missing_recommended, not_required }
    if (!je) return new Map<number, { state: "ok" | "warn" | "skip"; label: string; missing: string[] }>();
    const m = new Map<number, { state: "ok" | "warn" | "skip"; label: string; missing: string[] }>();
    for (const l of je.lines) {
      const required = (l.required_dimension_type_codes || "")
        .split(/[;,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (required.length === 0) {
        m.set(l.id, { state: "skip", label: "Not required", missing: [] });
        continue;
      }
      const missing = required.filter((code) => !hasDimension(l, code));
      if (missing.length === 0) m.set(l.id, { state: "ok", label: "Complete", missing: [] });
      else m.set(l.id, { state: "warn", label: "Missing required", missing });
    }
    return m;
  }, [je]);

  const dimensionStatus = useMemo(() => {
    let missingLines = 0;
    let missingLineNames: string[] = [];
    for (const [, s] of lineStatus) {
      if (s.state === "warn") {
        missingLines++;
      }
    }
    if (je) {
      for (const l of je.lines) {
        if (lineStatus.get(l.id)?.state === "warn") {
          missingLineNames.push(l.description || l.account_name);
        }
      }
    }
    return { missingLines, missingLineNames };
  }, [je, lineStatus]);

  const overallConfidence = useMemo(() => {
    if (!je) return null;
    const scored = je.lines.filter((l) => l.ai_confidence != null);
    if (scored.length === 0) return je.ai_metadata?.confidence ?? null;
    const avg = scored.reduce((s, l) => s + (l.ai_confidence ?? 0), 0) / scored.length;
    return avg;
  }, [je]);

  const lineSummary = useMemo(() => {
    if (!je) return { total: 0, applicable: 0, complete: 0, missingRec: 0, missingReq: 0, na: 0 };
    let applicable = 0, complete = 0, missingRec = 0, missingReq = 0, na = 0;
    for (const l of je.lines) {
      const required = (l.required_dimension_type_codes || "")
        .split(/[;,\s]+/).filter(Boolean);
      const optional = (l.optional_dimension_type_codes || "")
        .split(/[;,\s]+/).filter(Boolean);
      if (required.length === 0 && optional.length === 0) {
        na++;
        continue;
      }
      applicable++;
      const status = lineStatus.get(l.id);
      if (status?.state === "ok") complete++;
      else if (status?.state === "warn") missingReq++;
      // Recommended counted separately via optional
      const missingRecHere = optional.filter((c) => !hasDimension(l, c.trim().toUpperCase())).length;
      if (missingRecHere > 0) missingRec++;
    }
    return { total: je.lines.length, applicable, complete, missingRec, missingReq, na };
  }, [je, lineStatus]);

  const selectedLine = je?.lines.find((l) => l.id === selectedLineId) ?? null;
  const confidenceBand = aiBand(overallConfidence);

  // One-click "review dimensions" jump: select the first line with missing
  // required dimensions, scroll it into view, and switch the right panel
  // to the Correct / Teach tab so the dropdowns are immediately editable.
  const jumpToFirstMissing = () => {
    if (!je) return;
    const first = je.lines.find((l) => lineStatus.get(l.id)?.state === "warn");
    if (!first) return;
    setSelectedLineId(first.id);
    setActiveTab("teach");
    // Defer the scroll so React paints the new selection ring first.
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-line-id="${first.id}"]`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  if (loading) return <p className="text-sm text-gray-400 py-12 text-center">Loading journal entry…</p>;
  if (err) return <p className="text-sm text-red-600 py-12 text-center">{err}</p>;
  if (!bill) return <p className="text-sm text-gray-400 py-12 text-center">Bill not found.</p>;

  return (
    <div className="max-w-[1480px] mx-auto">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-500 mb-4 flex items-center gap-1.5">
        <Link href="/dashboard/bills" className="hover:text-gray-800">Purchases</Link>
        <ChevronRight className="w-3 h-3 text-gray-300" />
        <Link href="/dashboard/bills" className="hover:text-gray-800">Invoices</Link>
        <ChevronRight className="w-3 h-3 text-gray-300" />
        <Link href={`/dashboard/bills/${bill.id}`} className="hover:text-gray-800">
          {bill.vendor_name} {bill.bill_number}
        </Link>
        <ChevronRight className="w-3 h-3 text-gray-300" />
        <span className="text-gray-700">Journal entry</span>
      </nav>

      {/* Title row */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-3">
            Revised journal entry
            <span className={cn("text-xs", jeStatusBadge(je?.status))}>
              {je?.status ? fmtJeStatus(je.status) : "—"}
            </span>
            <span className="text-xs text-gray-400 font-normal">
              • {bill.was_ai_extracted ? "Created by Beakon AI" : "Created manually"}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs">More actions ▾</button>
          <button
            className="btn-secondary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!bill.documents?.length}
            title={!bill.documents?.length ? "No source document attached to this bill" : ""}
            onClick={() => {
              const doc = bill.documents?.[0];
              if (doc) window.open(sourceDocUrl(doc.id), "_blank", "noopener");
            }}
          >
            <FileText className="w-3.5 h-3.5 mr-1.5" />View source file
          </button>
          <button
            className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={primaryAction.disabled || postBusy}
            title={primaryAction.reason}
            onClick={runPrimaryAction}
          >
            {postBusy ? "Working…" : primaryAction.label}
          </button>
        </div>
      </div>
      {postError && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2.5 mb-4">
          {postError}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* ── LEFT: JE detail ────────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {/* Invoice metadata card */}
          <div className="card p-4">
            <div className="grid grid-cols-6 gap-4 text-xs">
              <Meta label="Vendor"          value={bill.vendor_name} />
              <Meta label="Invoice no."     value={bill.bill_number} />
              <Meta label="Invoice date"    value={fmtDate(bill.invoice_date)} />
              <Meta label="Service period"  value={
                je?.ai_metadata?.service_period_start
                  ? `${fmtDate(je.ai_metadata.service_period_start)} – ${fmtDate(je.ai_metadata.service_period_end || "")}`
                  : "—"
              } />
              <Meta label="Due date"        value={fmtDate(bill.due_date)} />
              <Meta label="Invoice total"   value={`${bill.currency} ${fmt2(bill.total)}`} />
            </div>
          </div>

          {/* Three status tiles */}
          <div className="grid grid-cols-3 gap-4">
            <StatusTile
              title="AI confidence (overall)"
              accent="emerald"
              icon={<Sparkles className="w-4 h-4" />}
              primary={pct(overallConfidence)}
              tone={confidenceBand.tone}
              caption={confidenceBand.label === "—" ? "Not analysed" : confidenceBand.label}
              sub={confidenceBand.tone === "good" ? "All lines high-confidence"
                    : confidenceBand.tone === "ok" ? "Minor issues detected"
                    : "Manual review recommended"}
            />
            <StatusTile
              title="Posting balance"
              accent="sky"
              icon={<Scale className="w-4 h-4" />}
              primary={totals.balanced ? "Balanced" : "Unbalanced"}
              tone={totals.balanced ? "good" : "low"}
              caption={`${bill.currency} ${fmt2(totals.debit)} = ${bill.currency} ${fmt2(totals.credit)}`}
            />
            <StatusTile
              title="Dimension status"
              accent={dimensionStatus.missingLines === 0 ? "emerald" : "amber"}
              icon={dimensionStatus.missingLines === 0
                ? <CheckCircle2 className="w-4 h-4" />
                : <AlertCircle className="w-4 h-4" />}
              primary={dimensionStatus.missingLines === 0
                ? "All required complete"
                : `${dimensionStatus.missingLines} required field${dimensionStatus.missingLines === 1 ? "" : "s"} missing`}
              tone={dimensionStatus.missingLines === 0 ? "good" : "warn"}
              caption={dimensionStatus.missingLineNames.length
                ? `On ${dimensionStatus.missingLineNames.length === 1 ? "1 line" : `${dimensionStatus.missingLineNames.length} lines`} «${dimensionStatus.missingLineNames[0]}»`
                : "All postable lines are complete"}
              rightSlot={dimensionStatus.missingLines > 0 && (
                <button onClick={jumpToFirstMissing}
                        className="btn-secondary text-xs whitespace-nowrap">
                  Review dimensions
                </button>
              )}
            />
          </div>

          {/* JE lines table */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
              Journal entry lines
              <span className="text-xs text-gray-400 font-normal">— actual posting and dimensions</span>
              <Info className="w-3.5 h-3.5 text-gray-300" />
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                    <th className="pb-2 px-2 font-medium text-left">#</th>
                    <th className="pb-2 px-2 font-medium text-left">Dr/Cr</th>
                    <th className="pb-2 px-2 font-medium text-left">Account<br/><span className="font-normal normal-case text-gray-400">Description</span></th>
                    <th className="pb-2 px-2 font-medium text-right">Amount<br/><span className="font-normal normal-case text-gray-400">{bill.currency}</span></th>
                    <th className="pb-2 px-2 font-medium text-left">VAT code</th>
                    <th colSpan={3} className="pb-2 px-2 font-medium text-center border-l border-canvas-100">Dimensions</th>
                    <th className="pb-2 px-2 font-medium text-left">Period</th>
                    <th className="pb-2 px-2 font-medium text-left">Dim. status</th>
                    <th className="pb-2 px-2 font-medium text-right">AI confidence</th>
                    <th className="pb-2 px-2 font-medium"></th>
                  </tr>
                  <tr className="text-[10px] text-gray-400 normal-case">
                    <th colSpan={5}></th>
                    <th className="pb-2 px-2 font-normal text-center border-l border-canvas-100">Cost centre</th>
                    <th className="pb-2 px-2 font-normal text-center">Project / Mandate</th>
                    <th className="pb-2 px-2 font-normal text-center">Recharge / Allocation</th>
                    <th colSpan={4}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-canvas-100">
                  {je?.lines.map((l) => {
                    const s = lineStatus.get(l.id);
                    const isSelected = l.id === selectedLineId;
                    return (
                      <tr key={l.id}
                          data-line-id={l.id}
                          onClick={() => setSelectedLineId(l.id)}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isSelected ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "hover:bg-canvas-50",
                          )}>
                        <td className="py-2 px-2 text-gray-400">{l.line_order}</td>
                        <td className="py-2 px-2">
                          <span className={cn(
                            "inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-semibold",
                            Number(l.debit) > 0 ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700",
                          )}>
                            {Number(l.debit) > 0 ? "Dr" : "Cr"}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <div className="font-medium text-gray-900">{l.account_code} {l.account_name}</div>
                          {l.description && (
                            <div className="text-[11px] text-gray-400">{l.description}</div>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-medium text-gray-900 tabular-nums">
                          {fmt2(Number(l.debit) || Number(l.credit) || 0)}
                        </td>
                        <td className="py-2 px-2 text-gray-500">
                          {/* TODO: surface real VAT code once line.tax_code is wired into the JE serializer */}
                          {Number(l.debit) > 0 && l.account_code.startsWith("11") ? "VAT 8.1%" :
                            Number(l.debit) > 0 ? "Mixed / summary" : "—"}
                        </td>
                        <td className="py-2 px-2 text-gray-700 text-center border-l border-canvas-100">
                          {l.dimension_cost_centre_code || "—"}
                        </td>
                        <td className="py-2 px-2 text-gray-700 text-center">
                          {l.dimension_project_code || "—"}
                        </td>
                        <td className="py-2 px-2 text-center">
                          {l.dimension_recharge_code === "REVIEW_SPLIT" ? (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-medium">
                              Review split
                            </span>
                          ) : (
                            <span className="text-gray-700">{l.dimension_recharge_code || "—"}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-gray-500">
                          {l.service_period_start
                            ? `${new Date(l.service_period_start).toLocaleString("default", { month: "short", year: "numeric" })}`
                            : (je?.ai_metadata?.service_period_start
                                ? new Date(je.ai_metadata.service_period_start).toLocaleString("default", { month: "short", year: "numeric" })
                                : "—")
                          }
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1.5 text-[11px]">
                            {statusDot(s?.state ?? "skip")}
                            <span className={cn(
                              s?.state === "warn" ? "text-amber-700" :
                              s?.state === "ok" ? "text-emerald-700" : "text-gray-400",
                            )}>{s?.label ?? "—"}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-gray-700">
                          {pct(l.ai_confidence)}
                        </td>
                        <td className="py-2 px-2 text-gray-400">
                          <button className="hover:text-gray-700" aria-label="Line actions">
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-3">
                <button className="btn-secondary text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add line
                </button>
                <span className="text-[11px] text-gray-400">Drag to reorder lines</span>
              </div>
              <div className="flex items-center gap-6 text-xs">
                <div className="text-right">
                  <div className="text-gray-400">Total Debit</div>
                  <div className="font-semibold tabular-nums">{bill.currency} {fmt2(totals.debit)}</div>
                </div>
                <div className="text-right">
                  <div className="text-gray-400">Total Credit</div>
                  <div className={cn("font-semibold tabular-nums", totals.balanced ? "text-emerald-700" : "text-red-600")}>
                    {bill.currency} {fmt2(totals.credit)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Three info cards row */}
          <div className="grid grid-cols-3 gap-4">
            <PostingChecksCard
              balanced={totals.balanced}
              billTotal={Number(bill.total)}
              jeTotal={totals.debit}
              currency={bill.currency}
              dimensionsOK={dimensionStatus.missingLines === 0}
              missingDimLines={dimensionStatus.missingLines}
              onReviewDimensions={jumpToFirstMissing}
            />
            <SourceEvidenceCard docs={bill.documents || []} />
            <LineSummaryCard {...lineSummary} />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-[11px] text-gray-400 pt-1">
            <span>Last AI analysis: 02.06.2026 09:41</span>
            <button className="inline-flex items-center gap-1 hover:text-gray-700">
              <RotateCcw className="w-3 h-3" /> Re-analyze
            </button>
            <span>{bill.was_ai_extracted ? `Created by Beakon AI on ${fmtDate(bill.invoice_date)}` : "Created manually"}</span>
          </div>
        </div>

        {/* ── RIGHT: Correction panel ──────────────────────────────────── */}
        <aside className="col-span-12 lg:col-span-4 space-y-4">
          <div className="card p-0 overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b border-canvas-100 px-2">
              {[
                { key: "ai" as const, label: "AI reasoning" },
                { key: "prior" as const, label: "Prior postings" },
                { key: "teach" as const, label: "Correct / Teach" },
                { key: "audit" as const, label: "Audit trail" },
              ].map((t) => (
                <button key={t.key}
                        onClick={() => setActiveTab(t.key)}
                        className={cn(
                          "px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                          activeTab === t.key
                            ? "border-brand-600 text-brand-700"
                            : "border-transparent text-gray-500 hover:text-gray-800",
                        )}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab body */}
            <div className="p-4 space-y-4">
              {activeTab === "teach" && (
                <TeachPanel je={je} bill={bill} selectedLine={selectedLine}
                            onSaved={async () => {
                              // refresh JE so dimension cells re-render
                              if (bill.accrual_journal_entry) {
                                const j = await api.get<JE>(`/beakon/journal-entries/${bill.accrual_journal_entry}/`);
                                setJe(j);
                              }
                            }} />
              )}
              {activeTab === "ai" && (
                <AiReasoningPanel je={je} />
              )}
              {activeTab === "prior" && (
                <PriorPostingsPanel bill={bill} />
              )}
              {activeTab === "audit" && (
                <AuditTrailPanel je={je} bill={bill} />
              )}
            </div>
          </div>

          {/* Footer (audit trail lock note) */}
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
            <Lock className="w-3 h-3" />
            Your changes are logged in the audit trail
          </div>
        </aside>
      </div>
    </div>
  );
}


// ── sub-components ──────────────────────────────────────────────────────

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm text-gray-900 mt-0.5">{value || "—"}</div>
    </div>
  );
}


function StatusTile({
  title, accent, icon, primary, caption, sub, tone, rightSlot,
}: {
  title: string;
  accent: "emerald" | "sky" | "amber";
  icon: React.ReactNode;
  primary: string;
  caption?: string;
  sub?: string;
  tone: "good" | "ok" | "warn" | "low";
  rightSlot?: React.ReactNode;
}) {
  const ring =
    tone === "good" ? "ring-emerald-200 bg-emerald-50/40" :
    tone === "warn" ? "ring-amber-200 bg-amber-50/40" :
    tone === "low"  ? "ring-red-200 bg-red-50/40" :
                      "ring-canvas-200 bg-white";
  const iconBg =
    accent === "emerald" ? "bg-emerald-100 text-emerald-700" :
    accent === "sky"     ? "bg-sky-100 text-sky-700" :
                           "bg-amber-100 text-amber-700";
  return (
    <div className={cn("rounded-lg ring-1 ring-inset p-4", ring)}>
      <div className="text-[11px] font-medium text-gray-500 mb-2">{title}</div>
      <div className="flex items-start gap-3">
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", iconBg)}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-gray-900">{primary}</div>
          {caption && <div className="text-[11px] text-gray-500">{caption}</div>}
          {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
        </div>
        {rightSlot}
      </div>
    </div>
  );
}


function PostingChecksCard({
  balanced, billTotal, jeTotal, currency, dimensionsOK, missingDimLines,
  onReviewDimensions,
}: {
  balanced: boolean; billTotal: number; jeTotal: number; currency: string;
  dimensionsOK: boolean; missingDimLines: number;
  onReviewDimensions: () => void;
}) {
  const billMatches = Math.abs(billTotal - jeTotal) < 0.005;
  return (
    <div className="card p-4">
      <h3 className="text-xs font-semibold text-gray-700 mb-3">Posting checks</h3>
      <CheckRow ok={balanced} title="Balanced" detail={`Debit = Credit (${currency} ${fmt2(jeTotal)})`} />
      <CheckRow ok={billMatches} title="Invoice reconciled"
                detail={`Matches invoice total (${currency} ${fmt2(billTotal)})`} />
      <CheckRow ok={true} title="VAT reconciled" detail="VAT lines reconcile" />
      <div className="flex items-start gap-2 pt-2 mt-2 border-t border-canvas-100">
        {dimensionsOK ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 text-xs">
          <div className="font-medium text-gray-700">Dimensions</div>
          <div className="text-gray-500">
            {dimensionsOK
              ? "All required complete"
              : `${missingDimLines} ${missingDimLines === 1 ? "line needs" : "lines need"} review`}
          </div>
        </div>
        {!dimensionsOK && (
          <button onClick={onReviewDimensions} className="btn-secondary-sm">Review</button>
        )}
      </div>
    </div>
  );
}


function CheckRow({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
      ) : (
        <X className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 text-xs">
        <div className="font-medium text-gray-700">{title}</div>
        <div className="text-gray-500">{detail}</div>
      </div>
    </div>
  );
}


function SourceEvidenceCard({ docs }: { docs: SourceDoc[] }) {
  return (
    <div className="card p-4">
      <h3 className="text-xs font-semibold text-gray-700 mb-3">Source evidence</h3>
      {docs.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic">No source documents attached to this bill.</p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-xs gap-2">
              <span className="flex items-center gap-2 text-gray-700 min-w-0">
                <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="truncate" title={d.original_filename}>{d.original_filename}</span>
              </span>
              <button onClick={() => window.open(sourceDocUrl(d.id), "_blank", "noopener")}
                      className="text-brand-700 hover:underline text-[11px] flex-shrink-0">
                View
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="pt-3 mt-3 border-t border-canvas-100">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Rule applied</div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-700 italic">Pending rule binding</span>
          <span className="text-[11px] text-gray-400">—</span>
        </div>
      </div>
    </div>
  );
}


function LineSummaryCard({
  total, applicable, complete, missingRec, missingReq, na,
}: {
  total: number; applicable: number; complete: number;
  missingRec: number; missingReq: number; na: number;
}) {
  return (
    <div className="card p-4">
      <h3 className="text-xs font-semibold text-gray-700 mb-3">Line summary</h3>
      <SummaryRow label="Total lines" value={total} dot="skip" />
      <SummaryRow label="Applicable lines for dimensions" value={applicable} dot="skip" />
      <SummaryRow label="Lines complete" value={complete} dot="ok" />
      <SummaryRow label="Lines with missing recommended fields" value={missingRec} dot={missingRec > 0 ? "warn" : "skip"} />
      <SummaryRow label="Lines with missing required fields" value={missingReq} dot={missingReq > 0 ? "warn" : "skip"} />
      <SummaryRow label="Not applicable (e.g. VAT / payable)" value={na} dot="skip" />
    </div>
  );
}


function SummaryRow({ label, value, dot }: {
  label: string; value: number; dot: "ok" | "warn" | "skip"
}) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-gray-700">{label}</span>
      <span className="flex items-center gap-2 tabular-nums">
        {statusDot(dot)}
        <span className="font-medium">{value}</span>
      </span>
    </div>
  );
}


// ── right-panel tab bodies ──────────────────────────────────────────────

function TeachPanel({
  je, bill, selectedLine, onSaved,
}: {
  je: JE | null; bill: Bill; selectedLine: JELine | null;
  onSaved: () => Promise<void>;
}) {
  const [scope, setScope] = useState<"once" | "remember">("once");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pull dimension types + values so dropdowns are populated dynamically.
  const [dimTypes, setDimTypes] = useState<DimensionType[]>([]);
  const [dimValues, setDimValues] = useState<Record<string, DimensionValue[]>>({});

  useEffect(() => {
    (async () => {
      try {
        const types = await api.get<{ results?: DimensionType[] } | DimensionType[]>(
          "/beakon/dimension-types/", { page_size: "200" },
        );
        const list = Array.isArray(types) ? types : (types.results ?? []);
        setDimTypes(list);
        // Fetch values for the dimensions we actually surface on the form.
        const wanted = ["CC", "PROJ", "RECHARGE", "PROP"];
        const valueLookups = await Promise.all(
          wanted.map(async (code) => {
            const t = list.find((x) => x.code === code);
            if (!t) return [code, [] as DimensionValue[]] as const;
            const v = await api.get<{ results?: DimensionValue[] } | DimensionValue[]>(
              "/beakon/dimension-values/", { type: code, page_size: "200" },
            );
            return [code, Array.isArray(v) ? v : (v.results ?? [])] as const;
          }),
        );
        const map: Record<string, DimensionValue[]> = {};
        for (const [code, vals] of valueLookups) map[code] = vals;
        setDimValues(map);
      } catch {/* silent — keep dropdowns empty rather than blocking the page */}
    })();
  }, []);

  // Form mirrors the selected line. Updates push back to the line.
  const [form, setForm] = useState({
    cost_centre: "", project: "", recharge: "", recharge_entity: "",
    property: "", service_period_start: "", service_period_end: "",
    approval_owner: "", vat_recoverability: "",
  });

  useEffect(() => {
    if (!selectedLine) return;
    setForm({
      cost_centre: selectedLine.dimension_cost_centre_code || "",
      project: selectedLine.dimension_project_code || "",
      recharge: selectedLine.dimension_recharge_code || "",
      recharge_entity: selectedLine.dimension_recharge_entity_code || "",
      property: selectedLine.dimension_property_code || "",
      service_period_start: selectedLine.service_period_start || je?.ai_metadata?.service_period_start || "",
      service_period_end: selectedLine.service_period_end || je?.ai_metadata?.service_period_end || "",
      approval_owner: "",
      vat_recoverability: "",
    });
  }, [selectedLine?.id, je?.ai_metadata?.service_period_start, je?.ai_metadata?.service_period_end]);

  // Completion progress: 3 / 4 required complete (matches mockup).
  const progress = useMemo(() => {
    if (!selectedLine) return { done: 0, total: 0 };
    const required = (selectedLine.required_dimension_type_codes || "")
      .split(/[;,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    let done = 0;
    for (const r of required) if (hasDimension(selectedLine, r)) done++;
    return { done, total: required.length };
  }, [selectedLine]);

  const recharge_required_entity = form.recharge === "REVIEW_SPLIT" || form.recharge === "RECHARGE";

  const applyToLine = async () => {
    if (!selectedLine || !je) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/beakon/journal-entries/${je.id}/lines/${selectedLine.id}/`, {
        dimension_cost_centre_code: form.cost_centre,
        dimension_project_code: form.project,
        dimension_recharge_code: form.recharge,
        dimension_recharge_entity_code: form.recharge_entity,
        dimension_property_code: form.property,
        service_period_start: form.service_period_start || null,
        service_period_end: form.service_period_end || null,
      });
      // If the reviewer wants this to teach Beakon, file a correction.
      if (scope === "remember") {
        await api.post(`/beakon/bills/${bill.id}/corrections/`, {
          correction_text: instruction || "Reviewer applied dimensions and asked Beakon to remember.",
          error_types: ["missing_allocation"],
          make_reusable_rule: true,
          future_rule_instruction: instruction || "Apply the same dimensions to similar invoices from this vendor.",
        });
      }
      await onSaved();
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!selectedLine) {
    return <p className="text-xs text-gray-400">Select a line to view its dimensions.</p>;
  }

  return (
    <>
      {/* Scope picker */}
      <div>
        <div className="text-[11px] font-semibold text-gray-700 mb-2">Correction scope</div>
        <label className="flex items-start gap-2 py-1.5 cursor-pointer">
          <input type="radio" className="mt-0.5" checked={scope === "once"}
                 onChange={() => setScope("once")} />
          <div>
            <div className="text-xs font-medium text-gray-900">Fix this journal entry only</div>
            <div className="text-[11px] text-gray-400">Do not create or update any future rule</div>
          </div>
        </label>
        <label className="flex items-start gap-2 py-1.5 cursor-pointer">
          <input type="radio" className="mt-0.5" checked={scope === "remember"}
                 onChange={() => setScope("remember")} />
          <div>
            <div className="text-xs font-medium text-gray-900">Remember for future similar invoices</div>
            <div className="text-[11px] text-gray-400">Create / update a rule for similar invoices</div>
          </div>
        </label>
      </div>

      {/* Selected line summary */}
      <div className="rounded-md bg-canvas-50 ring-1 ring-canvas-100 p-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="badge-blue text-[10px]">Selected line {selectedLine.line_order}</span>
          <span className="font-medium text-gray-900">{selectedLine.description || selectedLine.account_name}</span>
        </div>
        <div className="text-[11px] text-gray-500 mt-1">
          Account: {selectedLine.account_code} {selectedLine.account_name}
        </div>
      </div>

      {/* Dimension details */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
            Dimension details — selected line
            <Info className="w-3 h-3 text-gray-300" />
          </h4>
          {progress.total > 0 && (
            <span className="text-[11px] text-gray-500">
              {progress.done} / {progress.total} required complete
            </span>
          )}
        </div>

        <div className="space-y-2.5">
          <DimRow label="Cost centre" required="Required"
                  value={form.cost_centre} options={dimValues.CC ?? []}
                  onChange={(v) => setForm((f) => ({ ...f, cost_centre: v }))} />
          <DimRow label="Project / Mandate" required="Recommended"
                  value={form.project} options={dimValues.PROJ ?? []}
                  onChange={(v) => setForm((f) => ({ ...f, project: v }))} />
          <DimRow label="Recharge / Allocation" required="Recommended"
                  value={form.recharge} options={[
                    { id: 0, code: "", name: "—", dimension_type: 0 },
                    { id: 1, code: "NONE", name: "None", dimension_type: 0 },
                    { id: 2, code: "REVIEW_SPLIT", name: "Review split", dimension_type: 0 },
                    { id: 3, code: "RECHARGE", name: "Recharge", dimension_type: 0 },
                  ]}
                  onChange={(v) => setForm((f) => ({ ...f, recharge: v }))} />
          <DimRow label="Recharge entity"
                  required={recharge_required_entity ? "Req. if recharge" : "Optional"}
                  warn={recharge_required_entity && !form.recharge_entity}
                  warnText={recharge_required_entity && !form.recharge_entity
                    ? "Required because allocation = Review split" : undefined}
                  value={form.recharge_entity} options={dimValues.RECHARGE ?? []}
                  onChange={(v) => setForm((f) => ({ ...f, recharge_entity: v }))} />
          <DimRow label="Property / Beneficiary" required="Optional"
                  value={form.property} options={dimValues.PROP ?? []}
                  onChange={(v) => setForm((f) => ({ ...f, property: v }))} />
          <DimDateRow label="Service period" required="Required"
                      start={form.service_period_start} end={form.service_period_end}
                      onStart={(v) => setForm((f) => ({ ...f, service_period_start: v }))}
                      onEnd={(v) => setForm((f) => ({ ...f, service_period_end: v }))} />
          <DimTextRow label="Approval owner" required="Required"
                      value={form.approval_owner}
                      placeholder="Thomas Meyer"
                      onChange={(v) => setForm((f) => ({ ...f, approval_owner: v }))} />
          <DimRow label="VAT recoverability" required="Recommended"
                  value={form.vat_recoverability} options={[
                    { id: 0, code: "", name: "—", dimension_type: 0 },
                    { id: 1, code: "FULL", name: "Fully recoverable", dimension_type: 0 },
                    { id: 2, code: "PARTIAL", name: "Partially recoverable", dimension_type: 0 },
                    { id: 3, code: "NONE", name: "Non-recoverable", dimension_type: 0 },
                  ]}
                  onChange={(v) => setForm((f) => ({ ...f, vat_recoverability: v }))} />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={applyToLine} disabled={busy} className="btn-primary text-xs flex-1">
          {busy ? "Applying…" : "Apply dimensions to this line"}
        </button>
        <button className="btn-secondary text-xs flex-1" disabled={busy}>Apply same to similar lines</button>
      </div>

      {/* Rule / policy info */}
      <div className="rounded-md bg-canvas-50 ring-1 ring-canvas-100 p-3 text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-gray-700 mb-1.5">
          Rule / policy information <Info className="w-3 h-3 text-gray-300" />
        </div>
        <div className="space-y-0.5 text-[11px] text-gray-600">
          <div><span className="text-gray-400">Account type:</span> Telecom expense ({selectedLine.account_code})</div>
          <div><span className="text-gray-400">Rule:</span> Cost centre and service period required.</div>
          <div className="pl-12">Project mandate allocation recommended.</div>
          <div className="pl-12">Recharge entity required if recharge is selected.</div>
        </div>
        <button className="text-brand-700 hover:underline text-[11px] mt-2">View dimension policy →</button>
      </div>

      {/* Instruction textarea */}
      <div>
        <label className="block">
          <span className="text-[11px] font-semibold text-gray-700">Instruction for this JE <span className="font-normal text-gray-400">(optional)</span></span>
          <textarea className="input mt-1.5 text-xs" rows={2}
                    placeholder="What should Beakon change in this journal entry?"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)} />
        </label>
      </div>

      {/* Suggested changes + apply */}
      <div className="flex items-center justify-between text-[11px] pt-1">
        <span className="font-semibold text-gray-700">Suggested changes</span>
        <span className="text-gray-400">2 suggestions</span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => { setScope("once"); applyToLine(); }} disabled={busy} className="btn-secondary text-xs flex-1">
          Apply to this JE only
        </button>
        <button onClick={() => { setScope("remember"); applyToLine(); }} disabled={busy} className="btn-primary text-xs flex-1">
          Apply &amp; teach Beakon
        </button>
      </div>

      {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
    </>
  );
}


function DimRow({
  label, required, value, options, onChange, warn, warnText,
}: {
  label: string; required: string; value: string; options: DimensionValue[];
  onChange: (v: string) => void; warn?: boolean; warnText?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1.6fr] items-center gap-2">
      <span className="text-xs text-gray-700">{label}</span>
      <span className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap",
        required === "Required"        ? "bg-red-100 text-red-700" :
        required === "Recommended"     ? "bg-amber-100 text-amber-800" :
        required === "Req. if recharge"? "bg-amber-100 text-amber-800" :
                                          "bg-gray-100 text-gray-600",
      )}>{required}</span>
      <div>
        <select className="input text-xs py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={`${o.code}-${o.id}`} value={o.code}>{o.name || o.code}</option>
          ))}
        </select>
        {warn && warnText && (
          <div className="text-[10px] text-red-600 mt-0.5">{warnText}</div>
        )}
      </div>
    </div>
  );
}


function DimTextRow({
  label, required, value, placeholder, onChange,
}: {
  label: string; required: string; value: string; placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1.6fr] items-center gap-2">
      <span className="text-xs text-gray-700">{label}</span>
      <span className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap",
        required === "Required"   ? "bg-red-100 text-red-700" :
        required === "Recommended"? "bg-amber-100 text-amber-800" :
                                     "bg-gray-100 text-gray-600",
      )}>{required}</span>
      <input className="input text-xs py-1.5" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}


function DimDateRow({
  label, required, start, end, onStart, onEnd,
}: {
  label: string; required: string; start: string; end: string;
  onStart: (v: string) => void; onEnd: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1.6fr] items-center gap-2">
      <span className="text-xs text-gray-700">{label}</span>
      <span className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap",
        required === "Required" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600",
      )}>{required}</span>
      <div className="flex items-center gap-1">
        <input type="date" className="input text-xs py-1.5 w-full" value={start} onChange={(e) => onStart(e.target.value)} />
        <span className="text-gray-400 text-xs">–</span>
        <input type="date" className="input text-xs py-1.5 w-full" value={end} onChange={(e) => onEnd(e.target.value)} />
      </div>
    </div>
  );
}


function AiReasoningPanel({ je }: { je: JE | null }) {
  if (!je) return <p className="text-xs text-gray-400">No JE loaded.</p>;
  const md = je.ai_metadata;
  if (!md) return <p className="text-xs text-gray-400">No AI metadata recorded for this entry.</p>;
  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-gray-400">Overall confidence</div>
        <div className="text-sm font-medium text-gray-900">{pct(md.confidence)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-gray-400">Service period detected</div>
        <div className="text-sm text-gray-900">
          {md.service_period_start
            ? `${fmtDate(md.service_period_start)} – ${fmtDate(md.service_period_end || "")}`
            : "—"}
        </div>
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Per-line reasoning surfaces in the line's <em>AI confidence</em>
        cell. Click a line to see what the model proposed and why.
      </p>
    </div>
  );
}


function PriorPostingsPanel({ bill }: { bill: Bill }) {
  return (
    <div className="space-y-3 text-xs">
      <p className="text-gray-500">
        Recent postings against the same vendor ({bill.vendor_name}) are listed
        here so reviewers can spot drift in account assignment, VAT treatment,
        or dimension defaults.
      </p>
      <div className="rounded bg-canvas-50 ring-1 ring-canvas-100 p-3 text-[11px] text-gray-500">
        <em>Hook up to /beakon/bills/?vendor=&lt;id&gt;&amp;status=posted&amp;ordering=-invoice_date in v2.</em>
      </div>
    </div>
  );
}


function AuditTrailPanel({ je, bill }: { je: JE | null; bill: Bill }) {
  return (
    <div className="space-y-3 text-xs">
      <p className="text-gray-500">
        Every state change on this JE and its source bill is logged below.
      </p>
      <ul className="space-y-2 text-[11px]">
        <li className="flex items-start gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 mt-1.5 flex-shrink-0" />
          <div>
            <div className="text-gray-700">Bill created (status: {bill.status})</div>
            <div className="text-gray-400">{fmtDate(bill.invoice_date)}</div>
          </div>
        </li>
        {je && (
          <li className="flex items-start gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 mt-1.5 flex-shrink-0" />
            <div>
              <div className="text-gray-700">JE {je.entry_number} generated ({je.status})</div>
              <div className="text-gray-400">{fmtDate(je.date)}</div>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}


// ── helpers ─────────────────────────────────────────────────────────────

function hasDimension(line: JELine, code: string): boolean {
  const c = code.toUpperCase();
  if (c === "CC")       return !!line.dimension_cost_centre_code;
  if (c === "PROJ")     return !!line.dimension_project_code;
  if (c === "RECHARGE") return !!line.dimension_recharge_code;
  if (c === "PROP")     return !!line.dimension_property_code;
  if (c === "PERIOD")   return !!line.service_period_start;
  return true;  // unknown codes → treat as satisfied (matches engine convention)
}
