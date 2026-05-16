"use client";

/* Custodian Statements — daily statement package received from the
 * custodian's overnight SFTP push (Avaloq pilot).
 *
 * Page architecture (top-to-bottom):
 *   1. Environment strip      — TEST vs LIVE, today's business date
 *   2. SLA + coverage strip   — coverage of today's expected statements
 *   3. Action queue           — 3 cards summarising what needs action
 *   4. Coverage heatmap       — last 14 business days, cell per (portfolio × day)
 *   5. Filters / search       — chip rail (custodian, portfolio, status, etc.)
 *   6. Statements table       — sortable, click-to-open drawer
 *   7. Reconciliation panel   — categorised differences, drillable
 *
 * User-facing labels are accounting language (statement, post, ledger,
 * differences, per-custodian / per-ledger). Internal types/state names
 * keep the dev terms (drop, ingest, break) because that's what the API
 * returns; the schema rename is not worth the churn for a v1.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, AlertTriangle, ArrowRight, Calendar, CheckCircle2,
  ChevronDown, ChevronRight, ClipboardCopy, Clock, Coins, FileArchive,
  FileWarning, Inbox, Layers, LineChart, ListChecks, MapPin, PackageOpen,
  RefreshCcw, RotateCw, Search, ShieldAlert, ShieldCheck, Sparkles,
  Workflow, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";


// ── Environment ──────────────────────────────────────────────────
//
// In a real deployment this is wired to settings and read from the
// API. For Beakon today there is only one mode: TEST. When the bank
// goes live we flip the constant or read from `/auth/me/`.

const ENVIRONMENT: "TEST" | "LIVE" = "TEST";


// ── Types matching the Django serializers ────────────────────────


interface Drop {
  id: number;
  file_name: string;
  sha256: string;
  business_date: string;
  custodian: number | null;
  custodian_code: string;
  custodian_name: string;
  portfolio_id: string;
  portfolio_currency: string;
  received_at: string;
  received_at_cet: string | null;
  ingest_started_at: string | null;
  ingest_completed_at: string | null;
  status: "received" | "ingesting" | "ingested" | "failed";
  display_status: string;
  sla_status: "on_time" | "late" | "missing" | "n/a";
  sla_cutoff_at: string;
  source_ip: string;
  source_ip_match: "allowlisted" | "rejected" | "unknown";
  schema_version: string;
  file_size_bytes: number;
  prior_drop: number | null;
  reprocessed_from: number | null;
  file_counts: Record<string, number>;
  error_log: any[];
  notes: string;
  breaks_open: number;
  breaks_total: number;
  breaks_by_category: Record<string, number>;
}


interface Break {
  id: number;
  drop: number;
  drop_file_name: string;
  business_date: string;
  portfolio: number | null;
  portfolio_id: string;
  break_type: string;
  category: string;
  isin: string;
  bank_value: string;
  beakon_value: string;
  detail: string;
  suggested_resolution: string;
  resolved: boolean;
  resolved_at: string | null;
  resolution_notes: string;
  created_at: string;
}


interface DropDetail {
  drop: Drop;
  breaks: Break[];
  samples: {
    cash: any[];
    securities: any[];
    positions: any[];
    performance: any[];
    orderbook: any[];
  };
}


interface CoverageRow {
  business_date: string;
  expected: number;
  received: number;
  on_time: number;
  late: number;
  missing: number;
  ingested: number;
  failed: number;
  differences_open: number;
}


interface Coverage {
  today: string;
  cutoff_cet: string;
  rows: CoverageRow[];
}


// ── Visual helpers ───────────────────────────────────────────────


/* Display-status → badge tone. The DB stores `received/ingesting/
 * ingested/failed`; the serializer derives a richer `display_status`
 * label that distinguishes "Posted" from "Posted (empty)" etc. */
const DISPLAY_STATUS_TONE: Record<string, string> = {
  "Posted":         "bg-mint-50 text-mint-700 ring-mint-100",
  "Posted (empty)": "bg-canvas-100 text-gray-700 ring-canvas-200",
  "Posting":        "bg-amber-50 text-amber-700 ring-amber-100",
  "Received":       "bg-canvas-100 text-gray-600 ring-canvas-200",
  "Failed":         "bg-rose-50 text-rose-700 ring-rose-100",
};


const SLA_LABELS: Record<string, { label: string; tone: string; icon: any }> = {
  on_time:  { label: "On time", tone: "text-mint-700",   icon: CheckCircle2 },
  late:     { label: "Late",    tone: "text-amber-700",  icon: Clock },
  missing:  { label: "Missing", tone: "text-rose-700",   icon: AlertTriangle },
  "n/a":    { label: "—",       tone: "text-gray-400",   icon: Clock },
};


const FILE_TYPE_LABELS: Record<string, { label: string; tone: string }> = {
  cash:       { label: "Cash movements",      tone: "bg-brand-50 text-brand-700 ring-brand-100" },
  securities: { label: "Trade confirmations", tone: "bg-indigo-50 text-indigo-700 ring-indigo-100" },
  positions:  { label: "Holdings",            tone: "bg-mint-50 text-mint-700 ring-mint-100" },
  perf:       { label: "Performance",         tone: "bg-violet-50 text-violet-700 ring-violet-100" },
  orderbook:  { label: "Pending orders",      tone: "bg-amber-50 text-amber-700 ring-amber-100" },
};


const BREAK_TYPE_LABELS: Record<string, string> = {
  position_qty_mismatch:    "Quantity mismatch",
  position_count_mismatch:  "Holdings count mismatch",
  unknown_isin:             "Unrecognised security",
  missing_portfolio:        "Portfolio not found",
  fx_rate_missing:          "FX rate missing",
};


