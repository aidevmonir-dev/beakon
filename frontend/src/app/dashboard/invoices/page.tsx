"use client";

/* Invoices (AR) — customer invoices with full lifecycle. Mirror of bills.
 *
 *   draft -> pending_approval -> issued (AR JE auto-posts) -> paid (receipt JE auto-posts)
 *                             -> rejected -> draft
 *   draft -> cancelled
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, FileOutput, Plus, X, CheckCircle2, XCircle, DollarSign, Ban, Send, RotateCcw,
  Sparkles, Upload, Loader2,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";


interface Entity { id: number; code: string; name: string; functional_currency: string; }
interface Customer { id: number; code: string; name: string; default_currency: string;
                     default_payment_terms_days: number; default_revenue_account: number | null; }
interface Account { id: number; code: string; name: string; account_type: string;
                    account_subtype: string; entity_code: string | null; }
interface TaxCode { id: number; code: string; name: string; rate: string; tax_type: string; }
interface LineSpec {
  revenue_account: string;
  description: string;
  amount: string;
  tax_code: string;
}

interface Invoice {
  id: number;
  reference: string;
  invoice_number: string;
  entity_code: string;
  customer_code: string;
  customer_name: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  total: string;
  status: string;
  issued_journal_entry: number | null;
  payment_journal_entry: number | null;
  payment_date: string | null;
}

const STATUSES = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending" },
  { key: "issued", label: "Issued" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
];

function badge(status: string) {
  switch (status) {
    case "paid": return "badge-green";
    case "issued": return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected": return "badge-red";
    case "cancelled": return "badge-gray";
    case "draft": return "badge-gray";
    default: return "badge-gray";
  }
}


export default function InvoicesPage() {
  // useSearchParams() forces this component into client-side bailout
  // during static export. Wrapping the inner content in <Suspense>
  // lets Next.js emit a placeholder for the build.
  return (
    <Suspense fallback={<p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}>
      <InvoicesPageContent />
    </Suspense>
  );
}

function InvoicesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);

  // Honour ?new=1 deeplink from the JE Transaction Type picker so AR routes
  // straight into the create drawer instead of dropping the user on the list.
  useEffect(() => {
    if (searchParams?.get("new") === "1" && !drawer) {
      setDrawer(true);
      router.replace("/dashboard/invoices");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const load = async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    try {
      const d = await api.get<{ results: Invoice[] } | Invoice[]>("/beakon/invoices/", params);
      setInvoices(Array.isArray(d) ? d : (d.results ?? []));
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [status]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of invoices) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [invoices]);

  const act = async (
    inv: Invoice, path: string, body: object = {}, confirmMsg?: string,
  ) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusyId(inv.id);
    setErr(null);
    try {
      await api.post(`/beakon/invoices/${inv.id}/${path}/`, body);
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
            <FileOutput className="w-5 h-5 text-brand-700" />
            Invoices (AR)
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Customer invoices. Issue auto-posts the AR JE; record-payment auto-posts the receipt JE.
          </p>
        </div>
        <button onClick={() => setDrawer(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Invoice
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
            {loading ? "loading…" : `${invoices.length} invoices`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : invoices.length === 0 ? (
          <div className="py-12 text-center">
            <FileOutput className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No invoices.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Reference</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Invoice #</th>
                  <th className="pb-2 pr-4 font-medium">Invoice date</th>
                  <th className="pb-2 pr-4 font-medium">Due</th>
                  <th className="pb-2 pl-4 font-medium text-right">Total</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                  <th className="pb-2 pl-4 font-medium">JEs</th>
                  <th className="pb-2 pl-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {invoices.map((i) => (
                  <tr key={i.id} className="hover:bg-canvas-50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{i.reference}</td>
                    <td className="py-2 pr-4 text-sm text-gray-900">
                      <span className="font-mono text-xs text-gray-500">{i.customer_code}</span>{" "}
                      {i.customer_name}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{i.entity_code}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 font-mono">{i.invoice_number || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(i.invoice_date)}</td>
                    <td className="py-2 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(i.due_date)}</td>
                    <td className="py-2 pl-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                      <span className="text-gray-400">{i.currency}</span> {fmt2(i.total)}
                    </td>
                    <td className="py-2 pl-4">
                      <span className={badge(i.status)}>{fmtLabel(i.status)}</span>
                    </td>
                    <td className="py-2 pl-4 text-xs">
                      {i.issued_journal_entry && (
                        <Link href={`/dashboard/journal-entries/${i.issued_journal_entry}`}
                              className="block text-brand-700 hover:underline">
                          issue #{i.issued_journal_entry}
                        </Link>
                      )}
                      {i.payment_journal_entry && (
                        <Link href={`/dashboard/journal-entries/${i.payment_journal_entry}`}
                              className="block text-brand-700 hover:underline">
                          receipt #{i.payment_journal_entry}
                        </Link>
                      )}
                      {!i.issued_journal_entry && !i.payment_journal_entry && (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-4 text-right">
                      <div className="inline-flex gap-1">
                        {i.status === "draft" && (
                          <>
                            <button onClick={() => act(i, "submit-for-approval")} disabled={busyId === i.id}
                                    className="text-xs text-brand-700 hover:underline disabled:opacity-50">
                              <Send className="w-3 h-3 inline mr-0.5" />Submit
                            </button>
                            <span className="text-gray-300">·</span>
                            <button onClick={() => act(i, "cancel", {}, `Cancel ${i.reference}?`)}
                                    disabled={busyId === i.id}
                                    className="text-xs text-gray-500 hover:underline disabled:opacity-50">
                              <Ban className="w-3 h-3 inline mr-0.5" />Cancel
                            </button>
                          </>
                        )}
                        {i.status === "pending_approval" && (
                          <>
                            <button onClick={() => act(i, "issue",
                                      {}, `Issue ${i.reference}? This posts the AR JE.`)}
                                    disabled={busyId === i.id}
                                    className="text-xs text-mint-700 hover:underline disabled:opacity-50">
                              <CheckCircle2 className="w-3 h-3 inline mr-0.5" />Issue
                            </button>
                            <span className="text-gray-300">·</span>
                            <button onClick={() => {
                                      const r = prompt("Rejection reason:");
                                      if (r !== null) void act(i, "reject", { reason: r });
                                    }}
                                    disabled={busyId === i.id}
                                    className="text-xs text-red-700 hover:underline disabled:opacity-50">
                              <XCircle className="w-3 h-3 inline mr-0.5" />Reject
                            </button>
                            <span className="text-gray-300">·</span>
                            <button onClick={() => act(i, "return-to-draft")} disabled={busyId === i.id}
                                    className="text-xs text-gray-500 hover:underline disabled:opacity-50">
                              To draft
                            </button>
                          </>
                        )}
                        {i.status === "issued" && (
                          <button onClick={() => setPayTarget(i)} disabled={busyId === i.id}
                                  className="text-xs text-brand-700 hover:underline disabled:opacity-50">
                            <DollarSign className="w-3 h-3 inline mr-0.5" />Record payment
                          </button>
                        )}
                        {i.status === "rejected" && (
                          <button onClick={() => act(i, "return-to-draft")} disabled={busyId === i.id}
                                  className="text-xs text-gray-700 hover:underline disabled:opacity-50">
                            <RotateCcw className="w-3 h-3 inline mr-0.5" />To draft
                          </button>
                        )}
                        {i.status === "paid" && (
                          <span className="text-xs text-gray-400">paid {fmtDate(i.payment_date)}</span>
                        )}
                        {i.status === "cancelled" && (
                          <span className="text-xs text-gray-400">cancelled</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <CreateInvoiceDrawer
          onClose={() => setDrawer(false)}
          onCreated={async () => { setDrawer(false); await load(); }}
        />
      )}
      {payTarget && (
        <PayModal
          invoice={payTarget}
          onClose={() => setPayTarget(null)}
          onPaid={async () => { setPayTarget(null); await load(); }}
        />
      )}
    </div>
  );
}


function CreateInvoiceDrawer({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    entity: "", customer: "", invoice_date: today, due_date: "",
    invoice_number: "", currency: "", description: "", explanation: "",
    tax_amount: "0.00",
  });
  const [lines, setLines] = useState<LineSpec[]>([
    { revenue_account: "", description: "", amount: "", tax_code: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── AI invoice-import state (mirror of Bills page) ──────────────────
  // Imports a legacy / external invoice PDF or image, extracts fields
  // via OCR + LLM, and prefills this drawer for human review. Receipts
  // never auto-create — user clicks Create Draft like any manual flow.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPhase, setAiPhase] = useState("");
  const [aiPct, setAiPct] = useState(0);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiSource, setAiSource] = useState<{ filename: string; model: string } | null>(null);
  // We hold the actual File the AI extracted from in component state so
  // that when the user clicks "Create draft" we also upload it as an
  // invoice attachment. The same row gets stamped with journal_entry_id
  // when the invoice is issued (transfer_invoice_documents_to_je).
  const [aiReceiptFile, setAiReceiptFile] = useState<File | null>(null);
  // Mirror of the bills drawer: when AI's suggested revenue account didn't
  // pass server-side CoA validation, surface what AI was thinking inline
  // beneath the empty line dropdown so the reviewer can pick the closest
  // valid match.
  const [aiSuggestedAccount, setAiSuggestedAccount] = useState<
    | { id: number; code: string | null; name: string | null;
        on_other_entity: boolean; is_active: boolean | null;
        reasoning: string }
    | null
  >(null);
  const [proposedCustomer, setProposedCustomer] = useState<{
    name: string;
    defaultCurrency: string;
    defaultRevenueAccountId: number | null;
  } | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const generateCustomerCode = (name: string): string => {
    const cleaned = name
      .replace(/[.,&'"]/g, "")
      .replace(/\b(Inc|Ltd|LLC|GmbH|AG|S\.?A|Corp|Co|LLP|PLC|Pty|BV|SRL)\b\.?/gi, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 30);
    return cleaned || "CUSTOMER";
  };

  const createCustomerFromProposal = async () => {
    if (!proposedCustomer) return;
    setCreatingCustomer(true);
    setErr(null);
    try {
      const payload: any = {
        code: generateCustomerCode(proposedCustomer.name),
        name: proposedCustomer.name,
        default_currency: proposedCustomer.defaultCurrency || "",
        is_active: true,
      };
      if (proposedCustomer.defaultRevenueAccountId) {
        payload.default_revenue_account = proposedCustomer.defaultRevenueAccountId;
      }
      const created = await api.post<Customer>("/beakon/customers/", payload);
      setCustomers((cs) => [...cs, created]);
      setForm((f) => ({ ...f, customer: String(created.id) }));
      setProposedCustomer(null);
      setAiWarnings((ws) => ws.filter((w) => !w.toLowerCase().includes("no customer record matched")));
    } catch (e: any) {
      const msg = e?.error?.message || e?.code?.[0] || e?.message
        || "Failed to create customer — try a different name or create it manually in Customers.";
      setErr(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setCreatingCustomer(false);
    }
  };

  const applyExtraction = (event: any, file: File) => {
    const ex = event.extraction || {};
    const matchedCustomer = event.matched_customer;

    setAiWarnings(event.warnings || []);
    setAiSource({ filename: file.name, model: ex.model_used || "unknown" });
    setAiReceiptFile(file);
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

    if (!matchedCustomer && ex.customer_name) {
      setProposedCustomer({
        name: ex.customer_name,
        defaultCurrency: (ex.currency || "").toUpperCase(),
        defaultRevenueAccountId: event.matched_account_id || null,
      });
    } else {
      setProposedCustomer(null);
    }

    // Auto-fill the explanation only if the user hasn't typed one. The
    // template summarises what AI extracted so the auditor sees concrete
    // reasoning rather than a generic "AI categorised this".
    const aiTemplate = buildAIInvoiceExplanation({
      customerName: ex.customer_name || matchedCustomer?.name,
      invoiceDate: ex.invoice_date,
      currency: ex.currency,
      total: ex.total,
      reasoning: ex.suggested_account_reasoning || ex.reasoning,
      lineCount: (ex.line_items || []).length,
      hasTax: !!(ex.tax_amount && ex.tax_amount !== "0"),
    });

    setForm((f) => ({
      ...f,
      customer: matchedCustomer ? String(matchedCustomer.id) : f.customer,
      invoice_date: ex.invoice_date || f.invoice_date,
      due_date: ex.due_date || f.due_date,
      currency: (ex.currency || matchedCustomer?.default_currency || f.currency || "").toUpperCase(),
      invoice_number: ex.invoice_number || f.invoice_number,
      description: ex.description || f.description,
      explanation: f.explanation || aiTemplate,
      tax_amount: (ex.tax_amount && ex.tax_amount !== "0") ? ex.tax_amount : f.tax_amount,
    }));

    const items = ex.line_items || [];
    const matchedAccountId = event.matched_account_id ? String(event.matched_account_id) : "";
    if (items.length > 0) {
      setLines(items.map((li: any) => ({
        revenue_account: matchedAccountId,
        description: li.description || "",
        amount: li.amount || "",
        tax_code: "",
      })));
    } else if (ex.subtotal && ex.subtotal !== "0") {
      setLines([{
        revenue_account: matchedAccountId,
        description: ex.description || "",
        amount: ex.subtotal,
        tax_code: "",
      }]);
    }
  };

  const extractFromInvoice = async (file: File) => {
    if (!form.entity) {
      setErr("Pick an entity first — the AI needs the entity's chart of accounts to suggest a revenue category.");
      return;
    }
    setAiBusy(true);
    setAiPhase("Uploading invoice…");
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

      const resp = await fetch(`${API_BASE}/beakon/ocr/extract-invoice-stream/`, {
        method: "POST", headers, body: fd,
      });
      if (!resp.ok || !resp.body) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body?.error?.message || body?.detail || `HTTP ${resp.status}`);
      }

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
      setErr(e?.message || "Invoice extraction failed");
      setAiSource(null);
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    Promise.all([
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Customer[] } | Customer[]>("/beakon/customers/", { is_active: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { account_type: "revenue" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: TaxCode[] } | TaxCode[]>("/beakon/tax-codes/", { active_flag: "true" }).then((d) =>
        Array.isArray(d) ? d : (d.results ?? [])).catch(() => [] as TaxCode[]),
    ]).then(([es, cs, as, tcs]) => {
      setEntities(es); setCustomers(cs); setAccounts(as); setTaxCodes(tcs);
      if (es.length && !form.entity) setForm((f) => ({ ...f, entity: String(es[0].id) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCustomerChange = (cid: string) => {
    const c = customers.find((x) => String(x.id) === cid);
    setForm((f) => ({ ...f, customer: cid, currency: c?.default_currency || f.currency }));
    if (c?.default_revenue_account && lines.length === 1 && !lines[0].revenue_account) {
      setLines([{ ...lines[0], revenue_account: String(c.default_revenue_account) }]);
    }
  };

  const lineSum = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
    [lines],
  );
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
    if (!form.entity || !form.customer) return;
    setBusy(true);
    setErr(null);
    const payload: any = {
      entity: Number(form.entity),
      customer: Number(form.customer),
      invoice_date: form.invoice_date,
      invoice_number: form.invoice_number,
      currency: form.currency || undefined,
      description: form.description,
      explanation: form.explanation,
      lines: lines
        .filter((l) => l.revenue_account && l.amount)
        .map((l) => {
          const spec: any = {
            revenue_account_id: Number(l.revenue_account),
            description: l.description,
            amount: l.amount,
          };
          if (l.tax_code) spec.tax_code_id = Number(l.tax_code);
          return spec;
        }),
    };
    if (!lineLevelTax.any) payload.tax_amount = form.tax_amount;
    if (form.due_date) payload.due_date = form.due_date;
    if (payload.lines.length === 0) {
      setErr("Add at least one line with a revenue account and amount.");
      setBusy(false);
      return;
    }
    try {
      const created = await api.post<{ id: number }>("/beakon/invoices/", payload);
      // Persist the AI-uploaded scan as an invoice attachment. It auto-
      // transfers to the JE when the invoice is issued
      // (InvoiceService → transfer_invoice_documents_to_je). Failure
      // here is non-fatal — the invoice is already created.
      if (aiReceiptFile && created?.id) {
        try {
          const fd = new FormData();
          fd.append("file", aiReceiptFile);
          const token = localStorage.getItem("access_token");
          const orgId = localStorage.getItem("organization_id");
          const headers: Record<string, string> = {};
          if (token) headers["Authorization"] = `Bearer ${token}`;
          if (orgId) headers["X-Organization-ID"] = orgId;
          await fetch(`${API_BASE}/beakon/invoices/${created.id}/documents/`, {
            method: "POST", headers, body: fd,
          });
        } catch {
          // Non-fatal.
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

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full sm:w-[640px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">New Invoice</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          {/* AI invoice-import section. Mirrors the Bills drawer — upload
              a legacy/external customer invoice (PDF/image) and the AI
              prefills the form for human review. Receipts never auto-
              create. */}
          <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
            <input ref={fileInputRef} type="file"
                   accept="application/pdf,image/*"
                   className="hidden"
                   onChange={(e) => {
                     const f = e.target.files?.[0];
                     if (f) void extractFromInvoice(f);
                     e.target.value = "";
                   }} />
            {!aiBusy && !aiSource && (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand-600" />
                    Import from invoice
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Upload a PDF or image of an invoice you issued. AI extracts
                    customer, dates, line items, and suggests a revenue account.
                    You review and approve.
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
                  Review every field below before saving — AI drafts an invoice, the human approves it.
                </p>
                <button type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[11px] text-brand-700 hover:underline mt-1">
                  Replace with another invoice
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
            {proposedCustomer && (
              <div className="mt-2 pt-2 border-t border-amber-200 flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-700 leading-snug">
                  Create customer record for <span className="font-medium text-gray-900">"{proposedCustomer.name}"</span>?
                </span>
                <button type="button"
                        disabled={creatingCustomer}
                        onClick={createCustomerFromProposal}
                        className="text-[11px] bg-brand-600 hover:bg-brand-700 text-white font-medium px-2.5 py-1 rounded shrink-0 disabled:opacity-50 disabled:cursor-not-allowed">
                  {creatingCustomer ? "Creating…" : "Create customer"}
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
              <span className="text-xs font-medium text-gray-600">Customer *</span>
              <select className="input mt-1" value={form.customer}
                      onChange={(e) => onCustomerChange(e.target.value)}>
                <option value="">— select customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
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
              <span className="text-[10px] text-gray-400">Auto from customer terms if blank.</span>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Currency</span>
              <input className="input mt-1 uppercase font-mono" maxLength={3}
                     value={form.currency}
                     onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Customer-facing invoice number</span>
            <input className="input mt-1 font-mono" value={form.invoice_number}
                   onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
                   placeholder="Leave blank to use our reference" />
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
              placeholder="e.g. Debit Accounts Receivable — customer is now owed pending payment. Credit Service Revenue — services have been delivered for the period covered. Booked at invoice date per accrual accounting."
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Saved on the invoice and copied to the resulting JE for the auditor.
            </p>
          </label>

          <div className="border-t border-canvas-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Lines</span>
              <button type="button"
                      onClick={() => setLines([...lines, { revenue_account: "", description: "", amount: "", tax_code: "" }])}
                      className="text-xs text-brand-700 hover:underline">
                + Add line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const tc = taxCodes.find((t) => String(t.id) === l.tax_code);
                const lineTax = tc ? (Number(l.amount) || 0) * (Number(tc.rate) / 100) : 0;
                const showAiHint = !l.revenue_account && aiSuggestedAccount;
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-start">
                    <select className="input col-span-4" value={l.revenue_account}
                            onChange={(e) => updateLine(i, { revenue_account: e.target.value })}>
                      <option value="">— revenue account —</option>
                      {accounts.map((a) => (
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
                    disabled={busy || !form.entity || !form.customer || lines.every((l) => !l.amount)}
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
  invoice, onClose, onPaid,
}: {
  invoice: Invoice;
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ payment_date: today, bank_account: "", reference: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ results: Account[] } | Account[]>("/beakon/accounts/", { account_subtype: "bank" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d.results ?? []);
        setAccounts(list);
        if (list.length && !form.bank_account) {
          setForm((f) => ({ ...f, bank_account: String(list[0].id) }));
        }
      })
      .catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/beakon/invoices/${invoice.id}/record-payment/`, {
        payment_date: form.payment_date,
        bank_account: Number(form.bank_account),
        reference: form.reference,
      });
      await onPaid();
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e?.detail || e || "Failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white rounded-2xl border border-canvas-200 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">Record payment — {invoice.reference}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="rounded-lg bg-canvas-50 p-3 text-sm">
            <div className="text-gray-900 font-medium">{invoice.customer_name}</div>
            <div className="text-xs text-gray-500">{invoice.entity_code} · {invoice.invoice_number || invoice.reference}</div>
            <div className="font-mono text-base mt-1 tabular-nums">
              {invoice.currency} {fmt2(invoice.total)}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Receipt date *</span>
            <input type="date" className="input mt-1" value={form.payment_date}
                   onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Into bank account *</span>
            <select className="input mt-1" value={form.bank_account}
                    onChange={(e) => setForm((f) => ({ ...f, bank_account: e.target.value }))}>
              <option value="">— pick a bank account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}{a.entity_code ? ` (${a.entity_code})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Reference</span>
            <input className="input mt-1 font-mono" value={form.reference}
                   onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                   placeholder="ACH-12345 / Check #542" />
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          <div className="text-[11px] text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
            Recording payment will <strong>auto-post</strong> a receipt journal entry:
            DR selected bank account / CR AR from {invoice.customer_code}.
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy || !form.bank_account} className="btn-primary">
              {busy ? "Posting…" : "Confirm receipt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


/* ── Posting preview ───────────────────────────────────────────────────
 * Shows the eventual journal entry the invoice will book once issued:
 *   DR Accounts Receivable   <total>           [why]
 *   CR <revenue account>     <line amount>     [why]
 *   CR Output VAT            <tax amount>      [why]
 *
 * Helps the reviewer understand WHAT the invoice will post before
 * clicking "Create draft". The "why" column quotes the deterministic
 * accounting rationale per side.
 */
function PostingPreview({
  lines, accounts, currency, taxAmount, taxIsLineDriven,
}: {
  lines: { revenue_account: string; description: string; amount: string; tax_code: string }[];
  accounts: { id: number; code: string; name: string }[];
  currency: string;
  taxAmount: number;
  taxIsLineDriven: boolean;
}) {
  const filledLines = lines.filter(
    (l) => l.revenue_account && Number(l.amount) > 0,
  );
  const lineSum = filledLines.reduce((s, l) => s + Number(l.amount), 0);
  const total = lineSum + taxAmount;

  if (filledLines.length === 0) {
    return (
      <div className="border border-dashed border-canvas-200 rounded-lg p-3 mt-3 text-xs text-gray-400">
        Pick a revenue account and amount on a line to preview the journal entry.
      </div>
    );
  }

  const acctMap = new Map(accounts.map((a) => [String(a.id), a]));

  return (
    <div className="border border-canvas-200 rounded-lg p-3 mt-3 bg-canvas-50/40">
      <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider mb-2">
        Posting preview · what the invoice will book on issue
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
          <tr className="border-t border-canvas-100">
            <td className="py-1 font-mono text-emerald-700 font-semibold">DR</td>
            <td className="py-1 text-gray-800">
              Accounts Receivable
              <span className="text-[10px] text-gray-400 ml-1">(customer asset)</span>
            </td>
            <td className="py-1 text-right font-mono tabular-nums text-gray-900">
              {fmt2(total)}
            </td>
            <td className="py-1 pl-3 text-gray-600">
              Customer owes us — increases AR. Cleared when the invoice is paid.
            </td>
          </tr>
          {filledLines.map((l, i) => {
            const a = acctMap.get(l.revenue_account);
            return (
              <tr key={`cr-${i}`} className="border-t border-canvas-100">
                <td className="py-1 font-mono text-rose-700 font-semibold">CR</td>
                <td className="py-1 text-gray-800">
                  {a ? `${a.code} · ${a.name}` : "—"}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-gray-900">
                  {fmt2(l.amount)}
                </td>
                <td className="py-1 pl-3 text-gray-600">
                  Revenue earned — increases the income statement.
                  {l.description ? ` (${l.description.slice(0, 50)})` : ""}
                </td>
              </tr>
            );
          })}
          {taxAmount > 0 && (
            <tr className="border-t border-canvas-100">
              <td className="py-1 font-mono text-rose-700 font-semibold">CR</td>
              <td className="py-1 text-gray-800">
                Output VAT (collected)
                {taxIsLineDriven && (
                  <span className="text-[10px] text-gray-400 ml-1">(per-line tax codes)</span>
                )}
              </td>
              <td className="py-1 text-right font-mono tabular-nums text-gray-900">
                {fmt2(taxAmount)}
              </td>
              <td className="py-1 pl-3 text-gray-600">
                VAT charged to customer — owed to the tax authority on remittance.
              </td>
            </tr>
          )}
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
function buildAIInvoiceExplanation(args: {
  customerName?: string | null;
  invoiceDate?: string | null;
  currency?: string | null;
  total?: string | null;
  reasoning?: string | null;
  lineCount: number;
  hasTax: boolean;
}): string {
  const parts: string[] = [];
  const who = args.customerName ? `to ${args.customerName}` : "to the customer";
  const when = args.invoiceDate ? ` dated ${args.invoiceDate}` : "";
  const what = args.lineCount > 0
    ? `${args.lineCount} line item${args.lineCount === 1 ? "" : "s"}`
    : "the invoice subtotal";
  parts.push(`Issuing the invoice ${who}${when}.`);
  parts.push(
    "Debit Accounts Receivable — the customer now owes us pending payment.",
  );
  parts.push(
    `Credit the revenue account on each line — services or goods have been delivered (covers ${what}).`,
  );
  if (args.hasTax) {
    parts.push("Credit Output VAT — tax we charged the customer; owed to the authority on remittance.");
  }
  if (args.reasoning) {
    parts.push("");
    parts.push(`AI categoriser: ${args.reasoning}`);
  }
  return parts.join("\n");
}
