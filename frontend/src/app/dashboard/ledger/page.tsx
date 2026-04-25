"use client";

/* Ledger — flat line-level view across every journal entry in the org.
 *
 * Backs the blueprint's "journal listing / running log of every posted
 * line" Phase 1 deliverable. Each row is one JournalLine with entity,
 * account, date, memo, debit, credit, currency, and a click-through
 * to the parent journal entry.
 *
 * Filters: entity, account, date range, posted-only, status.
 * Summary: running totals (Dr, Cr) + row count.
 * Default view shows posted + pending_approval + approved (everything
 * that's more than a scratch draft) so the page is useful on first load.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Search, X, Command, AlertCircle, BookOpen, Hash,
  Building2, ListTree, Calendar, CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";


interface Line {
  line_id: number;
  journal_entry_id: number;
  entry_number: string;
  date: string;
  entity_id: number;
  entity_code: string;
  entity_name: string;
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  memo: string;
  status: string;
  source_type: string;
  debit: string;
  credit: string;
  native_currency: string;
  native_debit: string;
  native_credit: string;
  exchange_rate: string;
  functional_currency: string;
  counterparty_entity: string | null;
}

interface Entity   { id: number; code: string; name: string; entity_type: string; }
interface Account  { id: number; code: string; name: string; account_type: string; entity: number | null; }

const STATUS_META: Record<string, { label: string; chip: string; dot: string }> = {
  draft:            { label: "Draft",            chip: "bg-gray-100 text-gray-700 ring-gray-200",           dot: "bg-gray-400" },
  pending_approval: { label: "Pending approval", chip: "bg-amber-50 text-amber-800 ring-amber-100",         dot: "bg-amber-500" },
  approved:         { label: "Approved",         chip: "bg-indigo-50 text-indigo-700 ring-indigo-100",      dot: "bg-indigo-500" },
  posted:           { label: "Posted",           chip: "bg-mint-50 text-mint-700 ring-mint-200/80",         dot: "bg-mint-500" },
  rejected:         { label: "Rejected",         chip: "bg-rose-50 text-rose-700 ring-rose-100",            dot: "bg-rose-500" },
  reversed:         { label: "Reversed",         chip: "bg-gray-100 text-gray-600 ring-gray-200",           dot: "bg-gray-400" },
};


export default function LedgerPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter state
  const [query, setQuery]       = useState("");
  const [entityId, setEntityId] = useState<string>("all");
  const [acctId, setAcctId]     = useState<string>("all");
  const [onlyPosted, setOnlyPosted] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");

  // Filter reference data
  const [entities, setEntities] = useState<Entity[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const searchRef = useRef<HTMLInputElement>(null);

  // ── Load reference data once ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [e, a] = await Promise.all([
          api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/?is_active=true"),
          api.get<{ results: Account[] } | Account[]>("/beakon/accounts/?is_active=true"),
        ]);
        setEntities(Array.isArray(e) ? e : (e.results ?? []));
        setAccounts(Array.isArray(a) ? a : (a.results ?? []));
      } catch {
        // Reference data is non-critical — the page still works with raw filters.
      }
    })();
  }, []);

  // ── Load lines when filters change ───────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const p: Record<string, string> = { limit: "500" };
      if (entityId !== "all") p.entity_id = entityId;
      if (acctId   !== "all") p.account_id = acctId;
      if (dateFrom)           p.date_from = dateFrom;
      if (dateTo)             p.date_to   = dateTo;
      if (onlyPosted)         p.only_posted = "true";

      const r = await api.get<{ lines: Line[]; count: number }>(
        "/beakon/reports/lines-listing/", p,
      );
      setLines(r.lines ?? []);
    } catch (e: any) {
      setLoadError(typeof e?.detail === "string" ? e.detail : "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  }, [entityId, acctId, dateFrom, dateTo, onlyPosted]);

  useEffect(() => { void load(); }, [load]);

  // ── Client-side search (memo / entry / account) ──────────────────────
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return lines;
    return lines.filter((ln) => {
      const hay = `${ln.entry_number} ${ln.memo} ${ln.entity_code} ${ln.account_code} ${ln.account_name}`.toLowerCase();
      return hay.includes(q);
    });
  }, [lines, q]);

  // ── Derived summary numbers ──────────────────────────────────────────
  const totals = useMemo(() => {
    let dr = 0, cr = 0;
    const entitySet = new Set<string>();
    const accountSet = new Set<string>();
    for (const ln of filtered) {
      dr += parseFloat(ln.debit || "0");
      cr += parseFloat(ln.credit || "0");
      if (ln.entity_code) entitySet.add(ln.entity_code);
      if (ln.account_code) accountSet.add(ln.account_code);
    }
    return { dr, cr, entities: entitySet.size, accounts: accountSet.size };
  }, [filtered]);

  const activeFilterCount =
    (entityId !== "all" ? 1 : 0) +
    (acctId !== "all" ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (!onlyPosted ? 1 : 0) +
    (q ? 1 : 0);

  function resetFilters() {
    setQuery("");
    setEntityId("all");
    setAcctId("all");
    setDateFrom("");
    setDateTo("");
    setOnlyPosted(true);
  }

  // Keyboard: / and ⌘K focus the search.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      const inField = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return;
      }
      if (inField) return;
      if (e.key === "/") {
        e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Filter account options by the currently-selected entity.
  const accountOptions = useMemo(() => {
    if (entityId === "all") return accounts;
    const ent = Number(entityId);
    return accounts.filter((a) => a.entity === null || a.entity === ent);
  }, [accounts, entityId]);

  return (
    <div>
      <PageHeader
        title="Ledger"
        description={
          <>
            Every journal line in the organization, flat. The blueprint's running log —
            one row per posted debit or credit, traceable back to the entry and the source.
          </>
        }
        context={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-700 ring-1 ring-inset ring-brand-100">
            <BookOpen className="h-3 w-3" />
            Phase 1 · journal listing
          </span>
        }
      />

      {/* Summary */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat
          label="Lines in view"
          value={filtered.length}
          hint={onlyPosted ? "Posted only" : "All statuses"}
          icon={Hash}
          tone="brand"
        />
        <SummaryStat
          label="Total debits"
          value={fmt2(totals.dr)}
          hint="Functional currency"
          icon={CheckCircle2}
          tone="mint"
        />
        <SummaryStat
          label="Total credits"
          value={fmt2(totals.cr)}
          hint={Math.abs(totals.dr - totals.cr) < 0.01 ? "Balanced" : `Imbalance ${fmt2(Math.abs(totals.dr - totals.cr))}`}
          icon={CheckCircle2}
          tone="indigo"
        />
        <SummaryStat
          label="Accounts / entities"
          value={`${totals.accounts} / ${totals.entities}`}
          hint="Distinct touched"
          icon={Building2}
          tone="amber"
        />
      </div>

      {/* Toolbar */}
      <div className="mt-5 rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memo, entry number, account code or name"
              className="w-full h-10 pl-9 pr-20 rounded-xl border border-canvas-200 bg-white text-sm placeholder-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none transition"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-canvas-50" aria-label="Clear search">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded-md border border-canvas-200 bg-canvas-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 sm:inline-flex">
                <Command className="h-2.5 w-2.5" /> K
              </kbd>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-10 rounded-xl border border-canvas-200 bg-white text-sm px-3 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none"
              value={entityId}
              onChange={(e) => { setEntityId(e.target.value); setAcctId("all"); }}
            >
              <option value="all">All entities</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>

            <select
              className="h-10 rounded-xl border border-canvas-200 bg-white text-sm px-3 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none max-w-[220px]"
              value={acctId}
              onChange={(e) => setAcctId(e.target.value)}
            >
              <option value="all">All accounts</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Secondary rail — date range + only-posted toggle */}
        <div className="flex flex-wrap items-center gap-2 border-t border-canvas-100 px-3 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mr-1 inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Range
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 rounded-lg border border-canvas-200 bg-white text-xs px-2 focus:border-brand-400 focus:ring-2 focus:ring-brand-50 outline-none"
          />
          <span className="text-gray-400 text-xs">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 rounded-lg border border-canvas-200 bg-white text-xs px-2 focus:border-brand-400 focus:ring-2 focus:ring-brand-50 outline-none"
          />

          <span className="mx-2 h-4 w-px bg-canvas-200" />

          <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-canvas-200"
              checked={onlyPosted}
              onChange={(e) => setOnlyPosted(e.target.checked)}
            />
            Posted lines only
          </label>

          {activeFilterCount > 0 && (
            <>
              <span className="mx-2 h-4 w-px bg-canvas-200" />
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-brand-700 font-medium hover:text-brand-900 hover:underline"
              >
                Reset filters
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col className="w-[96px]" />                         {/* Date */}
              <col className="w-[80px] hidden sm:table-column" />  {/* Entry */}
              <col className="w-[92px]" />                         {/* Entity */}
              <col />                                              {/* Account (flex) */}
              <col className="hidden lg:table-column" />           {/* Memo (flex on lg+) */}
              <col className="w-[96px]" />                         {/* Debit */}
              <col className="w-[96px]" />                         {/* Credit */}
              <col className="w-[116px]" />                        {/* Status */}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-canvas-50/80 backdrop-blur border-b border-canvas-200/70">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                <th className="pl-5 pr-2 py-2 font-semibold">Date</th>
                <th className="pr-2 py-2 font-semibold hidden sm:table-cell">Entry</th>
                <th className="pr-3 py-2 font-semibold">Entity</th>
                <th className="pr-3 py-2 font-semibold">Account</th>
                <th className="pr-3 py-2 font-semibold hidden lg:table-cell">Memo</th>
                <th className="pr-3 py-2 font-semibold text-right">Debit</th>
                <th className="pr-3 py-2 font-semibold text-right">Credit</th>
                <th className="pr-5 py-2 font-semibold">Status</th>
              </tr>
            </thead>

            {loading ? (
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} columns={8} />)}
              </tbody>
            ) : loadError ? (
              <tbody>
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      tone="warning"
                      icon={AlertCircle}
                      title="Couldn't load ledger"
                      description={loadError}
                      primaryAction={{ label: "Retry", onClick: () => void load() }}
                      className="border-0 shadow-none rounded-none"
                    />
                  </td>
                </tr>
              </tbody>
            ) : filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      icon={lines.length === 0 ? BookOpen : Search}
                      title={lines.length === 0 ? "No ledger lines yet" : "No lines match these filters"}
                      description={
                        lines.length === 0
                          ? "Once journal entries are posted, every line appears here — one row per debit or credit across every entity and account."
                          : "Try widening the date range, clearing search, or turning off 'Posted lines only' to see drafts."
                      }
                      primaryAction={activeFilterCount > 0 ? { label: "Reset filters", onClick: resetFilters } : undefined}
                      className="border-0 shadow-none rounded-none"
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((ln) => <LineRow key={ln.line_id} line={ln} />)}
              </tbody>
            )}
          </table>
        </div>

        {!loading && filtered.length > 0 && filtered.length >= 500 && (
          <div className="border-t border-canvas-100 bg-canvas-50/50 px-4 py-2 text-[11px] text-gray-500">
            Showing the first 500 lines matching your filter. Narrow the range or pick an account
            to see more.
          </div>
        )}
      </div>
    </div>
  );
}