const BREAK_CATEGORY_META: Record<string, { label: string; tone: string;
                                            description: string }> = {
  timing: {
    label: "Timing",
    tone: "bg-amber-50 text-amber-800 ring-amber-100",
    description: "Trade booked but settlement (T+2) not yet reflected. " +
                 "These typically resolve themselves within two business days.",
  },
  fx: {
    label: "FX",
    tone: "bg-indigo-50 text-indigo-800 ring-indigo-100",
    description: "Quantity matches but valuation differs — usually a rate " +
                 "or revaluation timing question.",
  },
  missing_trade: {
    label: "Missing trade",
    tone: "bg-rose-50 text-rose-800 ring-rose-100",
    description: "The custodian shows a position the ledger has no record of. " +
                 "Either book the missing buy or query the custodian.",
  },
  corp_action: {
    label: "Corporate action",
    tone: "bg-violet-50 text-violet-800 ring-violet-100",
    description: "Quantity ratio looks like a stock split or scrip dividend. " +
                 "Confirm against the corporate-action calendar.",
  },
  true_error: {
    label: "True error",
    tone: "bg-rose-50 text-rose-800 ring-rose-100",
    description: "Trade history exists but doesn't mathematically explain " +
                 "the difference. Needs investigation.",
  },
  unknown: {
    label: "Unknown",
    tone: "bg-canvas-100 text-gray-700 ring-canvas-200",
    description: "No clear cause — needs a human review.",
  },
};


function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}


function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    // ISO-style with explicit timezone offset.
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  } catch { return iso; }
}


// ── Page ──────────────────────────────────────────────────────────


