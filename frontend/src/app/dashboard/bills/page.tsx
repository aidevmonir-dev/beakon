"use client";

/* Bills (AP) — vendor bills with full lifecycle.
 *
 *   draft -> pending_approval -> approved (accrual JE auto-posts) -> paid (payment JE auto-posts)
 *                             -> rejected -> draft
 *   draft -> cancelled
 *
 * v1 keeps it on a single page: list + filter + create modal + inline
 * approve/reject/pay actions. A future bills/[id] detail page can show
 * the linked accrual & payment JEs and full audit history. */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Receipt, Plus, X, CheckCircle2, XCircle, DollarSign, RotateCcw, Ban, Send,
  Sparkles, Upload, Loader2,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";


interface Entity { id: number; code: string; name: string; functional_currency: string; }
interface Vendor { id: number; code: string; name: string; default_currency: string;
                   default_payment_terms_days: number; default_expense_account: number | null;
                   default_expense_account_code: string | null; }
interface Account { id: number; code: string; name: string; account_type: string;
                    account_subtype: string; entity_code: string | null; }
interface TaxCode { id: number; code: string; name: string; rate: string; tax_type: string; }
interface LineSpec {
  expense_account: string;
  description: string;
  amount: string;
  tax_code: string;
}

interface AbsorbedLine {
  description: string;
  amount: string;
  absorbed_note: string;
}

interface Bill {
  id: number;
  reference: string;
  bill_number: string;
  entity_code: string;
  vendor_code: string;
  vendor_name: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  total: string;
  status: string;
  accrual_journal_entry: number | null;
  payment_journal_entry: number | null;
  payment_date: string | null;
  was_ai_extracted: boolean;
}

const STATUSES = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

function badge(status: string) {
  switch (status) {
    case "paid": return "badge-green";
    case "approved": return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected": return "badge-red";
    case "cancelled": return "badge-gray";
    case "draft": return "badge-gray";
    default: return "badge-gray";
  }
}


export default function BillsPage() {
  // useSearchParams() forces this component into client-side bailout
  // during static export. Wrapping the inner content in <Suspense>
  // lets Next.js emit a placeholder for the build.
  return (
    <Suspense fallback={<p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}>
      <BillsPageContent />
    </Suspense>
  );
}

function BillsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<Bill | null>(null);

  // Honour ?new=1 deeplink from the JE Transaction Type picker so AP routes
  // straight into the create drawer instead of dropping the user on the list.
  useEffect(() => {
    if (searchParams?.get("new") === "1" && !drawer) {
      setDrawer(true);
      // Clean the URL so a refresh/back doesn't re-open the drawer.
      router.replace("/dashboard/bills");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const load = async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    try {
      const d = await api.get<{ results: Bill[] } | Bill[]>("/beakon/bills/", params);
      setBills(Array.isArray(d) ? d : (d.results ?? []));
    } catch {
      setBills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [status]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of bills) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [bills]);

  const act = async (
    bill: Bill,
    path: string,
    body: object = {},
    confirmMsg?: string,
  ) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusyId(bill.id);
    setErr(null);
    try {
      await api.post(`/beakon/bills/${bill.id}/${path}/`, body);
      await load();
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || `Action failed`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <Link
        href="/dashboard/accounting"
        className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Accounting
      </Link>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-brand-700" />
            Bills (AP)
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Vendor bills. Approval auto-posts the accrual JE; mark-as-paid auto-posts the payment JE.
          </p>
        </div>
        <button onClick={() => setDrawer(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Bill
        </button>
      </div>

      {err && (
        <div className="card p-3 mb-3 border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-1 mb-4 text-xs">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStatus(s.key)}
              className={
                "px-2.5 py-1 rounded-full border transition-colors " +
                (status === s.key
                  ? "bg-brand-50 border-brand-200 text-brand-800"
                  : "bg-white border-canvas-200 text-gray-600 hover:bg-canvas-50")
              }
            >
              {s.label}{s.key && counts[s.key] ? ` (${counts[s.key]})` : ""}
            </button>
          ))}
          <span className="ml-auto text-gray-400">
            {loading ? "loading…" : `${bills.length} bills`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : bills.length === 0 ? (
          <div className="py-12 text-center">
            <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No bills.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Reference</th>
                  <th className="pb-2 pr-4 font-medium">Vendor</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Bill #</th>
                  <th className="pb-2 pr-4 font-medium">Invoice date</th>
                  <th className="pb-2 pr-4 font-medium">Due</th>
                  <th className="pb-2 pl-4 font-medium text-right">Total</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                  <th className="pb-2 pl-4 font-medium">JEs</th>
                  <th className="pb-2 pl-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {bills.map((b) => (
                  <tr key={b.id} className="hover:bg-canvas-50">
                    <td className="py-2 pr-4 font-mono text-xs">
                      <Link href={`/dashboard/bills/${b.id}`}
                            className="text-brand-700 underline decoration-dotted underline-offset-2 hover:decoration-solid">
                        {b.reference}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-sm text-gray-900 max-w-[260px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {b.was_ai_extracted && (
                          <Sparkles
                            className="w-3 h-3 text-brand-600 shrink-0"
                            aria-label="Imported from AI receipt extraction"
                          />
                        )}
                        <span className="font-mono text-xs text-gray-500 shrink-0">
                          {b.vendor_code}
                        </span>
                        <span className="truncate" title={b.vendor_name}>
                          {b.vendor_name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{b.entity_code}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 font-mono">{b.bill_number || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(b.invoice_date)}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(b.due_date)}</td>
                    <td className="py-2 pl-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                      <span className="text-gray-400">{b.currency}</span> {fmt2(b.total)}
                    </td>
                    <td className="py-2 pl-4">
                      <span className={badge(b.status)}>{fmtLabel(b.status)}</span>
                    </td>
                    <td className="py-2 pl-4 text-xs">
                      {b.accrual_journal_entry && (
                        <Link href={`/dashboard/journal-entries/${b.accrual_journal_entry}`}
                              className="block text-brand-700 hover:underline">
                          accrual #{b.accrual_journal_entry}
                        </Link>
                      )}
                      {b.payment_journal_entry && (
                        <Link href={`/dashboard/journal-entries/${b.payment_journal_entry}`}
                              className="block text-brand-700 hover:underline">
                          payment #{b.payment_journal_entry}
                        </Link>
                      )}
                      {!b.accrual_journal_entry && !b.payment_journal_entry && (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <ActionButtons
                        bill={b}
                        busy={busyId === b.id}
                        onSubmit={() => act(b, "submit-for-approval")}
                        onApprove={() => act(b, "approve",
                          {}, `Approve bill ${b.reference}? This posts the accrual JE.`)}
                        onReject={() => {
                          const reason = prompt("Rejection reason:");
                          if (reason !== null) void act(b, "reject", { reason });
                        }}
                        onReturn={() => act(b, "return-to-draft")}
                        onPay={() => setPayTarget(b)}
                        onCancel={() => act(b, "cancel",
                          {}, `Cancel bill ${b.reference}? This is final.`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <CreateBillDrawer
          onClose={() => setDrawer(false)}
          onCreated={async () => { setDrawer(false); await load(); }}
        />
      )}
      {payTarget && (
        <PayModal
          bill={payTarget}
          onClose={() => setPayTarget(null)}
          onPaid={async () => { setPayTarget(null); await load(); }}
        />
      )}
    </div>
  );
}


function ActionButtons({
  bill, busy, onSubmit, onApprove, onReject, onReturn, onPay, onCancel,
}: {
  bill: Bill; busy: boolean;
  onSubmit: () => void; onApprove: () => void; onReject: () => void;
  onReturn: () => void; onPay: () => void; onCancel: () => void;
}) {
  return (
    <div className="inline-flex gap-1">
      {bill.status === "draft" && (
        <>
          <button onClick={onSubmit} disabled={busy}
                  className="text-xs text-brand-700 hover:underline disabled:opacity-50">
            <Send className="w-3 h-3 inline mr-0.5" />Submit
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={onCancel} disabled={busy}
                  className="text-xs text-gray-500 hover:underline disabled:opacity-50">
            <Ban className="w-3 h-3 inline mr-0.5" />Cancel
          </button>
        </>
      )}
      {bill.status === "pending_approval" && (
        <>
          <button onClick={onApprove} disabled={busy}
                  className="text-xs text-mint-700 hover:underline disabled:opacity-50">
            <CheckCircle2 className="w-3 h-3 inline mr-0.5" />Approve
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={onReject} disabled={busy}
                  className="text-xs text-red-700 hover:underline disabled:opacity-50">
            <XCircle className="w-3 h-3 inline mr-0.5" />Reject
          </button>
          <span className="text-gray-300">·</span>
          <button onClick={onReturn} disabled={busy}
                  className="text-xs text-gray-500 hover:underline disabled:opacity-50">
            To draft
          </button>
        </>
      )}
      {bill.status === "approved" && (
        <button onClick={onPay} disabled={busy}
                className="text-xs text-brand-700 hover:underline disabled:opacity-50">
          <DollarSign className="w-3 h-3 inline mr-0.5" />Pay
        </button>
      )}
      {bill.status === "rejected" && (
        <button onClick={onReturn} disabled={busy}
                className="text-xs text-gray-700 hover:underline disabled:opacity-50">
          <RotateCcw className="w-3 h-3 inline mr-0.5" />To draft
        </button>
      )}
      {bill.status === "paid" && (
        <span className="text-xs text-gray-400">paid {fmtDate(bill.payment_date)}</span>
      )}
      {bill.status === "cancelled" && (
        <span className="text-xs text-gray-400">cancelled</span>
      )}
    </div>
  );
}


function CreateBillDrawer({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    entity: "",
    vendor: "",
    invoice_date: today,
    due_date: "",
    bill_number: "",
    currency: "",
    description: "",
    explanation: "",
    tax_amount: "0.00",
  });
  const [lines, setLines] = useState<LineSpec[]>([
    { expense_account: "", description: "", amount: "", tax_code: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── AI receipt-import state ─────────────────────────────────────────
  // Receipt → Bill (not JE) is the correct AP-lifecycle anchor: the
  // user uploads a receipt, AI prefills the manual bill draft, the
  // user reviews and clicks Create Draft. Bill approval then auto-posts
  // the accrual JE through the existing flow — receipts never bypass
  // human review and never short-circuit the approval workflow.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPhase, setAiPhase] = useState("");
  const [aiPct, setAiPct] = useState(0);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiSource, setAiSource] = useState<{ filename: string; model: string } | null>(null);
  // Thomas 2026-05-12 (Sunrise case): the AI reported invoice total. We
  // stash it so we can deterministically verify that the user's saved
  // bill (sum of lines + VAT) reconciles to what was on the document.
  // If they don't match, the save is blocked — the JE would not have
  // tied to the invoice. Cleared on manual reset.
  const [aiInvoiceTotal, setAiInvoiceTotal] = useState<string | null>(null);
  // B5 — LearningRules the AI followed on this extraction. Rendered as
  // chips so the reviewer can see "Beakon followed Rule #N" before
  // creating the draft. Cleared on subsequent extractions or manual reset.
  const [appliedRules, setAppliedRules] = useState<Array<{
    id: number;
    vendor_code: string | null;
    vendor_name: string | null;
    scope_label: string;
    correction_type: string;
    human_instruction: string;
  }>>([]);
  // B7 — absorbed lines from the AI (Sunrise device instalment case).
  // Kept out of the editable `lines` state so they don't post; rendered
  // as struck-through info rows under the lines table for audit trail.
  const [absorbedLines, setAbsorbedLines] = useState<AbsorbedLine[]>([]);
  // B7 — customer number printed on the invoice and the AI's draft
  // future-rule text. Both feed the Teach Beakon panel when the
  // reviewer opens it from the extract banner.
  const [aiCustomerNumber, setAiCustomerNumber] = useState("");
  const [aiSuggestedRule, setAiSuggestedRule] = useState("");
  // Captured AI extraction snapshot — frozen at extract time so we can
  // pass it to BillCorrection.ai_proposal_snapshot if the reviewer
  // teaches Beakon. Includes vendor name, total, and line items so the
  // audit row preserves what the AI originally proposed even after the
  // human edits.
  const [aiSnapshot, setAiSnapshot] = useState<Record<string, unknown> | null>(null);
  // B7 — the Teach panel itself. errorTypes use the same 9 checkbox
  // taxonomy as the post-creation correction flow on /bills/[id].
  const [teachOpen, setTeachOpen] = useState(false);
  const [errorTypes, setErrorTypes] = useState<string[]>([]);
  const [futureRuleInstruction, setFutureRuleInstruction] = useState("");
  const [teachScopeHint, setTeachScopeHint] = useState("");
  const [applyToFutureRule, setApplyToFutureRule] = useState(true);
  // We hold the actual File the AI extracted from in component state so
  // that when the user clicks "Create draft" we can also upload it as a
  // bill attachment. The same row will get stamped with journal_entry_id
  // when the bill is approved (BillService.transfer_bill_documents_to_je).
  const [aiReceiptFile, setAiReceiptFile] = useState<File | null>(null);
  // When the AI suggested an expense account but it didn't pass server-side
  // validation against this entity's CoA, show what AI was thinking inline
  // beneath the (now-empty) line dropdown so the reviewer can pick the
  // closest valid match instead of staring at a blank field.
  const [aiSuggestedAccount, setAiSuggestedAccount] = useState<
    | { id: number; code: string | null; name: string | null;
        on_other_entity: boolean; is_active: boolean | null;
        reasoning: string }
    | null
  >(null);
  // B8 — ranked alternative account candidates from the AI, already
  // validated server-side against this entity's CoA. Rendered as
  // clickable chips under any empty line dropdown so the reviewer
  // doesn't have to scroll the full chart when the AI was unsure.
  const [accountCandidates, setAccountCandidates] = useState<Array<{
    id: number;
    code: string;
    name: string;
    score: number;
    reason: string;
  }>>([]);
  // When AI extracts a vendor name that doesn't match any Vendor record,
  // capture it so we can show a "Create this vendor" approval button.
  // Cleared once the user creates the vendor or picks a different one.
  const [proposedVendor, setProposedVendor] = useState<{
    name: string;
    defaultCurrency: string;
    defaultExpenseAccountId: number | null;
  } | null>(null);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build a short, readable vendor code from the extracted name —
  // strip company suffixes, take the first ~2 words, drop punctuation.
  // Uniqueness is enforced server-side; if a duplicate, we show the
  // error and let the user pick from the dropdown manually.
  const generateVendorCode = (name: string): string => {
    const cleaned = name
      .replace(/[.,&'"]/g, "")
      .replace(/\b(Inc|Ltd|LLC|GmbH|AG|S\.?A|Corp|Co|LLP|PLC|Pty|BV|SRL)\b\.?/gi, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase()
      // Drop accents and any remaining non-ASCII so the code stays simple
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 30);
    return cleaned || "VENDOR";
  };

  const createVendorFromProposal = async () => {
    if (!proposedVendor) return;
    setCreatingVendor(true);
    setErr(null);
    try {
      const payload: any = {
        code: generateVendorCode(proposedVendor.name),
        name: proposedVendor.name,
        default_currency: proposedVendor.defaultCurrency || "",
        is_active: true,
      };
      if (proposedVendor.defaultExpenseAccountId) {
        payload.default_expense_account = proposedVendor.defaultExpenseAccountId;
      }
      const created = await api.post<Vendor>("/beakon/vendors/", payload);
      // Append to the in-drawer vendor list and select it. No need to
      // re-fetch the entire vendor list — the dropdown rebuilds.
      setVendors((vs) => [...vs, created]);
      setForm((f) => ({ ...f, vendor: String(created.id) }));
      setProposedVendor(null);
      // Drop the matching warning so the UI reflects the resolution.
      setAiWarnings((ws) => ws.filter((w) => !w.toLowerCase().includes("no vendor record matched")));
    } catch (e: any) {
      const msg = e?.error?.message || e?.code?.[0] || e?.message
        || "Failed to create vendor — try a different name or create it manually in Vendors.";
      setErr(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setCreatingVendor(false);
    }
  };

  const applyExtraction = (event: any, file: File) => {
    const ex = event.extraction || {};
    const matchedVendor = event.matched_vendor;

    setAiWarnings(event.warnings || []);
    setAiSource({ filename: file.name, model: ex.model_used || "unknown" });
    // Stash the AI's reported invoice total for the reconciliation guard.
    // Cleared on subsequent extractions or manual reset.
    setAiInvoiceTotal(ex.total ? String(ex.total) : null);
    // B5: capture any LearningRules that fired on this extraction.
    setAppliedRules(Array.isArray(event.applied_rules) ? event.applied_rules : []);
    // Stash the original receipt so we can attach it to the bill on save.
    setAiReceiptFile(file);
    // B8 — server-validated alternative account picks. Always
    // captured: even when matched_account_id is set, the reviewer
    // may want to swap to a different account for one of the lines.
    setAccountCandidates(Array.isArray(event.account_candidates) ? event.account_candidates : []);
    // Capture AI's account suggestion ONLY when the server failed to
    // resolve it against this entity's CoA — otherwise the dropdown is
    // already filled and the hint would be noise.
    const sai = event.suggested_account_info;
    if (sai && !event.matched_account_id) {
      setAiSuggestedAccount({
        id: sai.id,
        code: sai.code ?? null,
        name: sai.name ?? null,
        on_other_entity: !!sai.on_other_entity,
        is_active: sai.is_active ?? null,
        reasoning: sai.reasoning || ex.suggested_account_reasoning || "",
      });
    } else {
      setAiSuggestedAccount(null);
    }
    // If no Vendor matched but the AI did extract a vendor name,
    // surface the "create this vendor" approval button below.
    if (!matchedVendor && ex.vendor_name) {
      setProposedVendor({
        name: ex.vendor_name,
        defaultCurrency: (ex.currency || "").toUpperCase(),
        defaultExpenseAccountId: event.matched_account_id || null,
      });
    } else {
      setProposedVendor(null);
    }

    // Auto-fill an explanation only when the user hasn't typed one. The
    // template summarises what AI extracted so the auditor sees concrete
    // reasoning rather than a generic "AI categorised this". The user
    // can edit it before saving.
    const aiTemplate = buildAIExplanation({
      vendorName: ex.vendor_name || matchedVendor?.name,
      invoiceDate: ex.invoice_date,
      currency: ex.currency,
      total: ex.total,
      reasoning: ex.suggested_account_reasoning || ex.reasoning,
      lineCount: (ex.line_items || []).length,
      hasTax: !!(ex.tax_amount && ex.tax_amount !== "0"),
    });

    setForm((f) => ({
      ...f,
      vendor: matchedVendor ? String(matchedVendor.id) : f.vendor,
      invoice_date: ex.invoice_date || f.invoice_date,
      due_date: ex.due_date || f.due_date,
      currency: (ex.currency || matchedVendor?.default_currency || f.currency || "").toUpperCase(),
      bill_number: ex.invoice_number || f.bill_number,
      description: ex.description || f.description,
      explanation: f.explanation || aiTemplate,
      tax_amount: (ex.tax_amount && ex.tax_amount !== "0") ? ex.tax_amount : f.tax_amount,
    }));

    // Map extracted line_items → form lines. The AI's suggested
    // expense account applies to every line — most bills book a single
    // category (e.g. all four office-supply lines → Operating Expenses).
    // The reviewer can change individual lines if a particular item
    // belongs in a different account.
    //
    // B7 — partition extracted line items into POSTING lines (these go
    // into the editable form) and ABSORBED lines (informational
    // duplicates the AI flagged, e.g. Sunrise device instalment that's
    // already inside the Mobile total). Absorbed lines render as
    // struck-through audit rows; they're never posted.
    const allItems = ex.line_items || [];
    const items = allItems.filter((li: any) => !li.is_absorbed);
    const absorbed = allItems.filter((li: any) => li.is_absorbed);
    setAbsorbedLines(absorbed.map((li: any) => ({
      description: li.description || "",
      amount: String(li.amount || "0"),
      absorbed_note: li.absorbed_note || "Already counted in another line",
    })));
    // B7 — capture customer number + AI's suggested rule for the Teach
    // panel. Pre-seed the panel's scope hint so the reviewer doesn't
    // have to retype the subscriber number.
    setAiCustomerNumber(ex.customer_number || "");
    setAiSuggestedRule(ex.suggested_rule_text || "");
    setTeachScopeHint(ex.customer_number ? `Customer number: ${ex.customer_number}` : "");
    setFutureRuleInstruction(ex.suggested_rule_text || "");
    // Freeze the AI proposal so we can attach it to a BillCorrection if
    // the reviewer teaches Beakon from this draft.
    setAiSnapshot({
      vendor_name: ex.vendor_name,
      invoice_number: ex.invoice_number,
      total: ex.total,
      subtotal: ex.subtotal,
      tax_amount: ex.tax_amount,
      currency: ex.currency,
      line_items: allItems,
      customer_number: ex.customer_number || "",
      suggested_account_id: ex.suggested_account_id || null,
      suggested_account_reasoning: ex.suggested_account_reasoning || "",
      model_used: ex.model_used,
    });
    // B7 — auto-open the Teach panel when the AI flagged something
    // worth correcting (duplicate/absorbed lines, or it drafted a rule
    // for the reviewer to consider). This is the Sunrise-style path:
    // the AI itself raises its hand and asks for a rule to be saved.
    const aiFlagged = absorbed.length > 0 || !!(ex.suggested_rule_text || "").trim();
    setTeachOpen(aiFlagged);
    // Pre-check Duplicate line when the AI marked absorbed entries —
    // the reviewer is confirming the AI's own detection rather than
    // flagging a new error.
    setErrorTypes(absorbed.length > 0 ? ["duplicate_line"] : []);
    setApplyToFutureRule(true);
    const matchedAccountId = event.matched_account_id ? String(event.matched_account_id) : "";
    if (items.length > 0) {
      // VAT safeguard: line amounts MUST be NET of VAT (matching subtotal).
      // If the AI returned gross figures, scale them pro-rata to sum to
      // the extracted subtotal — protects against the "DR expense gross +
      // DR VAT + CR AP gross+VAT" double-count bug.
      const rawAmounts = items.map((li: any) => parseFloat(li.amount) || 0);
      const sumLines = rawAmounts.reduce((s: number, n: number) => s + n, 0);
      const sub = parseFloat(ex.subtotal || "0") || 0;
      const tax = parseFloat(ex.tax_amount || "0") || 0;
      const tol = 0.02;
      let normalisedAmounts = rawAmounts;
      if (sub > 0 && Math.abs(sumLines - sub) > tol) {
        // Likely cause: AI returned gross. Detect by checking if the sum
        // matches subtotal+tax (gross), and rescale to subtotal.
        if (tax > 0 && Math.abs(sumLines - (sub + tax)) <= tol && sumLines > 0) {
          const scale = sub / sumLines;
          normalisedAmounts = rawAmounts.map(
            (n: number) => Math.round(n * scale * 100) / 100,
          );
          // Fix rounding drift on the last line so the sum is exact.
          const drift = sub - normalisedAmounts.reduce((s: number, n: number) => s + n, 0);
          if (normalisedAmounts.length > 0) {
            normalisedAmounts[normalisedAmounts.length - 1] =
              Math.round((normalisedAmounts[normalisedAmounts.length - 1] + drift) * 100) / 100;
          }
        }
      }
      setLines(items.map((li: any, i: number) => ({
        expense_account: matchedAccountId,
        description: li.description || "",
        amount: normalisedAmounts[i] > 0 ? normalisedAmounts[i].toFixed(2) : (li.amount || ""),
        tax_code: "",
      })));
    } else if (ex.subtotal && ex.subtotal !== "0") {
      // No line items in the extraction — collapse to a single line.
      setLines([{
        expense_account: matchedAccountId,
        description: ex.description || "",
        amount: ex.subtotal,
        tax_code: "",
      }]);
    }
  };

  const extractFromReceipt = async (file: File) => {
    if (!form.entity) {
      setErr("Pick an entity first — the AI needs the entity's chart of accounts to suggest an expense category.");
      return;
    }
    setAiBusy(true);
    setAiPhase("Uploading receipt…");
    setAiPct(2);
    setAiWarnings([]);
    setAiSource(null);
    setErr(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entity", form.entity);
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;

      const resp = await fetch(`${API_BASE}/beakon/ocr/extract-stream/`, {
        method: "POST", headers, body: fd,
      });
      if (!resp.ok || !resp.body) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body?.error?.message || body?.detail || `HTTP ${resp.status}`);
      }

      // SSE consumer mirrors the journal-entries upload flow.
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastPhasePct = 12;
      const ESTIMATED_TOKENS = 350;
      let doneEvent: any = null;
      let errEvent: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          if (!block.startsWith("data:")) continue;
          let data: any;
          try { data = JSON.parse(block.slice(5).trim()); }
          catch { continue; }
          if (data.type === "phase") {
            lastPhasePct = data.pct ?? lastPhasePct;
            setAiPct(lastPhasePct);
            setAiPhase(data.phase);
          } else if (data.type === "token") {
            const fraction = Math.min(1, data.n / ESTIMATED_TOKENS);
            setAiPct(lastPhasePct + (95 - lastPhasePct) * fraction);
            setAiPhase(`Model generating (${data.n} tokens)…`);
          } else if (data.type === "done") {
            doneEvent = data;
          } else if (data.type === "error") {
            errEvent = data;
          }
        }
      }
      if (errEvent) throw new Error(errEvent.message || "Extraction failed");
      if (!doneEvent) throw new Error("Stream closed without a result.");

      applyExtraction(doneEvent, file);
      setAiPct(100);
    } catch (e: any) {
      setErr(e?.message || "Receipt extraction failed");
      setAiSource(null);
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Vendor[] } | Vendor[]>("/beakon/vendors/", { is_active: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { account_type: "expense" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: TaxCode[] } | TaxCode[]>("/beakon/tax-codes/", { active_flag: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => [] as TaxCode[]),
    ]).then(([es, vs, as, tcs]) => {
      setEntities(es); setVendors(vs); setAccounts(as); setTaxCodes(tcs);
      if (es.length && !form.entity) setForm((f) => ({ ...f, entity: String(es[0].id) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When vendor changes, prefill currency + first line's expense account
  const onVendorChange = (vid: string) => {
    const v = vendors.find((x) => String(x.id) === vid);
    setForm((f) => ({
      ...f, vendor: vid,
      currency: v?.default_currency || f.currency,
    }));
    if (v?.default_expense_account && lines.length === 1 && !lines[0].expense_account) {
      setLines([{ ...lines[0], expense_account: String(v.default_expense_account) }]);
    }
  };

  const lineSum = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
    [lines],
  );
  // When any line has a tax_code, tax is line-driven; otherwise honour the manual tax_amount.
  const lineLevelTax = useMemo(() => {
    let any = false;
    let total = 0;
    for (const l of lines) {
      if (l.tax_code) {
        any = true;
        const tc = taxCodes.find((t) => String(t.id) === l.tax_code);
        const rate = tc ? Number(tc.rate) : 0;
        total += (Number(l.amount) || 0) * (rate / 100);
      }
    }
    return { any, total };
  }, [lines, taxCodes]);
  const taxNum = lineLevelTax.any ? lineLevelTax.total : (parseFloat(form.tax_amount) || 0);
  const total = lineSum + taxNum;

  // Thomas 2026-05-12 (Sunrise case): deterministic reconciliation
  // guard. If we have an AI-reported invoice total, the user's saved
  // lines + VAT MUST equal it. Returns null if reconciled, otherwise an
  // explanation string used to render the error banner and block save.
  const reconcileError = useMemo<string | null>(() => {
    if (!aiInvoiceTotal) return null;
    const target = parseFloat(aiInvoiceTotal);
    if (!Number.isFinite(target) || target <= 0) return null;
    const computed = lineSum + taxNum;
    const diff = computed - target;
    if (Math.abs(diff) <= 0.02) return null;
    const ccy = form.currency || "";
    const sign = diff > 0 ? "+" : "";
    return (
      `Lines + VAT come to ${ccy} ${computed.toFixed(2)}, but the invoice ` +
      `total is ${ccy} ${target.toFixed(2)} (${sign}${diff.toFixed(2)} mismatch). ` +
      `Check for duplicate lines or a misread amount before saving.`
    );
  }, [aiInvoiceTotal, lineSum, taxNum, form.currency]);

  // B7 — when the Teach panel is open, the footer's two action buttons
  // (Fix this draft only / Apply correction & remember rule) flip this
  // flag before triggering the form submit so we know whether to also
  // post a BillCorrection after the bill lands.
  const [teachMode, setTeachMode] = useState<"draft_only" | "remember" | null>(null);

  const requestSubmit = () => {
    void submitCore();
  };

  const submitCore = async () => {
    if (!form.entity || !form.vendor || lines.length === 0) return;
    if (reconcileError) {
      setErr(reconcileError);
      return;
    }
    setBusy(true);
    setErr(null);
    const payload: any = {
      entity: Number(form.entity),
      vendor: Number(form.vendor),
      invoice_date: form.invoice_date,
      bill_number: form.bill_number,
      currency: form.currency || undefined,
      description: form.description,
      explanation: form.explanation,
      ...(aiSource && {
        notes: `[AI-EXTRACTED:${aiSource.model}] from ${aiSource.filename}`,
      }),
      lines: lines
        .filter((l) => l.expense_account && l.amount)
        .map((l) => {
          const spec: any = {
            expense_account_id: Number(l.expense_account),
            description: l.description,
            amount: l.amount,
          };
          if (l.tax_code) spec.tax_code_id = Number(l.tax_code);
          return spec;
        }),
    };
    if (!lineLevelTax.any) payload.tax_amount = form.tax_amount;
    if (form.due_date) payload.due_date = form.due_date;
    if (appliedRules.length > 0) {
      payload.ai_applied_rule_ids = appliedRules.map((r) => r.id);
    }
    if (payload.lines.length === 0) {
      setErr("Add at least one line with an expense account and amount.");
      setBusy(false);
      return;
    }
    try {
      const created = await api.post<{ id: number }>("/beakon/bills/", payload);
      // Persist the original receipt as a bill attachment.
      if (aiReceiptFile && created?.id) {
        try {
          const fd = new FormData();
          fd.append("file", aiReceiptFile);
          const token = localStorage.getItem("access_token");
          const orgId = localStorage.getItem("organization_id");
          const headers: Record<string, string> = {};
          if (token) headers["Authorization"] = `Bearer ${token}`;
          if (orgId) headers["X-Organization-ID"] = orgId;
          await fetch(`${API_BASE}/beakon/bills/${created.id}/documents/`, {
            method: "POST", headers, body: fd,
          });
        } catch {
          // Non-fatal — user can re-upload later.
        }
      }
      // B7 — if the reviewer used the Teach panel, also POST a
      // BillCorrection so the audit row + (optionally) the LearningRule
      // land alongside the bill. teachMode = "remember" promotes the
      // rule; "draft_only" records the correction but skips promotion.
      if (created?.id && teachOpen && teachMode) {
        try {
          const summary = errorTypes.length > 0
            ? `Reviewer flagged: ${errorTypes.map((t) => t.replace(/_/g, " ")).join(", ")}.`
            : "Reviewer corrected the AI draft before saving.";
          const correctionPayload: Record<string, unknown> = {
            correction_text: summary,
            ai_proposal_snapshot: aiSnapshot ?? {},
            error_types: errorTypes,
            make_reusable_rule: teachMode === "remember" && applyToFutureRule,
            future_rule_instruction:
              teachMode === "remember" ? futureRuleInstruction.trim() : "",
          };
          await api.post(`/beakon/bills/${created.id}/corrections/`, correctionPayload);
        } catch (e) {
          // Non-fatal: bill is saved. Surface a soft warning but don't
          // block the flow — the reviewer can file the correction
          // manually from the bill detail page if this errored.
          console.warn("Correction POST failed:", e);
        }
      }
      await onCreated();
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e?.detail || e || "Failed"));
    } finally {
      setBusy(false);
      setTeachMode(null);
    }
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    void submitCore();
  };

  const updateLine = (i: number, patch: Partial<typeof lines[0]>) => {
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  };

  // Show only shared accounts (entity_code === null) OR accounts scoped to
  // the entity the bookkeeper picked. Cuts the dropdown from "every expense
  // account in every entity" to just what makes sense for this bill.
  const acctsForLine = useMemo(() => {
    const selEnt = entities.find((e) => String(e.id) === form.entity);
    const selCode = selEnt?.code;
    return accounts.filter((a) => !a.entity_code || a.entity_code === selCode);
  }, [accounts, entities, form.entity]);

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div
        className={
          "bg-white border-l border-canvas-200 flex transition-all duration-200 " +
          (teachOpen ? "w-full sm:w-[1120px]" : "w-full sm:w-[640px]")
        }
      >
        <div className={
          (teachOpen ? "w-[640px] shrink-0 border-r border-canvas-100" : "flex-1") +
          " overflow-y-auto"
        }>
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">New Bill</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          {/* AI receipt-import section — appears at the very top so the
              user sees the AI option before starting manual entry. After
              extraction this collapses into a small attribution badge so
              the user's focus moves to reviewing the prefilled fields. */}
          <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
            <input ref={fileInputRef} type="file"
                   accept="application/pdf,image/*"
                   className="hidden"
                   onChange={(e) => {
                     const f = e.target.files?.[0];
                     if (f) void extractFromReceipt(f);
                     e.target.value = "";
                   }} />
            {!aiBusy && !aiSource && (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand-600" />
                    Import from receipt
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Upload a PDF or image. AI extracts vendor, dates, line items,
                    and suggests an expense account. You review and approve.
                  </p>
                  {!form.entity && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      Pick an entity first — the AI uses the entity's chart of accounts.
                    </p>
                  )}
                </div>
                <button type="button"
                        disabled={!form.entity}
                        onClick={() => fileInputRef.current?.click()}
                        className="btn-secondary text-xs whitespace-nowrap disabled:opacity-50">
                  <Upload className="w-3.5 h-3.5 mr-1" /> Choose file
                </button>
              </div>
            )}
            {aiBusy && (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-700 flex items-center gap-1.5 min-w-0">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-600 shrink-0" />
                    <span className="truncate">{aiPhase}</span>
                  </p>
                  <span className="text-xs font-mono tabular-nums text-brand-700 shrink-0">
                    {Math.round(Math.min(100, aiPct))}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 bg-canvas-200 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 transition-all duration-200"
                       style={{ width: `${Math.min(100, aiPct)}%` }} />
                </div>
              </div>
            )}
            {!aiBusy && aiSource && (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-700 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-brand-600" />
                      AI-extracted from <span className="font-mono text-gray-900 truncate">{aiSource.filename}</span>
                      <span className="text-gray-400">via {aiSource.model}</span>
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Review every field below before saving — AI drafts a bill, the human approves it.
                    </p>
                  </div>
                  {!teachOpen && (
                    <button
                      type="button"
                      onClick={() => setTeachOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Correct & teach Beakon
                    </button>
                  )}
                </div>
                {/* B5: surface any LearningRules the AI followed so the
                    reviewer knows what shaped the draft. Per Thomas §8:
                    "the user must be able to see why Beakon applied a
                    learned rule and override it if needed." */}
                {appliedRules.length > 0 && (
                  <div className="mt-2 rounded-md border border-mint-200 bg-mint-50 p-2">
                    <p className="text-[11px] font-semibold text-mint-800 mb-1">
                      Beakon followed {appliedRules.length === 1 ? "1 rule" : `${appliedRules.length} rules`} from past corrections
                    </p>
                    <ul className="space-y-1">
                      {appliedRules.map((r) => (
                        <li
                          key={r.id}
                          className="text-[11px] text-mint-900 leading-snug"
                          title={r.human_instruction}
                        >
                          <span className="font-semibold">Rule #{r.id}</span>
                          {r.scope_label && <span className="text-mint-700"> · {r.scope_label}</span>}
                          {r.vendor_code && <span className="text-mint-700"> · {r.vendor_code}</span>}
                          <span className="text-mint-700"> — </span>
                          <span className="break-words">
                            {r.human_instruction.length > 140
                              ? r.human_instruction.slice(0, 140) + "…"
                              : r.human_instruction}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[11px] text-brand-700 hover:underline mt-1">
                  Replace with another receipt
                </button>
              </div>
            )}
            {aiWarnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-amber-800 border-t border-amber-200 pt-2">
                {aiWarnings.map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-amber-600 shrink-0">⚠</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            {proposedVendor && (
              <div className="mt-2 pt-2 border-t border-amber-200 flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-700 leading-snug">
                  Create vendor record for <span className="font-medium text-gray-900">"{proposedVendor.name}"</span>?
                </span>
                <button type="button"
                        disabled={creatingVendor}
                        onClick={createVendorFromProposal}
                        className="text-[11px] bg-brand-600 hover:bg-brand-700 text-white font-medium px-2.5 py-1 rounded shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
                  {creatingVendor ? "Creating…" : "Create vendor"}
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Entity *</span>
              <select className="input mt-1" value={form.entity}
                      onChange={(e) => setForm((f) => ({ ...f, entity: e.target.value }))}>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Vendor *</span>
              <select className="input mt-1" value={form.vendor}
                      onChange={(e) => onVendorChange(e.target.value)}>
                <option value="">— select vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.code} · {v.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Invoice date *</span>
              <input type="date" className="input mt-1" value={form.invoice_date}
                     onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Due date</span>
              <input type="date" className="input mt-1" value={form.due_date}
                     onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
              <span className="text-[10px] text-gray-400">Auto from vendor terms if blank.</span>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Currency</span>
              <input className="input mt-1 uppercase font-mono" maxLength={3}
                     value={form.currency}
                     onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Vendor's bill number</span>
            <input className="input mt-1 font-mono" value={form.bill_number}
                   onChange={(e) => setForm((f) => ({ ...f, bill_number: e.target.value }))}
                   placeholder="INV-12345" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Description</span>
            <textarea className="input mt-1" rows={2} value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-600">
              Explanation
              <span className="ml-1 font-normal text-gray-400">
                — why this entry exists and why each side is debited or credited
              </span>
            </span>
            <textarea
              className="input mt-1 font-mono text-sm"
              rows={3}
              value={form.explanation}
              onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
              placeholder="e.g. Debit Office Rent — April service period consumed. Credit Accounts Payable — supplier owed pending wire. Booked under operating expenses (not prepaid) since the period is fully consumed."
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Saved on the bill and copied to the resulting JE for the auditor.
            </p>
          </label>

          <div className="border-t border-canvas-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Lines</span>
              <button type="button"
                      onClick={() => setLines([...lines, { expense_account: "", description: "", amount: "", tax_code: "" }])}
                      className="text-xs text-brand-700 hover:underline">
                + Add line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const tc = taxCodes.find((t) => String(t.id) === l.tax_code);
                const lineTax = tc ? (Number(l.amount) || 0) * (Number(tc.rate) / 100) : 0;
                const showAiHint = !l.expense_account && aiSuggestedAccount;
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-start">
                    <select className="input col-span-4" value={l.expense_account}
                            onChange={(e) => updateLine(i, { expense_account: e.target.value })}>
                      <option value="">— expense account —</option>
                      {acctsForLine.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </select>
                    <input className="input col-span-4" placeholder="Description"
                           value={l.description}
                           onChange={(e) => updateLine(i, { description: e.target.value })} />
                    <input className="input col-span-2 text-right font-mono" placeholder="Amount"
                           type="number" step="0.01" value={l.amount}
                           onChange={(e) => updateLine(i, { amount: e.target.value })} />
                    <select className="input col-span-2 text-xs" value={l.tax_code}
                            onChange={(e) => updateLine(i, { tax_code: e.target.value })}
                            title={tc ? `Auto VAT: ${lineTax.toFixed(2)}` : "No tax"}>
                      <option value="">No VAT</option>
                      {taxCodes.map((t) => (
                        <option key={t.id} value={t.id}>{t.code} · {t.rate}%</option>
                      ))}
                    </select>
                    {showAiHint && (
                      <div className="col-span-12 -mt-1 text-[11px] rounded border border-amber-200 bg-amber-50 px-2 py-1 leading-snug">
                        <div className="text-amber-900">
                          <span className="font-semibold">AI suggested:</span>{" "}
                          {aiSuggestedAccount.code || aiSuggestedAccount.name ? (
                            <span className="font-mono">
                              {aiSuggestedAccount.code}
                              {aiSuggestedAccount.code && aiSuggestedAccount.name && " · "}
                              {aiSuggestedAccount.name}
                            </span>
                          ) : (
                            <span className="italic">unknown account id #{aiSuggestedAccount.id}</span>
                          )}
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-700">
                            {aiSuggestedAccount.on_other_entity
                              ? "on a different entity"
                              : aiSuggestedAccount.is_active === false
                                ? "inactive"
                                : "not on this entity's CoA"}
                          </span>
                        </div>
                        {aiSuggestedAccount.reasoning && (
                          <div className="text-amber-800/80 mt-0.5">
                            {aiSuggestedAccount.reasoning}
                          </div>
                        )}
                        <div className="text-amber-800/70 mt-0.5">
                          Pick the closest matching account from the dropdown above.
                        </div>
                      </div>
                    )}
                    {/* B8 — clickable ranked candidates. Surface when
                        the line has no expense account picked yet so
                        the reviewer can fill it with one click instead
                        of scrolling the full chart. */}
                    {!l.expense_account && accountCandidates.length > 0 && (
                      <div className="col-span-12 -mt-1 rounded border border-violet-200 bg-violet-50/60 p-2">
                        <p className="text-[11px] font-semibold text-violet-800 mb-1.5 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Beakon&apos;s top picks — click to use
                        </p>
                        <div className="flex flex-col gap-1">
                          {accountCandidates.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => updateLine(i, { expense_account: String(c.id) })}
                              className="flex items-start justify-between gap-2 rounded border border-violet-200 bg-white px-2 py-1 text-left hover:border-violet-400 hover:bg-violet-50 transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-mono text-gray-900">
                                  {c.code} · {c.name}
                                </div>
                                {c.reason && (
                                  <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                                    {c.reason}
                                  </div>
                                )}
                              </div>
                              <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-violet-700 tabular-nums">
                                {Math.round(c.score * 100)}%
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {lines.length > 1 && (
                      <button type="button"
                              onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                              className="col-span-12 text-xs text-red-600 hover:underline text-right -mt-1">
                        Remove line
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* B7 — absorbed (duplicate) lines the AI detected.
                Rendered with strikethrough so the auditor can see
                what the AI considered, but they are NOT posted to
                the JE and never enter the editable `lines` state. */}
            {absorbedLines.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
                <p className="text-[11px] font-semibold text-amber-900 mb-1.5 flex items-center gap-1.5">
                  <span className="text-amber-600">⚠</span>
                  {absorbedLines.length === 1
                    ? "1 line detected as duplicate / absorbed — not posted:"
                    : `${absorbedLines.length} lines detected as duplicate / absorbed — not posted:`}
                </p>
                <ul className="space-y-1">
                  {absorbedLines.map((al, i) => (
                    <li key={i} className="flex items-start justify-between gap-2 text-[11px]">
                      <span className="text-amber-800 line-through">
                        <span className="font-medium">{al.description || "Line"}</span>
                        {al.absorbed_note && (
                          <span className="not-italic ml-1 text-amber-700/80">— {al.absorbed_note}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-amber-800 line-through tabular-nums">
                          {fmt2(al.amount)}
                        </span>
                        <span className="rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 not-italic">
                          Included above
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <PostingPreview
            lines={lines}
            accounts={accounts}
            currency={form.currency}
            taxAmount={lineLevelTax.any ? lineLevelTax.total : (parseFloat(form.tax_amount) || 0)}
            taxIsLineDriven={lineLevelTax.any}
          />

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-canvas-100">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">
                Tax {lineLevelTax.any && <span className="text-gray-400">(auto from lines)</span>}
              </span>
              <input className="input mt-1 text-right font-mono" type="number" step="0.01"
                     disabled={lineLevelTax.any}
                     value={lineLevelTax.any ? lineLevelTax.total.toFixed(2) : form.tax_amount}
                     onChange={(e) => setForm((f) => ({ ...f, tax_amount: e.target.value }))} />
            </label>
            <div className="flex items-end justify-end pb-2">
              <span className="text-sm text-gray-500 mr-2">Total:</span>
              <span className="text-lg font-mono font-semibold text-gray-900 tabular-nums">
                {form.currency || "—"} {fmt2(total)}
              </span>
            </div>
          </div>

          {reconcileError && (
            // Thomas §8: JE total must reconcile to the invoice total
            // before a draft can be saved. The Sunrise bug surfaces here.
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-900 font-bold text-[10px]">!</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">Doesn&apos;t reconcile to the invoice total</p>
                  <p className="mt-1 leading-relaxed">{reconcileError}</p>
                </div>
              </div>
            </div>
          )}
          {err && !reconcileError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 break-words">
              {err}
            </div>
          )}
          <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
            {teachOpen ? (
              <>
                <button
                  type="button"
                  onClick={() => { setTeachMode("draft_only"); requestSubmit(); }}
                  disabled={busy || !form.entity || !form.vendor || lines.every((l) => !l.amount) || !!reconcileError}
                  className="btn-secondary"
                  title="Save the corrected bill but don't create a learning rule"
                >
                  Fix this draft only
                </button>
                <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { setTeachMode("remember"); requestSubmit(); }}
                  disabled={
                    busy || !form.entity || !form.vendor || lines.every((l) => !l.amount) ||
                    !!reconcileError || !futureRuleInstruction.trim() || errorTypes.length === 0
                  }
                  className="btn-primary bg-violet-600 hover:bg-violet-700"
                  title={
                    errorTypes.length === 0
                      ? "Pick at least one error type"
                      : !futureRuleInstruction.trim()
                        ? "Write what Beakon should do next time"
                        : "Save the bill and create a learning rule"
                  }
                >
                  {busy ? "Saving…" : "Apply correction & remember rule"}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit"
                        disabled={busy || !form.entity || !form.vendor || lines.every((l) => !l.amount) || !!reconcileError}
                        className="btn-primary">
                  {busy ? "Saving…" : "Create draft"}
                </button>
              </>
            )}
          </div>
        </form>
        </div>
        {/* B7 — Teach Beakon side panel. Opens from the AI-extracted
            banner. Captures what was wrong, a live JE preview, and an
            optional rule to remember for the future. Submission goes
            through the same `submit` handler — teachMode tells it
            whether to also post a BillCorrection / promote a rule. */}
        {teachOpen && (
          <TeachBeakonPanel
            errorTypes={errorTypes}
            setErrorTypes={setErrorTypes}
            futureRuleInstruction={futureRuleInstruction}
            setFutureRuleInstruction={setFutureRuleInstruction}
            scopeHint={teachScopeHint}
            setScopeHint={setTeachScopeHint}
            applyToFutureRule={applyToFutureRule}
            setApplyToFutureRule={setApplyToFutureRule}
            customerNumber={aiCustomerNumber}
            aiSuggestedRule={aiSuggestedRule}
            jePreview={{
              currency: form.currency || "—",
              netExpense: lineSum,
              vat: taxNum,
              vendorName:
                vendors.find((v) => String(v.id) === form.vendor)?.name ||
                (aiSnapshot?.vendor_name as string | undefined) ||
                "vendor",
              total,
              reconciled: !reconcileError,
            }}
            onClose={() => setTeachOpen(false)}
          />
        )}
      </div>
    </div>
  );
}


function PayModal({
  bill, onClose, onPaid,
}: {
  bill: Bill;
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    payment_date: today,
    bank_account: "",
    reference: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Filter bank accounts to only those on the bill's entity (or shared, entity=NULL).
  // Posting against an account that belongs to a different entity is what
  // raised "Account 1010 belongs to a different entity" before this filter.
  const validAccounts = useMemo(
    () => accounts.filter((a) => !a.entity_code || a.entity_code === bill.entity_code),
    [accounts, bill.entity_code],
  );

  useEffect(() => {
    api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { account_subtype: "bank" })
      .then((d) => setAccounts(Array.isArray(d) ? d : (d.results ?? [])))
      .catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-select first VALID bank account once they've loaded.
  useEffect(() => {
    if (validAccounts.length && !form.bank_account) {
      setForm((f) => ({ ...f, bank_account: String(validAccounts[0].id) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validAccounts]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/beakon/bills/${bill.id}/mark-paid/`, {
        payment_date: form.payment_date,
        bank_account: Number(form.bank_account),
        reference: form.reference,
      });
      await onPaid();
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e?.detail || e || "Pay failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white rounded-2xl border border-canvas-200 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">Pay bill {bill.reference}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="rounded-lg bg-canvas-50 p-3 text-sm">
            <div className="text-gray-900 font-medium">{bill.vendor_name}</div>
            <div className="text-xs text-gray-500">{bill.entity_code} · {bill.bill_number || bill.reference}</div>
            <div className="font-mono text-base mt-1 tabular-nums">
              {bill.currency} {fmt2(bill.total)}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Payment date *</span>
            <input type="date" className="input mt-1" value={form.payment_date}
                   onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">From bank account *</span>
            <select className="input mt-1" value={form.bank_account}
                    onChange={(e) => setForm((f) => ({ ...f, bank_account: e.target.value }))}>
              <option value="">— pick a bank account —</option>
              {validAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}{a.entity_code ? ` (${a.entity_code})` : " (shared)"}
                </option>
              ))}
            </select>
            {validAccounts.length === 0 && (
              <span className="text-[10px] text-amber-700 mt-1 block">
                No bank accounts on {bill.entity_code}. Create one in Chart of Accounts first.
              </span>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Reference</span>
            <input className="input mt-1 font-mono" value={form.reference}
                   onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                   placeholder="WIRE-12345 / Check #1042" />
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          <div className="text-[11px] text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
            Marking paid will <strong>auto-post</strong> a payment journal entry:
            DR {bill.vendor_code} payable / CR selected bank account.
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy || !form.bank_account} className="btn-primary">
              {busy ? "Posting…" : "Confirm payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


/* ── Posting preview ───────────────────────────────────────────────────
 * Shows the eventual journal entry the bill will book once approved:
 *   DR <expense account>     <line amount>     [why]
 *   DR Input VAT (recoverable) <tax amount>    [why]
 *   CR Accounts Payable      <total>           [why]
 *
 * Helps the reviewer understand WHAT the bill will post before they
 * click "Create draft". The "why" column is templated — we know which
 * convention applies to each side so the reasoning can be deterministic.
 */
function PostingPreview({
  lines, accounts, currency, taxAmount, taxIsLineDriven,
}: {
  lines: { expense_account: string; description: string; amount: string; tax_code: string }[];
  accounts: { id: number; code: string; name: string }[];
  currency: string;
  taxAmount: number;
  taxIsLineDriven: boolean;
}) {
  const filledLines = lines.filter(
    (l) => l.expense_account && Number(l.amount) > 0,
  );
  const lineSum = filledLines.reduce((s, l) => s + Number(l.amount), 0);
  const total = lineSum + taxAmount;

  if (filledLines.length === 0) {
    return (
      <div className="border border-dashed border-canvas-200 rounded-lg p-3 mt-3 text-xs text-gray-400">
        Pick an expense account and amount on a line to preview the journal entry.
      </div>
    );
  }

  const acctMap = new Map(accounts.map((a) => [String(a.id), a]));

  return (
    <div className="border border-canvas-200 rounded-lg p-3 mt-3 bg-canvas-50/40">
      <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-2">
        Posting preview · what the bill will book on approval
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-gray-400 uppercase tracking-wider">
            <th className="text-left pb-1 font-medium w-10">DR/CR</th>
            <th className="text-left pb-1 font-medium">Account</th>
            <th className="text-right pb-1 font-medium w-28">Amount</th>
            <th className="text-left pb-1 pl-3 font-medium">Why</th>
          </tr>
        </thead>
        <tbody>
          {filledLines.map((l, i) => {
            const a = acctMap.get(l.expense_account);
            return (
              <tr key={`dr-${i}`} className="border-t border-canvas-100">
                <td className="py-1 font-mono text-emerald-700 font-semibold">DR</td>
                <td className="py-1 text-gray-800">
                  {a ? `${a.code} · ${a.name}` : "—"}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-gray-900">
                  {fmt2(l.amount)}
                </td>
                <td className="py-1 pl-3 text-gray-600">
                  Expense was incurred — increases expense balance.
                  {l.description ? ` (${l.description.slice(0, 50)})` : ""}
                </td>
              </tr>
            );
          })}
          {taxAmount > 0 && (
            <tr className="border-t border-canvas-100">
              <td className="py-1 font-mono text-emerald-700 font-semibold">DR</td>
              <td className="py-1 text-gray-800">
                Input VAT (recoverable)
                {taxIsLineDriven && (
                  <span className="text-[10px] text-gray-400 ml-1">(per-line tax codes)</span>
                )}
              </td>
              <td className="py-1 text-right font-mono tabular-nums text-gray-900">
                {fmt2(taxAmount)}
              </td>
              <td className="py-1 pl-3 text-gray-600">
                VAT we paid the supplier — claimable from the tax authority.
              </td>
            </tr>
          )}
          <tr className="border-t border-canvas-100">
            <td className="py-1 font-mono text-rose-700 font-semibold">CR</td>
            <td className="py-1 text-gray-800">
              Accounts Payable
              <span className="text-[10px] text-gray-400 ml-1">(supplier liability)</span>
            </td>
            <td className="py-1 text-right font-mono tabular-nums text-gray-900">
              {fmt2(total)}
            </td>
            <td className="py-1 pl-3 text-gray-600">
              Supplier is owed — increases AP. Cleared when the bill is paid.
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-double border-gray-700">
            <td className="pt-1.5 text-right font-medium text-gray-700" colSpan={2}>
              Totals (must balance)
            </td>
            <td className="pt-1.5 text-right font-mono tabular-nums font-semibold text-gray-900">
              DR {fmt2(total)} {currency} · CR {fmt2(total)} {currency}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}


/* Build a templated explanation from the AI extraction so the reviewer
 * starts with concrete, audit-ready reasoning that quotes what the AI
 * actually saw in the document. They edit it as needed before saving. */
function buildAIExplanation(args: {
  vendorName?: string | null;
  invoiceDate?: string | null;
  currency?: string | null;
  total?: string | null;
  reasoning?: string | null;
  lineCount: number;
  hasTax: boolean;
}): string {
  const parts: string[] = [];
  const who = args.vendorName ? `from ${args.vendorName}` : "from the supplier";
  const when = args.invoiceDate ? ` dated ${args.invoiceDate}` : "";
  const what = args.lineCount > 0
    ? `${args.lineCount} line item${args.lineCount === 1 ? "" : "s"}`
    : "the invoice subtotal";
  parts.push(`Recording the bill ${who}${when}.`);
  parts.push(
    `Debit the expense account on each line — the cost has been incurred (covers ${what}).`,
  );
  if (args.hasTax) {
    parts.push("Debit Input VAT — the tax we paid is recoverable from the authority.");
  }
  parts.push(
    "Credit Accounts Payable — supplier is owed pending payment; cleared when the bill is paid.",
  );
  if (args.reasoning) {
    parts.push("");
    parts.push(`AI categoriser: ${args.reasoning}`);
  }
  return parts.join("\n");
}


// ── B7 — Teach Beakon side panel ────────────────────────────────────
// Mounted next to the New Bill drawer when the reviewer clicks
// "Correct & teach Beakon". Captures three things:
//   1. What was wrong (9-checkbox taxonomy)
//   2. A live preview of the JE the reviewer is about to post
//   3. An optional rule to remember for the next invoice from this
//      vendor (pre-filled with the AI's own suggestion when available)
//
// The bill creation itself stays in the parent form — this panel is a
// thin sidekick that contributes to the BillCorrection POST after the
// bill lands. Submit is driven from the parent footer buttons.

const TEACH_ERROR_TYPES = [
  { key: "duplicate_line",       label: "Duplicate line" },
  { key: "vat_treatment_wrong",  label: "VAT treatment wrong" },
  { key: "wrong_expense_account", label: "Wrong expense account" },
  { key: "wrong_amount",         label: "Wrong amount" },
  { key: "missing_allocation",   label: "Missing allocation" },
  { key: "wrong_vendor",         label: "Wrong vendor" },
  { key: "wrong_entity",         label: "Wrong entity" },
  { key: "wrong_period",         label: "Wrong period" },
  { key: "other",                label: "Other" },
];

function TeachBeakonPanel({
  errorTypes, setErrorTypes,
  futureRuleInstruction, setFutureRuleInstruction,
  scopeHint, setScopeHint,
  applyToFutureRule, setApplyToFutureRule,
  customerNumber, aiSuggestedRule,
  jePreview,
  onClose,
}: {
  errorTypes: string[];
  setErrorTypes: (v: string[]) => void;
  futureRuleInstruction: string;
  setFutureRuleInstruction: (v: string) => void;
  scopeHint: string;
  setScopeHint: (v: string) => void;
  applyToFutureRule: boolean;
  setApplyToFutureRule: (v: boolean) => void;
  customerNumber: string;
  aiSuggestedRule: string;
  jePreview: {
    currency: string;
    netExpense: number;
    vat: number;
    vendorName: string;
    total: number;
    reconciled: boolean;
  };
  onClose: () => void;
}) {
  const toggleError = (key: string) => {
    if (errorTypes.includes(key)) {
      setErrorTypes(errorTypes.filter((k) => k !== key));
    } else {
      setErrorTypes([...errorTypes, key]);
    }
  };

  const StepNumber = ({ n }: { n: number }) => (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white text-[11px] font-semibold">
      {n}
    </span>
  );

  return (
    <div className="flex-1 bg-canvas-50/60 overflow-y-auto">
      <div className="flex items-center justify-between p-4 border-b border-canvas-100 bg-white">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-100">
            <Sparkles className="w-4 h-4 text-violet-600" />
          </span>
          <h2 className="text-base font-semibold text-gray-900">Teach Beakon</h2>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* ── Step 1 — what is wrong ── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <StepNumber n={1} />
            <h3 className="text-sm font-semibold text-gray-900">What is wrong?</h3>
          </div>
          <div className="space-y-1.5 pl-7">
            {TEACH_ERROR_TYPES.map((t) => (
              <label
                key={t.key}
                className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={errorTypes.includes(t.key)}
                  onChange={() => toggleError(t.key)}
                  className="rounded border-gray-300"
                />
                {t.label}
              </label>
            ))}
          </div>
        </section>

        {/* ── Step 2 — live JE preview ── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <StepNumber n={2} />
            <h3 className="text-sm font-semibold text-gray-900">Correct journal entry</h3>
          </div>
          <div className="pl-7">
            <div className="rounded-md border border-canvas-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-canvas-100 text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="text-left font-medium px-3 py-1.5">Account</th>
                    <th className="text-right font-medium px-3 py-1.5">Amount ({jePreview.currency})</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-canvas-100">
                    <td className="px-3 py-1.5 text-gray-800">Expense (net)</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-900">{fmt2(jePreview.netExpense)}</td>
                  </tr>
                  <tr className="border-b border-canvas-100">
                    <td className="px-3 py-1.5 text-gray-800">Input VAT</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-900">{fmt2(jePreview.vat)}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-gray-800 font-medium">
                      Accounts payable — {jePreview.vendorName}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-gray-900 font-semibold">
                      {fmt2(jePreview.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {jePreview.reconciled ? (
              <p className="mt-1.5 text-[11px] text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                JE total reconciles to invoice total.
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-amber-700 flex items-center gap-1">
                <span className="text-amber-600">⚠</span>
                JE total does not match invoice total — fix the lines on the left.
              </p>
            )}
          </div>
        </section>

        {/* ── Step 3 — teach for the future ── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <StepNumber n={3} />
            <h3 className="text-sm font-semibold text-gray-900">Teach Beakon for the future</h3>
          </div>
          <div className="pl-7 space-y-2.5">
            <textarea
              rows={6}
              value={futureRuleInstruction}
              onChange={(e) => setFutureRuleInstruction(e.target.value)}
              placeholder="e.g. For Sunrise invoices, do not add device instalments as a separate expense line when already included in the Mobile total. Use the VAT declaration to split expense and input VAT."
              className="input w-full text-sm font-mono"
            />
            {aiSuggestedRule && futureRuleInstruction !== aiSuggestedRule && (
              <p className="text-[11px] text-gray-500">
                <button
                  type="button"
                  onClick={() => setFutureRuleInstruction(aiSuggestedRule)}
                  className="text-violet-700 hover:underline"
                >
                  Use Beakon&apos;s draft
                </button>
                {" "}— the AI noticed this case while extracting and proposed: &ldquo;
                <span className="text-gray-600">{aiSuggestedRule.length > 100 ? aiSuggestedRule.slice(0, 100) + "…" : aiSuggestedRule}</span>
                &rdquo;
              </p>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={applyToFutureRule}
                onChange={(e) => setApplyToFutureRule(e.target.checked)}
                className="rounded border-gray-300"
              />
              Apply this rule to future invoices from this vendor
            </label>
            <div>
              <label className="block">
                <span className="text-[11px] text-gray-500">Scope (optional)</span>
                <input
                  className="input mt-0.5 w-full text-sm"
                  value={scopeHint}
                  onChange={(e) => setScopeHint(e.target.value)}
                  placeholder={customerNumber ? `Customer number: ${customerNumber}` : "e.g. Customer number, contract ref, project code"}
                />
              </label>
              {customerNumber && (
                <p className="text-[10px] text-gray-400 mt-1">
                  Pre-filled from the invoice. Cleared if you only want the rule scoped by vendor.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
