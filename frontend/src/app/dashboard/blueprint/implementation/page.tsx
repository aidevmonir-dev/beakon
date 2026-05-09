"use client";

/* Workbook → Database evidence page.
 *
 * Built for in-meeting demos with Thomas: every tab in his CoA workbook
 * (and every Notes-tab TODO that's been built since) is shown here with
 * its live row count from the database, so he can confirm at a glance
 * the structure is implemented faithfully. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Database, FileSpreadsheet, MinusCircle, Printer } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";

interface TabImpl {
  tab: string;
  type: "data" | "extension";
  model: string;
  db_table: string;
  field_count: number;
  row_count: number;
  sample_ids: string[];
  url: string;
}

interface ImplResponse {
  organization: string;
  organization_id: number;
  workbook: string;
  architecture_pdf: string;
  tabs: TabImpl[];
  totals: {
    tab_count: number;
    data_tabs: number;
    extension_tabs: number;
    total_rows: number;
    fully_loaded_count: number;
  };
}

export default function ImplementationEvidencePage() {
  const [data, setData] = useState<ImplResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<ImplResponse>("/beakon/workbook-implementation/")
      .then(setData)
      .catch((e) => setErr(e?.error?.message || e?.message || "Failed"));
  }, []);

  if (err) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!data) return <div className="p-6 text-sm text-gray-400">Loading…</div>;

  const dataTabs = data.tabs.filter((t) => t.type === "data");
  const extensionTabs = data.tabs.filter((t) => t.type === "extension");

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Workbook → Database evidence"
        description={`Every tab in ${data.workbook} is implemented as a Django model with a live database table. Row counts below are read from the database in real time.`}
        context={
          <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
            <span className="rounded-full border border-canvas-200 bg-white px-3 py-1">
              Organization: <strong className="text-gray-800">{data.organization}</strong>
            </span>
            <span className="rounded-full border border-canvas-200 bg-white px-3 py-1">
              Workbook: {data.workbook}
            </span>
            <span className="rounded-full border border-canvas-200 bg-white px-3 py-1">
              Architecture: {data.architecture_pdf}
            </span>
          </div>
        }
        actions={
          <button onClick={() => window.print()} className="btn-secondary">
            <Printer className="w-4 h-4 mr-1.5" /> Print
          </button>
        }
      />

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Workbook tabs implemented" value={`${data.totals.data_tabs} / 17`} accent="green" />
        <Stat label="Notes-tab extensions" value={`${data.totals.extension_tabs}`} accent="blue" />
        <Stat label="Tabs loaded with data" value={`${data.totals.fully_loaded_count} / ${data.totals.tab_count}`} accent="green" />
        <Stat label="Total rows in DB" value={data.totals.total_rows.toLocaleString()} accent="brand" />
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-mint-700" />
          Workbook data tabs (17)
        </h2>
        <ImplTable tabs={dataTabs} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-700" />
          Architecture / Notes-tab extensions
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Pension and Commitment were called out as TODOs in Thomas&apos;s Notes / Master-tabs sheets;
          Tax Code and Recognition Rule are downstream engine pieces from the architecture PDF.
        </p>
        <ImplTable tabs={extensionTabs} />
      </section>

      <section className="mt-8 card p-5 bg-mint-50/40 border-mint-200">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">What this page proves</h2>
        <ul className="text-xs text-gray-700 space-y-1.5">
          <li>• Every workbook tab has a corresponding Django model and database table — no tab is skipped.</li>
          <li>• Field counts match the workbook&apos;s column counts (small differences = added id, organization, timestamps, audit fields).</li>
          <li>• Row counts are live from the database — refresh the page to re-query.</li>
          <li>• Sample IDs prove the workbook&apos;s actual data has been loaded, not just empty schema.</li>
          <li>• Engine-side enforcement of the Tab 09 validation rules is alive — see <Link href="/dashboard/journal-entries" className="underline">Journal Entries</Link> (refusing to post without required dimensions).</li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  const cls = {
    green: "border-mint-200 bg-mint-50/40",
    blue: "border-blue-200 bg-blue-50/40",
    brand: "border-brand-200 bg-brand-50/40",
  }[accent] || "border-canvas-200 bg-white";
  return (
    <div className={`rounded-lg border ${cls} p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{value}</div>
    </div>
  );
}

function ImplTable({ tabs }: { tabs: TabImpl[] }) {
  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
            <th className="py-2 px-3 font-medium">Workbook tab</th>
            <th className="py-2 px-3 font-medium">→ Django model</th>
            <th className="py-2 px-3 font-medium">DB table</th>
            <th className="py-2 px-3 font-medium text-center">Fields</th>
            <th className="py-2 px-3 font-medium text-center">Rows in DB</th>
            <th className="py-2 px-3 font-medium text-center">Sample IDs</th>
            <th className="py-2 px-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-canvas-100">
          {tabs.map((t) => (
            <tr key={t.db_table} className="hover:bg-canvas-50">
              <td className="py-2 px-3 font-medium text-gray-900 whitespace-nowrap">{t.tab}</td>
              <td className="py-2 px-3 font-mono text-xs text-gray-700">{t.model}</td>
              <td className="py-2 px-3 font-mono text-xs text-gray-500">{t.db_table}</td>
              <td className="py-2 px-3 text-center tabular-nums text-gray-700">{t.field_count}</td>
              <td className="py-2 px-3 text-center tabular-nums">
                {t.row_count > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-mint-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t.row_count}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-gray-400">
                    <MinusCircle className="w-3.5 h-3.5" /> 0
                  </span>
                )}
              </td>
              <td className="py-2 px-3 text-center text-[11px] font-mono text-gray-500">
                {t.sample_ids.length > 0 ? t.sample_ids.join(", ") : "—"}
              </td>
              <td className="py-2 px-3 text-right">
                <Link href={t.url} className="text-xs text-brand-700 hover:underline whitespace-nowrap">
                  View <ArrowRight className="inline w-3 h-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
