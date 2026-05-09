"use client";

/* Recognition rules — multi-period revenue/expense allocation.
 *
 * Founder-paper Nov–Apr $1,000 example: pay $1,000 in Nov for service
 * running Nov–Apr → recognise $166.67/mo. The engine pre-builds the
 * schedule and posts a balanced JE per period when "Run" is clicked.
 *
 * Visual vocabulary matches /dashboard/fx-rates and /dashboard/bank:
 * PageHeader, SummaryStat strip, FilterChip rail, sticky-header table,
 * drawer for create.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Plus, X, Repeat, Play, Ban, Search, Calendar,
  AlertCircle, CheckCircle2, Clock, Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel, fmtMoneyLead } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";

interface Entity { id: number; code: string; name: string; functional_currency: string; }
interface Account { id: number; code: string; name: string; account_type: string; account_subtype: string; }

interface SchedulePeriod {
  id: number;
  sequence: number;
  period_start: string;
  period_end: string;
  amount: string;
  posted_journal_entry: number | null;
  posted_journal_entry_number: string | null;
  is_posted: boolean;
}

interface RuleSummary {
  id: number;
  code: string;
  name: string;
  entity: number;
  entity_code: string;
  rule_type: string;
  currency: string;
  total_amount: string;
  recognized_to_date: string;
  remaining_amount: string;
  start_date: string;
  end_date: string;
  period_type: string;
  method: string;
  deferral_account: number;
  deferral_account_code: string;
  recognition_account: number;
  recognition_account_code: string;
  status: string;
}

interface RuleDetail extends RuleSummary {
  schedule: SchedulePeriod[];
  notes: string;
}

const RULE_TYPES = [
  { value: "PREPAID_EXPENSE", label: "Prepaid expense" },
  { value: "DEFERRED_REVENUE", label: "Deferred revenue" },
  { value: "ACCRUED_EXPENSE", label: "Accrued expense" },
  { value: "ACCRUED_REVENUE", label: "Accrued revenue" },
];

const PERIOD_TYPES = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUAL", label: "Annual" },
];

const METHODS = [
  { value: "STRAIGHT_LINE_BY_PERIOD", label: "Straight line per period" },
  { value: "STRAIGHT_LINE_BY_DAY", label: "Straight line by day" },
];

/* Type colour-coding — prepaid/accrued use balance-sheet tones,
 * deferred/accrued revenue use P&L tones. */
const TYPE_TONE: Record<string, string> = {
  PREPAID_EXPENSE:  "bg-indigo-50 text-indigo-700 ring-indigo-100",
  DEFERRED_REVENUE: "bg-mint-50 text-mint-700 ring-mint-100",
  ACCRUED_EXPENSE:  "bg-amber-50 text-amber-700 ring-amber-100",
  ACCRUED_REVENUE:  "bg-emerald-50 text-emerald-700 ring-emerald-100",
};
const TYPE_TONE_DEFAULT = "bg-canvas-100 text-gray-600 ring-canvas-200";

function statusPill(status: string) {
  const tone =
    status === "ACTIVE"    ? "bg-brand-50 text-brand-700 ring-brand-100" :
    status === "COMPLETED" ? "bg-mint-50 text-mint-700 ring-mint-100" :
    status === "CANCELLED" ? "bg-canvas-100 text-gray-500 ring-canvas-200" :
                             "bg-canvas-100 text-gray-500 ring-canvas-200";
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
      tone,
    )}>
      {fmtLabel(status)}
    </span>
  );
}


