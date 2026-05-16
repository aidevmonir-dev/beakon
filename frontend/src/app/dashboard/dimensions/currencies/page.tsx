"use client";

/* Currencies — ISO 4217 registry surfaced as a financial dimension on the
 * /dashboard/dimensions hub. Currencies live in a global table (not as
 * DimensionValues) but Thomas's framing is "every classification axis is
 * a dimension," so the screen mirrors Subaccounts: sectioned table,
 * monospace codes, sticky header, stat strip, search.
 *
 * Two sections:
 *   - In use   — at least one entity uses this currency as functional
 *                or reporting; sorted by usage count.
 *   - Available — active ISO currencies not yet adopted by any entity.
 *
 * Edit happens via the Currency admin (or the Entity setup screen);
 * we don't duplicate that surface here — same convention as Subaccounts
 * linking back to CoA.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ChevronDown, Coins, Globe, Loader2, Search, Layers,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";


interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  is_active: boolean;
}

interface Entity {
  id: number;
  code: string;
  name: string;
  functional_currency: string;
  reporting_currency: string;
}

interface ApiResp<T> { results?: T[]; count?: number; }

type SectionKey = "in_use" | "available";

const SECTIONS: {
  value: SectionKey;
  label: string;
  blurb: string;
  rail: string;
}[] = [
  {
    value: "in_use",
    label: "In use",
    blurb: "Adopted by at least one entity as functional or reporting currency.",
    rail: "bg-emerald-500",
  },
  {
    value: "available",
    label: "Available",
    blurb: "Active ISO 4217 currencies not yet adopted by any entity.",
    rail: "bg-gray-400",
  },
];


export default function CurrenciesPage() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    in_use: false, available: true,
  });

  useEffect(() => {
    setLoading(true); setErr(null);
    Promise.all([
      api.get<ApiResp<Currency> | Currency[]>("/beakon/currencies/")
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => [] as Currency[]),
      api.get<ApiResp<Entity> | Entity[]>("/beakon/entities/", { page_size: "500" })
        .then((d) => Array.isArray(d) ? d : (d.results ?? []))
        .catch(() => [] as Entity[]),
    ])
      .then(([curs, ents]) => {
        setCurrencies(curs);
        setEntities(ents);
      })
      .catch((e) => setErr(e?.error?.message || e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // Count how many entities adopt each currency (functional + reporting).
  const usageByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entities) {
      const codes = new Set<string>();
      if (e.functional_currency) codes.add(e.functional_currency);
      if (e.reporting_currency) codes.add(e.reporting_currency);
      for (const c of codes) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [entities]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => currencies.filter((c) => {
    if (!q) return true;
    return `${c.code} ${c.name} ${c.symbol}`.toLowerCase().includes(q);
  }), [currencies, q]);

  const grouped = useMemo(() => {
    const inUse: Currency[] = [];
    const available: Currency[] = [];
    for (const c of filtered) {
      if ((usageByCode.get(c.code) ?? 0) > 0) inUse.push(c);
      else available.push(c);
    }
    inUse.sort((a, b) =>
      (usageByCode.get(b.code) ?? 0) - (usageByCode.get(a.code) ?? 0)
      || a.code.localeCompare(b.code),
    );
    available.sort((a, b) => a.code.localeCompare(b.code));
    return { in_use: inUse, available };
  }, [filtered, usageByCode]);

  const toggleSection = (k: SectionKey) =>
    setCollapsed((p) => ({ ...p, [k]: !p[k] }));

  const totals = {
    all: currencies.length,
    in_use: grouped.in_use.length,
    available: grouped.available.length,
  };

  return (
    <div>
      <Link href="/dashboard/dimensions"
            className="inline-flex items-center text-xs text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Dimensions
      </Link>

      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-600" /> Currencies
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-[640px]">
            The ISO 4217 currencies known to Beakon. Each entity declares a
            functional currency for its books and an optional reporting
            currency for consolidation — both drive the FX engine.
          </p>
        </div>
        <Link href="/dashboard/fx-rates"
              className="btn-secondary text-xs inline-flex items-center gap-1">
          <Coins className="w-3.5 h-3.5" /> FX rates
        </Link>
      </div>

      {/* ── Stat strip ─────────────────────────────────────── */}
      {!loading && !err && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-3">
          <StatCard label="Currencies" value={totals.all.toString()} mono />
          <StatCard label="In use" value={totals.in_use.toString()} accent="bg-emerald-500" mono />
          <StatCard label="Available" value={totals.available.toString()} accent="bg-gray-400" mono />
          <StatCard label="Entities tracked" value={entities.length.toString()} mono />
        </div>
      )}

      {/* ── Search ─────────────────────────────────────────── */}
      <div className="relative mb-4 max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search currency code, name, symbol…"
          className="input pl-9 w-full"
        />
      </div>

      {loading ? (
        <div className="card p-8 flex items-center justify-center text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading currencies…
        </div>
      ) : err ? (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          {q ? "No currencies match that search." : "No currencies loaded yet."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/90 backdrop-blur">
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-[0.12em] border-b border-canvas-100">
                <th className="pl-5 pr-2 py-2.5 w-[90px] font-medium">Code</th>
                <th className="pr-4 py-2.5 font-medium">Currency</th>
                <th className="hidden md:table-cell pr-4 py-2.5 font-medium w-[80px]">Symbol</th>
                <th className="hidden md:table-cell pr-4 py-2.5 font-medium w-[80px]">Decimals</th>
                <th className="pr-4 py-2.5 text-right font-medium w-[120px]">Entities</th>
                <th className="pr-3 py-2.5 w-[28px]" />
              </tr>
            </thead>
            {SECTIONS.map((sec) => {
              const rows = grouped[sec.value];
              if (rows.length === 0) return null;
              const isOpen = !collapsed[sec.value];
              return (
                <tbody key={sec.value} className="border-t border-canvas-100">
                  <tr
                    onClick={() => toggleSection(sec.value)}
                    className="group cursor-pointer bg-canvas-50/40 hover:bg-canvas-50 select-none"
                  >
                    <td className="relative pl-5 pr-2 py-2.5">
                      <span className={cn("absolute left-0 top-0 bottom-0 w-1", sec.rail)} />
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-canvas-200 text-gray-600">
                        <Coins className="h-3.5 w-3.5" />
                      </span>
                    </td>
                    <td colSpan={3} className="pr-4 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-gray-900 tracking-tight">
                          {sec.label}
                        </span>
                        <span className="text-[11px] text-gray-400 font-medium">
                          {rows.length} {rows.length === 1 ? "currency" : "currencies"}
                        </span>
                        <span className="hidden lg:inline text-[11px] text-gray-400">
                          · {sec.blurb}
                        </span>
                      </div>
                    </td>
                    <td className="pr-4 py-2.5 text-right">
                      <span className="font-mono text-[13px] font-semibold text-gray-900 tabular-nums">
                        {rows.reduce((s, c) => s + (usageByCode.get(c.code) ?? 0), 0)}
                      </span>
                    </td>
                    <td className="pr-3 py-2.5">
                      <ChevronDown className={cn(
                        "h-4 w-4 text-gray-400 transition-transform",
                        isOpen ? "" : "-rotate-90",
                      )} />
                    </td>
                  </tr>

                  {isOpen && rows.map((c) => {
                    const used = usageByCode.get(c.code) ?? 0;
                    return (
                      <tr
                        key={c.code}
                        className="group transition-colors hover:bg-brand-50/30"
                      >
                        <td className="pl-5 pr-2 py-2 font-mono text-[12px] text-gray-700 tabular-nums">
                          {c.code}
                        </td>
                        <td className="pr-4 py-2 min-w-0">
                          <span className="text-sm text-gray-900 truncate">{c.name}</span>
                        </td>
                        <td className="hidden md:table-cell pr-4 py-2">
                          <span className="font-mono text-sm text-gray-700">
                            {c.symbol || <span className="text-gray-300">—</span>}
                          </span>
                        </td>
                        <td className="hidden md:table-cell pr-4 py-2 font-mono text-sm text-gray-600 tabular-nums">
                          {c.decimal_places}
                        </td>
                        <td className="pr-4 py-2 text-right">
                          {used > 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                              <Layers className="h-3 w-3" />
                              <span className="font-mono tabular-nums">{used}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-300">
                              <Globe className="h-3 w-3" />
                              <span>not adopted</span>
                            </span>
                          )}
                        </td>
                        <td className="pr-3 py-2 text-right">
                          <span className="text-gray-300" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
          <div className="px-5 py-2 text-[11px] text-gray-500 border-t border-canvas-100 bg-canvas-50/40 flex items-center justify-between">
            <span>
              Showing {filtered.length} of {currencies.length} currencies
            </span>
            <span className="font-mono tabular-nums">
              {entities.length} entities · {usageByCode.size} adopted codes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}


function StatCard({
  label, value, accent, mono,
}: { label: string; value: string; accent?: string; mono?: boolean }) {
  return (
    <div className="card relative overflow-hidden px-3 py-2.5">
      {accent && <span className={cn("absolute left-0 top-0 bottom-0 w-0.5", accent)} />}
      <div className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-medium">{label}</div>
      <div className={cn("text-base text-gray-900 mt-0.5", mono && "font-mono tabular-nums")}>
        {value}
      </div>
    </div>
  );
}
