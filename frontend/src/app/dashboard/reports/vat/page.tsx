"use client";

/* VAT report — period summary of input/output VAT activity by tax code. */
import { useEffect, useState } from "react";
import { Calculator } from "lucide-react";
import { api } from "@/lib/api";

interface Entity { id: number; code: string; name: string; }

interface VATRow {
  tax_code_id: number | null;
  code: string;
  name: string;
  rate: string;
  sales_base: string;
  output_vat: string;
  purchases_base: string;
  input_vat: string;
  net: string;
}

interface VATReport {
  organization_id: number;
  entity_id: number | null;
  date_from: string;
  date_to: string;
  rows: VATRow[];
  total_output_vat: string;
  total_input_vat: string;
  net_vat_payable: string;
}

function defaultRange() {
  const now = new Date();
  // Default = current quarter
  const m = now.getMonth();
  const qStart = new Date(now.getFullYear(), Math.floor(m / 3) * 3, 1);
  const qEnd = new Date(now.getFullYear(), Math.floor(m / 3) * 3 + 3, 0);
  return {
    date_from: qStart.toISOString().slice(0, 10),
    date_to: qEnd.toISOString().slice(0, 10),
  };
}

export default function VATReportPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState<string>("");
  const [range, setRange] = useState(defaultRange);
  const [report, setReport] = useState<VATReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => Array.isArray(d) ? d : (d.results ?? []))
      .then(setEntities)
      .catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.post<VATReport>("/beakon/reports/vat/", {
        date_from: range.date_from,
        date_to: range.date_to,
        entity: entityId ? Number(entityId) : null,
      });
      setReport(r);
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">VAT Report</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Period summary of output VAT (sales) and input VAT (purchases) by tax code.
            Net = output − input. Positive net = payable to the tax authority; negative = refundable.
          </p>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Entity</span>
            <select className="input mt-1" value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}>
              <option value="">All entities</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">From *</span>
            <input className="input mt-1" type="date" required value={range.date_from}
                   onChange={(e) => setRange((r) => ({ ...r, date_from: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">To *</span>
            <input className="input mt-1" type="date" required value={range.date_to}
                   onChange={(e) => setRange((r) => ({ ...r, date_to: e.target.value }))} />
          </label>
          <div className="flex items-end">
            <button onClick={run} disabled={loading} className="btn-primary w-full">
              {loading ? "Running…" : "Run report"}
            </button>
          </div>
        </div>
        {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
      </div>

      {report ? (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">
              {report.date_from} → {report.date_to}
            </h2>
            <div className="text-xs text-gray-500">
              Output: <span className="font-mono tabular-nums text-gray-900">{report.total_output_vat}</span>
              {" · "}Input: <span className="font-mono tabular-nums text-gray-900">{report.total_input_vat}</span>
              {" · "}<strong>Net payable:</strong>{" "}
              <span className={`font-mono tabular-nums ${
                Number(report.net_vat_payable) >= 0 ? "text-amber-700" : "text-mint-700"
              }`}>{report.net_vat_payable}</span>
            </div>
          </div>
          {report.rows.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">No VAT activity in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                    <th className="pb-2 pr-4 font-medium">Code</th>
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium text-right">Rate</th>
                    <th className="pb-2 pr-4 font-medium text-right">Sales base</th>
                    <th className="pb-2 pr-4 font-medium text-right">Output VAT</th>
                    <th className="pb-2 pr-4 font-medium text-right">Purchases base</th>
                    <th className="pb-2 pr-4 font-medium text-right">Input VAT</th>
                    <th className="pb-2 pr-4 font-medium text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-canvas-100">
                  {report.rows.map((r) => (
                    <tr key={r.tax_code_id ?? "untagged"} className="hover:bg-canvas-50">
                      <td className="py-2 pr-4 font-mono text-xs text-gray-700">{r.code}</td>
                      <td className="py-2 pr-4 text-gray-900">{r.name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-xs">{r.rate}%</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.sales_base}</td>
                      <td className="py-2 pr-4 text-right tabular-nums font-medium text-amber-700">{r.output_vat}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.purchases_base}</td>
                      <td className="py-2 pr-4 text-right tabular-nums font-medium text-mint-700">{r.input_vat}</td>
                      <td className="py-2 pr-4 text-right tabular-nums font-semibold">{r.net}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm font-semibold border-t-2 border-canvas-200">
                  <tr>
                    <td colSpan={4} className="pt-2 text-right pr-4 text-xs text-gray-500">Totals</td>
                    <td className="pt-2 pr-4 text-right tabular-nums text-amber-700">{report.total_output_vat}</td>
                    <td className="pt-2 pr-4"></td>
                    <td className="pt-2 pr-4 text-right tabular-nums text-mint-700">{report.total_input_vat}</td>
                    <td className="pt-2 pr-4 text-right tabular-nums">{report.net_vat_payable}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <Calculator className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Pick a date range and run the report.</p>
        </div>
      )}
    </div>
  );
}
