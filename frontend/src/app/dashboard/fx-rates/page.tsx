"use client";

/* FX Rates — time-series exchange rates with one-click ECB sync.
 *
 * Visual vocabulary matches /dashboard/accounts and /dashboard/bank:
 * PageHeader, SummaryStat strip, FilterChip rail, sticky-header table,
 * drawer for create.
 *
 * Live-data path:
 *   POST /beakon/fx-rates/sync-ecb/ pulls today's reference fixing from
 *   the European Central Bank, stores ~30 EUR-base pairs + inverses +
 *   CHF cross-rates. Source field is set to "ecb". Manual entries keep
 *   their original source label.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight, Coins, Globe, Plus, RefreshCcw, Search, Sparkles, X,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtRate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";


interface FXRate {
  id: number;
  from_currency: string;
  to_currency: string;
  rate: string;
  as_of: string;
  source: string;
  created_at: string;
}

interface SyncResp {
  fetched_days: number;
  rows_upserted: number;
  inverses_added: number;
  cross_rates_added: number;
  latest_date: string | null;
  source_url: string;
}


/* Source colour-coding — ecb is the headline. */
const SOURCE_TONE: Record<string, string> = {
  ecb:           "bg-brand-50 text-brand-700 ring-brand-100",
  manual:        "bg-canvas-100 text-gray-600 ring-canvas-200",
  smoketest:     "bg-amber-50 text-amber-700 ring-amber-100",
  openexchange:  "bg-violet-50 text-violet-700 ring-violet-100",
};
const SOURCE_TONE_DEFAULT = "bg-canvas-100 text-gray-600 ring-canvas-200";


