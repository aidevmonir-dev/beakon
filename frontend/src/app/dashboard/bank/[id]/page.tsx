"use client";

/* Bank account detail — CSV import + transaction list + categorize each txn
 * into a draft JE. The draft flows through the standard approval pipeline;
 * the signal on the kernel flips matched status when the JE posts.
 *
 * Visual vocabulary matches the entities / reports pages: PageHeader with
 * context chips, compact SummaryStat strip, sticky-header table with
 * tonal status pills, EmptyState / skeleton for edge states.
 *
 * Running balance is computed client-side from every transaction (opening
 * balance + cumulative), so the column is always populated whether or not
 * the source CSV carried a balance column.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Upload, X, Check, Ban, Undo2, Sparkles,
  Landmark, Building, User, ListTree, Coins, Hash, RefreshCcw, AlertCircle,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";


// ── Types ─────────────────────────────────────────────────────────────────

interface BankAccount {
  id: number;
  name: string;
  bank_name: string;
  account_number_last4: string;
  entity: number;
  entity_code: string;
  entity_name: string;
  entity_type: string;
  account: number;
  account_code: string;
  account_name: string;
  currency: string;
  opening_balance: string;
  is_active: boolean;
}

interface CoaAccount {
  id: number;
  code: string;
  name: string;
  account_type: string;
  entity: number | null;
  entity_code: string | null;
}

interface Txn {
  id: number;
  date: string;
  description: string;
  amount: string;
  balance_after: string | null;
  currency: string;
  status: string;
  is_duplicate: boolean;
  proposed_journal_entry: number | null;
  proposed_je_number: string | null;
  proposed_je_status: string | null;
}

interface TxnWithBalance extends Txn {
  runningBalance: number;
}


// ── Status vocabulary ─────────────────────────────────────────────────────

type StatusKey = "" | "new" | "proposed" | "matched" | "ignored";

const STATUSES: { key: StatusKey; label: string; hint?: string }[] = [
  { key: "",         label: "All" },
  { key: "new",      label: "New",                 hint: "Fresh imports awaiting categorization" },
  { key: "proposed", label: "Awaiting approval",   hint: "Draft journal entry exists, pending approval" },
  { key: "matched",  label: "Matched",             hint: "Journal entry posted — fully reconciled" },
  { key: "ignored",  label: "Ignored",             hint: "Excluded from the ledger by the user" },
];

const STATUS_META: Record<string, { label: string; chip: string; dot: string }> = {
  new:      { label: "New",
              chip: "bg-brand-50 text-brand-800 ring-brand-100",
              dot:  "bg-brand-500" },
  proposed: { label: "Awaiting approval",
              chip: "bg-amber-50 text-amber-800 ring-amber-100",
              dot:  "bg-amber-500" },
  matched:  { label: "Matched",
              chip: "bg-mint-50 text-mint-700 ring-mint-200/80",
              dot:  "bg-mint-500" },
  ignored:  { label: "Ignored",
              chip: "bg-gray-100 text-gray-600 ring-gray-200",
              dot:  "bg-gray-400" },
};

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] || STATUS_META.new;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset",
      m.chip,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────

export default function BankDetailPage() {
  const params = useParams<{ id: string }>();
  const [ba, setBa] = useState<BankAccount | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusKey>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [catTarget, setCatTarget] = useState<Txn | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [b, a] = await Promise.all([
        api.get<BankAccount>(`/beakon/bank-accounts/${params.id}/`),
        api.get<{ results: CoaAccount[] } | CoaAccount[]>("/beakon/accounts/").then((d) =>
          Array.isArray(d) ? d : (d.results ?? []),
        ),
      ]);
      setBa(b);
      setAccounts(a);
    } catch {
      setError("Bank account not found.");
    }
  };

  const loadTxns = async () => {
    if (!params.id) return;
    // Always fetch the full transaction list so running balance is correct
    // regardless of the active status filter. The filter is applied client-side.
    const r = await api.get<{ results: Txn[] } | Txn[]>(
      `/beakon/bank-accounts/${params.id}/transactions/`, { page_size: "500" },
    ).catch(() => ({ results: [] as Txn[] }));
    const list = Array.isArray(r) ? r : (r.results || []);
    setTxns(list);
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await Promise.all([load(), loadTxns()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  // ── Derived: running balance + status counts + filtered view ─────────
  const withBalance: TxnWithBalance[] = useMemo(() => {
    if (!ba) return [];
    const sorted = [...txns].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.id - b.id;
    });
    let running = parseFloat(ba.opening_balance || "0");
    const countsTowardLedger = (s: string) => s !== "ignored";
    const enriched = sorted.map((t) => {
      if (countsTowardLedger(t.status)) running += parseFloat(t.amount || "0");
      return { ...t, runningBalance: running };
    });
    // Present newest first in the UI while keeping the computed balance.
    return enriched.reverse();
  }, [txns, ba]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { new: 0, proposed: 0, matched: 0, ignored: 0 };
    for (const t of txns) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [txns]);

  const filtered = useMemo(() => {
    if (!statusFilter) return withBalance;
    return withBalance.filter((t) => t.status === statusFilter);
  }, [withBalance, statusFilter]);

  const currentBalance = useMemo(() => {
    if (!ba) return 0;
    if (withBalance.length === 0) return parseFloat(ba.opening_balance || "0");
    // withBalance is newest-first; index 0 has the latest running balance.
    return withBalance[0].runningBalance;
  }, [withBalance, ba]);

  async function refresh() {
    setRefreshing(true);
    await loadTxns();
    setRefreshing(false);
  }

  // ── Error / loading shells ───────────────────────────────────────────
  if (error) {
    return (
      <div>
        <BackLink />
        <div className="mt-4">
          <EmptyState
            tone="warning"
            icon={AlertCircle}
            title="Couldn't load this bank account"
            description={error}
            primaryAction={{ label: "Back to Bank Feed", onClick: () => { window.location.href = "/dashboard/bank"; } }}
          />
        </div>
      </div>
    );
  }

  if (loading || !ba) {
    return (
      <div>
        <BackLink />
        <div className="mt-3 h-24 rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-pulse" />
        <div className="mt-5 overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <table className="w-full text-sm">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={6} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const isPerson = ba.entity_type === "individual";
  const EntityIcon = isPerson ? User : Building;

  return (
    <div>
      <BackLink />

      <div className="mt-3">
        <PageHeader
          title={ba.name}
          description={
            <>
              Bank statement imports for this account flow through the controlled journal workflow.
              Every transaction must become a journal entry before it reaches the ledger.
            </>
          }
          context={
            <div className="flex flex-wrap items-center gap-1.5">
              <ContextChip icon={Landmark} label="Bank">
                <span className="font-medium text-gray-900">{ba.bank_name || "—"}</span>
                {ba.account_number_last4 && (
                  <>
                    <span className="text-gray-300 mx-1">·</span>
                    <span className="font-mono text-[11px]">···{ba.account_number_last4}</span>
                  </>
                )}
              </ContextChip>
              <ContextChip icon={EntityIcon} label="Entity" tone={isPerson ? "rose" : "brand"}>
                <span className="font-medium text-gray-900">{ba.entity_name}</span>
                <span className="text-gray-300 mx-1">·</span>
                <span className="font-mono text-[11px] text-gray-600">{ba.entity_code}</span>
                {ba.entity_type && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {fmtLabel(ba.entity_type)}
                  </span>
                )}
              </ContextChip>
              <ContextChip icon={ListTree} label="COA">
                <span className="font-mono text-[11px] text-gray-700">{ba.account_code}</span>
                <span className="text-gray-300 mx-1">·</span>
                <span className="text-gray-700">{ba.account_name}</span>
              </ContextChip>
              <ContextChip icon={Coins} label="Currency">
                <span className="font-mono text-[11px] text-gray-900">{ba.currency}</span>
              </ContextChip>
              {!ba.is_active && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600 ring-1 ring-inset ring-gray-200">
                  Archived
                </span>
              )}
            </div>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="btn-secondary"
                title="Reload transactions"
              >
                <RefreshCcw className={cn("w-4 h-4 mr-1.5", refreshing && "animate-spin")} />
                Refresh
              </button>
              <button onClick={() => setImportModal(true)} className="btn-primary">
                <Upload className="w-4 h-4 mr-1.5" /> Import CSV
              </button>
            </>
          }
        />
      </div>

      {/* Summary */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat
          label="Current balance"
          value={`${currentBalance < 0 ? "−" : ""}${fmt2(Math.abs(currentBalance))} ${ba.currency}`}
          hint={
            txns.length > 0
              ? `${txns.filter((t) => t.status !== "ignored").length} txns applied`
              : "Opening balance · no imports yet"
          }
          icon={Landmark}
          tone="brand"
        />
        <SummaryStat
          label="New"
          value={counts.new || 0}
          hint={counts.new ? "Awaiting categorization" : "Inbox clear"}
          icon={Hash}
          tone="indigo"
        />
        <SummaryStat
          label="Awaiting approval"
          value={counts.proposed || 0}
          hint={counts.proposed ? "Draft JE sitting with approver" : "None pending"}
          icon={Check}
          tone="amber"
        />
        <SummaryStat
          label="Matched"
          value={counts.matched || 0}
          hint={counts.matched ? "Posted to the ledger" : "No posts yet"}
          icon={Check}
          tone="mint"
        />
      </div>

      {/* Transactions */}
      <div className="mt-5 overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {/* Filter rail */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-canvas-100 px-3 py-2.5">
          {STATUSES.map((s) => {
            const active = statusFilter === s.key;
            const count = s.key ? counts[s.key] || 0 : txns.length;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatusFilter(s.key)}
                title={s.hint}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ring-1 ring-inset",
                  active
                    ? "bg-brand-50 text-brand-800 ring-brand-200"
                    : "bg-white text-gray-600 ring-canvas-200 hover:bg-canvas-50",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full",
                  s.key && STATUS_META[s.key] ? STATUS_META[s.key].dot : "bg-gray-300",
                )} />
                {s.label}
                <span className={cn(
                  "ml-0.5 text-[10px] font-semibold tabular-nums",
                  active ? "text-brand-700" : "text-gray-400",
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-canvas-50/80 backdrop-blur border-b border-canvas-200/70">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                <th className="w-28 pl-5 pr-3 py-2.5 font-semibold">Date</th>
                <th className="pr-4 py-2.5 font-semibold">Description</th>
                <th className="pr-4 py-2.5 font-semibold text-right">Amount</th>
                <th className="pr-4 py-2.5 font-semibold text-right hidden md:table-cell">Running balance</th>
                <th className="pr-4 py-2.5 font-semibold">Status</th>
                <th className="pr-4 py-2.5 font-semibold hidden lg:table-cell">Draft JE</th>
                <th className="pr-5 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>

            {filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7} className="p-0">
                    {txns.length === 0 ? (
                      <EmptyState
                        tone="brand"
                        icon={Upload}
                        title="No transactions yet"
                        description="Import a CSV from your bank to begin. Every row becomes a proposed journal entry that flows through the approval workflow before it hits the ledger."
                        primaryAction={{ label: "Import CSV", icon: Upload, onClick: () => setImportModal(true) }}
                        className="border-0 shadow-none rounded-none"
                      />
                    ) : (
                      <EmptyState
                        icon={Hash}
                        title={`No ${STATUSES.find((s) => s.key === statusFilter)?.label.toLowerCase() || "matching"} transactions`}
                        description="Pick a different filter to see more transactions."
                        primaryAction={statusFilter ? { label: "Clear filter", onClick: () => setStatusFilter("") } : undefined}
                        className="border-0 shadow-none rounded-none"
                      />
                    )}
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((t) => (
                  <TxnRow
                    key={t.id}
                    txn={t}
                    currency={ba.currency}
                    onCategorize={() => setCatTarget(t)}
                    onIgnore={async () => {
                      const reason = prompt("Reason for ignoring (optional):") || "";
                      await api.post(`/beakon/bank-transactions/${t.id}/ignore/`, { reason });
                      await loadTxns();
                    }}
                    onUndo={async () => {
                      if (!confirm("Undo categorization? The draft journal entry will be deleted.")) return;
                      try {
                        await api.post(`/beakon/bank-transactions/${t.id}/undo/`, {});
                        await loadTxns();
                      } catch (e: any) {
                        alert(e?.error?.message || "Undo failed");
                      }
                    }}
                  />
                ))}
              </tbody>
            )}
          </table>
        </div>
      </div>

      {importModal && (
        <ImportModal
          bankAccountId={ba.id}
          onClose={() => setImportModal(false)}
          onImported={async () => { setImportModal(false); await loadTxns(); }}
          busy={importing}
          setBusy={setImporting}
        />
      )}

      {catTarget && (
        <CategorizeModal
          txn={catTarget}
          accounts={accounts.filter((a) => a.entity === null || a.entity === ba.entity)}
          bankAccountCoa={ba.account}
          onClose={() => setCatTarget(null)}
          onDone={async () => { setCatTarget(null); await loadTxns(); }}
        />
      )}
    </div>
  );
}


