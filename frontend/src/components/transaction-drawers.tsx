"use client";

/* Transaction Type drawers — purpose-built JE creation forms.
 *
 * Per Thomas (voice note 2026-04-25): each transaction type has its
 * own field set. These four drawers are the v1 forms for the types
 * that don't have a dedicated existing screen (AP and AR already
 * have Bills / Invoices). All drawers share:
 *
 *   - common header/shell + Cancel / Create draft footer
 *   - entity + date pickers
 *   - submit POSTs to /beakon/journal-entries/ then routes to the new
 *     JE detail page
 *
 * Each drawer composes a 2-line balanced JE under the hood — the user
 * sees the type-natural fields (qty / price / loan code / asset code),
 * the form derives the debit/credit lines and attaches the right
 * dimension codes (custodian, portfolio, instrument, etc.).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X, AlertCircle, Plus, Minus, Paperclip, Sparkles, Loader2, Upload,
  TrendingUp, Landmark, Building, NotebookPen, CreditCard, Network,
  Users, Hourglass, CalendarCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";


// ── Shared types ──────────────────────────────────────────────────────────

interface EntityOpt {
  id: number; code: string; name: string;
  functional_currency: string;
}
interface AccountOpt {
  id: number; code: string; name: string;
  account_type: string; account_subtype: string;
  entity_code: string | null;
}
interface BankAccountOpt {
  id: number; name: string; bank_name: string;
  currency: string; account: number; entity: number;
}
interface DimensionValueOpt {
  id: number; code: string; name: string;
  dimension_type_code?: string;
}

interface TypedDrawerProps {
  open: boolean;
  onClose: () => void;
}


// ── Shared shell ──────────────────────────────────────────────────────────

function DrawerShell({
  open, onClose, icon: Icon, kicker, title, subtitle, children, footer,
}: {
  open: boolean;
  onClose: () => void;
  icon: LucideIcon;
  kicker: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[600px] bg-white border-l border-canvas-200 overflow-y-auto flex flex-col">
        <div className="px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 shrink-0 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center ring-1 ring-inset ring-brand-200">
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">{kicker}</p>
                <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">{title}</h2>
                <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {children}
        </div>
        <div className="sticky bottom-0 border-t border-canvas-100 bg-white/95 backdrop-blur px-5 py-3 flex justify-end gap-2">
          {footer}
        </div>
      </div>
    </div>
  );
}

function Field({
  label, hint, required, children, span,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  span?: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", span === 2 && "col-span-2")}>
      <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10px] text-gray-400">{hint}</span>}
    </label>
  );
}

function ErrorBlock({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="whitespace-pre-wrap">{msg}</span>
    </div>
  );
}

function asArray<T>(d: { results?: T[] } | T[]): T[] {
  return Array.isArray(d) ? d : (d.results ?? []);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtErr(e: any): string {
  if (typeof e?.detail === "string") return e.detail;
  if (e?.error?.message) return e.error.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e?.detail || e || "Failed", null, 2); } catch { return "Failed"; }
}


// ── Shared loader for entities + bank accounts ────────────────────────────

function useEntities(open: boolean) {
  const [entities, setEntities] = useState<EntityOpt[]>([]);
  useEffect(() => {
    if (!open) return;
    api.get<{ results: EntityOpt[] } | EntityOpt[]>("/beakon/entities/")
      .then((d) => setEntities(asArray(d).filter((e: any) => e.is_active !== false)))
      .catch(() => setEntities([]));
  }, [open]);
  return entities;
}

function useBankAccounts(open: boolean, entityId: string) {
  const [bas, setBAs] = useState<BankAccountOpt[]>([]);
  useEffect(() => {
    if (!open) return;
    api.get<{ results: BankAccountOpt[] } | BankAccountOpt[]>("/beakon/bank-accounts/")
      .then((d) => setBAs(asArray(d)))
      .catch(() => setBAs([]));
  }, [open]);
  return useMemo(
    () => entityId ? bas.filter((b) => String(b.entity) === entityId) : bas,
    [bas, entityId],
  );
}

function useAccounts(open: boolean, params: Record<string, string>) {
  const [accs, setAccs] = useState<AccountOpt[]>([]);
  // Stringify params for stable dependency
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!open) return;
    // Force a wide page so the AI's matched_account_id isn't lost behind
    // pagination — the JE drawer doesn't filter by account_type, so the
    // result set can easily exceed the default page size.
    const effective = { page_size: "500", ...params };
    api.get<{ results: AccountOpt[] } | AccountOpt[]>("/beakon/accounts/", effective)
      .then((d) => setAccs(asArray(d).filter((a) => a.entity_code === null || true)))
      .catch(() => setAccs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);
  return accs;
}

function useDimensionValues(open: boolean, dimCode: string) {
  // Fetch all dimension values once, filter client-side by dimension_type_code.
  const [all, setAll] = useState<DimensionValueOpt[]>([]);
  useEffect(() => {
    if (!open) return;
    api.get<{ results: DimensionValueOpt[] } | DimensionValueOpt[]>(
      "/beakon/dimension-values/", { active_flag: "true", page_size: "500" },
    )
      .then((d) => setAll(asArray(d)))
      .catch(() => setAll([]));
  }, [open]);
  return useMemo(
    () => all.filter((v) => v.dimension_type_code === dimCode),
    [all, dimCode],
  );
}


// ── 1. General Journal Entry ──────────────────────────────────────────────

interface JLine {
  account_id: string;
  description: string;
  debit: string;
  credit: string;
  currency: string;
  // Phase 1.5 additions per Thomas's expanded JE spec (WhatsApp 2026-04-25).
  // Cost centre and tax code are captured here today; on submit they're
  // appended to the line description as labelled markers — `[CC: …]`,
  // `[TAX: …]` — until the dimension and tax engines have proper columns.
  cost_centre: string;
  tax_code: string;
}

function periodLabelForDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" });
}

export function GeneralJEDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const accounts = useAccounts(open, {});

  const [entityId, setEntityId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [memo, setMemo] = useState("");
  const [explanation, setExplanation] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JLine[]>([
    { account_id: "", description: "", debit: "", credit: "", currency: "", cost_centre: "", tax_code: "" },
    { account_id: "", description: "", debit: "", credit: "", currency: "", cost_centre: "", tax_code: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // ── Attached source-document staging ─────────────────────────────
  // The Bills (AP) drawer attaches uploaded receipts to the resulting
  // bill record. For manual JEs we mirror that pattern: collect the
  // file before the JE exists, then upload it via the JE's
  // /documents/ endpoint once the entry id is back. Failure to attach
  // is non-fatal — the JE still gets created, the user sees an inline
  // warning so they can re-upload from the JE detail page.
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Bills-shaped UI: credit-side picker + tax amount ─────────────
  // Declared before the accounts-resolve effect because that effect
  // pre-fills `creditAccountId` / `inputVatAccountId` and re-runs on
  // `linesResolveTick`. Block-scoped vars can't be referenced before
  // declaration, so these have to live above the effect.
  const [creditAccountId, setCreditAccountId] = useState("");
  const [creditDescription, setCreditDescription] = useState("");
  const [taxAmount, setTaxAmount] = useState("0.00");
  const [dueDate, setDueDate] = useState("");
  const [inputVatAccountId, setInputVatAccountId] = useState("");
  // Bumped after applyExtraction writes new lines so the
  // accounts-effect re-runs against the freshly-populated rows even
  // when `accounts` itself didn't change.
  const [linesResolveTick, setLinesResolveTick] = useState(0);

  // When the accounts list loads:
  //   (a) scrub any `account_id` that doesn't resolve to an option in
  //       the dropdown — phantom ids from AI extraction silently land
  //       in form state but render as "— account —", which hides the
  //       candidate chips. Clearing them makes the line look truly
  //       empty so the user is guided toward the candidates strip.
  //   (b) auto-resolve VAT and AP lines from line-description hints.
  //       The AI returns generic candidates for the whole bill (e.g.
  //       Operating Expenses, Cloud Hosting, Coworking). VAT and AP
  //       lines need specific accounts the AI doesn't usually rank.
  //       We match on account code/name heuristics so VAT receivable
  //       and Accounts Payable are pre-filled if the entity's CoA has
  //       them.
  useEffect(() => {
    if (accounts.length === 0) return;
    const valid = new Set(accounts.map((a) => String(a.id)));
    const lower = (s: string) => (s || "").toLowerCase();
    const inputVatAccount = accounts.find((a) => {
      const c = lower(a.code), n = lower(a.name);
      // Input VAT first (recoverable). Excludes output / sales VAT.
      const isVat = c.includes("vat") || n.includes("vat") || n.includes("mwst") || n.includes("tva");
      const isInput = c.includes("input") || n.includes("input") ||
                      n.includes("recoverable") || n.includes("receivable") ||
                      c.startsWith("11") || c.startsWith("12");
      const isOutput = n.includes("output") || n.includes("sales") || n.includes("payable") ||
                       c.startsWith("22") || c.startsWith("23");
      return isVat && (isInput || !isOutput);
    });
    const apAccount = accounts.find((a) => {
      const c = lower(a.code), n = lower(a.name);
      return (
        n.includes("accounts payable") ||
        n.includes("trade payable") ||
        n.includes("creditor") ||
        c === "2000" || c === "2010" || c === "2100"
      );
    });

    setLines((ls) => {
      let changed = false;
      const next = ls.map((l) => {
        // Scrub phantom ids that don't resolve to a loaded account.
        if (l.account_id && !valid.has(l.account_id)) {
          changed = true;
          l = { ...l, account_id: "" };
        }
        return l;
      });
      return changed ? next : ls;
    });
    // Auto-resolve the credit-side account when empty: AP for vendor
    // bills, otherwise leave for the user to pick. Same heuristic as
    // before but applied to the dedicated credit-side state.
    if (!creditAccountId && apAccount) {
      setCreditAccountId(String(apAccount.id));
    }
    // Reference the VAT account for the preview helper.
    if (inputVatAccount) setInputVatAccountId(String(inputVatAccount.id));
  }, [accounts, linesResolveTick]);

  // ── AI extraction — same pipeline as the Bills (AP) drawer ──────
  // Calls /beakon/ocr/extract-stream/ which returns SSE events with
  // phase/token progress and a final `done` event carrying the parsed
  // extraction. We map the result into JE form state: one DR line per
  // extracted line_item, optional VAT line, and a balancing CR line
  // the user fills in (since manual JEs don't assume an AP credit
  // side the way Bills do).
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPhase, setAiPhase] = useState("");
  const [aiPct, setAiPct] = useState(0);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiSource, setAiSource] = useState<{ filename: string; model: string } | null>(null);
  // AI's suggested expense account, kept around even when the server
  // failed to resolve it to a concrete account (low confidence). Rendered
  // as an inline hint below empty line dropdowns — same affordance the
  // Bills (AP) drawer provides via `aiSuggestedAccount`.
  const [aiSuggestedAccount, setAiSuggestedAccount] = useState<
    | { code: string | null; name: string | null; reasoning: string }
    | null
  >(null);
  // Tax codes for the per-line VAT dropdown — mirrors Bills'
  // taxCodes state. (creditAccountId/taxAmount/dueDate/inputVatAccountId/
  // linesResolveTick are declared earlier — see the accounts-resolve
  // effect for why they have to live above it.)
  const [taxCodes, setTaxCodes] = useState<Array<{ id: number; code: string; rate: string; tax_type: string }>>([]);
  useEffect(() => {
    if (!open) return;
    api.get<{ results: any[] } | any[]>("/beakon/tax-codes/", { active_flag: "true" })
      .then((d) => setTaxCodes(asArray(d)))
      .catch(() => setTaxCodes([]));
  }, [open]);
  // Server-validated alternative account picks from the AI. Rendered as
  // clickable chips below empty Account dropdowns so the user doesn't
  // have to scroll the full chart when the model was unsure. Same shape
  // as the Bills (AP) drawer's `accountCandidates`.
  const [accountCandidates, setAccountCandidates] = useState<Array<{
    id: number;
    code: string;
    name: string;
    score?: number;
    reason?: string;
  }>>([]);

  // ── Teach Beakon side-panel state ─────────────────────────────────
  // Mirrors the Bills (AP) drawer's Teach panel. Captures structured
  // corrections + an optional reusable-rule scope; posts to the JE's
  // /corrections/ endpoint after the JE is created. Panel only opens
  // after a successful AI extraction — there's nothing to teach about
  // a manual entry the AI never proposed.
  const [teachOpen, setTeachOpen] = useState(false);
  const [errorTypes, setErrorTypes] = useState<string[]>([]);
  const [futureRuleInstruction, setFutureRuleInstruction] = useState("");
  const [teachScopeHint, setTeachScopeHint] = useState("");
  const [applyToFutureRule, setApplyToFutureRule] = useState(true);
  const [aiSnapshot, setAiSnapshot] = useState<Record<string, unknown> | null>(null);
  const [aiVendorName, setAiVendorName] = useState("");
  const [aiVendorCode, setAiVendorCode] = useState("");
  const [aiCustomerNumber, setAiCustomerNumber] = useState("");
  const [aiSuggestedRule, setAiSuggestedRule] = useState("");

  const toggleErrorType = (key: string) => {
    setErrorTypes((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  // JE-flavoured version of buildAIExplanation. Mirrors what the Bills
  // drawer writes into the Explanation field, but doesn't assume an AP
  // credit side — the user picks bank / AP / suspense based on what
  // they're actually booking.
  const buildJEExplanation = (args: {
    vendorName?: string | null;
    invoiceDate?: string | null;
    lineCount: number;
    hasTax: boolean;
    reasoning?: string | null;
  }): string => {
    const parts: string[] = [];
    const who = args.vendorName ? `from ${args.vendorName}` : "from the supplier";
    const when = args.invoiceDate ? ` dated ${args.invoiceDate}` : "";
    const what = args.lineCount > 0
      ? `${args.lineCount} line item${args.lineCount === 1 ? "" : "s"}`
      : "the invoice subtotal";
    parts.push(`Manual journal entry for the bill ${who}${when}.`);
    parts.push(
      `Debit the expense account on each line — the cost has been incurred (covers ${what}).`,
    );
    if (args.hasTax) {
      parts.push("Debit Input VAT — the tax we paid is recoverable from the authority.");
    }
    parts.push(
      "Credit the funding side — pick Accounts Payable (if owed) or Bank / Cash (if already settled).",
    );
    if (args.reasoning) {
      parts.push("");
      parts.push(`AI categoriser: ${args.reasoning}`);
    }
    return parts.join("\n");
  };

  const applyExtraction = (event: any) => {
    const ex = event.extraction || {};
    setAiWarnings(event.warnings || []);
    setAiSource({ filename: event.filename || "uploaded file", model: ex.model_used || "unknown" });

    // Capture the AI's suggested account when the server didn't resolve
    // it to a concrete account on this entity's CoA — surfaces as a hint
    // beneath each empty line account dropdown.
    const sai = event.suggested_account_info;
    if (sai && !event.matched_account_id) {
      setAiSuggestedAccount({
        code: sai.code ?? null,
        name: sai.name ?? null,
        reasoning: sai.reasoning || ex.suggested_account_reasoning || "",
      });
    } else if (!event.matched_account_id && ex.suggested_account_reasoning) {
      // Backend didn't return a structured suggested_account_info but
      // the AI did give us free-text reasoning — still surface it so
      // the user has *something* to act on.
      setAiSuggestedAccount({
        code: null, name: null,
        reasoning: ex.suggested_account_reasoning,
      });
    } else {
      setAiSuggestedAccount(null);
    }
    // Stash server-validated alternative candidates for the per-line
    // chip strip. Bills passes these in as `account_candidates`.
    setAccountCandidates(Array.isArray(event.account_candidates) ? event.account_candidates : []);

    // Pre-fill header fields when present. Don't overwrite values the
    // user has already typed unless they're empty.
    setMemo((prev) => prev || ex.description || (ex.vendor_name ? `Bill from ${ex.vendor_name}` : ""));
    setReference((prev) => prev || ex.invoice_number || "");
    if (ex.invoice_date) setDate(ex.invoice_date);

    // Auto-fill the Explanation only when the user hasn't typed one.
    // Mirrors the Bills drawer's behaviour so the auditor sees the
    // same AI-reasoned template on both forms.
    const aiTemplate = buildJEExplanation({
      vendorName: ex.vendor_name,
      invoiceDate: ex.invoice_date,
      lineCount: (ex.line_items || []).filter((li: any) => !li.is_absorbed).length,
      hasTax: !!(ex.tax_amount && ex.tax_amount !== "0"),
      reasoning: ex.suggested_account_reasoning || ex.reasoning,
    });
    setExplanation((prev) => prev || aiTemplate);

    // ── Teach Beakon pre-fill ───────────────────────────────────
    // Capture the AI snapshot + vendor + scope hint at extraction time
    // so the Teach panel has everything it needs without re-fetching.
    setAiSnapshot({
      vendor_name: ex.vendor_name,
      invoice_number: ex.invoice_number,
      total: ex.total,
      subtotal: ex.subtotal,
      tax_amount: ex.tax_amount,
      currency: ex.currency,
      line_items: ex.line_items || [],
      customer_number: ex.customer_number || "",
      suggested_account_reasoning: ex.suggested_account_reasoning || "",
      model_used: ex.model_used,
    });
    setAiVendorName(ex.vendor_name || "");
    setAiVendorCode((event.matched_vendor && event.matched_vendor.code) || "");
    setAiCustomerNumber(ex.customer_number || "");
    setAiSuggestedRule(ex.suggested_rule_text || "");
    setTeachScopeHint(
      ex.customer_number ? `Customer number: ${ex.customer_number}` : "",
    );
    if (ex.suggested_rule_text) setFutureRuleInstruction(ex.suggested_rule_text);

    // Build JE expense lines (DR side only) from the AI extraction.
    // Bills-shaped UI: lines table holds expense DRs; the VAT amount
    // and credit-side account live in their own form fields above the
    // Posting Preview, which derives the final DR/CR rows.
    const lineItems = (ex.line_items || []).filter((li: any) => !li.is_absorbed);
    const matchedAccount = event.matched_account_id ? String(event.matched_account_id) : "";
    const taxAmt = parseFloat(ex.tax_amount || "0") || 0;
    const ccy = (ex.currency || "").toUpperCase();

    const newLines: JLine[] = [];
    for (const li of lineItems) {
      newLines.push({
        account_id: matchedAccount,
        description: li.description || "",
        debit:  li.amount ? String(li.amount) : "",
        credit: "",
        currency: ccy,
        cost_centre: "",
        tax_code: "",
      });
    }
    // Always leave a minimum of 1 line so the table stays usable.
    while (newLines.length < 1) {
      newLines.push({
        account_id: "", description: "", debit: "", credit: "",
        currency: ccy, cost_centre: "", tax_code: "",
      });
    }
    if (newLines.length > 0) setLines(newLines);

    // Fill the header-level VAT amount + credit-side description.
    // The actual AP / Bank account is resolved by the auto-resolver
    // that watches `accounts` and matches by description keywords.
    if (taxAmt > 0) setTaxAmount(taxAmt.toFixed(2));
    setCreditDescription(
      ex.vendor_name ? `Payable — ${ex.vendor_name}` : "",
    );
    if (dueDate === "" && ex.due_date) setDueDate(ex.due_date);

    // Bump the resolve tick so the accounts-effect re-runs against the
    // freshly-populated lines (auto-fills VAT/AP, scrubs phantom ids).
    setLinesResolveTick((n) => n + 1);

    // Auto-open the Teach Beakon side panel — same trigger as Bills:
    // open whenever the AI either suggested a rule for next time or
    // marked lines as "absorbed" (the model raised its hand). Without
    // this, the right block never appears unless the user clicks the
    // "Correct & teach Beakon" button manually.
    const absorbed = (ex.line_items || []).filter((li: any) => li.is_absorbed);
    const aiFlagged = absorbed.length > 0 || !!(ex.suggested_rule_text || "").trim();
    setTeachOpen(aiFlagged);
  };

  const extractFromDocument = async (file: File) => {
    if (!entityId) {
      setErr("Pick an entity first — the AI needs the entity's chart of accounts.");
      return;
    }
    setAiBusy(true);
    setAiPhase("Uploading…");
    setAiPct(2);
    setAiWarnings([]);
    setAiSource(null);
    setErr(null);
    setAttachErr(null);
    // Always stage the file so it attaches to the JE on Create, even
    // if AI extraction fails — the auditor still wants the source doc.
    setAttachedFile(file);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entity", entityId);
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

      // SSE consumer — same shape as the Bills (AP) drawer.
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
      applyExtraction({ ...doneEvent, filename: file.name });
      setAiPct(100);
    } catch (e: any) {
      setErr(e?.message || "AI extraction failed — you can still create the JE manually with the attached file.");
      setAiSource(null);
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);

  const entity = entities.find((e) => String(e.id) === entityId);
  const ccyDefault = entity?.functional_currency || "EUR";

  // Posting Preview rows — derived from the simplified Bills-shaped
  // input (lines table = expense DRs; tax amount + credit-side picker
  // for the rest). Mirrors what the JE will actually post on save.
  interface PreviewRow {
    drCr: "DR" | "CR";
    accountId: string;
    accountLabel: string;
    amount: number;
    why: string;
  }
  const postingPreview: PreviewRow[] = useMemo(() => {
    const rows: PreviewRow[] = [];
    for (const l of lines) {
      const amt = parseFloat(l.debit) || 0;
      if (amt <= 0 || !l.account_id) continue;
      const acct = accounts.find((a) => String(a.id) === l.account_id);
      rows.push({
        drCr: "DR",
        accountId: l.account_id,
        accountLabel: acct ? `${acct.code} · ${acct.name}` : "— pick account —",
        amount: amt,
        why: l.description
          ? `Expense was incurred — increases expense balance. (${l.description})`
          : "Expense was incurred — increases expense balance.",
      });
    }
    const vatAmt = parseFloat(taxAmount) || 0;
    if (vatAmt > 0) {
      const vatAcct = accounts.find((a) => String(a.id) === inputVatAccountId);
      rows.push({
        drCr: "DR",
        accountId: inputVatAccountId,
        accountLabel: vatAcct
          ? `${vatAcct.code} · ${vatAcct.name} (recoverable)`
          : "Input VAT (pick account)",
        amount: vatAmt,
        why: "VAT we paid the supplier — claimable from the tax authority.",
      });
    }
    const totalDr = rows.reduce((s, r) => s + r.amount, 0);
    if (totalDr > 0) {
      const crAcct = accounts.find((a) => String(a.id) === creditAccountId);
      rows.push({
        drCr: "CR",
        accountId: creditAccountId,
        accountLabel: crAcct
          ? `${crAcct.code} · ${crAcct.name} (supplier liability)`
          : (creditDescription || "— pick credit account —"),
        amount: totalDr,
        why: creditDescription
          ? `Supplier is owed — increases AP. Cleared when the bill is paid.`
          : "Balancing credit — pick the funding account (AP, Bank, etc.).",
      });
    }
    return rows;
  }, [lines, taxAmount, creditAccountId, creditDescription, inputVatAccountId, accounts]);

  const previewTotals = useMemo(() => {
    let dr = 0, cr = 0;
    for (const r of postingPreview) {
      if (r.drCr === "DR") dr += r.amount; else cr += r.amount;
    }
    return { dr, cr, balanced: Math.abs(dr - cr) < 0.005 };
  }, [postingPreview]);

  const sums = useMemo(() => ({
    dr: previewTotals.dr,
    cr: previewTotals.cr,
    diff: previewTotals.dr - previewTotals.cr,
  }), [previewTotals]);

  function updateLine(i: number, patch: Partial<JLine>) {
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  // Count lines that would actually be posted. The Posting Preview is
  // the source of truth (it's what the user sees). Postable rows have
  // an account_id and a non-zero amount. Missing-account counts both
  // expense lines with an amount but no account AND the credit-side
  // row when it has nothing.
  const accountIdSet = new Set(accounts.map((a) => String(a.id)));
  const postableLineCount = postingPreview.filter(
    (r) => r.accountId && accountIdSet.has(r.accountId) && r.amount > 0,
  ).length;
  const missingAccountCount = (
    lines.filter(
      (l) =>
        (parseFloat(l.debit) || 0) > 0 &&
        (!l.account_id || !accountIdSet.has(l.account_id)),
    ).length
  ) + (
    // The credit side counts as 1 missing if the user hasn't picked one.
    (postingPreview.some((r) => r.drCr === "CR") &&
     !accountIdSet.has(creditAccountId)) ? 1 : 0
  ) + (
    // The Input VAT side counts as 1 missing if VAT > 0 but no account.
    (parseFloat(taxAmount) > 0 && !accountIdSet.has(inputVatAccountId)) ? 1 : 0
  );

  async function submit() {
    if (!entityId) return;
    if (Math.abs(sums.diff) > 0.005) {
      setErr(`Lines don't balance: DR ${sums.dr.toFixed(2)} vs CR ${sums.cr.toFixed(2)}.`);
      return;
    }
    // Hard guard: at least 2 lines must carry an account + an amount.
    // Without this the server returns the cryptic
    // "Ensure this field has at least 2 elements." 400. Walk the user
    // to which lines are blocking them instead.
    if (postableLineCount < 2) {
      if (missingAccountCount > 0) {
        setErr(
          `${missingAccountCount} line${missingAccountCount === 1 ? "" : "s"} ` +
          `${missingAccountCount === 1 ? "has" : "have"} an amount but no account. ` +
          `Pick an account on each line (use the amber "AI suggested" hint if shown) before creating the draft.`,
        );
      } else {
        setErr("A journal entry needs at least 2 lines — one debit and one credit. Add lines and fill in amounts.");
      }
      return;
    }
    setBusy(true); setErr(null);
    try {
      // Build the lines payload from the Posting Preview rows — that's
      // what we showed the user, so the JE posts exactly what they saw.
      // Each preview row maps cleanly to one JournalLine.
      const payloadLines = postingPreview.map((r) => ({
        account_id: Number(r.accountId),
        description: r.accountLabel.replace(/^[0-9A-Za-z_-]+ · /, ""),
        debit:  r.drCr === "DR" ? r.amount.toFixed(2) : "0",
        credit: r.drCr === "CR" ? r.amount.toFixed(2) : "0",
        currency: ccyDefault,
      }));
      const payload = {
        entity_id: Number(entityId),
        date,
        memo: memo.trim(),
        explanation: explanation.trim(),
        reference: reference.trim(),
        currency: ccyDefault,
        source_type: "manual",
        lines: payloadLines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );

      // Attach the staged source document, if any. Done as a multipart
      // POST via fetch (the api client wraps JSON only). Failure to
      // attach is non-fatal — we route to the JE detail page either way;
      // the user sees the warning and can re-upload from there.
      if (attachedFile) {
        try {
          const fd = new FormData();
          fd.append("file", attachedFile);
          const token = localStorage.getItem("access_token");
          const orgId = localStorage.getItem("organization_id");
          const headers: Record<string, string> = {};
          if (token) headers["Authorization"] = `Bearer ${token}`;
          if (orgId) headers["X-Organization-ID"] = orgId;
          const resp = await fetch(
            `${API_BASE}/beakon/journal-entries/${created.id}/documents/`,
            { method: "POST", headers, body: fd },
          );
          if (!resp.ok) {
            const body = await resp.json().catch(() => ({ detail: resp.statusText }));
            throw new Error(body?.detail || body?.error?.message || `HTTP ${resp.status}`);
          }
        } catch (attachE: any) {
          setAttachErr(
            attachE?.message ||
            "JE was created, but the attachment failed. Re-upload from the entry's detail page.",
          );
          // Still route — entry exists, user can fix the attachment there.
        }
      }

      // ── Teach Beakon: save the structured correction ─────────────
      // Fires only when the user wrote a future-rule instruction OR
      // checked error types — otherwise the panel was opened but not
      // used. Same payload shape as /bills/<id>/corrections/.
      const wantsTeach =
        errorTypes.length > 0 ||
        (applyToFutureRule && futureRuleInstruction.trim().length > 0);
      if (wantsTeach) {
        try {
          await api.post(`/beakon/journal-entries/${created.id}/corrections/`, {
            correction_text:
              futureRuleInstruction.trim() ||
              "Reviewer flagged this entry via Teach Beakon at create time.",
            error_types: errorTypes,
            make_reusable_rule: applyToFutureRule && futureRuleInstruction.trim().length > 0,
            future_rule_instruction: applyToFutureRule ? futureRuleInstruction.trim() : "",
            ai_proposal_snapshot: aiSnapshot || {},
            ai_vendor_name: aiVendorName,
            vendor_code: aiVendorCode,
          });
        } catch (teachE) {
          // Non-fatal — the JE exists, the user can teach from the JE
          // detail page if the correction save blipped. Don't block the
          // route; just log to the console for debugging.
          console.warn("Teach Beakon save failed; route anyway:", teachE);
        }
      }

      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  // Thomas asked for the JE entry form to mirror the Bills (AP) drawer
  // visually: same fixed side-drawer, simple header bar, label-on-top
  // field stack, 12-col line grid, totals row in the footer. Inline
  // structure (not DrawerShell) so it matches CreateBillDrawer exactly.
  if (!open) return null;
  const balanced = Math.abs(sums.diff) <= 0.005;
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div
        className={cn(
          "bg-white border-l border-canvas-200 flex transition-all duration-200",
          // Width matches the Bills drawer's expand-on-teach behaviour:
          // 640px solo, 1120px when the Teach panel is open.
          teachOpen ? "w-full sm:w-[1120px]" : "w-full sm:w-[640px]",
        )}
      >
        <div className={cn(
          "flex flex-col overflow-hidden",
          teachOpen ? "w-[640px] shrink-0 border-r border-canvas-100" : "flex-1",
        )}>
        {/* Header — mirrors the Bills "New Bill" bar exactly. */}
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">New Journal Entry</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {/* AI extraction banner — same SSE flow as the Bills (AP)
              drawer. Pick a file → /ocr/extract-stream/ → form pre-fills
              with vendor + lines + suggested account; the file itself is
              also staged for upload as a JE attachment on Create. */}
          <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*,.csv,.xls,.xlsx,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void extractFromDocument(f);
                e.target.value = "";
              }}
            />
            {!aiBusy && !aiSource && !attachedFile && (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand-600" />
                    Import from document
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Upload a PDF or image. AI extracts line items, suggests
                    an account, and pre-fills the JE. You review and approve.
                  </p>
                  {!entityId && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      Pick an entity first — the AI uses the entity&apos;s chart of accounts.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!entityId}
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-secondary text-xs whitespace-nowrap disabled:opacity-50"
                >
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
                      AI-extracted from{" "}
                      <span className="font-mono text-gray-900 truncate">{aiSource.filename}</span>
                      <span className="text-gray-400">via {aiSource.model}</span>
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Review every field below before saving — AI drafts the JE,
                      the human approves it. The source document attaches to the
                      JE on Create.
                    </p>
                  </div>
                  {!teachOpen && (
                    <button
                      type="button"
                      onClick={() => setTeachOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Correct &amp; teach Beakon
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-brand-700 hover:underline"
                  >
                    Replace with another file
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAttachedFile(null); setAiSource(null); }}
                    className="text-rose-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
            {!aiBusy && !aiSource && attachedFile && (
              // Manual-attach branch — user picked a file but extraction
              // didn't run or didn't succeed. The file still uploads on Create.
              <div>
                <p className="text-xs text-gray-700 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                  <span className="font-mono text-gray-900 truncate">{attachedFile.name}</span>
                  <span className="text-gray-400 shrink-0">
                    ({(attachedFile.size / 1024).toFixed(1)} KB)
                  </span>
                </p>
                <div className="mt-1.5 flex items-center gap-3 text-[11px]">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-brand-700 hover:underline"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttachedFile(null)}
                    className="text-rose-600 hover:underline"
                  >
                    Remove
                  </button>
                  <span className="text-gray-400 ml-auto">
                    Uploads when the draft is created.
                  </span>
                </div>
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
            {attachErr && (
              <p className="mt-2 text-[11px] text-amber-800 border-t border-amber-200 pt-2">
                ⚠ {attachErr}
              </p>
            )}
          </div>

          {/* 2-col: Entity / Posting date — same grid as Bills (Entity / Vendor). */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Entity *</span>
              <select className="input mt-1" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Posting date *</span>
              <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
              <span className="text-[10px] text-gray-400">Accounting period: {periodLabelForDate(date)}.</span>
            </label>
          </div>

          {/* 3-col: Currency / Reference / (empty) — mirrors the Bills
              "Invoice date / Due date / Currency" row. */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Currency</span>
              <input
                className="input mt-1 uppercase font-mono"
                maxLength={3}
                value={ccyDefault}
                readOnly
                title="Entity functional currency. Per-line currency edits are still allowed."
              />
              <span className="text-[10px] text-gray-400">Functional currency of {entity?.code || "the entity"}.</span>
            </label>
            <label className="block col-span-2">
              <span className="text-xs font-medium text-gray-600">Reference</span>
              <input
                className="input mt-1 font-mono"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Optional — invoice no., wire ref, journal voucher ID"
              />
            </label>
          </div>

          {/* Description — textarea, matches the Bills drawer's Description. */}
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Description</span>
            <textarea
              className="input mt-1"
              rows={2}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="One-line subject — e.g. April rent — WeWork"
            />
          </label>

          {/* Explanation — verbatim wording from the Bills drawer so the
              auditor-facing helper text reads the same on both forms. */}
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
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="e.g. Debit Office Rent — April service period consumed. Credit Operating Bank — wire cleared 2026-04-30."
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Saved on the JE for the auditor.
            </p>
          </label>

          {/* ── Lines — Bills-shape 12-col grid: just Account, Description,
              Amount (NET debit), VAT code. No Cost centre, no DR/CR split.
              The Credit side is picked separately below; the Posting Preview
              derives the final DR/CR rows from this state. ── */}
          <div className="border-t border-canvas-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Lines</span>
              <button
                type="button"
                onClick={() => setLines([...lines, { account_id: "", description: "", debit: "", credit: "", currency: "", cost_centre: "", tax_code: "" }])}
                className="text-xs text-brand-700 hover:underline"
              >
                + Add line
              </button>
            </div>

            <div className="grid grid-cols-12 gap-2 px-1 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              <span className="col-span-4">Account</span>
              <span className="col-span-4">Description</span>
              <span className="col-span-2 text-right">Amount</span>
              <span className="col-span-2">VAT</span>
            </div>

            <div className="space-y-2">
              {lines.map((l, i) => {
                // An account is "valid" only when it's actually one of
                // the accounts we loaded — the AI sometimes returns a
                // matched_account_id that lives on a different entity
                // or isn't visible to the current user. In that case
                // the dropdown displays "— account —" even though
                // l.account_id has a value, so we have to fall back to
                // the candidate chips. Treat that case as "needs account".
                const accountIsValid =
                  !!l.account_id &&
                  accounts.some((a) => String(a.id) === l.account_id);
                const showAiHint =
                  !accountIsValid &&
                  !!aiSuggestedAccount &&
                  (parseFloat(l.debit) || 0) > 0;
                // Pick the closest account match for the suggested code,
                // so clicking the hint chip selects it.
                const candidate = showAiHint
                  ? accounts.find((a) =>
                      (aiSuggestedAccount?.code && a.code === aiSuggestedAccount.code) ||
                      (aiSuggestedAccount?.name && a.name === aiSuggestedAccount.name))
                  : null;
                // Highlight the Account dropdown in red when the line has
                // an amount but no account — the user will otherwise hit
                // the cryptic "Ensure this field has at least 2 elements"
                // error from the server when they click Create draft.
                const hasAmount =
                  (parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0;
                const needsAccount = hasAmount && !accountIsValid;
                return (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <select
                    className={cn(
                      "input col-span-4 text-xs",
                      needsAccount && "border-rose-300 bg-rose-50/40",
                    )}
                    value={l.account_id}
                    onChange={(e) => updateLine(i, { account_id: e.target.value })}
                  >
                    <option value="">— account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                  <input
                    className="input col-span-4 text-xs"
                    placeholder="Description"
                    value={l.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                  />
                  <input
                    className="input col-span-2 text-right font-mono text-xs"
                    placeholder="0.00"
                    inputMode="decimal"
                    value={l.debit}
                    onChange={(e) => updateLine(i, { debit: e.target.value, credit: "" })}
                  />
                  <select
                    className="input col-span-2 text-xs"
                    value={l.tax_code}
                    onChange={(e) => updateLine(i, { tax_code: e.target.value })}
                    title="Per-line VAT rate."
                  >
                    <option value="">No VAT</option>
                    {taxCodes.map((t) => (
                      <option key={t.id} value={String(t.id)}>{t.code} · {t.rate}%</option>
                    ))}
                  </select>
                  {(showAiHint || (needsAccount && accountCandidates.length > 0)) && (
                    <div className="col-span-12 -mt-1 text-[11px] rounded border border-amber-200 bg-amber-50 px-2 py-1 leading-snug">
                      {aiSuggestedAccount && (
                        <div className="text-amber-900">
                          <span className="font-semibold">AI suggested:</span>{" "}
                          {aiSuggestedAccount.code || aiSuggestedAccount.name ? (
                            <span className="font-mono">
                              {aiSuggestedAccount.code}
                              {aiSuggestedAccount.code && aiSuggestedAccount.name && " · "}
                              {aiSuggestedAccount.name}
                            </span>
                          ) : (
                            <span className="italic text-amber-800">(no specific account named)</span>
                          )}
                          {candidate && (
                            <button
                              type="button"
                              onClick={() => updateLine(i, { account_id: String(candidate.id) })}
                              className="ml-2 inline-flex items-center rounded bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
                            >
                              Use this
                            </button>
                          )}
                        </div>
                      )}
                      {aiSuggestedAccount?.reasoning && (
                        <div className="mt-0.5 text-amber-800 leading-snug">
                          {aiSuggestedAccount.reasoning}
                        </div>
                      )}
                      {accountCandidates.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="text-[10px] text-amber-800 font-semibold uppercase tracking-wider mr-1 self-center">
                            Candidates:
                          </span>
                          {accountCandidates.slice(0, 5).map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => updateLine(i, { account_id: String(c.id) })}
                              title={c.reason || `Score ${c.score ?? "—"}`}
                              className="inline-flex items-center rounded bg-white hover:bg-amber-100 ring-1 ring-amber-200 px-1.5 py-0.5 text-[10px] font-mono text-amber-900"
                            >
                              {c.code} · {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {lines.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                      className="col-span-12 text-[10px] text-rose-600 hover:underline text-right -mt-1"
                    >
                      <Minus className="inline w-2.5 h-2.5 mr-0.5" />Remove line
                    </button>
                  )}
                </div>
                );
              })}
            </div>

          </div>

          {/* ── VAT + Credit side — Bills shape: header-level VAT amount
              and a single credit-side picker (what gets credited for the
              gross total). The Posting Preview below derives the final
              DR/CR rows from these inputs.                              */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Tax amount</span>
              <input
                className="input mt-1 text-right font-mono"
                inputMode="decimal"
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
              />
              <span className="text-[10px] text-gray-400">Input VAT — goes on its own DR line.</span>
            </label>
            <label className="block col-span-2">
              <span className="text-xs font-medium text-gray-600">Credit account</span>
              <select
                className={cn(
                  "input mt-1",
                  !creditAccountId && "border-rose-300 bg-rose-50/40",
                )}
                value={creditAccountId}
                onChange={(e) => setCreditAccountId(e.target.value)}
              >
                <option value="">— pick credit account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                ))}
              </select>
              <span className="text-[10px] text-gray-400">
                Where the balancing credit goes (AP for vendor bills, Bank if paid, etc.).
              </span>
            </label>
          </div>

          {/* ── Posting Preview — what the JE will book on Create.
              Mirrors the Bills "POSTING PREVIEW · WHAT THE BILL WILL
              BOOK ON APPROVAL" section: DR/CR | Account | Amount | Why. */}
          <div className="rounded-lg border border-canvas-200 bg-canvas-50/40 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">
              Posting preview · what this JE will book
            </div>
            {postingPreview.length === 0 ? (
              <p className="text-[11.5px] text-gray-500 italic py-2 text-center">
                Add lines above to see the posting preview.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="text-left text-[9.5px] uppercase tracking-wider text-gray-400 border-b border-canvas-200">
                        <th className="pb-1 pr-2 font-medium">DR/CR</th>
                        <th className="pb-1 pr-2 font-medium">Account</th>
                        <th className="pb-1 pr-2 font-medium text-right">Amount</th>
                        <th className="pb-1 font-medium">Why</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-canvas-100">
                      {postingPreview.map((r, i) => (
                        <tr key={i}>
                          <td className="py-1.5 pr-2 font-mono font-semibold text-gray-800">
                            {r.drCr}
                          </td>
                          <td className="py-1.5 pr-2 text-gray-800">
                            {r.accountLabel}
                          </td>
                          <td className="py-1.5 pr-2 text-right font-mono tabular-nums">
                            {r.amount.toFixed(2)}
                          </td>
                          <td className="py-1.5 text-[10.5px] text-gray-500 leading-snug">
                            {r.why}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 pt-2 border-t-2 border-canvas-200 flex items-center justify-between text-[11.5px]">
                  <span className="font-semibold text-gray-700">Totals (must balance)</span>
                  <span className="font-mono tabular-nums">
                    DR {previewTotals.dr.toFixed(2)} {ccyDefault}
                    <span className="text-gray-400 mx-1.5">·</span>
                    CR {previewTotals.cr.toFixed(2)} {ccyDefault}
                  </span>
                </div>
              </>
            )}
          </div>

          <p className="mt-2 text-[10px] text-gray-400 italic">
            Lines table holds debit-side entries. The Credit account above is
            the balancing CR. VAT goes on its own DR line in the preview.
          </p>
          <div className="hidden">
            {/* Spacer kept so legacy structure stays valid */}
          </div>

          <ErrorBlock msg={err} />
        </form>

        {/* Footer — same layout as the Bills drawer: totals on the left,
            Cancel + Create Draft on the right. The submit button mirrors
            the Bills "Create Bill" button styling and disabled state. */}
        <div className="border-t border-canvas-100 bg-white px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-600 flex items-center gap-3 flex-wrap">
            <span>
              <span className="text-gray-400">DR</span>{" "}
              <span className="font-mono tabular-nums">{sums.dr.toFixed(2)}</span>
            </span>
            <span>
              <span className="text-gray-400">CR</span>{" "}
              <span className="font-mono tabular-nums">{sums.cr.toFixed(2)}</span>
            </span>
            <span className={cn(
              "font-medium",
              balanced ? "text-mint-700" : "text-rose-600",
            )}>
              {balanced
                ? "Balanced"
                : `Off by ${Math.abs(sums.diff).toFixed(2)}`}
            </span>
            {missingAccountCount > 0 && (
              <span className="text-amber-700 font-medium">
                · {missingAccountCount} line{missingAccountCount === 1 ? "" : "s"} need{missingAccountCount === 1 ? "s" : ""} an account
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !entityId || !balanced || postableLineCount < 2}
              className="btn-primary"
              title={
                postableLineCount < 2
                  ? "Each line needs an account + an amount. The AI couldn't auto-match some lines — pick them manually."
                  : ""
              }
            >
              {busy ? "Saving…" : "Create draft"}
            </button>
          </div>
        </div>
        </div>

        {/* ── Teach Beakon side panel — opens when the user clicks
            "Correct & teach Beakon" on the AI banner. Layout mirrors the
            Bills (AP) drawer's Teach panel exactly: 9-checkbox error
            taxonomy, a live "Correct journal entry" preview, the
            future-rule textarea + scope hint, and a small "use Beakon's
            draft" callout that drops the AI's pre-extracted rule text
            into the textarea on click.                                  */}
        {teachOpen && (
          <div className="flex-1 overflow-y-auto bg-canvas-50/30 border-l border-canvas-100">
            <div className="flex items-center justify-between p-4 border-b border-canvas-100 bg-white">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-violet-600" />
                <h3 className="text-sm font-semibold text-gray-900">Correct &amp; teach Beakon</h3>
              </div>
              <button
                onClick={() => setTeachOpen(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close Teach panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Step 1 — what was wrong */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold">
                    1
                  </span>
                  <h4 className="text-[12px] font-semibold text-gray-900 uppercase tracking-wider">
                    What was wrong?
                  </h4>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {[
                    ["wrong_account",        "Wrong account"],
                    ["wrong_amount",         "Wrong amount"],
                    ["duplicate_line",       "Duplicate line"],
                    ["vat_treatment_wrong",  "VAT treatment wrong"],
                    ["missing_allocation",   "Missing allocation"],
                    ["wrong_entity",         "Wrong entity"],
                    ["wrong_vendor",         "Wrong vendor"],
                    ["wrong_description",    "Wrong description"],
                    ["other",                "Other"],
                  ].map(([k, label]) => (
                    <label
                      key={k}
                      className="inline-flex items-center gap-1.5 text-[12px] text-gray-700 cursor-pointer hover:text-gray-900"
                    >
                      <input
                        type="checkbox"
                        checked={errorTypes.includes(k)}
                        onChange={() => toggleErrorType(k)}
                        className="h-3.5 w-3.5 rounded border-gray-300"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </section>

              {/* Step 2 — Correct journal entry preview */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold">
                    2
                  </span>
                  <h4 className="text-[12px] font-semibold text-gray-900 uppercase tracking-wider">
                    Correct journal entry
                  </h4>
                </div>
                <div className="rounded-md border border-canvas-200 bg-white overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-canvas-50 text-[10px] uppercase tracking-wider text-gray-500">
                        <th className="text-left px-2.5 py-1.5 font-medium">Account</th>
                        <th className="text-right px-2.5 py-1.5 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines
                        .filter((l) => (parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0)
                        .map((l, i) => {
                          const dr = parseFloat(l.debit) || 0;
                          const cr = parseFloat(l.credit) || 0;
                          const acct = accounts.find((a) => String(a.id) === l.account_id);
                          const label = acct
                            ? `${acct.code} · ${acct.name}`
                            : (l.description || "— pick account —");
                          return (
                            <tr key={i} className="border-t border-canvas-100">
                              <td className="px-2.5 py-1.5 text-gray-800">
                                {dr > 0 ? "DR " : "CR "}{label}
                              </td>
                              <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                                {(dr || cr).toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}
                      <tr className="border-t-2 border-canvas-200 bg-canvas-50/60 font-semibold">
                        <td className="px-2.5 py-1.5">Totals</td>
                        <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                          DR {sums.dr.toFixed(2)} · CR {sums.cr.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {!balanced && (
                  <p className="mt-1.5 text-[11px] text-rose-700 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    JE not balanced — fix the lines on the left before approving.
                  </p>
                )}
              </section>

              {/* Step 3 — Teach Beakon for the future */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold">
                    3
                  </span>
                  <h4 className="text-[12px] font-semibold text-gray-900 uppercase tracking-wider">
                    Teach Beakon for the future
                  </h4>
                </div>
                <textarea
                  className="input w-full text-[12px] font-mono leading-relaxed"
                  rows={5}
                  value={futureRuleInstruction}
                  onChange={(e) => setFutureRuleInstruction(e.target.value)}
                  placeholder="e.g. For Sunrise invoices, use the VAT declaration to split net expense and input VAT. Do not post device instalments separately when already included in the mobile total."
                />
                {aiSuggestedRule && futureRuleInstruction !== aiSuggestedRule && (
                  <button
                    type="button"
                    onClick={() => setFutureRuleInstruction(aiSuggestedRule)}
                    className="mt-1.5 text-[11px] text-violet-700 hover:underline text-left"
                  >
                    <span className="font-semibold">Use Beakon&apos;s draft</span>{" "}
                    — the AI proposed:{" "}
                    <span className="italic">
                      &ldquo;{aiSuggestedRule.length > 100
                        ? aiSuggestedRule.slice(0, 100) + "…"
                        : aiSuggestedRule}&rdquo;
                    </span>
                  </button>
                )}

                <label className="flex items-center gap-2 text-[12px] text-gray-700 cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    checked={applyToFutureRule}
                    onChange={(e) => setApplyToFutureRule(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  Apply this rule to future invoices from{" "}
                  {aiVendorName ? <span className="font-semibold">{aiVendorName}</span> : "this vendor"}
                </label>

                <div className="mt-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
                    Scope (optional)
                  </label>
                  <input
                    className="input w-full text-[12px] font-mono"
                    value={teachScopeHint}
                    onChange={(e) => setTeachScopeHint(e.target.value)}
                    placeholder="e.g. Customer number: 1000779477"
                  />
                  <p className="text-[10.5px] text-gray-400 mt-1 leading-snug">
                    {aiCustomerNumber
                      ? "Pre-filled from the invoice. Clear if you only want the rule scoped by vendor."
                      : "Empty = rule scoped to the vendor across all their invoices."}
                  </p>
                </div>
              </section>

              <p className="text-[10.5px] text-gray-400 leading-snug border-t border-canvas-100 pt-3">
                Saves a structured correction against the JE after it&apos;s
                created. If &ldquo;Apply this rule&rdquo; is checked and the AI
                matched a vendor, Beakon also promotes a LearningRule so the
                next invoice from this vendor uses your guidance.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ── 2. Portfolio Trade ────────────────────────────────────────────────────

export function PortfolioTradeDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const investmentAccounts = useAccounts(open, { account_subtype: "investment" });
  const custodians = useDimensionValues(open, "CUST");
  const portfolios = useDimensionValues(open, "PORT");

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [instrument, setInstrument] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [investmentAccountId, setInvestmentAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [custodian, setCustodian] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);

  const entity = entities.find((e) => String(e.id) === entityId);
  useEffect(() => {
    if (entity && !currency) setCurrency(entity.functional_currency);
  }, [entity, currency]);

  const total = useMemo(() => {
    const q = parseFloat(qty) || 0;
    const p = parseFloat(price) || 0;
    return q * p;
  }, [qty, price]);

  async function submit() {
    if (!entityId || !instrument || total <= 0 || !investmentAccountId || !bankAccountId) {
      setErr("Fill in entity, instrument, quantity, price, investment account, and bank account.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const ba = bankAccounts.find((b) => String(b.id) === bankAccountId);
      if (!ba) throw new Error("Selected bank account not found.");
      const ccy = (currency || entity?.functional_currency || "EUR").toUpperCase();
      const amount = total.toFixed(2);
      const description = `${direction === "buy" ? "Buy" : "Sell"} ${qty} ${instrument} @ ${price} ${ccy}`;

      // BUY:  DR investment (with portfolio/custodian/instrument tags), CR bank
      // SELL: DR bank, CR investment (with the same tags)
      // v1 sell ignores realised gain/loss split — user can adjust manually.
      const investmentLine = {
        account_id: Number(investmentAccountId),
        description,
        currency: ccy,
        dimension_instrument_code: instrument,
        dimension_custodian_code: custodian || "",
        dimension_portfolio_code: portfolio || "",
      };
      const bankLine = {
        account_id: ba.account,
        description,
        currency: ccy,
        dimension_bank_code: ba.name.slice(0, 50),
      };
      const lines = direction === "buy"
        ? [{ ...investmentLine, debit: amount, credit: "0" },
           { ...bankLine,       debit: "0",   credit: amount }]
        : [{ ...bankLine,       debit: amount, credit: "0" },
           { ...investmentLine, debit: "0",   credit: amount }];
      const payload = {
        entity_id: Number(entityId),
        date,
        memo: (memo || description).slice(0, 500),
        currency: ccy,
        source_type: "manual",
        source_ref: instrument,
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={TrendingUp}
      kicker="New transaction"
      title="Portfolio trade"
      subtitle="Buy or sell a security. The form auto-derives the JE; instrument / custodian / portfolio dims attach to the investment line."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy || total <= 0} className="btn-primary">
            {busy ? "Saving…" : `Create ${direction} draft`}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Trade date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div className="inline-flex rounded-xl border border-canvas-200 bg-white p-0.5 text-xs">
        {(["buy", "sell"] as const).map((d) => (
          <button
            key={d} type="button" onClick={() => setDirection(d)}
            className={cn(
              "px-4 py-1.5 rounded-lg font-semibold capitalize transition-colors",
              direction === d ? "bg-brand-50 text-brand-800" : "text-gray-500 hover:text-gray-800",
            )}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Instrument code" required hint="e.g. INS_AAPL — free text until the Instrument master ships" span={2}>
          <input className="input font-mono uppercase" value={instrument} onChange={(e) => setInstrument(e.target.value.toUpperCase())} placeholder="INS_AAPL" />
        </Field>
        <Field label="Quantity" required>
          <input className="input text-right font-mono" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="50" />
        </Field>
        <Field label="Price per unit" required>
          <input className="input text-right font-mono" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="190.50" />
        </Field>
        <Field label="Currency">
          <input className="input font-mono uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="USD" />
        </Field>
        <Field label="Total" hint="Auto = quantity × price">
          <div className="input bg-canvas-50 text-right font-mono tabular-nums">{total ? total.toFixed(2) : "0.00"}</div>
        </Field>
        <Field label="Investment account" required hint={investmentAccounts.length ? undefined : "No investment-subtype accounts yet — create one in CoA"} span={2}>
          <select className="input" value={investmentAccountId} onChange={(e) => setInvestmentAccountId(e.target.value)}>
            <option value="">— Pick an investment account —</option>
            {investmentAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Bank account (cash side)" required hint={bankAccounts.length ? undefined : "No bank account on this entity yet"} span={2}>
          <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">— Pick a bank account —</option>
            {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
          </select>
        </Field>
        <Field label="Custodian" hint={custodians.length ? "From CUST dimension" : "No custodian dimensions loaded"}>
          <select className="input font-mono" value={custodian} onChange={(e) => setCustodian(e.target.value)}>
            <option value="">— None —</option>
            {custodians.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Portfolio" hint={portfolios.length ? "From PORT dimension" : "No portfolio dimensions loaded"}>
          <select className="input font-mono" value={portfolio} onChange={(e) => setPortfolio(e.target.value)}>
            <option value="">— None —</option>
            {portfolios.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
          </select>
        </Field>
        <Field label="Memo" hint="Auto-suggested from the trade — override if needed" span={2}>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={`${direction === "buy" ? "Buy" : "Sell"} ${qty || "N"} ${instrument || "INS_…"} @ ${price || "0"} ${currency}`} />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 3. Loan transaction ───────────────────────────────────────────────────

type LoanKind = "drawdown" | "interest" | "repayment";

const LOAN_KINDS: { key: LoanKind; label: string; blurb: string }[] = [
  { key: "drawdown",  label: "Drawdown",  blurb: "Loan funds received — DR bank, CR loan-payable" },
  { key: "interest",  label: "Interest accrual", blurb: "Period interest charge — DR interest expense, CR loan-payable" },
  { key: "repayment", label: "Repayment", blurb: "Principal paid back — DR loan-payable, CR bank" },
];

export function LoanTxnDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const loanAccounts = useAccounts(open, { account_subtype: "loan_payable" });
  const interestAccounts = useAccounts(open, { account_type: "expense" });

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [loanCode, setLoanCode] = useState("");
  const [kind, setKind] = useState<LoanKind>("drawdown");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [loanAccountId, setLoanAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [interestAccountId, setInterestAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);
  useEffect(() => {
    if (entity && !currency) setCurrency(entity.functional_currency);
  }, [entity, currency]);

  async function submit() {
    const amt = parseFloat(amount);
    if (!entityId || !loanAccountId || !amt || amt <= 0) {
      setErr("Fill in entity, loan account, and amount.");
      return;
    }
    if (kind !== "interest" && !bankAccountId) {
      setErr("Drawdown and repayment need a bank account for the cash side.");
      return;
    }
    if (kind === "interest" && !interestAccountId) {
      setErr("Interest accrual needs an interest expense account.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (currency || entity?.functional_currency || "EUR").toUpperCase();
      const ba = bankAccounts.find((b) => String(b.id) === bankAccountId);
      const amtStr = amt.toFixed(2);
      const description = `${LOAN_KINDS.find((k) => k.key === kind)?.label} · ${loanCode || "loan"}`;

      const loanLine = {
        account_id: Number(loanAccountId),
        description,
        currency: ccy,
      };
      const bankLine = ba ? {
        account_id: ba.account,
        description,
        currency: ccy,
        dimension_bank_code: ba.name.slice(0, 50),
      } : null;
      const interestLine = {
        account_id: Number(interestAccountId || 0),
        description,
        currency: ccy,
      };

      let lines: any[];
      if (kind === "drawdown") {
        lines = [
          { ...bankLine!, debit: amtStr, credit: "0" },
          { ...loanLine,  debit: "0",     credit: amtStr },
        ];
      } else if (kind === "interest") {
        lines = [
          { ...interestLine, debit: amtStr, credit: "0" },
          { ...loanLine,     debit: "0",     credit: amtStr },
        ];
      } else {
        lines = [
          { ...loanLine,  debit: amtStr, credit: "0" },
          { ...bankLine!, debit: "0",     credit: amtStr },
        ];
      }

      const payload = {
        entity_id: Number(entityId),
        date,
        memo: (memo || description).slice(0, 500),
        currency: ccy,
        source_type: "manual",
        source_ref: loanCode || "",
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={Landmark}
      kicker="New transaction"
      title="Loan transaction"
      subtitle="Drawdown, interest accrual, or repayment against a loan agreement."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Create draft"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Transaction type" required>
        <div className="grid grid-cols-3 gap-2">
          {LOAN_KINDS.map((k) => (
            <button
              key={k.key} type="button" onClick={() => setKind(k.key)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                kind === k.key
                  ? "border-brand-300 bg-brand-50/60"
                  : "border-canvas-200 bg-white hover:border-brand-200 hover:bg-brand-50/30",
              )}
            >
              <div className="text-xs font-semibold text-gray-900">{k.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{k.blurb}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Loan code" hint="e.g. LOAN_MTG_001 — free text until the Loan master ships" span={2}>
          <input className="input font-mono uppercase" value={loanCode} onChange={(e) => setLoanCode(e.target.value.toUpperCase())} placeholder="LOAN_MTG_001" />
        </Field>
        <Field label="Amount" required>
          <input className="input text-right font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000.00" />
        </Field>
        <Field label="Currency">
          <input className="input font-mono uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
        </Field>
        <Field label="Loan account (liability)" required hint={loanAccounts.length ? undefined : "No loan_payable accounts in CoA yet"} span={2}>
          <select className="input" value={loanAccountId} onChange={(e) => setLoanAccountId(e.target.value)}>
            <option value="">— Pick a loan-payable account —</option>
            {loanAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        {kind !== "interest" && (
          <Field label="Bank account (cash side)" required span={2}>
            <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">— Pick a bank account —</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
            </select>
          </Field>
        )}
        {kind === "interest" && (
          <Field label="Interest expense account" required span={2}>
            <select className="input" value={interestAccountId} onChange={(e) => setInterestAccountId(e.target.value)}>
              <option value="">— Pick an expense account —</option>
              {interestAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Memo" span={2}>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Auto-suggested" />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 4. Fixed Asset transaction ────────────────────────────────────────────

type AssetKind = "purchase" | "depreciation";

const ASSET_KINDS: { key: AssetKind; label: string; blurb: string }[] = [
  { key: "purchase",     label: "Purchase",     blurb: "Capex acquisition — DR fixed asset, CR bank" },
  { key: "depreciation", label: "Depreciation", blurb: "Period charge — DR depreciation expense, CR accumulated depreciation" },
];

export function FixedAssetDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const fixedAssetAccounts = useAccounts(open, { account_subtype: "fixed_asset" });
  const accumDepAccounts = useAccounts(open, { account_subtype: "accumulated_depreciation" });
  const depExpenseAccounts = useAccounts(open, { account_subtype: "depreciation" });

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [assetCode, setAssetCode] = useState("");
  const [kind, setKind] = useState<AssetKind>("purchase");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [fixedAssetAccountId, setFixedAssetAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [accumDepAccountId, setAccumDepAccountId] = useState("");
  const [depExpenseAccountId, setDepExpenseAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);
  useEffect(() => {
    if (entity && !currency) setCurrency(entity.functional_currency);
  }, [entity, currency]);

  async function submit() {
    const amt = parseFloat(amount);
    if (!entityId || !fixedAssetAccountId || !amt || amt <= 0) {
      setErr("Fill in entity, fixed-asset account, and amount.");
      return;
    }
    if (kind === "purchase" && !bankAccountId) {
      setErr("Purchase needs a bank account for the cash side.");
      return;
    }
    if (kind === "depreciation" && (!accumDepAccountId || !depExpenseAccountId)) {
      setErr("Depreciation needs both depreciation expense and accumulated depreciation accounts.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (currency || entity?.functional_currency || "EUR").toUpperCase();
      const ba = bankAccounts.find((b) => String(b.id) === bankAccountId);
      const amtStr = amt.toFixed(2);
      const description = `${ASSET_KINDS.find((k) => k.key === kind)?.label} · ${assetCode || "fixed asset"}`;

      const faLine = {
        account_id: Number(fixedAssetAccountId),
        description,
        currency: ccy,
      };
      const bankLine = ba ? {
        account_id: ba.account,
        description,
        currency: ccy,
        dimension_bank_code: ba.name.slice(0, 50),
      } : null;
      const accDepLine = {
        account_id: Number(accumDepAccountId || 0),
        description,
        currency: ccy,
      };
      const depExpLine = {
        account_id: Number(depExpenseAccountId || 0),
        description,
        currency: ccy,
      };

      let lines: any[];
      if (kind === "purchase") {
        lines = [
          { ...faLine,    debit: amtStr, credit: "0" },
          { ...bankLine!, debit: "0",     credit: amtStr },
        ];
      } else {
        lines = [
          { ...depExpLine, debit: amtStr, credit: "0" },
          { ...accDepLine, debit: "0",     credit: amtStr },
        ];
      }

      const payload = {
        entity_id: Number(entityId),
        date,
        memo: (memo || description).slice(0, 500),
        currency: ccy,
        source_type: "manual",
        source_ref: assetCode || "",
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={Building}
      kicker="New transaction"
      title="Fixed asset transaction"
      subtitle="Capex purchase or depreciation charge against the fixed-asset register."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Create draft"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Transaction type" required>
        <div className="grid grid-cols-2 gap-2">
          {ASSET_KINDS.map((k) => (
            <button
              key={k.key} type="button" onClick={() => setKind(k.key)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                kind === k.key
                  ? "border-brand-300 bg-brand-50/60"
                  : "border-canvas-200 bg-white hover:border-brand-200 hover:bg-brand-50/30",
              )}
            >
              <div className="text-xs font-semibold text-gray-900">{k.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{k.blurb}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Asset code" hint="e.g. FA-LAPTOP-001 — free text until the Fixed Asset master ships" span={2}>
          <input className="input font-mono uppercase" value={assetCode} onChange={(e) => setAssetCode(e.target.value.toUpperCase())} placeholder="FA-LAPTOP-001" />
        </Field>
        <Field label="Amount" required>
          <input className="input text-right font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500.00" />
        </Field>
        <Field label="Currency">
          <input className="input font-mono uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
        </Field>
        <Field label="Fixed asset account" required hint={fixedAssetAccounts.length ? undefined : "No fixed_asset accounts in CoA yet"} span={2}>
          <select className="input" value={fixedAssetAccountId} onChange={(e) => setFixedAssetAccountId(e.target.value)}>
            <option value="">— Pick a fixed-asset account —</option>
            {fixedAssetAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        {kind === "purchase" && (
          <Field label="Bank account (cash side)" required span={2}>
            <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">— Pick a bank account —</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
            </select>
          </Field>
        )}
        {kind === "depreciation" && (
          <>
            <Field label="Depreciation expense account" required>
              <select className="input" value={depExpenseAccountId} onChange={(e) => setDepExpenseAccountId(e.target.value)}>
                <option value="">— Pick —</option>
                {depExpenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
            <Field label="Accumulated depreciation account" required>
              <select className="input" value={accumDepAccountId} onChange={(e) => setAccumDepAccountId(e.target.value)}>
                <option value="">— Pick —</option>
                {accumDepAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Memo" span={2}>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Auto-suggested" />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 5. Bank transaction ───────────────────────────────────────────────────

type BankKind = "transfer" | "fee" | "interest_income";

const BANK_KINDS: { key: BankKind; label: string; blurb: string }[] = [
  { key: "transfer",        label: "Transfer between banks", blurb: "Move cash between two of this entity's bank accounts" },
  { key: "fee",             label: "Bank fee / charge",      blurb: "Standalone fee — DR bank charges, CR bank" },
  { key: "interest_income", label: "Interest received",      blurb: "Credit interest from the bank — DR bank, CR interest income" },
];

export function BankTxnDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const feeAccounts = useAccounts(open, { account_type: "expense" });
  const incomeAccounts = useAccounts(open, { account_type: "revenue" });

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState<BankKind>("transfer");
  const [fromBankId, setFromBankId] = useState("");
  const [toBankId, setToBankId] = useState("");
  const [otherAccountId, setOtherAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);

  async function submit() {
    const amt = parseFloat(amount);
    if (!entityId || !amt || amt <= 0) { setErr("Pick an entity and enter an amount."); return; }
    if (kind === "transfer" && (!fromBankId || !toBankId || fromBankId === toBankId)) {
      setErr("Transfer needs two different bank accounts."); return;
    }
    if (kind !== "transfer" && (!fromBankId || !otherAccountId)) {
      setErr("Pick a bank account and the P&L account."); return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (entity?.functional_currency || "EUR").toUpperCase();
      const amtStr = amt.toFixed(2);
      const fromBA = bankAccounts.find((b) => String(b.id) === fromBankId);
      const toBA = bankAccounts.find((b) => String(b.id) === toBankId);
      const description = memo.trim() || BANK_KINDS.find((k) => k.key === kind)!.label;

      let lines: any[];
      if (kind === "transfer") {
        lines = [
          { account_id: toBA!.account,   description, currency: ccy, debit: amtStr, credit: "0",   dimension_bank_code: toBA!.name.slice(0, 50) },
          { account_id: fromBA!.account, description, currency: ccy, debit: "0",     credit: amtStr, dimension_bank_code: fromBA!.name.slice(0, 50) },
        ];
      } else if (kind === "fee") {
        lines = [
          { account_id: Number(otherAccountId), description, currency: ccy, debit: amtStr, credit: "0" },
          { account_id: fromBA!.account, description, currency: ccy, debit: "0", credit: amtStr, dimension_bank_code: fromBA!.name.slice(0, 50) },
        ];
      } else {
        lines = [
          { account_id: fromBA!.account, description, currency: ccy, debit: amtStr, credit: "0", dimension_bank_code: fromBA!.name.slice(0, 50) },
          { account_id: Number(otherAccountId), description, currency: ccy, debit: "0", credit: amtStr },
        ];
      }

      const payload = {
        entity_id: Number(entityId), date,
        memo: description.slice(0, 500), currency: ccy,
        source_type: "manual", lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) { setErr(fmtErr(e)); } finally { setBusy(false); }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={CreditCard}
      kicker="New transaction"
      title="Bank transaction"
      subtitle="Standalone bank movement — transfer between own accounts, a bank fee, or interest credited."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">{busy ? "Saving…" : "Create draft"}</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Transaction kind" required>
        <div className="grid grid-cols-3 gap-2">
          {BANK_KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)}
              className={cn("rounded-lg border px-3 py-2 text-left transition-colors",
                kind === k.key ? "border-brand-300 bg-brand-50/60" : "border-canvas-200 bg-white hover:border-brand-200 hover:bg-brand-50/30")}>
              <div className="text-xs font-semibold text-gray-900">{k.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{k.blurb}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === "transfer" ? "From bank" : "Bank account"} required span={kind === "transfer" ? 1 : 2}>
          <select className="input" value={fromBankId} onChange={(e) => setFromBankId(e.target.value)}>
            <option value="">— Pick —</option>
            {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
          </select>
        </Field>
        {kind === "transfer" && (
          <Field label="To bank" required>
            <select className="input" value={toBankId} onChange={(e) => setToBankId(e.target.value)}>
              <option value="">— Pick —</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
            </select>
          </Field>
        )}
        {kind === "fee" && (
          <Field label="Bank charges account" required span={2}>
            <select className="input" value={otherAccountId} onChange={(e) => setOtherAccountId(e.target.value)}>
              <option value="">— Pick an expense account —</option>
              {feeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
        )}
        {kind === "interest_income" && (
          <Field label="Interest income account" required span={2}>
            <select className="input" value={otherAccountId} onChange={(e) => setOtherAccountId(e.target.value)}>
              <option value="">— Pick a revenue account —</option>
              {incomeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Amount" required>
          <input className="input text-right font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Memo">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Quarterly account fee" />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 6. Intercompany ───────────────────────────────────────────────────────
//
// v1 books a single JE on the "From entity" with both legs, tagging
// counterparty_entity_id on both lines so reports can group by IC partner.
// The mirror on the other entity is a manual second step today — auto-mirror
// is the v2 work flagged in the picker subtitle.

export function IntercompanyDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const allAccounts = useAccounts(open, {});

  const [entityId, setEntityId] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [icAccountId, setIcAccountId] = useState("");
  const [offsetAccountId, setOffsetAccountId] = useState("");
  const [direction, setDirection] = useState<"receivable" | "payable">("receivable");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);
  const otherEntities = useMemo(
    () => entities.filter((e) => String(e.id) !== entityId),
    [entities, entityId],
  );

  async function submit() {
    const amt = parseFloat(amount);
    if (!entityId || !counterpartyId || !amt || amt <= 0 || !icAccountId || !offsetAccountId) {
      setErr("Pick both entities, the IC account, the offset account, and an amount."); return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (entity?.functional_currency || "EUR").toUpperCase();
      const amtStr = amt.toFixed(2);
      const cpId = Number(counterpartyId);
      const description = memo.trim() || `Intercompany ${direction === "receivable" ? "receivable" : "payable"}`;

      const icLine = {
        account_id: Number(icAccountId), description, currency: ccy,
        counterparty_entity_id: cpId,
      };
      const offsetLine = {
        account_id: Number(offsetAccountId), description, currency: ccy,
        counterparty_entity_id: cpId,
      };

      const lines = direction === "receivable"
        ? [{ ...icLine,     debit: amtStr, credit: "0" },
           { ...offsetLine, debit: "0",     credit: amtStr }]
        : [{ ...offsetLine, debit: amtStr, credit: "0" },
           { ...icLine,     debit: "0",     credit: amtStr }];

      const payload = {
        entity_id: Number(entityId), date,
        memo: description.slice(0, 500), currency: ccy,
        source_type: "manual",
        counterparty_entity_id: cpId,
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) { setErr(fmtErr(e)); } finally { setBusy(false); }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={Network}
      kicker="New transaction"
      title="Intercompany"
      subtitle="Books one side of an IC entry with the counterparty tagged on each line. Mirror leg on the other entity is a manual second step in v1."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">{busy ? "Saving…" : "Create draft"}</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="From entity (booking entity)" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="To entity (counterparty)" required>
          <select className="input" value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
            <option value="">— Pick —</option>
            {otherEntities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Direction" required>
          <div className="inline-flex rounded-lg border border-canvas-200 bg-white p-0.5 text-xs">
            {(["receivable", "payable"] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDirection(d)}
                className={cn("px-3 py-1 rounded-md font-semibold capitalize transition-colors",
                  direction === d ? "bg-brand-50 text-brand-800" : "text-gray-500 hover:text-gray-800")}>{d}</button>
            ))}
          </div>
        </Field>
        <Field label={`IC ${direction === "receivable" ? "receivable" : "payable"} account`} required span={2}>
          <select className="input" value={icAccountId} onChange={(e) => setIcAccountId(e.target.value)}>
            <option value="">— Pick —</option>
            {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Offset account (P&L or balance sheet)" required span={2}
          hint="What the IC line offsets — e.g. management fee revenue, expense recharge, intercompany loan funding.">
          <select className="input" value={offsetAccountId} onChange={(e) => setOffsetAccountId(e.target.value)}>
            <option value="">— Pick —</option>
            {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Amount" required>
          <input className="input text-right font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Memo">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Q1 management fee recharge" />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 7. Payroll ────────────────────────────────────────────────────────────
//
// v1 = monthly payroll. Three numbers in (gross, employer social, withholding)
// derive a four-line JE: DR salary expense (gross) + DR employer social
// expense, CR payroll payable (social + withholding), CR bank (net pay).

export function PayrollDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const expenseAccounts = useAccounts(open, { account_type: "expense" });
  const liabilityAccounts = useAccounts(open, { account_type: "liability" });

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [periodLabel, setPeriodLabel] = useState("");
  const [gross, setGross] = useState("");
  const [employerSocial, setEmployerSocial] = useState("");
  const [withholding, setWithholding] = useState("");
  const [salaryAccountId, setSalaryAccountId] = useState("");
  const [socialExpenseAccountId, setSocialExpenseAccountId] = useState("");
  const [payableAccountId, setPayableAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);

  const g = parseFloat(gross) || 0;
  const es = parseFloat(employerSocial) || 0;
  const wh = parseFloat(withholding) || 0;
  // Net pay = gross − employee-side withholdings. Employer social is an
  // additional expense on top of the gross — it doesn't reduce net pay.
  const net = Math.max(g - wh, 0);

  async function submit() {
    if (!entityId || g <= 0 || !salaryAccountId || !payableAccountId || !bankAccountId) {
      setErr("Pick entity, gross, salary account, payable account, and bank account."); return;
    }
    if (es > 0 && !socialExpenseAccountId) {
      setErr("Employer social charges need an expense account."); return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (entity?.functional_currency || "EUR").toUpperCase();
      const ba = bankAccounts.find((b) => String(b.id) === bankAccountId);
      const description = memo.trim()
        || `Payroll · ${periodLabel.trim() || periodLabelForDate(date)}`;
      const lines: any[] = [
        { account_id: Number(salaryAccountId),  description, currency: ccy, debit: g.toFixed(2),  credit: "0" },
      ];
      if (es > 0) {
        lines.push({ account_id: Number(socialExpenseAccountId), description, currency: ccy, debit: es.toFixed(2), credit: "0" });
      }
      const payable = es + wh;
      if (payable > 0) {
        lines.push({ account_id: Number(payableAccountId), description, currency: ccy, debit: "0", credit: payable.toFixed(2) });
      }
      lines.push({
        account_id: ba!.account, description, currency: ccy, debit: "0", credit: net.toFixed(2),
        dimension_bank_code: ba!.name.slice(0, 50),
      });

      const payload = {
        entity_id: Number(entityId), date,
        memo: description.slice(0, 500), currency: ccy,
        source_type: "manual", source_ref: periodLabel,
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) { setErr(fmtErr(e)); } finally { setBusy(false); }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={Users}
      kicker="New transaction"
      title="Payroll"
      subtitle="Monthly payroll posting. Gross salary, employer social, and withholding tax derive the JE; net pay credits the bank."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">{busy ? "Saving…" : "Create draft"}</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Posting date" required hint={`Period: ${periodLabelForDate(date)}`}>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Period label" hint="Free-text — e.g. April 2026" span={2}>
          <input className="input" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder={periodLabelForDate(date)} />
        </Field>
        <Field label="Gross salary" required>
          <input className="input text-right font-mono" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Employer social charges">
          <input className="input text-right font-mono" inputMode="decimal" value={employerSocial} onChange={(e) => setEmployerSocial(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Withholding / employee deductions">
          <input className="input text-right font-mono" inputMode="decimal" value={withholding} onChange={(e) => setWithholding(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Net pay (derived)" hint="Gross − withholding">
          <div className="input bg-canvas-50 text-right font-mono tabular-nums">{net.toFixed(2)}</div>
        </Field>
        <Field label="Salary expense account" required span={2}>
          <select className="input" value={salaryAccountId} onChange={(e) => setSalaryAccountId(e.target.value)}>
            <option value="">— Pick an expense account —</option>
            {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        {es > 0 && (
          <Field label="Employer social expense account" required span={2}>
            <select className="input" value={socialExpenseAccountId} onChange={(e) => setSocialExpenseAccountId(e.target.value)}>
              <option value="">— Pick an expense account —</option>
              {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Payroll payable / accrued account" required span={2}
          hint="Where employer social + withholding sit until paid to the authority.">
          <select className="input" value={payableAccountId} onChange={(e) => setPayableAccountId(e.target.value)}>
            <option value="">— Pick a liability account —</option>
            {liabilityAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Bank account (net pay out)" required span={2}>
          <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">— Pick a bank account —</option>
            {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
          </select>
        </Field>
        <Field label="Memo" span={2}>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Auto-suggested from period" />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 8. Accrual / Prepayment ───────────────────────────────────────────────
//
// v1 books the *initial* recognition only — accruing an expense or recording
// a prepaid asset. The auto-amortisation schedule across periods is the v2
// piece flagged in the picker (rules registry / RecognitionRule wiring).

type AccrualKind = "accrual" | "prepayment";

const ACCRUAL_KINDS: { key: AccrualKind; label: string; blurb: string }[] = [
  { key: "accrual",    label: "Accrue an expense",  blurb: "Cost incurred but not yet invoiced — DR expense, CR accrued liability" },
  { key: "prepayment", label: "Record a prepayment", blurb: "Cash paid upfront for future service — DR prepaid asset, CR bank" },
];

export function AccrualPrepaymentDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const expenseAccounts = useAccounts(open, { account_type: "expense" });
  const liabilityAccounts = useAccounts(open, { account_type: "liability" });
  const assetAccounts = useAccounts(open, { account_type: "asset" });

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState<AccrualKind>("accrual");
  const [amount, setAmount] = useState("");
  const [plAccountId, setPlAccountId] = useState("");
  const [bsAccountId, setBsAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);

  async function submit() {
    const amt = parseFloat(amount);
    if (!entityId || !amt || amt <= 0) { setErr("Pick entity and amount."); return; }
    if (kind === "accrual" && (!plAccountId || !bsAccountId)) {
      setErr("Accrual needs an expense account and an accrued-liability account."); return;
    }
    if (kind === "prepayment" && (!bsAccountId || !bankAccountId)) {
      setErr("Prepayment needs a prepaid-asset account and the bank account."); return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (entity?.functional_currency || "EUR").toUpperCase();
      const amtStr = amt.toFixed(2);
      const description = memo.trim()
        || (kind === "accrual" ? "Accrued expense" : "Prepayment");

      let lines: any[];
      if (kind === "accrual") {
        lines = [
          { account_id: Number(plAccountId), description, currency: ccy, debit: amtStr, credit: "0" },
          { account_id: Number(bsAccountId), description, currency: ccy, debit: "0", credit: amtStr },
        ];
      } else {
        const ba = bankAccounts.find((b) => String(b.id) === bankAccountId);
        lines = [
          { account_id: Number(bsAccountId), description, currency: ccy, debit: amtStr, credit: "0" },
          { account_id: ba!.account, description, currency: ccy, debit: "0", credit: amtStr,
            dimension_bank_code: ba!.name.slice(0, 50) },
        ];
      }
      const payload = {
        entity_id: Number(entityId), date,
        memo: description.slice(0, 500), currency: ccy,
        source_type: "manual", lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) { setErr(fmtErr(e)); } finally { setBusy(false); }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={Hourglass}
      kicker="New transaction"
      title="Accrual / prepayment"
      subtitle="Initial recognition only. Auto-amortisation across periods ships with the rules registry."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">{busy ? "Saving…" : "Create draft"}</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Direction" required>
        <div className="grid grid-cols-2 gap-2">
          {ACCRUAL_KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)}
              className={cn("rounded-lg border px-3 py-2 text-left transition-colors",
                kind === k.key ? "border-brand-300 bg-brand-50/60" : "border-canvas-200 bg-white hover:border-brand-200 hover:bg-brand-50/30")}>
              <div className="text-xs font-semibold text-gray-900">{k.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{k.blurb}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" required>
          <input className="input text-right font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Memo">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={kind === "accrual" ? "e.g. March electricity (estimated)" : "e.g. Annual SaaS prepaid"} />
        </Field>
        {kind === "accrual" ? (
          <>
            <Field label="Expense account" required span={2}>
              <select className="input" value={plAccountId} onChange={(e) => setPlAccountId(e.target.value)}>
                <option value="">— Pick an expense account —</option>
                {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
            <Field label="Accrued liability account" required span={2}>
              <select className="input" value={bsAccountId} onChange={(e) => setBsAccountId(e.target.value)}>
                <option value="">— Pick a liability account —</option>
                {liabilityAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Prepaid asset account" required span={2}>
              <select className="input" value={bsAccountId} onChange={(e) => setBsAccountId(e.target.value)}>
                <option value="">— Pick an asset account —</option>
                {assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
            <Field label="Bank account (cash out)" required span={2}>
              <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                <option value="">— Pick a bank account —</option>
                {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
              </select>
            </Field>
          </>
        )}
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 9. Period-end adjustment ──────────────────────────────────────────────
//
// Generic adjustment — FX reval, tax provision, reclass. Same fields as
// a general 2-line JE but tagged with source_type=adjustment so the
// Period-close workflow (when it ships) can auto-reverse one-shot items.

type AdjustmentKind = "fx_reval" | "tax_provision" | "reclass" | "other";

const ADJ_KINDS: { key: AdjustmentKind; label: string }[] = [
  { key: "fx_reval",      label: "FX revaluation" },
  { key: "tax_provision", label: "Tax provision" },
  { key: "reclass",       label: "Reclassification" },
  { key: "other",         label: "Other" },
];

export function PeriodEndDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const allAccounts = useAccounts(open, {});

  const [entityId, setEntityId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [kind, setKind] = useState<AdjustmentKind>("fx_reval");
  const [amount, setAmount] = useState("");
  const [debitAccountId, setDebitAccountId] = useState("");
  const [creditAccountId, setCreditAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);

  async function submit() {
    const amt = parseFloat(amount);
    if (!entityId || !amt || amt <= 0 || !debitAccountId || !creditAccountId) {
      setErr("Pick entity, debit account, credit account, and an amount."); return;
    }
    if (debitAccountId === creditAccountId) {
      setErr("Debit and credit must be different accounts."); return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (entity?.functional_currency || "EUR").toUpperCase();
      const amtStr = amt.toFixed(2);
      const label = ADJ_KINDS.find((k) => k.key === kind)!.label;
      const description = memo.trim() || `${label} · ${periodLabelForDate(date)}`;
      const lines = [
        { account_id: Number(debitAccountId),  description, currency: ccy, debit: amtStr, credit: "0" },
        { account_id: Number(creditAccountId), description, currency: ccy, debit: "0", credit: amtStr },
      ];
      const payload = {
        entity_id: Number(entityId), date,
        memo: description.slice(0, 500), currency: ccy,
        // source_type=adjustment keeps these out of operational P&L cuts
        // and is what the future Period-close workflow will look for when
        // auto-reversing one-shot adjustments.
        source_type: "adjustment", source_ref: kind,
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) { setErr(fmtErr(e)); } finally { setBusy(false); }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={CalendarCheck}
      kicker="New transaction"
      title="Period-end adjustment"
      subtitle="FX revaluation, tax provision, or reclass. Tagged source_type=adjustment so Period-close can auto-reverse one-shot items."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">{busy ? "Saving…" : "Create draft"}</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Date" required hint={`Period: ${periodLabelForDate(date)}`}>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Adjustment kind" required>
        <div className="grid grid-cols-4 gap-2">
          {ADJ_KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)}
              className={cn("rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                kind === k.key ? "border-brand-300 bg-brand-50/60 text-brand-800" : "border-canvas-200 bg-white text-gray-700 hover:border-brand-200")}>{k.label}</button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Debit account" required span={2}>
          <select className="input" value={debitAccountId} onChange={(e) => setDebitAccountId(e.target.value)}>
            <option value="">— Pick —</option>
            {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Credit account" required span={2}>
          <select className="input" value={creditAccountId} onChange={(e) => setCreditAccountId(e.target.value)}>
            <option value="">— Pick —</option>
            {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Amount" required>
          <input className="input text-right font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Memo">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Auto-suggested" />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}
