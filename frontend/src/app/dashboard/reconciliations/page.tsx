"use client";

/* Bank reconciliation — side-by-side bank vs GL with auto-suggestions.
 *
 * Demo-grade read-only report (live data, no persistence). Picks a bank
 * account + as-of date and renders the classic four-block accountant
 * view:
 *
 *   Summary tiles  →  reconciling-items breakdown  →  side-by-side
 *
 * Auto-matching: server suggests pairs where amount equals signed GL
 * delta and dates are within ±5 days. Suggestions are advisory; the
 * confirm-and-save flow is the next iteration.
 *
 * Style: PageHeader / SummaryStat / FilterChip — matches /dashboard/bank
 * and /dashboard/fx-rates.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, BadgeCheck, Banknote, BookOpen, Brain, Calendar,
  Check, CheckCircle2, ChevronRight, Landmark, Loader2, Scale,
  Sparkles, Trash2, Upload, Wand2, X,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { fmtAccountingFixed, fmtDate, fmtMoneyLeadFixed } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";


/* ──────────────────────────── Types ────────────────────────────── */

interface BankAccountLite {
  id: number;
  name: string;
  bank_name: string;
  currency: string;
  entity: number;
  entity_code: string;
  is_active: boolean;
  gl_balance?: string;
}

interface MatchedRow {
  txn_id: number;
  date: string;
  description: string;
  amount: string;
  currency: string;
  je_id: number;
  je_number: string;
  je_date: string;
}
interface OutBankRow {
  txn_id: number;
  date: string;
  description: string;
  amount: string;
  currency: string;
  status: string;
}
interface OutGLRow {
  line_id: number;
  date: string;
  description: string;
  debit: string;
  credit: string;
  amount_signed: string;
  je_id: number;
  je_number: string;
}
interface Suggestion {
  txn_id: number;
  line_id: number;
  amount: string;
  date_delta_days: number;
  txn_description: string;
  je_number: string;
}
interface AISuggestion {
  transaction_id: number;
  suggested_account_id: number;
  suggested_account_code: string;
  suggested_account_name: string;
  account_type: string;
  account_subtype: string;
  reasoning: string;
  confidence: number;
  model_used: string;
}

type AICell =
  | { state: "loading" }
  | { state: "ok"; data: AISuggestion }
  | { state: "err"; msg: string }
  | { state: "creating"; data: AISuggestion }
  | { state: "created"; data: AISuggestion; je_id: number; je_number: string }
  | { state: "create_err"; data: AISuggestion; msg: string };

interface CategorizeResponse {
  transaction: { id: number; status: string };
  journal_entry_id: number;
  journal_entry_number: string;
  journal_entry_status: string;
}

interface AIPreviewTxn {
  date: string;
  description: string;
  amount: string;
  balance_after?: string | null;
  dedup_match: boolean;
}
interface AIPreviewResp {
  filename: string;
  currency: string;
  statement_period_start?: string | null;
  statement_period_end?: string | null;
  account_iban?: string | null;
  opening_balance?: string | null;
  closing_balance?: string | null;
  transactions: AIPreviewTxn[];
}
interface AICommitResp {
  imported: number;
  duplicates: number;
  errors: { row: number; error: string }[];
}

interface ReconReport {
  bank_account_id: number;
  bank_account_name: string;
  bank_account_currency: string;
  entity_code: string;
  as_of: string;
  bank_balance: string;
  gl_balance: string;
  difference: string;
  matched_count: number;
  matched: MatchedRow[];
  outstanding_bank: OutBankRow[];
  outstanding_gl: OutGLRow[];
  suggestions: Suggestion[];
  summary: Record<string, string>;
}


/* ──────────────────────────── Page ─────────────────────────────── */