export default function BankFeedPage() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "simulate" | "ingest" | "reprocess">("");
  const [banner, setBanner] = useState<
    | { kind: "ok" | "err"; title: string; body: string }
    | null
  >(null);

  // Filters
  const [filterCustodian, setFilterCustodian] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterDate, setFilterDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Drawer
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DropDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [d, b, c] = await Promise.all([
        api.get<{ results: Drop[] } | Drop[]>("/beakon/bank-feed/drops/", {
          page_size: "100",
        }),
        api.get<{ results: Break[] } | Break[]>("/beakon/bank-feed/breaks/", {
          resolved: "false",
          page_size: "100",
        }),
        api.get<Coverage>("/beakon/bank-feed/coverage/", { days: "14" }),
      ]);
      setDrops(Array.isArray(d) ? d : (d.results ?? []));
      setBreaks(Array.isArray(b) ? b : (b.results ?? []));
      setCoverage(c);
    } catch (e: any) {
      setBanner({
        kind: "err", title: "Could not load statement history",
        body: e?.error?.message || e?.message || "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const onSimulate = async () => {
    setBusy("simulate"); setBanner(null);
    try {
      const r = await api.post<{ portfolio: string; business_date: string;
                                size_bytes: number }>(
        "/beakon/bank-feed/simulate-push/", {},
      );
      setBanner({
        kind: "ok", title: "Sample statement received",
        body: `Portfolio ${r.portfolio} · business date ${r.business_date} · ` +
              `${(r.size_bytes / 1024).toFixed(1)} KB. ` +
              `Click "Post statement" to record it in the ledger.`,
      });
    } catch (e: any) {
      setBanner({
        kind: "err", title: "Could not receive sample statement",
        body: e?.error?.message || e?.message || "Unknown error",
      });
    } finally { setBusy(""); }
  };

  const onIngest = async () => {
    setBusy("ingest"); setBanner(null);
    try {
      const r = await api.post<any>("/beakon/bank-feed/ingest/", {});
      const totals = (r.results ?? []).reduce((acc: any, x: any) => {
        if (x.skipped) acc.skipped += 1;
        else if (x.status === "ingested") acc.ok += 1;
        else if (x.error || x.status === "failed") acc.fail += 1;
        for (const [t, n] of Object.entries(x.file_counts ?? {})) {
          acc.byType[t] = (acc.byType[t] || 0) + (n as number);
        }
        acc.breaks += x.breaks ?? 0;
        return acc;
      }, { ok: 0, fail: 0, skipped: 0, breaks: 0,
           byType: {} as Record<string, number> });

      const summary = Object.entries(totals.byType)
        .map(([k, v]) => `${FILE_TYPE_LABELS[k]?.label ?? k}: ${v}`)
        .join(" · ");

      if (totals.fail) {
        setBanner({
          kind: "err",
          title: `Posted ${totals.ok}, failed ${totals.fail}`,
          body: `${summary || "no line items"}. ${totals.breaks} reconciliation difference(s).`,
        });
      } else if (r.scanned === 0) {
        setBanner({
          kind: "err", title: "No statements pending",
          body: "Click \"Receive sample statement\" first.",
        });
      } else {
        setBanner({
          kind: "ok",
          title: `Posted ${r.scanned} statement${r.scanned === 1 ? "" : "s"} to the ledger`,
          body: `${summary} — ${totals.breaks} reconciliation difference(s)`,
        });
      }
      await load();
    } catch (e: any) {
      setBanner({
        kind: "err", title: "Could not post statement",
        body: e?.error?.message || e?.message || "Unknown error",
      });
    } finally { setBusy(""); }
  };

  const onReprocess = async (dropId: number) => {
    if (!confirm("Re-process this statement from the original file? " +
                 "The current posting will be replaced.")) return;
    setBusy("reprocess"); setBanner(null);
    try {
      const r = await api.post<any>(
        `/beakon/bank-feed/drops/${dropId}/reprocess/`, {},
      );
      setBanner({
        kind: "ok", title: "Statement re-processed",
        body: `New posting: ${Object.entries(r.file_counts || {})
          .map(([k, v]) => `${FILE_TYPE_LABELS[k]?.label ?? k}: ${v}`)
          .join(" · ")}. ${r.breaks ?? 0} reconciliation difference(s).`,
      });
      setDetailId(null); setDetail(null);
      await load();
    } catch (e: any) {
      setBanner({
        kind: "err", title: "Could not re-process",
        body: e?.error?.message || e?.message || "Unknown error",
      });
    } finally { setBusy(""); }
  };

  const openDetail = async (id: number) => {
    setDetailId(id); setDetail(null); setDetailLoading(true);
    try {
      const d = await api.get<DropDetail>(`/beakon/bank-feed/drops/${id}/`);
      setDetail(d);
    } catch (e: any) {
      setBanner({
        kind: "err", title: "Could not load statement detail",
        body: e?.error?.message || e?.message || "Unknown error",
      });
    } finally { setDetailLoading(false); }
  };

  // ── Filtering ───────────────────────────────────────────────────
  const filteredDrops = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drops.filter((d) => {
      if (filterCustodian && d.custodian_code !== filterCustodian) return false;
      if (filterStatus && d.display_status !== filterStatus) return false;
      if (filterDate && d.business_date !== filterDate) return false;
      if (q) {
        const blob = `${d.file_name} ${d.portfolio_id} ${d.custodian_code}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [drops, filterCustodian, filterStatus, filterDate, search]);

  const filteredBreaks = useMemo(() => {
    return breaks.filter((b) => {
      if (filterCategory && b.category !== filterCategory) return false;
      return true;
    });
  }, [breaks, filterCategory]);

  // ── Derived ─────────────────────────────────────────────────────
  const todayCoverage = coverage?.rows[0];
  const distinctCustodians = useMemo(() =>
    Array.from(new Set(drops.map((d) => d.custodian_code).filter(Boolean))).sort(),
  [drops]);
  const distinctStatuses = useMemo(() =>
    Array.from(new Set(drops.map((d) => d.display_status))).sort(),
  [drops]);

  const breaksByCategory = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of breaks) out[b.category] = (out[b.category] || 0) + 1;
    return out;
  }, [breaks]);

  const lateOrMissing = (todayCoverage?.late ?? 0) + (todayCoverage?.missing ?? 0);

  return (
    <div className="space-y-5">

      {/* ─── 1. Environment strip ─────────────────────────────── */}
      <div className={cn(
        "rounded-lg px-3.5 py-2 text-xs flex items-center gap-2 ring-1",
        ENVIRONMENT === "TEST"
          ? "bg-amber-50/70 text-amber-900 ring-amber-200"
          : "bg-mint-50/70 text-mint-900 ring-mint-200",
      )}>
        <span className={cn(
          "inline-flex items-center font-bold tracking-wider px-2 py-0.5 rounded",
          ENVIRONMENT === "TEST"
            ? "bg-amber-200/60 text-amber-900"
            : "bg-mint-200/60 text-mint-900",
        )}>{ENVIRONMENT}</span>
        <span>
          {ENVIRONMENT === "TEST"
            ? "Test environment — sample statements only. Live data is not connected."
            : "Live environment — statements from real custodians post to the production ledger."}
        </span>
        <span className="ml-auto text-gray-600">
          Today {coverage?.today ?? "…"}{coverage ? ` · cutoff ${coverage.cutoff_cet} CET` : ""}
        </span>
      </div>

      {/* ─── Page header ───────────────────────────────────────── */}
      <PageHeader
        title="Custodian Statements"
        description={
          <>
            Daily statement package from the custodian — cash movements, trade
            confirmations, holdings, performance, and pending orders. Each
            statement is posted to the ledger and the holdings line is
            reconciled against your books.
          </>
        }
        actions={
          <>
            {ENVIRONMENT === "TEST" && (
              <button
                type="button"
                onClick={onSimulate}
                disabled={busy !== ""}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                title="TEST environment only — bring in a sample daily statement."
              >
                <PackageOpen className={cn("h-4 w-4",
                  busy === "simulate" && "animate-pulse")} />
                {busy === "simulate" ? "Receiving…" : "Receive sample statement"}
              </button>
            )}
            <button
              type="button"
              onClick={onIngest}
              disabled={busy !== ""}
              className="btn-primary"
              title="Post any pending statements to the ledger."
            >
              <RefreshCcw className={cn("w-4 h-4 mr-1.5",
                busy === "ingest" && "animate-spin")} />
              {busy === "ingest" ? "Posting…" : "Post statement"}
            </button>
          </>
        }
      />

      {banner && (
        <div className={cn(
          "flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm",
          banner.kind === "ok"
            ? "border-mint-200 bg-mint-50/70"
            : "border-rose-200 bg-rose-50/70",
        )}>
          {banner.kind === "ok"
            ? <CheckCircle2 className="w-4 h-4 text-mint-600 mt-0.5 shrink-0" />
            : <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <span className={cn("font-semibold",
              banner.kind === "ok" ? "text-mint-900" : "text-rose-900")}>
              {banner.title}
            </span>{" "}
            <span className={banner.kind === "ok" ? "text-mint-800" : "text-rose-800"}>
              {banner.body}
            </span>
          </div>
          <button type="button" onClick={() => setBanner(null)}
                  className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ─── 2. SLA + coverage strip ─────────────────────────── */}
      {todayCoverage && (
        <SlaCoverageStrip row={todayCoverage} cutoff={coverage!.cutoff_cet} />
      )}

      {/* ─── 3. Action queue ─────────────────────────────────── */}
      {!loading && (lateOrMissing > 0 || breaks.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lateOrMissing > 0 && (
            <ActionCard
              tone="rose"
              icon={Clock}
              title="Late or missing"
              count={lateOrMissing}
              detail={
                todayCoverage!.missing > 0
                  ? `${todayCoverage!.missing} not yet received — escalate with the custodian.`
                  : `${todayCoverage!.late} arrived after ${coverage!.cutoff_cet} CET cutoff.`
              }
              onClick={() => setFilterStatus("Received")}
            />
          )}
          {breaks.length > 0 && (
            <ActionCard
              tone="rose"
              icon={ShieldAlert}
              title="Open differences"
              count={breaks.length}
              detail={
                Object.entries(breaksByCategory)
                  .map(([cat, n]) => `${BREAK_CATEGORY_META[cat]?.label ?? cat}: ${n}`)
                  .join(" · ")
              }
              onClick={() => {
                document.getElementById("recon-section")?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          )}
          <ActionCard
            tone="indigo"
            icon={Inbox}
            title="Posted today"
            count={todayCoverage?.ingested ?? 0}
            detail={`${todayCoverage?.received ?? 0} of ${todayCoverage?.expected ?? 0} expected statements`}
          />
        </div>
      )}

      {/* ─── 4. Coverage heatmap ─────────────────────────────── */}
      {coverage && coverage.rows.length > 0 && (
        <CoverageHeatmap coverage={coverage}
                         onCellClick={(d) => setFilterDate(d)} />
      )}

      {/* ─── First-run walkthrough — only when nothing's ever happened ──── */}
      {!loading && drops.length === 0 && (
        <FirstRunCard
          envIsTest={ENVIRONMENT === "TEST"}
          onSimulate={onSimulate}
          onIngest={onIngest}
          busy={busy}
        />
      )}

      {/* ─── 5. Filters / search ─────────────────────────────── */}
      {drops.length > 0 && (
        <FilterBar
          search={search} onSearch={setSearch}
          custodian={filterCustodian} onCustodian={setFilterCustodian}
          custodians={distinctCustodians}
          status={filterStatus} onStatus={setFilterStatus}
          statuses={distinctStatuses}
          date={filterDate} onDate={setFilterDate}
          onClear={() => {
            setFilterCustodian(""); setFilterStatus("");
            setFilterDate(""); setSearch("");
          }}
        />
      )}

      {/* ─── 6. Statements table ─────────────────────────────── */}
      {drops.length > 0 && (
        <StatementsTable
          drops={filteredDrops} totalCount={drops.length}
          onOpen={openDetail}
        />
      )}

      {/* ─── 7. Reconciliation differences ──────────────────── */}
      {breaks.length > 0 && (
        <ReconciliationPanel
          breaks={filteredBreaks}
          totalCount={breaks.length}
          activeCategory={filterCategory}
          onCategoryClick={(c) => setFilterCategory(c === filterCategory ? "" : c)}
          onOpenStatement={openDetail}
        />
      )}

      {/* Drawer */}
      {detailId !== null && (
        <DetailDrawer
          loading={detailLoading}
          detail={detail}
          onClose={() => { setDetailId(null); setDetail(null); }}
          onReprocess={(id) => onReprocess(id)}
          reprocessBusy={busy === "reprocess"}
        />
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────


function SlaCoverageStrip({ row, cutoff }: { row: CoverageRow; cutoff: string }) {
  const total = row.expected || 1;
  const received = row.received;
  const onTime = row.on_time;
  const late = row.late;
  const missing = row.missing;
  const pct = Math.round((received / total) * 100);
  const ok = missing === 0 && late === 0;

  return (
    <section className="rounded-xl border border-canvas-200 bg-white px-5 py-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-900">
            Today · business date {row.business_date}
          </span>
        </div>
        <span className="text-xs text-gray-500">SLA cutoff {cutoff} CET</span>
        <span className="ml-auto text-xs text-gray-600 tabular-nums">
          {received} / {total} received · {pct}% coverage
        </span>
      </div>

      {/* Progress dots */}
      <div className="mt-3 flex items-center gap-1 flex-wrap">
        {Array.from({ length: total }).map((_, i) => {
          let cls = "bg-canvas-200";
          if (i < onTime) cls = "bg-mint-500";
          else if (i < onTime + late) cls = "bg-amber-500";
          else if (i < received) cls = "bg-amber-500";
          else if (i < received + missing) cls = "bg-rose-500";
          return <span key={i}
            className={cn("inline-block w-2.5 h-2.5 rounded-full", cls)} />;
        })}
      </div>

      <div className="mt-2 flex items-center gap-4 text-[12px] text-gray-600 tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-mint-500" />
          {onTime} on time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          {late} late
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          {missing} missing
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
          {row.differences_open} open differences
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {ok
            ? <><CheckCircle2 className="w-4 h-4 text-mint-600" />
                <span className="text-mint-700 font-medium">SLA met</span></>
            : <><AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-amber-700 font-medium">SLA breach</span></>}
        </span>
      </div>
    </section>
  );
}


function ActionCard({ tone, icon: Icon, title, count, detail, onClick }: {
  tone: "rose" | "indigo" | "amber";
  icon: any;
  title: string;
  count: number;
  detail: string;
  onClick?: () => void;
}) {
  const tones: Record<string, { ring: string; iconBg: string; iconText: string }> = {
    rose:   { ring: "ring-rose-200/60",   iconBg: "bg-rose-50",   iconText: "text-rose-700" },
    indigo: { ring: "ring-indigo-200/60", iconBg: "bg-indigo-50", iconText: "text-indigo-700" },
    amber:  { ring: "ring-amber-200/60",  iconBg: "bg-amber-50",  iconText: "text-amber-700" },
  };
  const t = tones[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-xl bg-white px-4 py-3.5 ring-1 hover:shadow-sm transition-shadow",
        t.ring,
        onClick ? "cursor-pointer" : "cursor-default",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
            {title}
          </p>
          <p className="mt-0.5 text-[22px] font-semibold tabular-nums text-gray-900">
            {count}
          </p>
          <p className="mt-1 text-[11px] text-gray-600 leading-snug">{detail}</p>
        </div>
        <div className={cn("shrink-0 h-8 w-8 rounded-lg flex items-center justify-center",
                          t.iconBg, t.iconText)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </button>
  );
}


function CoverageHeatmap({ coverage, onCellClick }: {
  coverage: Coverage;
  onCellClick: (date: string) => void;
}) {
  const rows = coverage.rows.slice().reverse(); // chronological L→R
  return (
    <section className="rounded-xl border border-canvas-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Last 14 business days
        </h2>
        <span className="text-[11px] text-gray-500">Click a day to filter the table</span>
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {rows.map((r) => {
          const status =
            r.received === 0 ? "missing" :
            r.late > 0 ? "late" :
            r.failed > 0 ? "failed" :
            r.differences_open > 0 ? "diffs" :
            "ok";
          const tones: Record<string, string> = {
            ok:      "bg-mint-500",
            late:    "bg-amber-500",
            missing: "bg-rose-500",
            failed:  "bg-rose-700",
            diffs:   "bg-mint-500 ring-2 ring-rose-300",
          };
          const today = r.business_date === coverage.today;
          const dayLabel = r.business_date.slice(8); // DD
          return (
            <button
              key={r.business_date}
              type="button"
              onClick={() => onCellClick(r.business_date)}
              className="group flex flex-col items-center gap-1 shrink-0 px-1 py-1 rounded hover:bg-canvas-50"
              title={
                `${r.business_date}\n` +
                `Received ${r.received}/${r.expected} · ` +
                `${r.on_time} on-time · ${r.late} late · ${r.missing} missing\n` +
                `${r.differences_open} differences open`
              }
            >
              <span className={cn(
                "block w-7 h-7 rounded",
                tones[status],
              )} />
              <span className={cn(
                "text-[10px] tabular-nums",
                today ? "text-gray-900 font-bold" : "text-gray-500",
              )}>{dayLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-500">
        <Legend tone="bg-mint-500" label="Posted on time" />
        <Legend tone="bg-amber-500" label="Late" />
        <Legend tone="bg-rose-500" label="Missing" />
        <Legend tone="bg-mint-500 ring-2 ring-rose-300" label="Posted, has differences" />
      </div>
    </section>
  );
}


function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("w-3 h-3 rounded", tone)} />
      {label}
    </span>
  );
}


function FirstRunCard({ envIsTest, onSimulate, onIngest, busy }: {
  envIsTest: boolean;
  onSimulate: () => void;
  onIngest: () => void;
  busy: string;
}) {
  return (
    <section className="rounded-2xl border border-brand-100 bg-gradient-to-b from-brand-50/60 to-white px-6 py-8">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700">
        <Sparkles className="h-3.5 w-3.5" /> How it works
      </div>
      <h2 className="mt-2 text-xl font-semibold text-gray-900">
        Receive a daily statement and post it to your ledger.
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-gray-600 leading-relaxed">
        Step&nbsp;1 brings in a sample daily statement from the custodian.
        Step&nbsp;2 posts cash and trades to the ledger and reconciles
        the holdings line against your books.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-canvas-200 bg-white p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold">1</span>
            Receive statement
          </div>
          <p className="mt-2 text-sm text-gray-700">
            Lands a sample statement in the receiving folder.
          </p>
          <button type="button" onClick={onSimulate}
            disabled={busy !== "" || !envIsTest}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
            <PackageOpen className="h-4 w-4" />
            {busy === "simulate" ? "Receiving…" : "Receive sample statement"}
          </button>
        </div>
        <div className="rounded-xl border border-canvas-200 bg-white p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-canvas-200 text-gray-600 text-[11px] font-bold">2</span>
            Post to ledger
          </div>
          <p className="mt-2 text-sm text-gray-700">
            Posts cash and trades and reconciles holdings.
          </p>
          <button type="button" onClick={onIngest}
            disabled={busy !== ""}
            className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-canvas-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-canvas-50 disabled:opacity-50">
            <RefreshCcw className="h-4 w-4" />
            {busy === "ingest" ? "Posting…" : "Post statement"}
          </button>
        </div>
      </div>
    </section>
  );
}


function FilterBar({
  search, onSearch, custodian, onCustodian, custodians,
  status, onStatus, statuses, date, onDate, onClear,
}: {
  search: string; onSearch: (v: string) => void;
  custodian: string; onCustodian: (v: string) => void;
  custodians: string[];
  status: string; onStatus: (v: string) => void;
  statuses: string[];
  date: string; onDate: (v: string) => void;
  onClear: () => void;
}) {
  const hasActive = !!(custodian || status || date || search);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          type="text" value={search} onChange={(e) => onSearch(e.target.value)}
          placeholder="Search file name, portfolio, custodian…"
          className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-canvas-200 bg-white"
        />
      </div>
      <FilterSelect label="Custodian" value={custodian} onChange={onCustodian}
                    options={custodians} />
      <FilterSelect label="Status" value={status} onChange={onStatus}
                    options={statuses} />
      <input
        type="date" value={date} onChange={(e) => onDate(e.target.value)}
        className="px-2 py-2 text-sm rounded-lg border border-canvas-200 bg-white"
      />
      {hasActive && (
        <button type="button" onClick={onClear}
                className="text-xs text-gray-600 hover:text-gray-900 px-2">
          Clear
        </button>
      )}
    </div>
  );
}


function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
            className="px-2 py-2 text-sm rounded-lg border border-canvas-200 bg-white">
      <option value="">{label} (any)</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}


function StatementsTable({ drops, totalCount, onOpen }: {
  drops: Drop[]; totalCount: number;
  onOpen: (id: number) => void;
}) {
  return (
    <section className="rounded-xl border border-canvas-200 bg-white">
      <header className="flex items-center justify-between px-4 py-3 border-b border-canvas-200">
        <div className="flex items-center gap-2 text-gray-700">
          <Inbox className="w-4 h-4" />
          <h2 className="text-sm font-semibold">Statements</h2>
          <span className="text-xs text-gray-400">
            ({drops.length}{drops.length !== totalCount ? ` of ${totalCount}` : ""})
          </span>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-gray-500 bg-canvas-50/60">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Status</th>
              <th className="text-left font-medium px-3 py-2.5">Business date</th>
              <th className="text-left font-medium px-3 py-2.5">Custodian</th>
              <th className="text-left font-medium px-3 py-2.5">Portfolio · Ccy</th>
              <th className="text-left font-medium px-3 py-2.5">Received</th>
              <th className="text-left font-medium px-3 py-2.5">SLA</th>
              <th className="text-left font-medium px-3 py-2.5">Source IP</th>
              <th className="text-left font-medium px-3 py-2.5">Statement contents</th>
              <th className="text-right font-medium px-3 py-2.5">Open differences</th>
              <th className="px-2 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-canvas-100">
            {drops.map((d) => {
              const sla = SLA_LABELS[d.sla_status] ?? SLA_LABELS["n/a"];
              const SlaIcon = sla.icon;
              return (
                <tr key={d.id}
                    className="hover:bg-canvas-50/60 cursor-pointer"
                    onClick={() => onOpen(d.id)}>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 whitespace-nowrap",
                      DISPLAY_STATUS_TONE[d.display_status] ?? DISPLAY_STATUS_TONE["Received"],
                    )}>{d.display_status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 tabular-nums">{d.business_date}</td>
                  <td className="px-3 py-2.5 text-gray-700">
                    {d.custodian_code
                      ? <span className="font-mono text-xs">{d.custodian_code}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">
                    <div className="flex flex-col">
                      <span className="font-mono text-[12px]">{d.portfolio_id}</span>
                      <span className="text-[11px] text-gray-500">
                        {d.portfolio_currency || "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-gray-700 tabular-nums whitespace-nowrap">
                    {d.received_at_cet ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={cn("inline-flex items-center gap-1 text-[12px]", sla.tone)}>
                      <SlaIcon className="w-3.5 h-3.5" />
                      {sla.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {d.source_ip ? (
                      <span className={cn(
                        "inline-flex items-center gap-1.5 font-mono",
                        d.source_ip_match === "allowlisted" ? "text-mint-700"
                          : d.source_ip_match === "rejected" ? "text-rose-700"
                          : "text-gray-500",
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full",
                          d.source_ip_match === "allowlisted" ? "bg-mint-500"
                            : d.source_ip_match === "rejected" ? "bg-rose-500"
                            : "bg-gray-400",
                        )} />
                        {d.source_ip}
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(d.file_counts || {}).map(([t, n]) => (
                        <span key={t} className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] ring-1 tabular-nums",
                          FILE_TYPE_LABELS[t]?.tone ?? "bg-canvas-50 text-gray-600 ring-canvas-200",
                        )}>
                          {FILE_TYPE_LABELS[t]?.label ?? t}:{" "}
                          <span className="font-semibold ml-0.5">{n as number}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {d.breaks_open > 0 ? (
                      <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        {d.breaks_open}
                      </span>
                    ) : <span className="text-gray-400">0</span>}
                  </td>
                  <td className="px-2 py-2.5 text-gray-400">
                    <ChevronRight className="w-4 h-4" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {drops.length === 0 && totalCount > 0 && (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          No statements match the current filters.
        </div>
      )}
    </section>
  );
}


function ReconciliationPanel({
  breaks, totalCount, activeCategory, onCategoryClick, onOpenStatement,
}: {
  breaks: Break[]; totalCount: number;
  activeCategory: string;
  onCategoryClick: (cat: string) => void;
  onOpenStatement: (dropId: number) => void;
}) {
  // Group displayed breaks by category
  const grouped = useMemo(() => {
    const m: Record<string, Break[]> = {};
    for (const b of breaks) {
      (m[b.category] ??= []).push(b);
    }
    return m;
  }, [breaks]);

  const allCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of breaks) m[b.category] = (m[b.category] || 0) + 1;
    return m;
  }, [breaks]);

  return (
    <section id="recon-section" className="rounded-xl border border-canvas-200 bg-white">
      <header className="flex items-center justify-between px-4 py-3 border-b border-canvas-200">
        <div className="flex items-center gap-2 text-gray-700">
          <ShieldAlert className="w-4 h-4" />
          <h2 className="text-sm font-semibold">Reconciliation differences</h2>
          <span className="text-xs text-gray-400">
            ({breaks.length}{breaks.length !== totalCount ? ` of ${totalCount}` : ""} open)
          </span>
        </div>
        <span className="text-[11px] text-gray-500">
          Custodian holdings statement vs. your ledger
        </span>
      </header>

      {/* Category chips */}
      <div className="px-4 pt-3 flex flex-wrap gap-1.5">
        {Object.keys(BREAK_CATEGORY_META).map((cat) => {
          const n = allCounts[cat] ?? 0;
          if (n === 0 && cat !== activeCategory) return null;
          const meta = BREAK_CATEGORY_META[cat];
          const active = cat === activeCategory;
          return (
            <button
              key={cat} type="button"
              onClick={() => onCategoryClick(cat)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ring-1 transition-colors",
                active
                  ? "bg-gray-900 text-white ring-gray-900"
                  : meta.tone,
              )}
            >
              {meta.label}
              <span className={cn(
                "tabular-nums font-semibold",
                active ? "text-white" : "",
              )}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Differences grouped */}
      <div className="px-4 py-3 space-y-4">
        {Object.entries(grouped).map(([cat, items]) => {
          const meta = BREAK_CATEGORY_META[cat] ?? BREAK_CATEGORY_META.unknown;
          return (
            <div key={cat}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-700 mb-1.5">
                {meta.label} <span className="text-gray-400">· {items.length}</span>
              </div>
              <p className="text-[11px] text-gray-500 mb-2">{meta.description}</p>
              <ul className="divide-y divide-canvas-100 border border-canvas-200 rounded-lg overflow-hidden">
                {items.map((b) => (
                  <li key={b.id} className="px-3 py-2.5 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                          <span className="font-semibold text-gray-900">
                            {BREAK_TYPE_LABELS[b.break_type] ?? b.break_type}
                          </span>
                          <span className="text-gray-300">·</span>
                          <span className="font-mono text-gray-800">{b.isin || "n/a"}</span>
                          <span className="text-gray-300">·</span>
                          <span className="text-[11px] text-gray-500 tabular-nums">
                            {b.portfolio_id || "—"} · {b.business_date}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[12.5px] tabular-nums">
                          <span className="text-gray-700">
                            Per custodian: <span className="font-semibold">{b.bank_value}</span>
                          </span>
                          <ArrowRight className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-700">
                            Per ledger: <span className="font-semibold">{b.beakon_value}</span>
                          </span>
                        </div>
                        {b.suggested_resolution && (
                          <p className="mt-1.5 text-xs text-gray-600 max-w-3xl leading-relaxed">
                            <span className="font-semibold text-gray-700">Suggested next step: </span>
                            {b.suggested_resolution}
                          </p>
                        )}
                      </div>
                      <button type="button"
                        onClick={() => onOpenStatement(b.drop)}
                        className="text-xs text-brand-700 hover:text-brand-900 font-medium shrink-0">
                        Open statement →
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}


// ─────────────────────────────────────────────────────────────────
// Statement detail drawer
// ─────────────────────────────────────────────────────────────────


function DetailDrawer({
  loading, detail, onClose, onReprocess, reprocessBusy,
}: {
  loading: boolean;
  detail: DropDetail | null;
  onClose: () => void;
  onReprocess: (id: number) => void;
  reprocessBusy: boolean;
}) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "cash" | "trades" | "holdings" | "performance" | "orders" | "audit"
  >("overview");

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-[1px]"
           onClick={onClose} />
      <aside className="relative ml-auto h-full w-full max-w-3xl bg-white shadow-xl overflow-y-auto">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-canvas-200 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">
              {loading || !detail
                ? "Loading statement…"
                : <span className="font-mono">{detail.drop.file_name}</span>}
            </h2>
            {detail && (
              <p className="text-xs text-gray-500 mt-0.5">
                {detail.drop.custodian_name || "no custodian linked"} ·{" "}
                Business date {detail.drop.business_date} ·{" "}
                <span className={cn(
                  "inline-flex items-center rounded-full px-1.5 py-0 text-[10px] ring-1",
                  DISPLAY_STATUS_TONE[detail.drop.display_status] ?? DISPLAY_STATUS_TONE["Received"],
                )}>{detail.drop.display_status}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {detail && (
              <button type="button"
                onClick={() => onReprocess(detail.drop.id)}
                disabled={reprocessBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-canvas-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-canvas-50 disabled:opacity-50"
                title="Re-process this statement from the original file">
                <RotateCw className={cn("w-3.5 h-3.5",
                  reprocessBusy && "animate-spin")} />
                Re-process
              </button>
            )}
            <button type="button" onClick={onClose}
                    className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Tabs */}
        {detail && (
          <nav className="flex gap-1 border-b border-canvas-200 px-3 sticky top-[57px] bg-white z-10">
            {[
              ["overview", "Overview"],
              ["cash", `Cash (${detail.samples.cash.length})`],
              ["trades", `Trades (${detail.samples.securities.length})`],
              ["holdings", `Holdings (${detail.samples.positions.length})`],
              ["performance", `Performance (${detail.samples.performance.length})`],
              ["orders", `Orders (${detail.samples.orderbook.length})`],
              ["audit", "Audit"],
            ].map(([key, label]) => (
              <button
                key={key} type="button"
                onClick={() => setActiveTab(key as any)}
                className={cn(
                  "px-3 py-2 text-xs font-medium border-b-2 -mb-[1px]",
                  activeTab === key
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-gray-500 hover:text-gray-700",
                )}
              >{label}</button>
            ))}
          </nav>
        )}

        {loading || !detail ? (
          <div className="p-12 text-center text-sm text-gray-500">Loading…</div>
        ) : (
          <div className="p-5 space-y-6">
            {activeTab === "overview" && <OverviewTab detail={detail} />}
            {activeTab === "cash" &&
              <SectionTable rows={detail.samples.cash} cols={[
                ["Date", "date", "date"], ["Description", "description", "text"],
                ["Amount", "amount", "amount"], ["Currency", "currency", "text"],
              ]} />}
            {activeTab === "trades" &&
              <SectionTable rows={detail.samples.securities} cols={[
                ["Trade date", "trade_date", "date"], ["ISIN", "isin", "mono"],
                ["Instrument", "instrument_name", "text"], ["Side", "side", "side"],
                ["Qty", "quantity", "qty"], ["Price", "price", "amount"],
                ["Ccy", "currency", "text"],
              ]} />}
            {activeTab === "holdings" &&
              <SectionTable rows={detail.samples.positions} cols={[
                ["ISIN", "isin", "mono"], ["Instrument", "instrument_name", "text"],
                ["Qty", "quantity", "qty"], ["Market value", "market_value", "amount"],
                ["Ccy", "currency", "text"],
              ]} />}
            {activeTab === "performance" &&
              <SectionTable rows={detail.samples.performance} cols={[
                ["Period", "period", "mono"], ["Return %", "return_pct", "pct"],
                ["Return amount", "return_amount", "amount"], ["Ccy", "currency", "text"],
              ]} />}
            {activeTab === "orders" &&
              <SectionTable rows={detail.samples.orderbook} cols={[
                ["Order date", "order_date", "date"], ["ISIN", "isin", "mono"],
                ["Side", "side", "side"], ["Qty", "quantity", "qty"],
                ["Limit", "limit_price", "amount"], ["Status", "order_status", "text"],
              ]} />}
            {activeTab === "audit" && <AuditTab detail={detail} />}
          </div>
        )}
      </aside>
    </div>
  );
}


function OverviewTab({ detail }: { detail: DropDetail }) {
  const d = detail.drop;
  const total = Object.values(d.file_counts || {}).reduce((a, b) => a + (b as number), 0);
  return (
    <div className="space-y-5">
      {/* Section counts */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">
        {Object.entries(d.file_counts || {}).map(([t, n]) => (
          <div key={t} className={cn(
            "rounded-lg ring-1 px-3 py-2.5",
            FILE_TYPE_LABELS[t]?.tone ?? "bg-canvas-50 text-gray-700 ring-canvas-200",
          )}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
              {FILE_TYPE_LABELS[t]?.label ?? t}
            </div>
            <div className="text-xl font-semibold tabular-nums mt-0.5">
              {n as number}
            </div>
          </div>
        ))}
      </div>
      {total === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-3.5 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">Empty statement.</span>{" "}
              The custodian sent the daily file but there were no movements,
              trades, or orders to report. Holdings are still reconciled
              against your ledger and any open differences are listed below.
            </div>
          </div>
        </div>
      )}

      {/* Provenance */}
      <SectionBlock icon={MapPin} title="Provenance"
                    subtitle="Where the statement came from and how we know it's the same file the bank sent.">
        <div className="grid gap-3 sm:grid-cols-2 text-[12.5px]">
          <KV k="Received at" v={d.received_at_cet ?? "—"} />
          <KV k="SLA cutoff" v={`08:00 CET on ${d.business_date}`} />
          <KV k="Source IP" v={
            <span className={cn("inline-flex items-center gap-1.5 font-mono",
              d.source_ip_match === "allowlisted" ? "text-mint-700" :
              d.source_ip_match === "rejected" ? "text-rose-700" :
              "text-gray-500",
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full",
                d.source_ip_match === "allowlisted" ? "bg-mint-500" :
                d.source_ip_match === "rejected" ? "bg-rose-500" :
                "bg-gray-400",
              )} />
              {d.source_ip || "unknown"}{" "}
              <span className="text-gray-500 ml-1">
                ({d.source_ip_match})
              </span>
            </span>
          } />
          <KV k="Custodian" v={`${d.custodian_code || "—"} · ${d.custodian_name || ""}`} />
          <KV k="Schema version" v={d.schema_version || "—"} />
          <KV k="File size" v={fmtBytes(d.file_size_bytes)} />
          <KV k="SHA-256" v={
            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
              {d.sha256.slice(0, 16)}…
              <button type="button" title="Copy full hash"
                onClick={() => navigator.clipboard?.writeText(d.sha256)}
                className="text-gray-400 hover:text-gray-700">
                <ClipboardCopy className="w-3 h-3" />
              </button>
            </span>
          } />
          <KV k="Prior statement" v={
            d.prior_drop ? `#${d.prior_drop} (T-1)` : "none"
          } />
        </div>
      </SectionBlock>

      {/* Differences scoped to this statement */}
      {detail.breaks.length > 0 && (
        <SectionBlock icon={ShieldAlert} title="Reconciliation differences"
                      subtitle="Differences detected while reconciling this statement's holdings.">
          <ul className="space-y-2">
            {detail.breaks.map((b) => {
              const meta = BREAK_CATEGORY_META[b.category] ?? BREAK_CATEGORY_META.unknown;
              return (
                <li key={b.id} className="rounded-md border border-rose-200 bg-rose-50/40 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] ring-1",
                      meta.tone)}>{meta.label}</span>
                    <span className="font-semibold text-rose-900">
                      {BREAK_TYPE_LABELS[b.break_type] ?? b.break_type} · <span className="font-mono">{b.isin}</span>
                    </span>
                  </div>
                  <div className="mt-1 text-rose-900 tabular-nums">
                    Per custodian: {b.bank_value} → Per ledger: {b.beakon_value}
                  </div>
                  {b.suggested_resolution && (
                    <div className="mt-1 text-rose-800">
                      <span className="font-semibold">Next step:</span> {b.suggested_resolution}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </SectionBlock>
      )}

      {/* Re-process notes */}
      {d.notes && (
        <SectionBlock icon={FileWarning} title="Notes"
                      subtitle="Operator-added context — typically re-processing history.">
          <pre className="text-[12px] text-gray-700 whitespace-pre-wrap leading-relaxed">{d.notes}</pre>
        </SectionBlock>
      )}
    </div>
  );
}


function AuditTab({ detail }: { detail: DropDetail }) {
  const d = detail.drop;
  const events: Array<{ at: string | null; what: string; detail?: string }> = [
    { at: d.received_at, what: "Received",
      detail: `From ${d.source_ip || "unknown IP"} · ${fmtBytes(d.file_size_bytes)} · SHA-256 verified` },
    { at: d.ingest_started_at, what: "Posting started" },
    { at: d.ingest_completed_at, what: "Posted to ledger",
      detail: `${Object.values(d.file_counts || {}).reduce((a, b) => a + (b as number), 0)} line items` },
  ];
  if (detail.breaks.length > 0) {
    events.push({
      at: d.ingest_completed_at, what: "Reconciliation completed",
      detail: `${detail.breaks.length} difference(s) detected`,
    });
  }
  return (
    <div className="space-y-1">
      {events.filter((e) => e.at).map((e, i) => (
        <div key={i} className="flex items-start gap-3 px-2 py-2 hover:bg-canvas-50 rounded">
          <span className="text-[11px] tabular-nums text-gray-500 shrink-0 w-40">
            {fmtDateTime(e.at)}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-medium text-gray-900">{e.what}</span>
            {e.detail && <p className="text-[12px] text-gray-600 mt-0.5">{e.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}


function SectionBlock({ icon: Icon, title, subtitle, children }: {
  icon: any; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </header>
      {subtitle && <p className="text-xs text-gray-500 mb-2 max-w-2xl">{subtitle}</p>}
      {children}
    </section>
  );
}


function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{k}</dt>
      <dd className="text-gray-800">{v}</dd>
    </div>
  );
}


function SectionTable({ rows, cols }: {
  rows: any[];
  cols: Array<[string, string, string]>;  // [label, key, formatter]
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-canvas-200 bg-canvas-50/40 px-4 py-8 text-center">
        <p className="text-sm text-gray-500">No rows in this section of the statement.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-canvas-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-[10.5px] uppercase tracking-wider text-gray-500 bg-canvas-50/60">
          <tr>{cols.map(([label]) => (
            <th key={label} className="text-left font-medium px-3 py-2">{label}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-canvas-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-canvas-50/40">
              {cols.map(([label, key, fmt]) => (
                <td key={label} className="px-3 py-2 text-gray-800">
                  {formatCell(r[key], fmt)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function formatCell(v: any, fmt: string): React.ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-gray-400">—</span>;
  if (fmt === "date") return <span className="tabular-nums">{v}</span>;
  if (fmt === "mono") return <span className="font-mono text-[12px]">{v}</span>;
  if (fmt === "amount") {
    const n = Number(v);
    return <span className={cn("tabular-nums",
      n < 0 ? "text-rose-700 font-medium" : "text-gray-800",
    )}>{n.toFixed(2)}</span>;
  }
  if (fmt === "qty") {
    return <span className="tabular-nums">{Number(v).toFixed(0)}</span>;
  }
  if (fmt === "pct") {
    return <span className="tabular-nums">{Number(v).toFixed(4)}%</span>;
  }
  if (fmt === "side") {
    return <span className={cn("text-[11px] font-semibold uppercase tracking-wider",
      v === "BUY" ? "text-mint-700" : "text-rose-700")}>{v}</span>;
  }
  return String(v);
}