// ── Header widgets ────────────────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/dashboard/bank"
      className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" /> Back to Bank Feed
    </Link>
  );
}


function ContextChip({
  icon: Icon, label, tone = "default", children,
}: {
  icon: typeof Landmark;
  label: string;
  tone?: "default" | "brand" | "rose";
  children: React.ReactNode;
}) {
  const toneMap: Record<string, string> = {
    default: "text-gray-500",
    brand:   "text-brand-600",
    rose:    "text-rose-600",
  };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", toneMap[tone])} />
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
        {label}
      </span>
      <span className="inline-flex items-baseline text-gray-700">{children}</span>
    </span>
  );
}


// ── Transaction row ───────────────────────────────────────────────────────

function TxnRow({
  txn, currency, onCategorize, onIgnore, onUndo,
}: {
  txn: TxnWithBalance;
  currency: string;
  onCategorize: () => void;
  onIgnore: () => Promise<void>;
  onUndo: () => Promise<void>;
}) {
  const amt = parseFloat(txn.amount);
  const quiet = txn.status === "ignored" || txn.status === "matched";

  return (
    <tr className={cn(
      "group transition-colors",
      quiet ? "hover:bg-canvas-50" : "hover:bg-brand-50/30",
      txn.status === "ignored" && "opacity-70",
    )}>
      <td className="pl-5 pr-3 py-2.5 text-xs text-gray-600 whitespace-nowrap tabular-nums">
        {fmtDate(txn.date)}
      </td>
      <td className="pr-4 py-2.5 min-w-0">
        <div className={cn(
          "text-sm text-gray-900 truncate max-w-[44ch] lg:max-w-[60ch]",
          txn.status === "ignored" && "line-through text-gray-500",
        )}>
          {txn.description}
        </div>
      </td>
      <td className={cn(
        "pr-4 py-2.5 text-right font-mono text-xs tabular-nums whitespace-nowrap",
        txn.status === "ignored"
          ? "text-gray-400 line-through"
          : amt >= 0
            ? "text-mint-700 font-semibold"
            : "text-red-600 font-semibold",
      )}>
        {amt >= 0 ? "+" : "−"}{fmt2(Math.abs(amt))}
      </td>
      <td className="pr-4 py-2.5 text-right font-mono text-xs tabular-nums text-gray-600 hidden md:table-cell whitespace-nowrap">
        {fmt2(txn.runningBalance)}
      </td>
      <td className="pr-4 py-2.5">
        <StatusChip status={txn.status} />
      </td>
      <td className="pr-4 py-2.5 hidden lg:table-cell">
        {txn.proposed_je_number ? (
          <Link
            href={`/dashboard/journal-entries/${txn.proposed_journal_entry}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-canvas-200 bg-canvas-50/60 px-2 py-0.5 text-[11px] font-mono text-brand-700 hover:border-brand-200 hover:bg-brand-50/60 transition-colors"
          >
            {txn.proposed_je_number}
            {txn.proposed_je_status && (
              <span className="text-[10px] font-sans text-gray-500 capitalize">
                {fmtLabel(txn.proposed_je_status)}
              </span>
            )}
          </Link>
        ) : (
          <span className="text-[11px] text-gray-300">—</span>
        )}
      </td>
      <td className="pr-5 py-2.5 text-right whitespace-nowrap">
        {txn.status === "new" && (
          <div className="inline-flex items-center gap-1">
            <button
              onClick={onCategorize}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 hover:text-brand-900 transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Create entry
            </button>
            <button
              onClick={onIgnore}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-canvas-100 hover:text-gray-700 transition-colors"
            >
              <Ban className="w-3.5 h-3.5" />
              Ignore
            </button>
          </div>
        )}
        {txn.status === "proposed" && (
          <button
            onClick={onUndo}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-amber-50 hover:text-amber-800 transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Undo
          </button>
        )}
        {(txn.status === "matched" || txn.status === "ignored") && (
          <span className="text-[11px] text-gray-300">—</span>
        )}
      </td>
    </tr>
  );
}


// ── Import modal ──────────────────────────────────────────────────────────

function ImportModal({
  bankAccountId, onClose, onImported, busy, setBusy,
}: {
  bankAccountId: number;
  onClose: () => void;
  onImported: () => Promise<void>;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dateFormat, setDateFormat] = useState("%Y-%m-%d");
  const [mapping, setMapping] = useState({ date: "0", description: "1", amount: "2", balance: "3" });
  const [hasHeader, setHasHeader] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ total_rows: number; imported_rows: number; duplicate_rows: number; error_rows: number; status: string } | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Please select a CSV file."); return; }

    setBusy(true);
    setErr(null);
    setResult(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("date_format", dateFormat);
    fd.append("has_header", hasHeader ? "true" : "false");
    fd.append("column_mapping", JSON.stringify({
      date: Number(mapping.date),
      description: Number(mapping.description),
      amount: Number(mapping.amount),
      balance: Number(mapping.balance),
    }));

    const token = localStorage.getItem("access_token");
    const orgId = localStorage.getItem("organization_id");
    const url = `${API_BASE}/beakon/bank-accounts/${bankAccountId}/import/`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(orgId ? { "X-Organization-ID": orgId } : {}),
        },
        body: fd,
      });
      const body = await r.json();
      if (!r.ok) throw body;
      setResult(body);
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e) || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (result) await onImported();
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-[520px] bg-white rounded-2xl border border-canvas-200 shadow-xl">
        <div className="relative px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white rounded-t-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                Bank feed
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">
                Import CSV statement
              </h2>
              <p className="mt-1 text-xs text-gray-500 max-w-sm">
                Duplicates are detected automatically. Every imported row becomes a proposed
                journal entry that you categorize into an offset account.
              </p>
            </div>
            <button onClick={close} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="p-5 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-700">CSV file <span className="text-rose-500">*</span></span>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="input mt-1" />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="rounded border-canvas-200" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            First row is a header
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Date format</span>
            <input className="input mt-1 font-mono" value={dateFormat}
                   onChange={(e) => setDateFormat(e.target.value)} />
            <span className="text-[11px] text-gray-400 mt-0.5 block">
              Python strftime format. Common: <code>%Y-%m-%d</code>, <code>%m/%d/%Y</code>, <code>%d/%m/%Y</code>
            </span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            <ColumnMapField label="Date col"    value={mapping.date}        onChange={(v) => setMapping((m) => ({ ...m, date: v }))} />
            <ColumnMapField label="Desc col"    value={mapping.description} onChange={(v) => setMapping((m) => ({ ...m, description: v }))} />
            <ColumnMapField label="Amount col"  value={mapping.amount}      onChange={(v) => setMapping((m) => ({ ...m, amount: v }))} />
            <ColumnMapField label="Balance col" value={mapping.balance}     onChange={(v) => setMapping((m) => ({ ...m, balance: v }))} />
          </div>

          {err && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}
          {result && (
            <div className="rounded-lg border border-mint-200 bg-mint-50 p-3 text-xs text-mint-800">
              <div className="font-semibold capitalize">{fmtLabel(result.status)}</div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                <div>Total rows: <span className="font-mono tabular-nums">{result.total_rows}</span></div>
                <div>Imported: <span className="font-mono tabular-nums">{result.imported_rows}</span></div>
                <div>Duplicates: <span className="font-mono tabular-nums">{result.duplicate_rows}</span></div>
                <div>Errors: <span className="font-mono tabular-nums">{result.error_rows}</span></div>
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={close} className="btn-secondary">
              {result ? "Done" : "Cancel"}
            </button>
            {!result && (
              <button type="submit" disabled={busy} className="btn-primary">
                {busy ? "Importing…" : "Import"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function ColumnMapField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-gray-700">{label}</span>
      <input
        type="number"
        min={0}
        className="input mt-1 font-mono text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}


// ── Categorize modal ──────────────────────────────────────────────────────

function CategorizeModal({
  txn, accounts, bankAccountCoa, onClose, onDone,
}: {
  txn: Txn;
  accounts: CoaAccount[];
  bankAccountCoa: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [offsetId, setOffsetId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{
    account_id: number;
    account_code: string;
    account_name: string;
    reasoning: string;
    confidence: number;
    model_used: string;
  } | null>(null);

  // Hide the bank's own COA account from the offset picker (would self-balance).
  const options = accounts.filter((a) => a.id !== bankAccountCoa);

  const askAI = async () => {
    setAiBusy(true);
    setAiErr(null);
    try {
      const r = await api.post<any>(
        `/beakon/bank-transactions/${txn.id}/suggest-categorization/`,
      );
      const suggestion = {
        account_id: r.suggested_account_id,
        account_code: r.suggested_account_code,
        account_name: r.suggested_account_name,
        reasoning: r.reasoning,
        confidence: r.confidence,
        model_used: r.model_used,
      };
      setAiSuggestion(suggestion);
      if (!offsetId) setOffsetId(String(suggestion.account_id));
    } catch (e: any) {
      setAiErr(e?.error?.message || e?.message || "AI suggestion failed");
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async () => {
    if (!offsetId) { setErr("Pick an offset account."); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/beakon/bank-transactions/${txn.id}/categorize/`, {
        offset_account_id: Number(offsetId),
        memo,
      });
      await onDone();
    } catch (e: any) {
      setErr(e?.error?.message || JSON.stringify(e) || "Categorize failed");
    } finally {
      setBusy(false);
    }
  };

  const amt = parseFloat(txn.amount);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white rounded-2xl border border-canvas-200 shadow-xl">
        <div className="relative px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white rounded-t-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                Bank feed
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">
                Create journal entry
              </h2>
              <p className="mt-1 text-xs text-gray-500 max-w-sm">
                Pick an offset account. A draft JE is created and sent through the approval pipe.
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-xl border border-canvas-200/70 bg-canvas-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-gray-500">{fmtDate(txn.date)}</div>
                <div className="mt-0.5 text-sm font-medium text-gray-900 truncate">{txn.description}</div>
              </div>
              <div className={cn(
                "font-mono text-sm tabular-nums font-semibold shrink-0",
                amt >= 0 ? "text-mint-700" : "text-red-600",
              )}>
                {amt >= 0 ? "+" : "−"}{fmt2(Math.abs(amt))} {txn.currency}
              </div>
            </div>
          </div>

          {/* AI suggestion banner */}
          <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50/70 to-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-brand-800 uppercase tracking-[0.08em] inline-flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-brand-600" />
                AI suggestion
              </span>
              {!aiSuggestion && !aiBusy && (
                <button onClick={askAI}
                        className="text-xs bg-brand-700 text-white px-3 py-1 rounded-full hover:bg-brand-800 inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Get AI suggestion
                </button>
              )}
              {aiSuggestion && !aiBusy && (
                <button onClick={askAI}
                        className="text-[11px] text-brand-700 hover:text-brand-900">
                  ↻ regenerate
                </button>
              )}
              {aiBusy && (
                <span className="text-xs text-brand-700 inline-flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />
                  Reading…
                </span>
              )}
            </div>
            {aiErr && (
              <div className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-1.5">
                {aiErr}
              </div>
            )}
            {aiSuggestion && (
              <div className="mt-2 text-xs">
                <div className="text-gray-900">
                  <span className="font-mono text-[11px] text-gray-500">{aiSuggestion.account_code}</span>{" "}
                  <span className="font-medium">{aiSuggestion.account_name}</span>
                  <span className={cn(
                    "ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium",
                    aiSuggestion.confidence >= 0.7 ? "bg-mint-100 text-mint-800" :
                    aiSuggestion.confidence >= 0.4 ? "bg-yellow-100 text-yellow-800" :
                                                      "bg-red-100 text-red-800",
                  )}>
                    conf {(aiSuggestion.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 italic mt-0.5">
                  {aiSuggestion.reasoning}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  via {aiSuggestion.model_used}
                </div>
              </div>
            )}
            {!aiSuggestion && !aiBusy && !aiErr && (
              <p className="mt-1 text-[11px] text-gray-500">
                Local Ollama reads the description + amount and picks the best offset account.
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-700">
              Offset account <span className="text-rose-500">*</span>
            </span>
            <select className="input mt-1" value={offsetId}
                    onChange={(e) => setOffsetId(e.target.value)}>
              <option value="">— pick one —</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name} ({a.account_type})
                </option>
              ))}
            </select>
            <span className="text-[11px] text-gray-400 block mt-0.5">
              {amt < 0
                ? "Money leaving the bank. Offset is typically an expense."
                : "Money entering the bank. Offset is typically revenue or a receivable."}
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-700">Memo <span className="text-gray-400 font-normal">(optional)</span></span>
            <input className="input mt-1" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>

          {err && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={submit} disabled={busy || !offsetId} className="btn-primary">
              {busy ? "Saving…" : "Create draft JE"}
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            A draft journal entry is created. It must be submitted and approved by a different user before it posts.
          </p>
        </div>
      </div>
    </div>
  );
}