export default function ReconciliationsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [bankAccounts, setBankAccounts] = useState<BankAccountLite[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [asOf, setAsOf] = useState(today);

  const [report, setReport] = useState<ReconReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AI explain-unmatched state. Map of bank txn id → cell.
  const [aiCells, setAiCells] = useState<Record<number, AICell>>({});
  const [aiRunning, setAiRunning] = useState(false);

  // Statement upload modal — AI extracts txns from PDF / CSV / image.
  const [uploadOpen, setUploadOpen] = useState(false);

  // When the report changes (new account or new as-of), drop any AI
  // results — they're tied to the previous unmatched set.
  useEffect(() => { setAiCells({}); }, [accountId, asOf]);

  const runAIExplain = async () => {
    if (!report || report.outstanding_bank.length === 0) return;
    setAiRunning(true);
    // Seed a "loading" entry for every txn so the UI shows skeletons.
    setAiCells((prev) => {
      const next = { ...prev };
      for (const t of report.outstanding_bank) next[t.txn_id] = { state: "loading" };
      return next;
    });
    // Run requests in parallel — each call hits the existing
    // /bank-transactions/{id}/suggest-categorization/ endpoint.
    await Promise.all(report.outstanding_bank.map(async (t) => {
      try {
        const d = await api.post<AISuggestion>(
          `/beakon/bank-transactions/${t.txn_id}/suggest-categorization/`, {},
        );
        setAiCells((prev) => ({ ...prev, [t.txn_id]: { state: "ok", data: d } }));
      } catch (e: any) {
        const msg = e?.error?.message || e?.detail || "AI suggestion failed";
        setAiCells((prev) => ({ ...prev, [t.txn_id]: { state: "err", msg } }));
      }
    }));
    setAiRunning(false);
  };

  // Confirm one AI suggestion: create a draft JE matching the bank txn
  // to the suggested offset account. The JE then enters the approval
  // queue; once POSTED the txn auto-flips to MATCHED via signal.
  const confirmMatch = async (txnId: number, sug: AISuggestion) => {
    setAiCells((prev) => ({ ...prev, [txnId]: { state: "creating", data: sug } }));
    try {
      const r = await api.post<CategorizeResponse>(
        `/beakon/bank-transactions/${txnId}/categorize/`,
        {
          offset_account_id: sug.suggested_account_id,
          memo: `AI: ${sug.reasoning}`.slice(0, 480),
        },
      );
      setAiCells((prev) => ({
        ...prev,
        [txnId]: {
          state: "created", data: sug,
          je_id: r.journal_entry_id,
          je_number: r.journal_entry_number,
        },
      }));
      // Re-fetch the recon report so the txn's status flips from
      // "new" → "proposed" and the suggested-matches list refreshes.
      void reloadReport();
    } catch (e: any) {
      const msg = e?.error?.message || e?.detail || "Failed to create JE";
      setAiCells((prev) => ({ ...prev, [txnId]: { state: "create_err", data: sug, msg } }));
    }
  };

  // Helper to refetch the report without flipping the page-level loader.
  const reloadReport = async () => {
    if (accountId === null) return;
    try {
      const d = await api.get<ReconReport>(
        `/beakon/bank-accounts/${accountId}/reconciliation/`,
        { as_of: asOf },
      );
      setReport(d);
    } catch {
      // swallow — we don't want a refetch failure to wipe the AI cards
    }
  };

  // ── Load bank accounts once ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    api.get<{ results: BankAccountLite[] } | BankAccountLite[]>(
      "/beakon/bank-accounts/", { is_active: "true", page_size: "100" },
    )
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : (d.results ?? []);
        setBankAccounts(list);
        // Default to the account with the most matched txns or first one
        if (list.length > 0 && accountId === null) setAccountId(list[0].id);
      })
      .catch(() => { if (!cancelled) setBankAccounts([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reload report when account or date changes ──────────────────
  useEffect(() => {
    if (accountId === null) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<ReconReport>(
      `/beakon/bank-accounts/${accountId}/reconciliation/`,
      { as_of: asOf },
    )
      .then((d) => { if (!cancelled) setReport(d); })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.error?.message || e?.detail || "Failed to load report");
        setReport(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, asOf]);

  const selectedAccount = useMemo(
    () => bankAccounts.find((b) => b.id === accountId) ?? null,
    [bankAccounts, accountId],
  );

  const ccy = report?.bank_account_currency ?? selectedAccount?.currency ?? "";

  // Diff is "reconciled" when zero (we cap at 0.005 because Decimal float
  // truncation can make it look like 0.0001).
  const diffNum = Number(report?.difference || 0);
  const isReconciled = Math.abs(diffNum) < 0.01;

  // Match rate for the headline tile.
  const totalBankItems =
    (report?.matched.length ?? 0) + (report?.outstanding_bank.length ?? 0);
  const matchRate = totalBankItems > 0
    ? Math.round(((report?.matched.length ?? 0) / totalBankItems) * 100)
    : 0;

  return (
    <div>
      <PageHeader
        title="Bank reconciliation"
        description="Match the bank statement against the general ledger, surface differences, and verify each balance with line-level evidence. Read-only today; one-click confirm comes next iteration."
        context={
          <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
            <Scale className="h-3.5 w-3.5 text-brand-600" />
            <span className="font-medium text-gray-800">
              {report?.entity_code ?? "—"}
            </span>
            <span className="text-gray-300">·</span>
            <span className="tabular-nums">As of {fmtDate(asOf)}</span>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <select
              value={accountId ?? ""}
              onChange={(e) => setAccountId(Number(e.target.value) || null)}
              className="input text-sm w-[260px]"
              disabled={bankAccounts.length === 0}
            >
              <option value="">— pick bank account —</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.entity_code} · {b.name} ({b.currency})
                </option>
              ))}
            </select>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="input pl-9 text-sm w-[160px]"
              />
            </div>
            <button
              onClick={() => setUploadOpen(true)}
              disabled={!accountId}
              className="btn-primary text-sm shrink-0"
              title={accountId ? "Upload a bank statement (PDF / CSV / image)" : "Pick a bank account first"}
            >
              <Upload className="w-4 h-4 mr-1.5" /> Upload statement
            </button>
          </div>
        }
      />

      {error && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
          <span className="text-rose-800 flex-1">{error}</span>
        </div>
      )}

      {/* ── Summary tiles ────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat
          label="Bank statement"
          value={loading
            ? <Skeleton className="h-6 w-28 inline-block" />
            : (report ? fmtMoneyLeadFixed(report.bank_balance, ccy, 2) : "—")}
          hint="Closing balance per latest txn ≤ as-of date"
          icon={Landmark}
          tone="brand"
        />
        <SummaryStat
          label="General ledger"
          value={loading
            ? <Skeleton className="h-6 w-28 inline-block" />
            : (report ? fmtMoneyLeadFixed(report.gl_balance, ccy, 2) : "—")}
          hint="Posted JL on the bank's CoA account"
          icon={BookOpen}
          tone="indigo"
        />
        <SummaryStat
          label="Difference"
          value={loading
            ? <Skeleton className="h-6 w-20 inline-block" />
            : (report
                ? <span className={isReconciled ? "text-emerald-700" : "text-amber-700"}>
                    {`${ccy} ${fmtAccountingFixed(report.difference, 2)}`}
                  </span>
                : "—")}
          hint={
            loading ? "" :
            isReconciled
              ? "Adjusted balances tie out — reconciled."
              : "Adjusted bank vs adjusted GL — investigate items below."
          }
          icon={isReconciled ? BadgeCheck : Scale}
          tone={isReconciled ? "mint" : "amber"}
        />
        <SummaryStat
          label="Match rate"
          value={loading
            ? <Skeleton className="h-6 w-12 inline-block" />
            : (totalBankItems > 0 ? `${matchRate}%` : "—")}
          hint={
            report
              ? `${report.matched.length} matched · ${report.outstanding_bank.length} unmatched · ${report.suggestions.length} suggested`
              : "—"
          }
          icon={CheckCircle2}
        />
      </div>

      {/* ── AI verdict ───────────────────────────────────────────── */}
      {accountId && report && (
        <ReconVerdictBox
          bankAccountId={accountId}
          asOf={asOf}
          isReconciled={isReconciled}
          report={report}
        />
      )}

      {/* ── Body ─────────────────────────────────────────────────── */}
      {!accountId ? (
        <div className="mt-5">
          <EmptyState
            icon={Landmark}
            title="Pick a bank account"
            description="Reconciliation runs against one bank account at a time. Choose one above to see the matched items, outstanding lines, and the reconciling-items summary."
          />
        </div>
      ) : loading ? (
        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ReconColumnSkeleton title="On bank statement" />
          <ReconColumnSkeleton title="In general ledger" />
        </div>
      ) : !report ? null : (
        <>
          {/* ── Reconciling-items summary block ──────────────────── */}
          <div className="mt-5 card overflow-hidden">
            <div className="px-4 py-3 border-b border-canvas-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Reconciliation summary</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Both adjusted balances should equal each other when the books agree with the bank.
                </p>
              </div>
              {isReconciled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2.5 py-1 text-[11px] font-medium text-mint-700 ring-1 ring-inset ring-mint-100">
                  <BadgeCheck className="w-3.5 h-3.5" />
                  Reconciled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-100">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Unreconciled
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-canvas-100">
              {/* Bank side */}
              <div className="p-4">
                <div className="text-[11px] uppercase tracking-wider text-brand-600 font-semibold mb-2 flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5" /> Per bank statement
                </div>
                <SummaryRow
                  label="Bank statement balance"
                  value={report.summary.bank_balance}
                  ccy={ccy}
                  bold
                />
                <SummaryRow
                  label="+ Receipts in books not yet on bank"
                  value={report.summary.gl_deposits_not_in_bank}
                  ccy={ccy}
                  muted
                />
                <SummaryRow
                  label="− Payments in books not yet on bank"
                  value={report.summary.gl_withdrawals_not_in_bank}
                  ccy={ccy}
                  muted
                />
                <div className="border-t border-canvas-100 mt-2 pt-2">
                  <SummaryRow
                    label="= Adjusted bank balance"
                    value={report.summary.adjusted_bank_balance}
                    ccy={ccy}
                    bold
                  />
                </div>
              </div>
              {/* GL side */}
              <div className="p-4">
                <div className="text-[11px] uppercase tracking-wider text-indigo-600 font-semibold mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> Per general ledger
                </div>
                <SummaryRow
                  label="GL balance"
                  value={report.summary.gl_balance}
                  ccy={ccy}
                  bold
                />
                <SummaryRow
                  label="+ Bank credits not yet in books"
                  value={report.summary.bank_credits_not_in_books}
                  ccy={ccy}
                  muted
                />
                <SummaryRow
                  label="− Bank debits not yet in books"
                  value={report.summary.bank_debits_not_in_books}
                  ccy={ccy}
                  muted
                />
                <div className="border-t border-canvas-100 mt-2 pt-2">
                  <SummaryRow
                    label="= Adjusted GL balance"
                    value={report.summary.adjusted_gl_balance}
                    ccy={ccy}
                    bold
                  />
                </div>
              </div>
            </div>
            <div className={cn(
              "px-4 py-3 border-t border-canvas-100 flex items-center justify-between",
              isReconciled ? "bg-mint-50/40" : "bg-amber-50/40",
            )}>
              <div className="text-xs">
                <span className="text-gray-500">Difference (adjusted bank − adjusted GL): </span>
                <span className={cn(
                  "font-semibold tabular-nums",
                  isReconciled ? "text-emerald-700" : "text-amber-700",
                )}>
                  {`${ccy} ${fmtAccountingFixed(report.difference, 2)}`}
                </span>
              </div>
              <div className="text-[11px] text-gray-500">
                Should be zero when reconciled
              </div>
            </div>
          </div>

          {/* ── AI explain unmatched ─────────────────────────────── */}
          {report.outstanding_bank.length > 0 && (
            <div className="mt-5 rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50/60 to-white p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
                      <Brain className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-violet-900">
                      AI explain unmatched
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-violet-800/80 max-w-xl">
                    For each bank txn the books don't yet know about, ask the
                    categoriser what it is and which GL account it should book
                    to. The reasoning stays attached so an approver can audit
                    the call.
                  </p>
                </div>
                <button
                  onClick={runAIExplain}
                  disabled={aiRunning}
                  className="btn-primary text-sm shrink-0"
                >
                  {aiRunning ? (
                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Asking AI…</>
                  ) : (
                    <><Brain className="w-4 h-4 mr-1.5" />
                      AI explain {report.outstanding_bank.length} unmatched
                    </>
                  )}
                </button>
              </div>

              {Object.keys(aiCells).length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {report.outstanding_bank.map((t) => {
                    const cell = aiCells[t.txn_id];
                    if (!cell) return null;
                    return (
                      <AIExplainCard
                        key={t.txn_id}
                        txn={t}
                        cell={cell}
                        ccy={ccy}
                        onConfirm={confirmMatch}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Auto-suggestions ─────────────────────────────────── */}
          {report.suggestions.length > 0 && (
            <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-brand-600" />
                <h3 className="text-sm font-semibold text-brand-900">
                  Auto-suggested matches ({report.suggestions.length})
                </h3>
                <span className="text-[11px] text-brand-700">
                  Same amount, dates within 5 days
                </span>
              </div>
              <div className="rounded-lg overflow-hidden border border-brand-100 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Bank txn</th>
                      <th className="px-3 py-2 text-left font-semibold">JE</th>
                      <th className="px-3 py-2 text-right font-semibold">Amount</th>
                      <th className="px-3 py-2 text-left font-semibold">Δ days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-50">
                    {report.suggestions.map((s) => (
                      <tr key={`${s.txn_id}-${s.line_id}`}>
                        <td className="px-3 py-1.5 text-xs text-gray-700 max-w-md truncate">
                          {s.txn_description || `Txn #${s.txn_id}`}
                        </td>
                        <td className="px-3 py-1.5 text-xs font-mono text-gray-700">
                          {s.je_number}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {fmtMoneyLeadFixed(s.amount, ccy, 2)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-500 tabular-nums">
                          ±{s.date_delta_days}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-[11px] text-brand-700/80 flex items-center gap-1">
                <Wand2 className="w-3 h-3" />
                Confirm-and-save action ships in the next iteration.
              </div>
            </div>
          )}

          {/* ── Side-by-side line lists ──────────────────────────── */}
          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Bank side */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-canvas-100">
                <div className="text-[11px] uppercase tracking-wider text-brand-600 font-semibold flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5" /> On bank statement
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {report.matched.length} matched ·{" "}
                  <span className={report.outstanding_bank.length > 0 ? "text-amber-700 font-medium" : ""}>
                    {report.outstanding_bank.length} not in books
                  </span>
                </div>
              </div>
              {report.outstanding_bank.length === 0 && report.matched.length === 0 ? (
                <EmptyState
                  icon={Landmark}
                  title="No bank transactions"
                  description="Nothing imported for this account up to the as-of date."
                />
              ) : (
                <div className="overflow-y-auto max-h-[480px]">
                  <table className="w-full text-sm">
                    <thead className="bg-canvas-50 text-[11px] uppercase tracking-wider text-gray-500 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Date</th>
                        <th className="px-3 py-2 text-left font-semibold">Description</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 text-left font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-canvas-100">
                      {report.outstanding_bank.length > 0 && (
                        <tr><td colSpan={4} className="px-3 py-1.5 bg-amber-50/40 text-[10px] uppercase tracking-wider text-amber-700 font-semibold">
                          Outstanding ({report.outstanding_bank.length})
                        </td></tr>
                      )}
                      {report.outstanding_bank.map((b) => (
                        <tr key={`ob-${b.txn_id}`} className="bg-amber-50/20">
                          <td className="px-3 py-1.5 text-xs text-gray-700 whitespace-nowrap">{fmtDate(b.date)}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-700 max-w-[260px] truncate" title={b.description}>{b.description}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtMoneyLeadFixed(b.amount, ccy, 2)}</td>
                          <td className="px-3 py-1.5 text-[11px]">
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-100">
                              {b.status}
                            </span>
                          </td>
                        </tr>
                      ))}

                      {report.matched.length > 0 && (
                        <tr><td colSpan={4} className="px-3 py-1.5 bg-mint-50/40 text-[10px] uppercase tracking-wider text-mint-700 font-semibold">
                          Matched ({report.matched.length})
                        </td></tr>
                      )}
                      {report.matched.map((m) => (
                        <tr key={`mb-${m.txn_id}`}>
                          <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(m.date)}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-500 max-w-[260px] truncate" title={m.description}>{m.description}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-gray-500">{fmtMoneyLeadFixed(m.amount, ccy, 2)}</td>
                          <td className="px-3 py-1.5 text-[11px]">
                            <span className="font-mono text-gray-400">{m.je_number}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* GL side */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-canvas-100">
                <div className="text-[11px] uppercase tracking-wider text-indigo-600 font-semibold flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> In general ledger
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {report.matched.length} matched ·{" "}
                  <span className={report.outstanding_gl.length > 0 ? "text-indigo-700 font-medium" : ""}>
                    {report.outstanding_gl.length} not on bank
                  </span>
                </div>
              </div>
              {report.outstanding_gl.length === 0 && report.matched.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="No GL activity"
                  description="No posted journal lines on this account up to the as-of date."
                />
              ) : (
                <div className="overflow-y-auto max-h-[480px]">
                  <table className="w-full text-sm">
                    <thead className="bg-canvas-50 text-[11px] uppercase tracking-wider text-gray-500 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Date</th>
                        <th className="px-3 py-2 text-left font-semibold">Memo</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2 text-left font-semibold">JE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-canvas-100">
                      {report.outstanding_gl.length > 0 && (
                        <tr><td colSpan={4} className="px-3 py-1.5 bg-indigo-50/40 text-[10px] uppercase tracking-wider text-indigo-700 font-semibold">
                          Outstanding ({report.outstanding_gl.length})
                        </td></tr>
                      )}
                      {report.outstanding_gl.map((l) => (
                        <tr key={`og-${l.line_id}`} className="bg-indigo-50/20">
                          <td className="px-3 py-1.5 text-xs text-gray-700 whitespace-nowrap">{fmtDate(l.date)}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-700 max-w-[260px] truncate" title={l.description}>{l.description}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtMoneyLeadFixed(l.amount_signed, ccy, 2)}</td>
                          <td className="px-3 py-1.5 text-[11px] font-mono text-indigo-700">{l.je_number}</td>
                        </tr>
                      ))}

                      {report.matched.length > 0 && (
                        <tr><td colSpan={4} className="px-3 py-1.5 bg-mint-50/40 text-[10px] uppercase tracking-wider text-mint-700 font-semibold">
                          Matched ({report.matched.length})
                        </td></tr>
                      )}
                      {report.matched.map((m) => (
                        <tr key={`mg-${m.je_id}`}>
                          <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">{fmtDate(m.je_date)}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-500 max-w-[260px] truncate" title={m.description}>{m.description}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-gray-500">{fmtMoneyLeadFixed(m.amount, ccy, 2)}</td>
                          <td className="px-3 py-1.5 text-[11px] font-mono text-gray-400">{m.je_number}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 text-[11px] text-gray-400">
            Read-only report. Auto-suggestions surface candidate matches; confirming
            them (and reversing matches) lands in the next iteration.
          </div>
        </>
      )}

      {/* ── Upload statement modal ──────────────────────────────── */}
      {uploadOpen && accountId !== null && (
        <UploadStatementModal
          bankAccountId={accountId}
          currency={selectedAccount?.currency || ""}
          onClose={() => setUploadOpen(false)}
          onImported={async () => {
            setUploadOpen(false);
            await reloadReport();
          }}
        />
      )}
    </div>
  );
}


/* ─────────────────────── Helpers ─────────────────────────────── */

/** Currency-leading wrapper for already-formatted accounting amounts.
 *  Negatives stay in parens — "CHF (1,234.56)" — and the em-dash zero
 *  passes through unchanged. */
function leadCcy(ccy: string, formatted: string): string {
  if (!ccy) return formatted;
  if (formatted === "—") return formatted;
  return `${ccy} ${formatted}`;
}



/* ── AI verdict box ───────────────────────────────────────────────── */
/* Streams a 3-5 sentence verdict from /beakon/narrative/?report_type=recon
 * Auto-runs the first time a (bankAccountId, asOf) pair becomes available
 * and re-runs whenever they change. Includes a "Discuss with Beakon"
 * handoff that opens the global Ask Beakon chat with the recon context
 * pre-filled — so the operator can ask follow-up questions without
 * re-typing what's on screen. */
function ReconVerdictBox({
  bankAccountId, asOf, isReconciled, report,
}: {
  bankAccountId: number;
  asOf: string;
  isReconciled: boolean;
  report: ReconReport;
}) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<{ backend: string; model: string } | null>(null);
  const ranKey = useRef<string>("");

  const generate = async (force = false) => {
    const key = `${bankAccountId}|${asOf}`;
    if (!force && ranKey.current === key && (text || error)) return;
    ranKey.current = key;
    setText("");
    setError(null);
    setStreaming(true);
    try {
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;
      const resp = await fetch(`${API_BASE}/beakon/narrative/`, {
        method: "POST", headers,
        body: JSON.stringify({
          report_type: "recon",
          bank_account: bankAccountId,
          as_of: asOf,
        }),
      });
      if (!resp.ok || !resp.body) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body?.detail || `HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let errMsg: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          if (!block.startsWith("data:")) continue;
          let data: any;
          try { data = JSON.parse(block.slice(5).trim()); } catch { continue; }
          if (data.type === "token") {
            acc += data.text || "";
            setText(acc);
          } else if (data.type === "error") {
            errMsg = data.message || "Verdict failed";
          } else if (data.type === "snapshot_built" && data.backend) {
            setBackend({ backend: data.backend, model: data.model || "" });
          }
        }
      }
      if (errMsg) throw new Error(errMsg);
    } catch (e: any) {
      setError(e?.message || "Verdict failed");
    } finally {
      setStreaming(false);
    }
  };

  useEffect(() => {
    void generate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountId, asOf]);

  const discussInChat = () => {
    const ccy = report.bank_account_currency;
    const lines = [
      `I'm looking at the reconciliation for ${report.bank_account_name} (entity ${report.entity_code}) as of ${asOf}.`,
      `Bank balance: ${report.bank_balance} ${ccy}.`,
      `GL balance: ${report.gl_balance} ${ccy}.`,
      `Difference: ${report.difference} ${ccy}.`,
      `${report.matched_count} matched · ${report.outstanding_bank.length} bank-only · ${report.outstanding_gl.length} GL-only.`,
      "",
      "What should I do next to close this reconciliation?",
    ];
    window.dispatchEvent(new CustomEvent("beakon:open", {
      detail: { prefill: lines.join("\n"), autoSubmit: false },
    }));
  };

  const tone = isReconciled
    ? "border-emerald-200 bg-emerald-50/30"
    : "border-amber-200 bg-amber-50/30";

  return (
    <div className={cn(
      "mt-4 rounded-xl border p-4",
      tone,
    )}>
      <div className="flex items-start gap-3">
        <Sparkles className={cn(
          "w-4 h-4 mt-0.5 shrink-0",
          isReconciled ? "text-emerald-600" : "text-amber-600",
        )} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-gray-700 uppercase tracking-wider">
                Beakon AI verdict
              </span>
              {backend && (
                <span className="text-[10px] text-gray-400">
                  · {backend.backend}{backend.model ? ` ${backend.model}` : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!streaming && (
                <button
                  onClick={() => void generate(true)}
                  className="text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
                  title="Regenerate verdict"
                >
                  <Wand2 className="w-3 h-3" /> Regenerate
                </button>
              )}
              <button
                onClick={discussInChat}
                disabled={streaming}
                className="text-[11px] text-brand-700 hover:text-brand-900 inline-flex items-center gap-1 font-medium disabled:opacity-50"
                title="Open Ask Beakon with this reconciliation context"
              >
                <Brain className="w-3 h-3" /> Discuss with Beakon
              </button>
            </div>
          </div>
          {error ? (
            <p className="text-xs text-red-700">{error}</p>
          ) : streaming && !text ? (
            <p className="text-xs text-gray-500 inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Reading the reconciliation snapshot…
            </p>
          ) : (
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              {text}
              {streaming && (
                <span className="inline-block w-1.5 h-3.5 bg-gray-500 ml-0.5 animate-pulse align-middle" />
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


function SummaryRow({
  label, value, ccy, bold = false, muted = false,
}: {
  label: string;
  value: string;
  ccy: string;
  bold?: boolean;
  muted?: boolean;
}) {
  const n = Number(value || 0);
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className={cn("text-gray-600", muted && "text-gray-500", bold && "text-gray-900 font-medium")}>
        {label}
      </span>
      <span className={cn(
        "tabular-nums",
        muted && "text-gray-500",
        bold && "text-gray-900 font-semibold",
      )}>
        {n === 0 ? "—" : fmtMoneyLeadFixed(value, ccy, 2)}
      </span>
    </div>
  );
}

function AIExplainCard({
  txn, cell, ccy, onConfirm,
}: {
  txn: OutBankRow;
  cell: AICell;
  ccy: string;
  onConfirm: (txnId: number, sug: AISuggestion) => void | Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-violet-100 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      {/* Bank txn header */}
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-canvas-100">
        <div className="min-w-0">
          <div className="text-xs text-gray-500 tabular-nums">{fmtDate(txn.date)}</div>
          <div className="mt-0.5 text-sm font-medium text-gray-900 truncate" title={txn.description}>
            {txn.description || `Txn #${txn.txn_id}`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm tabular-nums font-semibold text-gray-900">
            {fmtMoneyLeadFixed(txn.amount, ccy, 2)}
          </div>
        </div>
      </div>

      {/* AI body */}
      <div className="mt-2.5">
        {cell.state === "loading" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-violet-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
            </div>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}

        {cell.state === "err" && (
          <div className="rounded-lg border border-rose-100 bg-rose-50/60 p-2 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" />
            <span>{cell.msg}</span>
          </div>
        )}

        {cell.state === "ok" && (
          <>
            <AIExplainBody data={cell.data} />
            <div className="mt-3 pt-2 border-t border-canvas-100 flex items-center justify-end gap-2">
              <button
                onClick={() => onConfirm(txn.txn_id, cell.data)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Confirm & match
              </button>
            </div>
          </>
        )}

        {cell.state === "creating" && (
          <>
            <AIExplainBody data={cell.data} />
            <div className="mt-3 pt-2 border-t border-canvas-100 flex items-center justify-end gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-violet-700">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Creating draft JE…
              </span>
            </div>
          </>
        )}

        {cell.state === "created" && (
          <>
            <AIExplainBody data={cell.data} />
            <div className="mt-3 pt-2 border-t border-canvas-100 rounded-md bg-mint-50/60 px-2 py-2">
              <div className="flex items-start gap-2 text-xs text-mint-800">
                <CheckCircle2 className="w-3.5 h-3.5 text-mint-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold">
                    Draft <span className="font-mono">{cell.je_number}</span> created.
                  </div>
                  <div className="mt-0.5 text-mint-700/90">
                    Approve & post in{" "}
                    <a
                      href="/dashboard/approvals"
                      className="underline font-medium hover:text-mint-900"
                    >
                      Approvals
                    </a>{" "}
                    to mark this txn matched.
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {cell.state === "create_err" && (
          <>
            <AIExplainBody data={cell.data} />
            <div className="mt-3 pt-2 border-t border-canvas-100">
              <div className="rounded-lg border border-rose-100 bg-rose-50/60 p-2 text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" />
                <span className="flex-1">{cell.msg}</span>
                <button
                  onClick={() => onConfirm(txn.txn_id, cell.data)}
                  className="text-rose-700 underline font-medium"
                >
                  Retry
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function AIExplainBody({ data }: { data: AISuggestion }) {
  const conf = Number(data.confidence ?? 0);
  // Tone the confidence chip: high (≥0.8), med (0.5–0.8), low (<0.5).
  const confTone =
    conf >= 0.8 ? "bg-mint-50 text-mint-700 ring-mint-100" :
    conf >= 0.5 ? "bg-brand-50 text-brand-700 ring-brand-100" :
                  "bg-amber-50 text-amber-700 ring-amber-100";
  const confLabel =
    conf >= 0.8 ? "High confidence" :
    conf >= 0.5 ? "Medium confidence" :
                  "Low confidence";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
          AI suggests
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-mono text-violet-800 ring-1 ring-inset ring-violet-100">
          {data.suggested_account_code}
        </span>
        <span className="text-sm text-gray-900 font-medium truncate" title={data.suggested_account_name}>
          {data.suggested_account_name}
        </span>
      </div>
      <p className="text-[12px] text-gray-700 leading-relaxed">
        {data.reasoning}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap pt-1">
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
          confTone,
        )}>
          <CheckCircle2 className="w-3 h-3" />
          {confLabel} · {Math.round(conf * 100)}%
        </span>
        <span className="text-[10px] text-gray-400">
          {data.model_used}
        </span>
      </div>
    </div>
  );
}


function ReconColumnSkeleton({ title }: { title: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-canvas-100">
        <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">{title}</div>
        <div className="mt-1.5"><Skeleton className="h-3 w-32" /></div>
      </div>
      <div className="p-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 flex-1 max-w-[180px]" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}


/* ────────────────────────────────────────────────────────────────── */
/*  Upload statement modal — Claude reads PDF / CSV / image            */
/* ────────────────────────────────────────────────────────────────── */
function UploadStatementModal({
  bankAccountId, currency, onClose, onImported,
}: {
  bankAccountId: number;
  currency: string;
  onClose: () => void;
  onImported: () => void | Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<AIPreviewResp | null>(null);
  const [committed, setCommitted] = useState<AICommitResp | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onAnalyze = async () => {
    if (!file) return;
    setBusy(true); setErr(null); setCommitted(null); setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;
      const resp = await fetch(
        `${API_BASE}/beakon/bank-accounts/${bankAccountId}/ai-preview/`,
        { method: "POST", headers, body: fd },
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error?.message || data?.detail || "Upload failed");
      setPreview(data as AIPreviewResp);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const removeRow = (idx: number) => {
    if (!preview) return;
    setPreview({
      ...preview,
      transactions: preview.transactions.filter((_, i) => i !== idx),
    });
  };

  const onCommit = async () => {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      const result = await api.post<AICommitResp>(
        `/beakon/bank-accounts/${bankAccountId}/ai-commit/`,
        { transactions: preview.transactions, filename: preview.filename },
      );
      setCommitted(result);
    } catch (e: any) {
      setErr(e?.detail || e?.message || "Commit failed");
    } finally {
      setBusy(false);
    }
  };

  const newCount = preview
    ? preview.transactions.filter((t) => !t.dedup_match).length
    : 0;
  const dupCount = preview
    ? preview.transactions.filter((t) => t.dedup_match).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full sm:w-[720px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">AI bank statement import</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Claude reads the document and extracts every transaction. You review before anything is written.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* ── 3. Committed result ─────────────────────────────── */}
          {committed ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Check className="w-5 h-5 text-emerald-700" />
                <p className="text-sm font-semibold text-emerald-900">
                  Imported {committed.imported} transaction{committed.imported === 1 ? "" : "s"}
                </p>
              </div>
              {committed.duplicates > 0 && (
                <p className="text-xs text-emerald-800">
                  Skipped {committed.duplicates} duplicate{committed.duplicates === 1 ? "" : "s"} (already imported).
                </p>
              )}
              {committed.errors.length > 0 && (
                <p className="text-xs text-rose-700 mt-1">
                  {committed.errors.length} row{committed.errors.length === 1 ? "" : "s"} couldn't be parsed.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={() => onImported()} className="btn-primary text-sm">
                  See updated reconciliation <ChevronRight className="w-4 h-4 ml-1" />
                </button>
                <button onClick={onClose} className="btn-secondary text-sm">Close</button>
              </div>
            </div>
          ) : !preview ? (
            /* ── 1. File picker ─────────────────────────────────── */
            <>
              <div
                className="border border-dashed border-canvas-200 rounded-xl p-6 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/40 transition"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) setFile(f);
                }}
              >
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
                    <Upload className="w-4 h-4 text-brand-700" />
                    <span className="font-medium">{file.name}</span>
                    <span className="text-xs text-gray-400">
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-7 h-7 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600">Drop a file here or click to choose</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      .pdf · .csv · .tsv · .jpg · .png · .webp
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.csv,.tsv,.txt,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              {err && (
                <div className="rounded-lg border border-rose-100 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" /> {err}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
                <button onClick={onAnalyze} disabled={!file || busy} className="btn-primary text-sm">
                  {busy
                    ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Asking Claude…</>
                    : <><Sparkles className="w-4 h-4 mr-1.5" /> Analyze with AI</>}
                </button>
              </div>
            </>
          ) : (
            /* ── 2. Preview + commit ────────────────────────────── */
            <>
              <div className="rounded-xl border border-canvas-200 bg-canvas-50/60 p-3 text-xs text-gray-700 grid grid-cols-2 gap-y-1.5 gap-x-4">
                <div><span className="text-gray-400">File:</span> <span className="font-mono">{preview.filename}</span></div>
                <div><span className="text-gray-400">Currency:</span> {preview.currency || currency}</div>
                {preview.statement_period_start && (
                  <div className="col-span-2"><span className="text-gray-400">Period:</span> {preview.statement_period_start} → {preview.statement_period_end || "?"}</div>
                )}
                {preview.account_iban && (
                  <div className="col-span-2"><span className="text-gray-400">IBAN:</span> <span className="font-mono">{preview.account_iban}</span></div>
                )}
                {preview.opening_balance && (
                  <div><span className="text-gray-400">Opening:</span> <span className="tabular-nums">{preview.opening_balance}</span></div>
                )}
                {preview.closing_balance && (
                  <div><span className="text-gray-400">Closing:</span> <span className="tabular-nums">{preview.closing_balance}</span></div>
                )}
              </div>

              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-gray-900">{newCount} new</span>
                  {dupCount > 0 && (
                    <span className="text-amber-700 ml-2">
                      {dupCount} already imported (will be skipped)
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setPreview(null); setFile(null); }}
                  className="text-gray-500 hover:text-gray-800 underline"
                >
                  Start over
                </button>
              </div>

              <div className="border border-canvas-200 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-canvas-50 text-[10px] uppercase tracking-wider text-gray-500 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Date</th>
                      <th className="px-3 py-2 text-left font-semibold">Description</th>
                      <th className="px-3 py-2 text-right font-semibold">Amount</th>
                      <th className="px-3 py-2 text-center font-semibold w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-canvas-100">
                    {preview.transactions.map((t, i) => (
                      <tr key={i} className={cn(t.dedup_match && "bg-amber-50/40 text-gray-500")}>
                        <td className="px-3 py-1.5 whitespace-nowrap font-mono">{t.date}</td>
                        <td className="px-3 py-1.5 max-w-[280px] truncate" title={t.description}>{t.description}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {t.amount}
                          {t.dedup_match && (
                            <span className="ml-1.5 text-[10px] text-amber-700">dup</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <button
                            onClick={() => removeRow(i)}
                            className="text-gray-300 hover:text-rose-600"
                            title="Remove from import"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {err && (
                <div className="rounded-lg border border-rose-100 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" /> {err}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-canvas-100">
                <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
                <button onClick={onCommit} disabled={busy || newCount === 0} className="btn-primary text-sm">
                  {busy
                    ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Importing…</>
                    : <><Check className="w-4 h-4 mr-1.5" /> Import {newCount} transaction{newCount === 1 ? "" : "s"}</>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
