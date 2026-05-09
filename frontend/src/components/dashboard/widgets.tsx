"use client";

/* Dashboard widget components.
 *
 * Most widgets are presentational — the dashboard page fetches the
 * shared data once and passes it down. Two widgets self-fetch because
 * they're optional and don't share data with the others:
 *   - EntityBalancesWidget   : per-entity cash table (uses banks list)
 *   - AISummaryWidget        : calls /beakon/narrative/ for an SSE stream
 *
 * Each export accepts whatever data it needs. The page composes them
 * inside <WidgetSwitch> based on the saved layout.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, BarChart3, Brain, Building2, CheckCircle2, ChevronRight,
  CreditCard, FileText, Inbox, Landmark, Loader2, NotebookPen, Receipt,
  Scale, Sparkles, TrendingUp, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt2Fixed, fmtCompact, fmtDate, fmtLabel } from "@/lib/format";
import { api, API_BASE } from "@/lib/api";
import { SummaryStat } from "@/components/ui/summary-stat";
import { Skeleton } from "@/components/ui/skeleton";


/* ──────────────────────────── Shared types ────────────────────── */

export interface Entity {
  id: number; code: string; name: string;
  functional_currency: string; is_active: boolean;
}

export interface BankAccount {
  id: number; name: string;
  entity_code: string; entity_name?: string;
  currency: string; gl_balance?: string; is_active: boolean;
}

export interface JESummary {
  id: number; entry_number: string; entity_code: string; date: string;
  status: string; memo: string; total: string;
  functional_currency: string; created_by: string | null;
}


/* ──────────────────────────── 1. Cash position ────────────────── */

