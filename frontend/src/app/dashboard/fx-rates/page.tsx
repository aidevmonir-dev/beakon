"use client";

/* FX rates — time-series. Service picks most-recent on or before the JE
 * date when converting transaction currency to functional. Without rates
 * loaded for the relevant pairs, multi-currency JEs and FX revaluation
 * will fail with FXRateMissing. */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtRate } from "@/lib/format";


interface FXRate {
  id: number;
  from_currency: string;
  to_currency: string;
  rate: string;
  as_of: string;
  source: string;
  created_at: string;
}


export default function FXRatesPage() {
  const [rates, setRates] = useState<FXRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [pairFilter, setPairFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.get<{ results: FXRate[] } | FXRate[]>("/beakon/fx-rates/");
      setRates(Array.isArray(d) ? d : (d.results ?? []));
    } catch {
      setRates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (!pairFilter) return rates;
    const f = pairFilter.toUpperCase();
    return rates.filter((r) =>
      r.from_currency.includes(f) || r.to_currency.includes(f),
    );
  }, [rates, pairFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">FX Rates</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Time-series exchange rates. The kernel uses the most recent rate on
            or before each JE date. Inverse pairs are resolved automatically.
          </p>
        </div>
        <button onClick={() => setDrawer(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Rate
        </button>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-4 text-xs">
          <input
            className="input max-w-xs"
            placeholder="Filter by currency code (e.g. EUR)"
            value={pairFilter}
            onChange={(e) => setPairFilter(e.target.value)}
          />
          <span className="ml-auto text-gray-400">
            {loading ? "loading…" : `${filtered.length} rates`}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <ArrowLeftRight className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No FX rates loaded.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">From</th>
                  <th className="pb-2 pr-4 font-medium">To</th>
                  <th className="pb-2 pl-4 font-medium text-right">Rate</th>
                  <th className="pb-2 pl-4 font-medium">As of</th>
                  <th className="pb-2 pl-4 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas-50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{r.from_currency}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{r.to_currency}</td>
                    <td className="py-2 pl-4 text-right font-mono text-gray-900 tabular-nums">{fmtRate(r.rate)}</td>
                    <td className="py-2 pl-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(r.as_of)}</td>
                    <td className="py-2 pl-4 text-xs text-gray-500">{r.source || "—"}</td>
                  </tr>
                ))}
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
          <h2 className="text-base font-semibold">New FX Rate</h2>
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
              placeholder="manual / ecb / openexchange"
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
            />
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
