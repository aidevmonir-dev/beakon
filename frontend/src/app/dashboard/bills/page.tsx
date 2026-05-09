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
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Receipt, Plus, X, CheckCircle2, XCircle, DollarSign, RotateCcw, Ban, Send,
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
  // We hold the actual File the AI extracted from in component state so
  // that when the user clicks "Create draft" we can also upload it as a
  // bill attachment. The same row will get stamped with journal_entry_id
  // when the bill is approved (BillService.transfer_bill_documents_to_je).
  const [aiReceiptFile, setAiReceiptFile] = useState<File | null>(null);
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
    // Stash the original receipt so we can attach it to the bill on save.
    setAiReceiptFile(file);
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
    const items = ex.line_items || [];
    const matchedAccountId = event.matched_account_id ? String(event.matched_account_id) : "";
    if (items.length > 0) {
      setLines(items.map((li: any) => ({
        expense_account: matchedAccountId,
        description: li.description || "",
        amount: li.amount || "",
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

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.entity || !form.vendor || lines.length === 0) return;
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
      // When the bill was prefilled from AI receipt extraction, mark
      // the notes with a parseable prefix so the list can show a ✨ icon
      // and the audit trail records which model produced the draft.
      // Format: [AI-EXTRACTED:<model>] — kept stable for serializer regex.
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
    // Only send manual tax_amount when no per-line tax_code is set.
    if (!lineLevelTax.any) payload.tax_amount = form.tax_amount;
    if (form.due_date) payload.due_date = form.due_date;
    if (payload.lines.length === 0) {
      setErr("Add at least one line with an expense account and amount.");
      setBusy(false);
      return;
    }
    try {
      const created = await api.post<{ id: number }>("/beakon/bills/", payload);
      // If the user uploaded a receipt for AI extraction, persist it as
      // an attachment on the bill. It auto-transfers to the JE when the
      // bill is approved (BillService.transfer_bill_documents_to_je).
      // Failing the upload should NOT block the bill creation — surface
      // a non-fatal warning instead.
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
          // Non-fatal: bill is created; user can re-upload from the JE
          // detail page after approval if needed.
        }
      }
      await onCreated();
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e?.detail || e || "Failed"));
    } finally {
      setBusy(false);
    }
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
      <div className="w-full sm:w-[640px] bg-white border-l border-canvas-200 overflow-y-auto">
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
                <p className="text-xs text-gray-700 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-brand-600" />
                  AI-extracted from <span className="font-mono text-gray-900">{aiSource.filename}</span>
                  <span className="text-gray-400">via {aiSource.model}</span>
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Review every field below before saving — AI drafts a bill, the human approves it.
                </p>
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

          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 break-words">
              {err}
            </div>
          )}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit"
                    disabled={busy || !form.entity || !form.vendor || lines.every((l) => !l.amount)}
                    className="btn-primary">
              {busy ? "Saving…" : "Create draft"}
            </button>
          </div>
        </form>
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