export function CashPositionWidget({
  loading, entities, banks, compact = false,
}: { loading: boolean; entities: Entity[]; banks: BankAccount[]; compact?: boolean }) {
  const f = (v: number | string) => compact ? fmtCompact(v) : fmt2Fixed(v, 2);
  const cash = useMemo(() => {
    const byCcy: Record<string, number> = {};
    for (const ba of banks) {
      const v = parseFloat(ba.gl_balance || "0");
      if (!Number.isFinite(v)) continue;
      byCcy[ba.currency] = (byCcy[ba.currency] || 0) + v;
    }
    const sorted = Object.entries(byCcy).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return {
      headlineCcy: sorted[0]?.[0] ?? null,
      headline: sorted[0]?.[1] ?? 0,
      others: sorted.slice(1),
    };
  }, [banks]);
  const activeEntities = entities.filter((e) => e.is_active).length;
  const activeBanks = banks.filter((b) => b.is_active).length;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-canvas-200/70 bg-gradient-to-br from-brand-50/60 via-white to-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="absolute inset-y-0 right-0 w-1/3 pointer-events-none opacity-60"
           style={{ background: "radial-gradient(800px 220px at 100% 50%, rgba(56,189,248,0.10), transparent 60%)" }} />
      <div className="relative p-6 lg:p-7 flex flex-col lg:flex-row gap-6 items-start lg:items-end">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-lg bg-white shadow-sm flex items-center justify-center">
              <Wallet className="w-4 h-4 text-brand-700" />
            </div>
            <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-brand-700">
              Total cash position
            </span>
          </div>
          {loading ? (
            <Skeleton className="h-12 w-72" />
          ) : cash.headlineCcy ? (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[12px] font-semibold tracking-wider text-gray-500 tabular-nums">
                {cash.headlineCcy}
              </span>
              <span className="text-[44px] sm:text-[52px] leading-none font-semibold tracking-[-0.02em] text-gray-900 tabular-nums">
                {f(cash.headline)}
              </span>
            </div>
          ) : (
            <span className="text-[44px] leading-none font-semibold text-gray-300">—</span>
          )}
          <div className="mt-3 text-xs text-gray-600 leading-relaxed">
            Across <span className="font-semibold text-gray-900">{activeEntities}</span> entit{activeEntities === 1 ? "y" : "ies"}
            {" · "}
            <span className="font-semibold text-gray-900">{activeBanks}</span> bank account{activeBanks === 1 ? "" : "s"}
            {cash.others.length > 0 && (
              <span className="text-gray-400"> · plus {cash.others.length} other currenc{cash.others.length === 1 ? "y" : "ies"}</span>
            )}
          </div>
          {cash.others.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              {cash.others.slice(0, 4).map(([c, v]) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-white border border-canvas-200 px-2 py-0.5 text-[11px] text-gray-700">
                  <span className="font-mono font-medium text-gray-500">{c}</span>
                  <span className="tabular-nums">{f(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/bank" className="inline-flex items-center gap-1 rounded-lg bg-white border border-canvas-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-300 hover:text-brand-800 shadow-sm">
            <Landmark className="w-3.5 h-3.5" /> Bank accounts
          </Link>
          <Link href="/dashboard/reconciliations" className="inline-flex items-center gap-1 rounded-lg bg-white border border-canvas-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-brand-300 hover:text-brand-800 shadow-sm">
            <Scale className="w-3.5 h-3.5" /> Reconcile
          </Link>
          <Link href="/dashboard/reports" className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 shadow-sm">
            <TrendingUp className="w-3.5 h-3.5" /> Financials <ArrowRight className="w-3 h-3 ml-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}


/* ──────────────────────────── 2. KPI strip ────────────────────── */

export function KPIStripWidget({
  loading, entities, banks, pending, recent,
}: {
  loading: boolean; entities: Entity[]; banks: BankAccount[];
  pending: JESummary[]; recent: JESummary[];
}) {
  const activeEntityCount = entities.filter((e) => e.is_active).length;
  const activeBankCount = banks.filter((b) => b.is_active).length;
  const ccyCount = useMemo(
    () => new Set(banks.filter((b) => b.is_active).map((b) => b.currency)).size,
    [banks],
  );
  const postedThisWeek = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7); cutoff.setHours(0, 0, 0, 0);
    return recent.filter((j) => new Date(j.date + "T00:00:00") >= cutoff).length;
  }, [recent]);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <SummaryStat
        label="Active entities"
        value={loading ? <Skeleton className="h-6 w-12 inline-block" /> : activeEntityCount}
        hint={`${entities.length - activeEntityCount} archived`}
        icon={Building2} tone="brand"
      />
      <SummaryStat
        label="Awaiting approval"
        value={loading ? <Skeleton className="h-6 w-10 inline-block" /> : pending.length}
        hint={pending.length > 0 ? "Bills, invoices and JEs combined" : "Inbox is clear"}
        icon={Inbox} tone={pending.length > 0 ? "amber" : "mint"}
      />
      <SummaryStat
        label="Posted this week"
        value={loading ? <Skeleton className="h-6 w-10 inline-block" /> : postedThisWeek}
        hint={postedThisWeek > 0 ? "Last 7 days" : "Nothing posted yet"}
        icon={CheckCircle2} tone="mint"
      />
      <SummaryStat
        label="Bank accounts"
        value={loading ? <Skeleton className="h-6 w-10 inline-block" /> : activeBankCount}
        hint={`${ccyCount} currenc${ccyCount === 1 ? "y" : "ies"}`}
        icon={CreditCard}
      />
    </div>
  );
}


/* ──────────────────────────── 3. Approval inbox ───────────────── */

export function ApprovalInboxWidget({
  loading, pending,
}: { loading: boolean; pending: JESummary[] }) {
  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <header className="px-5 py-3.5 border-b border-canvas-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center">
            <Inbox className="w-4 h-4 text-amber-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Approval inbox</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              What's waiting on a sign-off — bills, invoices, journal entries.
            </p>
          </div>
        </div>
        <Link href="/dashboard/approvals" className="text-xs text-brand-700 hover:underline whitespace-nowrap inline-flex items-center gap-0.5">
          See all <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      <div>
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 flex-1 max-w-[260px]" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : pending.length === 0 ? (
          <EmptyMini icon={CheckCircle2} title="Inbox is clear" hint="Everything that came in has been signed off — go enjoy a coffee." />
        ) : (
          <ul className="divide-y divide-canvas-100">
            {pending.slice(0, 6).map((je) => (
              <li key={je.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-canvas-50/40 transition-colors">
                <span className="font-mono text-[11px] text-gray-500 w-20 shrink-0">{je.entry_number}</span>
                <span className="text-[11px] text-gray-700 font-medium w-20 shrink-0">{je.entity_code}</span>
                <span className="text-[11px] text-gray-400 w-20 shrink-0 tabular-nums">{fmtDate(je.date)}</span>
                <span className="flex-1 text-sm text-gray-800 truncate" title={je.memo}>{je.memo || "—"}</span>
                <span className="text-xs tabular-nums text-gray-700 hidden sm:inline shrink-0">
                  <span className="text-gray-400 font-mono">{je.functional_currency}</span> {fmt2Fixed(je.total, 2)}
                </span>
                <Link href={`/dashboard/journal-entries/${je.id}`} className="text-xs text-brand-700 hover:underline inline-flex items-center">
                  Review <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}


/* ──────────────────────────── 4. Recent activity ──────────────── */

export function RecentActivityWidget({
  loading, recent,
}: { loading: boolean; recent: JESummary[] }) {
  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <header className="px-5 py-3.5 border-b border-canvas-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-mint-50 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4 text-mint-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Recent activity</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Latest posted entries.</p>
          </div>
        </div>
        <Link href="/dashboard/journal-entries?status=posted" className="text-xs text-brand-700 hover:underline whitespace-nowrap inline-flex items-center gap-0.5">
          See all <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      <div>
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 flex-1 max-w-[160px]" />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyMini icon={NotebookPen} title="No posted entries yet" hint="The first JE you post will land here." />
        ) : (
          <ul className="divide-y divide-canvas-100">
            {recent.slice(0, 5).map((je) => (
              <li key={je.id} className="px-5 py-2.5">
                <Link href={`/dashboard/journal-entries/${je.id}`} className="block group">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-gray-500">{je.entry_number}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums">{fmtDate(je.date)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="inline-flex items-center rounded bg-canvas-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      {je.entity_code}
                    </span>
                    <span className="text-sm text-gray-800 truncate group-hover:text-brand-800 transition-colors" title={je.memo}>
                      {je.memo || fmtLabel(je.status)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}


/* ──────────────────────────── 5. Quick actions ────────────────── */

export function QuickActionsWidget() {
  return (
    <section>
      <div className="mb-2 px-1 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-brand-600" />
        <h3 className="text-[11px] uppercase tracking-[0.12em] font-semibold text-gray-500">
          Jump in
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <QuickLink href="/dashboard/bills" icon={Receipt} label="Pay bills" tone="amber" />
        <QuickLink href="/dashboard/invoices" icon={FileText} label="Send invoice" tone="indigo" />
        <QuickLink href="/dashboard/bank" icon={CreditCard} label="Bank feed" tone="brand" />
        <QuickLink href="/dashboard/reconciliations" icon={Scale} label="Reconcile" tone="mint" />
        <QuickLink href="/dashboard/reports" icon={BarChart3} label="Run a report" tone="default" />
      </div>
    </section>
  );
}


/* ──────────────────────────── 6. Entity balances ──────────────── */

export function EntityBalancesWidget({
  loading, entities, banks, compact = false,
}: { loading: boolean; entities: Entity[]; banks: BankAccount[]; compact?: boolean }) {
  const f = (v: number) => compact ? fmtCompact(v) : fmt2Fixed(v, 2);
  // Sum cash per entity. Multiple ccys per entity are listed inline.
  const rows = useMemo(() => {
    const byEntity: Record<string, { entityCode: string; entityName: string; byCcy: Record<string, number>; total0: number }> = {};
    for (const e of entities.filter((e) => e.is_active)) {
      byEntity[e.code] = { entityCode: e.code, entityName: e.name, byCcy: {}, total0: 0 };
    }
    for (const ba of banks) {
      if (!ba.is_active) continue;
      const slot = byEntity[ba.entity_code];
      if (!slot) continue;
      const v = parseFloat(ba.gl_balance || "0");
      if (!Number.isFinite(v)) continue;
      slot.byCcy[ba.currency] = (slot.byCcy[ba.currency] || 0) + v;
      slot.total0 += v;
    }
    return Object.values(byEntity).sort((a, b) => Math.abs(b.total0) - Math.abs(a.total0));
  }, [entities, banks]);
  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
      <header className="px-5 py-3.5 border-b border-canvas-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-indigo-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Cash by entity</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">GL balance per entity, summed across that entity's bank accounts.</p>
          </div>
        </div>
        <Link href="/dashboard/bank" className="text-xs text-brand-700 hover:underline whitespace-nowrap inline-flex items-center gap-0.5">
          See all <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>
      <div>
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 flex-1 max-w-[200px]" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyMini icon={Building2} title="No active entities" hint="Create an entity in /dashboard/entities to see balances here." />
        ) : (
          <ul className="divide-y divide-canvas-100">
            {rows.map((r) => (
              <li key={r.entityCode} className="px-5 py-2.5 flex items-center gap-3">
                <span className="inline-flex items-center rounded bg-canvas-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 font-mono shrink-0">
                  {r.entityCode}
                </span>
                <span className="flex-1 text-sm text-gray-800 truncate">{r.entityName}</span>
                <span className="text-xs tabular-nums text-gray-700 flex items-center gap-1.5 flex-wrap justify-end">
                  {Object.entries(r.byCcy).map(([c, v]) => (
                    <span key={c}>
                      <span className="text-gray-400 font-mono mr-1">{c}</span>{f(v)}
                    </span>
                  ))}
                  {Object.keys(r.byCcy).length === 0 && <span className="text-gray-300">—</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}


/* ──────────────────────────── 7. AI summary ───────────────────── */

interface NarrativeMeta { backend: string; model: string }

export function AISummaryWidget() {
  const [text, setText] = useState("");
  const [meta, setMeta] = useState<NarrativeMeta | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true); setErr(null); setText(""); setMeta(null);
    try {
      const token = typeof window !== "undefined"
        ? localStorage.getItem("access_token") : null;
      const orgId = typeof window !== "undefined"
        ? localStorage.getItem("organization_id") : null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;

      const resp = await fetch(`${API_BASE}/beakon/narrative/`, {
        method: "POST", headers,
        signal: ctrl.signal,
        body: JSON.stringify({ kind: "executive_summary" }),
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Parse SSE events split by blank lines
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const evt = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const eventLine = evt.match(/^event:\s*(.*)$/m)?.[1]?.trim() || "message";
          const dataLines = evt.split("\n").filter((l) => l.startsWith("data:"));
          const data = dataLines.map((l) => l.slice(5).trim()).join("\n");
          if (eventLine === "snapshot_built" || eventLine === "context_built") {
            try {
              const parsed = JSON.parse(data);
              if (parsed.backend) setMeta({ backend: parsed.backend, model: parsed.model || "" });
            } catch { /* ignore */ }
          } else if (eventLine === "token") {
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) setText((t) => t + parsed.text);
            } catch { /* ignore */ }
          } else if (eventLine === "error") {
            setErr(data);
          }
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setErr(e?.message || "AI summary failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-2xl border border-violet-100 bg-gradient-to-b from-violet-50/40 to-white p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-violet-100 flex items-center justify-center">
            <Brain className="w-4 h-4 text-violet-700" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-violet-900">AI executive summary</h2>
            <p className="text-[11px] text-violet-800/80 mt-0.5">
              Reads the latest TB and writes a 3–4 sentence narrative.
              {meta && (
                <span className="ml-1.5 text-violet-700/70 font-mono text-[10px]">
                  {meta.backend} · {meta.model}
                </span>
              )}
            </p>
          </div>
        </div>
        <button onClick={run} disabled={running} className="btn-primary text-sm">
          {running
            ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Reading the books…</>
            : <><Brain className="w-3.5 h-3.5 mr-1.5" /> {text ? "Re-run" : "Generate"}</>}
        </button>
      </div>
      {(text || err) && (
        <div className="mt-3 rounded-xl bg-white border border-violet-100 p-3 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
          {err ? <span className="text-rose-700">{err}</span> : text}
        </div>
      )}
      {!text && !running && !err && (
        <div className="mt-3 text-xs text-violet-700/80">
          Click <span className="font-semibold">Generate</span> — the model never makes up numbers; it reads the trial balance and only describes what's there.
        </div>
      )}
    </section>
  );
}


/* ──────────────────────── Helper components ────────────────────── */

function EmptyMini({
  icon: Icon, title, hint,
}: { icon: React.ComponentType<{ className?: string }>; title: string; hint: string }) {
  return (
    <div className="px-5 py-8 text-center">
      <div className="mx-auto mb-2 h-10 w-10 rounded-xl bg-canvas-50 flex items-center justify-center">
        <Icon className="w-5 h-5 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-800">{title}</p>
      <p className="mt-0.5 text-[11px] text-gray-500 max-w-xs mx-auto">{hint}</p>
    </div>
  );
}


function QuickLink({
  href, icon: Icon, label, tone = "default",
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: "default" | "brand" | "mint" | "amber" | "indigo";
}) {
  const TONE: Record<string, { bg: string; text: string }> = {
    default: { bg: "bg-canvas-100", text: "text-gray-600" },
    brand:   { bg: "bg-brand-50",   text: "text-brand-700" },
    mint:    { bg: "bg-mint-50",    text: "text-mint-700" },
    amber:   { bg: "bg-amber-50",   text: "text-amber-700" },
    indigo:  { bg: "bg-indigo-50",  text: "text-indigo-700" },
  };
  const t = TONE[tone];
  return (
    <Link href={href} className="group rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-brand-300 hover:shadow-md transition-all px-4 py-3.5 flex items-center gap-3">
      <span className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", t.bg)}>
        <Icon className={cn("w-4 h-4", t.text)} />
      </span>
      <span className="flex-1 text-sm font-medium text-gray-800 group-hover:text-brand-800 transition-colors">
        {label}
      </span>
      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-600 transition-colors" />
    </Link>
  );
}