function LineRow({ line }: { line: Line }) {
  const dr = parseFloat(line.debit || "0");
  const cr = parseFloat(line.credit || "0");
  const meta = STATUS_META[line.status] || STATUS_META.draft;
  const showNative = line.native_currency && line.native_currency !== line.functional_currency;
  const nDr = parseFloat(line.native_debit || "0");
  const nCr = parseFloat(line.native_credit || "0");

  return (
    <tr className="group hover:bg-brand-50/30 transition-colors">
      <td className="pl-5 pr-2 py-2 text-xs text-gray-700 tabular-nums whitespace-nowrap truncate">
        {fmtDate(line.date)}
      </td>
      <td className="pr-2 py-2 hidden sm:table-cell truncate">
        <Link
          href={`/dashboard/journal-entries/${line.journal_entry_id}`}
          className="inline-flex items-center rounded-md border border-canvas-200 bg-canvas-50/60 px-1.5 py-0.5 text-[11px] font-mono text-brand-700 hover:border-brand-200 hover:bg-brand-50/60 transition-colors"
        >
          {line.entry_number}
        </Link>
      </td>
      <td className="pr-3 py-2 whitespace-nowrap truncate">
        <Link
          href={`/dashboard/entities/${line.entity_id}`}
          className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-brand-800"
          title={line.entity_name}
        >
          <Building2 className="h-3 w-3 text-gray-400 shrink-0" />
          <span className="font-medium truncate">{line.entity_code}</span>
        </Link>
      </td>
      <td className="pr-3 py-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0" title={`${line.account_code} · ${line.account_name}`}>
          <ListTree className="h-3 w-3 text-gray-400 shrink-0" />
          <span className="font-mono text-[11px] text-gray-500 shrink-0">{line.account_code}</span>
          <span className="text-xs text-gray-800 truncate">{line.account_name}</span>
        </div>
      </td>
      <td className="pr-3 py-2 text-xs text-gray-600 hidden lg:table-cell min-w-0">
        <div className="truncate" title={line.memo || ""}>{line.memo || "—"}</div>
      </td>
      <td className="pr-3 py-2 text-right whitespace-nowrap">
        {dr > 0 ? (
          <div>
            <div className="font-mono text-xs tabular-nums font-semibold text-gray-900">{fmt2(dr)}</div>
            {showNative && nDr > 0 && (
              <div className="font-mono text-[10px] tabular-nums text-gray-400">
                {fmt2(nDr)} {line.native_currency}
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="pr-3 py-2 text-right whitespace-nowrap">
        {cr > 0 ? (
          <div>
            <div className="font-mono text-xs tabular-nums font-semibold text-gray-900">{fmt2(cr)}</div>
            {showNative && nCr > 0 && (
              <div className="font-mono text-[10px] tabular-nums text-gray-400">
                {fmt2(nCr)} {line.native_currency}
              </div>
            )}
          </div>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="pr-5 py-2 whitespace-nowrap">
        <span className={cn(
          "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset",
          meta.chip,
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
      </td>
    </tr>
  );
}