export default function FXRatesPage() {
  const [rates, setRates] = useState<FXRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResp | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ results: FXRate[] } | FXRate[]>(
        "/beakon/fx-rates/", { ordering: "-as_of", page_size: "500" },
      );
      setRates(Array.isArray(d) ? d : (d.results ?? []));
    } catch {
      setRates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const onSync = async (days: number) => {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      const r = await api.post<SyncResp>("/beakon/fx-rates/sync-ecb/", { days });
      setSyncResult(r);
      await load();
    } catch (e: any) {
      setSyncError(e?.error?.message || e?.detail || e?.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // ── Stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const sources = new Set(rates.map((r) => r.source).filter(Boolean));
    const pairs = new Set(rates.map((r) => `${r.from_currency}-${r.to_currency}`));
    const ccys = new Set<string>();
    for (const r of rates) {
      ccys.add(r.from_currency);
      ccys.add(r.to_currency);
    }
    const ecb = rates.filter((r) => r.source === "ecb");
    const ecbDates = ecb.map((r) => r.as_of).sort();
    return {
      total: rates.length,
      pairs: pairs.size,
      currencies: ccys.size,
      sources: Array.from(sources),
      ecbCount: ecb.length,
      latestEcb: ecbDates.length ? ecbDates[ecbDates.length - 1] : null,
    };
  }, [rates]);

  // ── Filtered ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rates.filter((r) => {
      if (sourceFilter && r.source !== sourceFilter) return false;
      if (q) {
        const blob = `${r.from_currency} ${r.to_currency} ${r.from_currency}/${r.to_currency}`;
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rates, search, sourceFilter]);

  // ── Source filter chip set ────────────────────────────────────────
  const knownSources = ["ecb", "manual", "smoketest"].filter((s) => stats.sources.includes(s));

  return (
    <div>
      <PageHeader
        title="FX Rates"
        description="Time-series exchange rates feeding the kernel's multi-currency posting and FX revaluation. Click 'Sync ECB' for free daily reference fixings — no API key, no fees, ~30 majors plus CHF cross-rates."
        context={
          <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
            <Coins className="h-3.5 w-3.5 text-brand-600" />
            <span className="font-medium text-gray-800">{stats.pairs} pair{stats.pairs === 1 ? "" : "s"}</span>
            <span className="text-gray-300">·</span>
            <span className="tabular-nums">{stats.currencies} currencies</span>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSync(1)}
              disabled={syncing}
              className="btn-primary"
              title="Pull today's ECB reference fixing"
            >
              <RefreshCcw className={cn("w-4 h-4 mr-1.5", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync ECB"}
            </button>
            <button
              onClick={() => onSync(90)}
              disabled={syncing}
              className="btn-secondary"
              title="Backfill 90 business days"
            >
              <Sparkles className="w-4 h-4 mr-1.5" /> Backfill 90d
            </button>
            <button onClick={() => setDrawer(true)} className="btn-secondary">
              <Plus className="w-4 h-4 mr-1.5" /> Manual rate
            </button>
          </div>
        }
      />

      {/* ── Sync feedback strip ──────────────────────────────────── */}
      {syncResult && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold text-emerald-900">
              ECB sync complete.
            </span>{" "}
            <span className="text-emerald-800">
              Pulled {syncResult.fetched_days} day{syncResult.fetched_days === 1 ? "" : "s"} ·
              upserted <span className="tabular-nums font-mono">{syncResult.rows_upserted}</span> rows
              {syncResult.cross_rates_added > 0 && (
                <> ({syncResult.cross_rates_added} CHF cross-rates)</>
              )}
              {syncResult.latest_date && (
                <> · latest fixing <span className="font-mono">{syncResult.latest_date}</span></>
              )}.
            </span>
          </div>
          <button
            onClick={() => setSyncResult(null)}
            className="text-emerald-400 hover:text-emerald-700"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {syncError && (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2 text-xs">
          <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold text-rose-900">ECB sync failed.</span>{" "}
            <span className="text-rose-800">{syncError}</span>
          </div>
          <button
            onClick={() => setSyncError(null)}
            className="text-rose-400 hover:text-rose-700"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Summary tiles ────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat
          label="Total rates"
          value={stats.total}
          hint={stats.total === 0 ? "Click 'Sync ECB' to load" : "Across all dates and pairs"}
        />
        <SummaryStat
          label="Currency pairs"
          value={stats.pairs}
          hint={`${stats.currencies} currencies`}
        />
        <SummaryStat
          label="ECB rows"
          value={stats.ecbCount}
          hint={stats.latestEcb ? `Latest: ${stats.latestEcb}` : "Not yet synced"}
        />
        <SummaryStat
          label="Sources"
          value={stats.sources.length || "—"}
          hint={stats.sources.join(" · ") || "—"}
        />
      </div>

      {/* ── Filters ──────────────────────────────────────────────── */}
      <div className="mt-5 mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by currency code (e.g. CHF, USD)…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-canvas-200 bg-white focus:border-brand-300 focus:outline-none uppercase"
          />
        </div>
        <FilterChip active={!sourceFilter} onClick={() => setSourceFilter("")}>
          All sources
        </FilterChip>
        {knownSources.map((s) => (
          <FilterChip
            key={s}
            active={sourceFilter === s}
            onClick={() => setSourceFilter(sourceFilter === s ? "" : s)}
          >
            {s}
          </FilterChip>
        ))}
        {(search || sourceFilter) && (
          <button
            onClick={() => { setSearch(""); setSourceFilter(""); }}
            className="text-xs text-gray-400 hover:text-gray-700 underline ml-1"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400 tabular-nums">
          {loading ? "loading…" : `${filtered.length} of ${rates.length}`}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {loading ? (
          <table className="w-full text-sm">
            <tbody>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={5} />)}</tbody>
          </table>
        ) : rates.length === 0 ? (
          <EmptyState
            icon={Globe}
            title="No FX rates loaded yet"
            description="The European Central Bank publishes free reference fixings for ~30 currencies daily — no API key required. One click to populate the table."
            primaryAction={{
              label: "Sync ECB rates",
              icon: RefreshCcw,
              onClick: () => onSync(1),
            }}
            secondaryAction={{
              label: "Add manually",
              onClick: () => setDrawer(true),
            }}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No rates match these filters"
            description="Try clearing the search or source chips above."
            primaryAction={{
              label: "Clear filters",
              onClick: () => { setSearch(""); setSourceFilter(""); },
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Pair</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Rate</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Mnemonic</th>
                  <th className="px-4 py-2.5 text-left font-semibold">As of</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((r) => {
                  const tone = SOURCE_TONE[r.source] ?? SOURCE_TONE_DEFAULT;
                  return (
                    <tr key={r.id} className="hover:bg-canvas-50/40">
                      <td className="px-4 py-2.5">
                        <div className="inline-flex items-center gap-2">
                          <span className="font-mono font-semibold text-gray-900">{r.from_currency}</span>
                          <ArrowLeftRight className="w-3.5 h-3.5 text-gray-300" />
                          <span className="font-mono font-semibold text-gray-900">{r.to_currency}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-900 tabular-nums">
                        {fmtRate(r.rate)}
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-gray-500">
                        1 <span className="font-mono">{r.from_currency}</span> ={" "}
                        <span className="font-mono">{fmtRate(r.rate)}</span>{" "}
                        <span className="font-mono">{r.to_currency}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtDate(r.as_of)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          "inline-flex items-center rounded-full ring-1 ring-inset px-2 py-0.5 text-[10px] font-medium",
                          tone,
                        )}>
                          {r.source || "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <RateDrawer
          onClose={() => setDrawer(false)}
          onCreated={async () => { setDrawer(false); await load(); }}
        />
      )}
    </div>
  );
}


function RateDrawer({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    from_currency: "USD",
    to_currency: "EUR",
    rate: "1.0000",
    as_of: today,
    source: "manual",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/beakon/fx-rates/", {
        from_currency: form.from_currency.toUpperCase().trim(),
        to_currency: form.to_currency.toUpperCase().trim(),
        rate: form.rate,
        as_of: form.as_of,
        source: form.source.trim(),
      });
      await onCreated();
    } catch (e: any) {
      setErr(JSON.stringify(e?.detail || e || "Failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-full sm:w-[420px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold">Manual FX Rate</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">From *</span>
              <input
                className="input mt-1 uppercase"
                maxLength={3}
                value={form.from_currency}
                onChange={(e) => setForm((f) => ({ ...f, from_currency: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">To *</span>
              <input
                className="input mt-1 uppercase"
                maxLength={3}
                value={form.to_currency}
                onChange={(e) => setForm((f) => ({ ...f, to_currency: e.target.value }))}
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Rate *</span>
            <input
              className="input mt-1 font-mono"
              type="number"
              step="0.0000000001"
              value={form.rate}
              onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
            />
            <span className="text-[10px] text-gray-400 mt-0.5 block">
              How many units of {form.to_currency || "to"} = 1 unit of {form.from_currency || "from"}.
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">As of *</span>
            <input
              type="date"
              className="input mt-1"
              value={form.as_of}
              onChange={(e) => setForm((f) => ({ ...f, as_of: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Source</span>
            <input
              className="input mt-1"
              placeholder="manual / openexchange / …"
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
            />
            <span className="text-[10px] text-gray-400 mt-0.5 block">
              ECB rates are auto-tagged source=&quot;ecb&quot; — use this for hand-keyed
              or third-party rates that aren&apos;t in the ECB feed.
            </span>
          </label>
          {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