export default function RecognitionPage() {
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RuleDetail | null>(null);
  const [runFor, setRunFor] = useState<RuleSummary | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [rs, es, as_] = await Promise.all([
      api.get<{ results: RuleSummary[] } | RuleSummary[]>("/beakon/recognition-rules/")
        .then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
        .then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
      api.get<{ results: Account[] } | Account[]>("/beakon/accounts/")
        .then((d) => Array.isArray(d) ? d : (d.results ?? [])).catch(() => []),
    ]);
    setRules(rs);
    setEntities(es);
    setAccounts(as_);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const openRule = async (id: number) => {
    setOpenId(id);
    setDetail(null);
    try {
      const d = await api.get<RuleDetail>(`/beakon/recognition-rules/${id}/`);
      setDetail(d);
    } catch (e: any) {
      setFeedback({ kind: "err", msg: e?.error?.message || "Failed to load rule" });
    }
  };

  const cancelRule = async (rule: RuleSummary) => {
    if (!confirm(`Cancel rule ${rule.code}? Pending schedule rows will be marked CANCELLED.`)) return;
    try {
      await api.post(`/beakon/recognition-rules/${rule.id}/cancel/`, { reason: "" });
      setFeedback({ kind: "ok", msg: `Rule ${rule.code} cancelled.` });
      await load();
      if (openId === rule.id) await openRule(rule.id);
    } catch (e: any) {
      setFeedback({ kind: "err", msg: e?.error?.message || "Failed" });
    }
  };

  // ── Stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const ccyTotals: Record<string, { total: number; recognised: number; remaining: number }> = {};
    let pendingPeriods = 0;
    let active = 0, completed = 0, cancelled = 0;
    for (const r of rules) {
      if (r.status === "ACTIVE")    active += 1;
      if (r.status === "COMPLETED") completed += 1;
      if (r.status === "CANCELLED") cancelled += 1;
      const ccy = r.currency || "—";
      const slot = ccyTotals[ccy] ?? { total: 0, recognised: 0, remaining: 0 };
      slot.total      += Number(r.total_amount || 0);
      slot.recognised += Number(r.recognized_to_date || 0);
      slot.remaining  += Number(r.remaining_amount || 0);
      ccyTotals[ccy]   = slot;
    }
    if (detail) {
      pendingPeriods = detail.schedule.filter((p) => !p.is_posted).length;
    }
    // Dominant currency for the headline number
    const ccyEntries = Object.entries(ccyTotals).sort((a, b) => b[1].total - a[1].total);
    const headlineCcy = ccyEntries[0]?.[0] ?? "";
    const headlineRecognised = ccyEntries[0]?.[1].recognised ?? 0;
    const headlineRemaining  = ccyEntries[0]?.[1].remaining  ?? 0;
    return {
      total: rules.length, active, completed, cancelled,
      ccyEntries, headlineCcy, headlineRecognised, headlineRemaining,
      pendingPeriods,
    };
  }, [rules, detail]);

  // ── Filtered ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (typeFilter && r.rule_type !== typeFilter) return false;
      if (q) {
        const blob = `${r.code} ${r.name} ${r.entity_code}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rules, search, statusFilter, typeFilter]);

  return (
    <div>
      <PageHeader
        title="Recognition rules"
        description="Spread one amount across multiple periods — prepaid expense, deferred revenue, accrued income/expense. The engine pre-builds the schedule and posts a balanced JE per period when you run it."
        context={
          <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
            <Repeat className="h-3.5 w-3.5 text-brand-600" />
            <span className="font-medium text-gray-800">
              {stats.active} active
            </span>
            <span className="text-gray-300">·</span>
            <span className="tabular-nums">{rules.length} total</span>
          </div>
        }
        actions={
          <button onClick={() => setDrawer(true)} className="btn-primary" disabled={entities.length === 0}>
            <Plus className="w-4 h-4 mr-1.5" /> New rule
          </button>
        }
      />

      {/* ── Feedback strip ────────────────────────────────────────── */}
      {feedback && (
        <div className={cn(
          "mt-4 rounded-lg border p-3 flex items-start gap-2 text-xs",
          feedback.kind === "ok"
            ? "border-emerald-200 bg-emerald-50"
            : "border-rose-200 bg-rose-50",
        )}>
          {feedback.kind === "ok"
            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            : <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />}
          <div className={cn(
            "flex-1",
            feedback.kind === "ok" ? "text-emerald-800" : "text-rose-800",
          )}>{feedback.msg}</div>
          <button
            onClick={() => setFeedback(null)}
            className={feedback.kind === "ok"
              ? "text-emerald-400 hover:text-emerald-700"
              : "text-rose-400 hover:text-rose-700"}
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Summary tiles ─────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat
          label="Active rules"
          value={stats.active}
          hint={`${stats.completed} completed · ${stats.cancelled} cancelled`}
          icon={Repeat}
          tone="brand"
        />
        <SummaryStat
          label="Recognised to date"
          value={stats.headlineCcy
            ? fmtMoneyLead(stats.headlineRecognised, stats.headlineCcy)
            : "—"}
          hint={
            stats.ccyEntries.length > 1
              ? `+${stats.ccyEntries.length - 1} more currenc${stats.ccyEntries.length - 1 === 1 ? "y" : "ies"}`
              : "Sum of posted schedule rows"
          }
          icon={CheckCircle2}
          tone="mint"
        />
        <SummaryStat
          label="Remaining"
          value={stats.headlineCcy
            ? fmtMoneyLead(stats.headlineRemaining, stats.headlineCcy)
            : "—"}
          hint="Yet to be posted across active rules"
          icon={Clock}
          tone="amber"
        />
        <SummaryStat
          label="Currencies"
          value={stats.ccyEntries.length || "—"}
          hint={stats.ccyEntries.map(([c]) => c).join(" · ") || "—"}
          icon={Wallet}
        />
      </div>

      {/* ── Filters ───────────────────────────────────────────────── */}
      <div className="mt-5 mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, name, or entity…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-canvas-200 bg-white focus:border-brand-300 focus:outline-none"
          />
        </div>
        <FilterChip active={!statusFilter} onClick={() => setStatusFilter("")}>
          All statuses
        </FilterChip>
        <FilterChip
          active={statusFilter === "ACTIVE"}
          onClick={() => setStatusFilter(statusFilter === "ACTIVE" ? "" : "ACTIVE")}
          count={stats.active}
        >
          Active
        </FilterChip>
        <FilterChip
          active={statusFilter === "COMPLETED"}
          onClick={() => setStatusFilter(statusFilter === "COMPLETED" ? "" : "COMPLETED")}
          count={stats.completed}
        >
          Completed
        </FilterChip>
        <FilterChip
          active={statusFilter === "CANCELLED"}
          onClick={() => setStatusFilter(statusFilter === "CANCELLED" ? "" : "CANCELLED")}
          count={stats.cancelled}
        >
          Cancelled
        </FilterChip>
        <span className="ml-auto text-xs text-gray-400 tabular-nums">
          {loading ? "loading…" : `${filtered.length} of ${rules.length}`}
        </span>
      </div>
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Type:</span>
        <FilterChip active={!typeFilter} onClick={() => setTypeFilter("")}>All</FilterChip>
        {RULE_TYPES.map((t) => (
          <FilterChip
            key={t.value}
            active={typeFilter === t.value}
            onClick={() => setTypeFilter(typeFilter === t.value ? "" : t.value)}
          >
            {t.label}
          </FilterChip>
        ))}
        {(search || statusFilter || typeFilter) && (
          <button
            onClick={() => { setSearch(""); setStatusFilter(""); setTypeFilter(""); }}
            className="text-xs text-gray-400 hover:text-gray-700 underline ml-1"
          >
            Clear all
          </button>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {loading ? (
          <table className="w-full text-sm">
            <tbody>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={8} />)}</tbody>
          </table>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="No recognition rules yet"
            description="Use these to spread a prepayment, deferred revenue, accrual, or amortisation across multiple periods. The engine builds the schedule and posts JEs on a click."
            primaryAction={{
              label: "New rule",
              icon: Plus,
              onClick: () => setDrawer(true),
            }}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No rules match these filters"
            description="Try clearing the search or chips above."
            primaryAction={{
              label: "Clear filters",
              onClick: () => { setSearch(""); setStatusFilter(""); setTypeFilter(""); },
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Code</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Window</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Recognised</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Remaining</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openRule(r.id)}
                    className="hover:bg-canvas-50 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700 whitespace-nowrap">
                      {r.code}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{r.name}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{r.entity_code}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                        TYPE_TONE[r.rule_type] ?? TYPE_TONE_DEFAULT,
                      )}>
                        {fmtLabel(r.rule_type)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-gray-500">
                      {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {fmtMoneyLead(r.total_amount, r.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-mint-700 whitespace-nowrap">
                      {fmt2(r.recognized_to_date)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-700 whitespace-nowrap">
                      {fmt2(r.remaining_amount)}
                    </td>
                    <td className="px-4 py-2.5">{statusPill(r.status)}</td>
                    <td
                      className="px-4 py-2.5 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.status === "ACTIVE" ? (
                        <div className="inline-flex gap-1.5">
                          <button
                            onClick={() => setRunFor(r)}
                            className="inline-flex items-center text-xs text-brand-700 hover:underline"
                            title="Post pending periods up to a date"
                          >
                            <Play className="w-3 h-3 mr-0.5" />Run
                          </button>
                          <span className="text-gray-300">·</span>
                          <button
                            onClick={() => cancelRule(r)}
                            className="inline-flex items-center text-xs text-rose-700 hover:underline"
                            title="Mark rule cancelled"
                          >
                            <Ban className="w-3 h-3 mr-0.5" />Cancel
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Help footnote ─────────────────────────────────────────── */}
      {!loading && rules.length > 0 && (
        <div className="mt-3 text-[11px] text-gray-400">
          Click any row to open the schedule. "Run" posts a balanced JE for every
          pending period whose end date is ≤ the as-of date you pick.
        </div>
      )}

      {/* ── Drawers / modals ──────────────────────────────────────── */}
      {drawer && (
        <RuleDrawer
          entities={entities}
          accounts={accounts}
          onClose={() => setDrawer(false)}
          onCreated={async () => {
            setDrawer(false);
            setFeedback({ kind: "ok", msg: "Rule created. Schedule generated." });
            await load();
          }}
        />
      )}
      {openId && detail && (
        <RuleDetailDrawer
          rule={detail}
          onClose={() => { setOpenId(null); setDetail(null); }}
        />
      )}
      {runFor && (
        <RunRuleModal
          rule={runFor}
          onCancel={() => setRunFor(null)}
          onConfirm={async (asOf) => {
            try {
              const r = await api.post<{ posted_count: number; completed_now: boolean }>(
                `/beakon/recognition-rules/${runFor.id}/run/`,
                { as_of: asOf },
              );
              setFeedback({
                kind: "ok",
                msg: `Posted ${r.posted_count} JE${r.posted_count === 1 ? "" : "s"}.${
                  r.completed_now ? " Rule is now COMPLETED." : ""
                }`,
              });
              setRunFor(null);
              await load();
              if (openId === runFor.id) await openRule(runFor.id);
            } catch (e: any) {
              setFeedback({ kind: "err", msg: e?.error?.message || "Failed" });
              setRunFor(null);
            }
          }}
        />
      )}
    </div>
  );
}


/* ────────────────────────────────────────────────────────────────── */
/*  Run-rule modal — replaces window.prompt                            */
/* ────────────────────────────────────────────────────────────────── */
function RunRuleModal({
  rule, onConfirm, onCancel,
}: {
  rule: RuleSummary;
  onConfirm: (asOf: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-white shadow-2xl border border-canvas-200">
        <div className="p-5 border-b border-canvas-100">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
              <Play className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Run recognition</h2>
              <p className="text-xs text-gray-500">{rule.code} · {rule.name}</p>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-600">
            All <span className="font-semibold">pending</span> schedule rows whose
            period ends on or before this date will post as balanced JEs.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Recognise through</span>
            <div className="relative mt-1">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="input pl-9"
                autoFocus
              />
            </div>
            <div className="mt-1.5 text-[11px] text-gray-400">
              Window: {fmtDate(rule.start_date)} → {fmtDate(rule.end_date)}
            </div>
          </label>
        </div>
        <div className="px-5 py-3 border-t border-canvas-100 flex justify-end gap-2 bg-canvas-50/40 rounded-b-2xl">
          <button onClick={onCancel} className="btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button
            onClick={async () => { setBusy(true); await onConfirm(asOf); }}
            disabled={busy || !asOf}
            className="btn-primary text-sm"
          >
            {busy ? "Posting…" : "Post pending JEs"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ────────────────────────────────────────────────────────────────── */
/*  Create rule drawer                                                  */
/* ────────────────────────────────────────────────────────────────── */
function RuleDrawer({
  entities, accounts, onClose, onCreated,
}: {
  entities: Entity[];
  accounts: Account[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    entity: entities[0]?.id?.toString() || "",
    code: "",
    name: "",
    rule_type: "PREPAID_EXPENSE",
    total_amount: "",
    currency: entities[0]?.functional_currency || "CHF",
    start_date: today,
    end_date: today,
    period_type: "MONTHLY",
    method: "STRAIGHT_LINE_BY_PERIOD",
    deferral_account: "",
    recognition_account: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sync currency to the selected entity's functional currency.
  useEffect(() => {
    const e = entities.find((x) => x.id.toString() === form.entity);
    if (e && e.functional_currency && form.currency !== e.functional_currency) {
      setForm((f) => ({ ...f, currency: e.functional_currency }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.entity]);

  // Quick preview: number of monthly periods between start and end.
  const previewPeriods = useMemo(() => {
    if (!form.start_date || !form.end_date) return null;
    const a = new Date(form.start_date), b = new Date(form.end_date);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null;
    if (form.period_type === "MONTHLY") {
      return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
    }
    if (form.period_type === "QUARTERLY") {
      const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
      return Math.ceil(months / 3);
    }
    return Math.max(1, b.getFullYear() - a.getFullYear() + 1);
  }, [form.start_date, form.end_date, form.period_type]);

  const previewPerPeriod = useMemo(() => {
    const n = Number(form.total_amount);
    if (!previewPeriods || !Number.isFinite(n) || previewPeriods === 0) return null;
    return n / previewPeriods;
  }, [previewPeriods, form.total_amount]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post("/beakon/recognition-rules/", {
        entity: Number(form.entity),
        code: form.code.trim(),
        name: form.name.trim(),
        rule_type: form.rule_type,
        total_amount: form.total_amount,
        currency: form.currency,
        start_date: form.start_date,
        end_date: form.end_date,
        period_type: form.period_type,
        method: form.method,
        deferral_account: Number(form.deferral_account),
        recognition_account: Number(form.recognition_account),
        notes: form.notes,
      });
      await onCreated();
    } catch (e: any) {
      setErr(e?.error?.message || e?.detail || JSON.stringify(e) || "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full sm:w-[520px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-canvas-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">New recognition rule</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              The engine will auto-build a {form.period_type.toLowerCase()} schedule and
              post a balanced JE per period when you click Run.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Entity *</span>
            <select className="input mt-1" required value={form.entity}
                    onChange={(e) => setForm((f) => ({ ...f, entity: e.target.value }))}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Code *</span>
              <input className="input mt-1" required value={form.code}
                     onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                     placeholder="PREPAID-INS-NOV2025" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Type *</span>
              <select className="input mt-1" value={form.rule_type}
                      onChange={(e) => setForm((f) => ({ ...f, rule_type: e.target.value }))}>
                {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Name *</span>
            <input className="input mt-1" required value={form.name}
                   onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                   placeholder="Insurance amortisation Nov 2025 – Apr 2026" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block col-span-2">
              <span className="text-xs font-medium text-gray-600">Total amount *</span>
              <input className="input mt-1 text-right tabular-nums" type="number" step="0.01" required
                     value={form.total_amount}
                     onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Currency *</span>
              <input className="input mt-1 uppercase" maxLength={3} required value={form.currency}
                     onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Start *</span>
              <input className="input mt-1" type="date" required value={form.start_date}
                     onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">End *</span>
              <input className="input mt-1" type="date" required value={form.end_date}
                     onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Period</span>
              <select className="input mt-1" value={form.period_type}
                      onChange={(e) => setForm((f) => ({ ...f, period_type: e.target.value }))}>
                {PERIOD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Method</span>
              <select className="input mt-1" value={form.method}
                      onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                {METHODS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>

          {/* Live preview */}
          {previewPeriods && previewPerPeriod !== null && (
            <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-xs text-brand-900">
              <div className="font-semibold mb-0.5">Preview</div>
              <div>
                {previewPeriods} {fmtLabel(form.period_type).toLowerCase()} period{previewPeriods === 1 ? "" : "s"}
                {" · "}
                <span className="tabular-nums font-mono">
                  {fmtMoneyLead(previewPerPeriod, form.currency)}
                </span> per period
              </div>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-gray-600">
              Deferral account * <span className="font-normal text-gray-400">(prepaid/accrued — balance sheet)</span>
            </span>
            <select className="input mt-1" required value={form.deferral_account}
                    onChange={(e) => setForm((f) => ({ ...f, deferral_account: e.target.value }))}>
              <option value="">— pick —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">
              Recognition account * <span className="font-normal text-gray-400">(P&L — expense or revenue)</span>
            </span>
            <select className="input mt-1" required value={form.recognition_account}
                    onChange={(e) => setForm((f) => ({ ...f, recognition_account: e.target.value }))}>
              <option value="">— pick —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Notes</span>
            <textarea className="input mt-1" rows={2} value={form.notes}
                      onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          {err && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}
        </form>
        <div className="px-5 py-3 border-t border-canvas-100 flex justify-end gap-2 bg-canvas-50/40 sticky bottom-0">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={submit as any} disabled={busy} className="btn-primary text-sm">
            {busy ? "Creating…" : "Create rule + schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ────────────────────────────────────────────────────────────────── */
/*  Detail drawer — rule + full schedule                                */
/* ────────────────────────────────────────────────────────────────── */
function RuleDetailDrawer({ rule, onClose }: { rule: RuleDetail; onClose: () => void }) {
  const total       = Number(rule.total_amount || 0);
  const recognised  = Number(rule.recognized_to_date || 0);
  const remaining   = Number(rule.remaining_amount || 0);
  const pct         = total > 0 ? Math.min(100, Math.round((recognised / total) * 100)) : 0;
  const postedCount = rule.schedule.filter((p) => p.is_posted).length;

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full sm:w-[680px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-canvas-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 truncate">{rule.code}</h2>
              {statusPill(rule.status)}
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{rule.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Progress */}
          <div>
            <div className="flex items-end justify-between text-xs mb-1.5">
              <span className="text-gray-500">Progress</span>
              <span className="font-semibold text-gray-900 tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-canvas-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-gray-500">
              <span>{postedCount} of {rule.schedule.length} periods posted</span>
              <span className="tabular-nums">{fmtMoneyLead(recognised, rule.currency)} of {fmtMoneyLead(total, rule.currency)}</span>
            </div>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Type</div>
              <div className="mt-0.5">
                <span className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                  TYPE_TONE[rule.rule_type] ?? TYPE_TONE_DEFAULT,
                )}>
                  {fmtLabel(rule.rule_type)}
                </span>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Window</div>
              <div className="mt-0.5 text-xs text-gray-700">{fmtDate(rule.start_date)} → {fmtDate(rule.end_date)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Period / Method</div>
              <div className="mt-0.5 text-xs text-gray-700">
                {fmtLabel(rule.period_type)} · {fmtLabel(rule.method)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Entity</div>
              <div className="mt-0.5 text-xs font-mono text-gray-700">{rule.entity_code}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Deferral account</div>
              <div className="mt-0.5 text-xs font-mono text-gray-700">{rule.deferral_account_code}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Recognition account</div>
              <div className="mt-0.5 text-xs font-mono text-gray-700">{rule.recognition_account_code}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Total</div>
              <div className="mt-0.5 tabular-nums text-gray-900">{fmtMoneyLead(total, rule.currency)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Remaining</div>
              <div className="mt-0.5 tabular-nums text-amber-700">{fmtMoneyLead(remaining, rule.currency)}</div>
            </div>
          </div>

          {rule.notes && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Notes</div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{rule.notes}</p>
            </div>
          )}

          {/* Schedule */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
              Schedule ({rule.schedule.length} periods)
            </div>
            <div className="rounded-lg border border-canvas-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-canvas-50 text-[11px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">#</th>
                    <th className="px-3 py-2 text-left font-semibold">Period</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-canvas-100">
                  {rule.schedule.map((p) => (
                    <tr key={p.id} className={cn(p.is_posted ? "" : "bg-amber-50/30")}>
                      <td className="px-3 py-1.5 text-xs text-gray-500 tabular-nums">{p.sequence}</td>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap text-gray-700">
                        {fmtDate(p.period_start)} → {fmtDate(p.period_end)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {fmtMoneyLead(p.amount, rule.currency)}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {p.is_posted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2 py-0.5 text-[11px] font-medium text-mint-700 ring-1 ring-inset ring-mint-100">
                            <CheckCircle2 className="w-3 h-3" />
                            {p.posted_journal_entry_number}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-100">
                            <Clock className="w-3 h-3" />
                            pending
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
