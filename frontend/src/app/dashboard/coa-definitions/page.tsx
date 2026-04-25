"use client";

import { useEffect, useMemo, useState } from "react";
import { Layers, Plus, Save } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";

interface CoADefinition {
  id: number;
  coa_id: string;
  name: string;
  coa_type: string;
  version_no: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  base_currency: string;
  default_reporting_currency: string;
  additional_reporting_currencies: string;
  notes: string;
  account_count: number;
}

interface FormState {
  coa_id: string;
  name: string;
  coa_type: string;
  version_no: string;
  status: string;
  effective_from: string;
  effective_to: string;
  base_currency: string;
  default_reporting_currency: string;
  additional_reporting_currencies: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  coa_id: "",
  name: "",
  coa_type: "WEALTH_MGMT",
  version_no: "1",
  status: "Active",
  effective_from: "",
  effective_to: "",
  base_currency: "CHF",
  default_reporting_currency: "CHF",
  additional_reporting_currencies: "USD",
  notes: "",
};

function asList(data: CoADefinition[] | { results?: CoADefinition[] }) {
  return Array.isArray(data) ? data : (data.results ?? []);
}

export default function CoADefinitionsPage() {
  const [items, setItems] = useState<CoADefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<CoADefinition[] | { results?: CoADefinition[] }>(
        "/beakon/coa-definitions/",
        { ordering: "coa_type,version_no,coa_id" },
      );
      setItems(asList(data));
    } catch {
      setError("Could not load CoA definitions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const activeCount = useMemo(
    () => items.filter((item) => item.status.toLowerCase() === "active").length,
    [items],
  );

  async function createDefinition() {
    if (!form.coa_id.trim() || !form.name.trim() || !form.coa_type.trim()) {
      setError("CoA ID, name, and type are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await api.post<CoADefinition>("/beakon/coa-definitions/", {
        coa_id: form.coa_id.trim(),
        name: form.name.trim(),
        coa_type: form.coa_type.trim(),
        version_no: Number(form.version_no || "1"),
        status: form.status.trim() || "Active",
        effective_from: form.effective_from || null,
        effective_to: form.effective_to || null,
        base_currency: form.base_currency.trim().toUpperCase(),
        default_reporting_currency: form.default_reporting_currency.trim().toUpperCase(),
        additional_reporting_currencies: form.additional_reporting_currencies.trim().toUpperCase(),
        notes: form.notes.trim(),
      });
      setItems((prev) => [...prev, created].sort((a, b) =>
        a.coa_type.localeCompare(b.coa_type) ||
        a.version_no - b.version_no ||
        a.coa_id.localeCompare(b.coa_id),
      ));
      setForm(EMPTY_FORM);
    } catch {
      setError("Could not create the CoA definition.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="CoA Definitions"
        description="Thomas's 01 CoA Definition tab, now represented in the database. This is the chart registry above the account rows and the clean starting point for the workbook-driven setup."
      />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Definitions" value={items.length.toString()} />
        <StatCard label="Active" value={activeCount.toString()} tone="green" />
        <StatCard label="Current focus" value="Wealth Mgmt" note="WM_CLIENT_V1 from the workbook" />
      </div>

      <section className="card mt-5 p-5">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-brand-700" />
          <h2 className="text-base font-semibold text-gray-900">Add Chart Definition</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Demo scope: chart identity, version, status, dates, and currencies. Later workbook tabs will attach to this record.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="CoA ID">
            <input className="input mt-1" value={form.coa_id}
                   onChange={(e) => setForm((f) => ({ ...f, coa_id: e.target.value }))}
                   placeholder="WM_CLIENT_V1" />
          </Field>
          <Field label="CoA Name">
            <input className="input mt-1" value={form.name}
                   onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                   placeholder="Wealth Management Client CoA" />
          </Field>
          <Field label="CoA Type">
            <input className="input mt-1" value={form.coa_type}
                   onChange={(e) => setForm((f) => ({ ...f, coa_type: e.target.value }))}
                   placeholder="WEALTH_MGMT" />
          </Field>
          <Field label="Version">
            <input className="input mt-1" type="number" min="1" value={form.version_no}
                   onChange={(e) => setForm((f) => ({ ...f, version_no: e.target.value }))} />
          </Field>
          <Field label="Status">
            <input className="input mt-1" value={form.status}
                   onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                   placeholder="Active" />
          </Field>
          <Field label="Effective From">
            <input className="input mt-1" type="date" value={form.effective_from}
                   onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
          </Field>
          <Field label="Effective To">
            <input className="input mt-1" type="date" value={form.effective_to}
                   onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))} />
          </Field>
          <Field label="Base Currency">
            <input className="input mt-1" value={form.base_currency}
                   onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value.toUpperCase() }))}
                   placeholder="CHF" />
          </Field>
          <Field label="Default Reporting Currency">
            <input className="input mt-1" value={form.default_reporting_currency}
                   onChange={(e) => setForm((f) => ({ ...f, default_reporting_currency: e.target.value.toUpperCase() }))}
                   placeholder="CHF" />
          </Field>
          <Field label="Additional Reporting Currencies">
            <input className="input mt-1" value={form.additional_reporting_currencies}
                   onChange={(e) => setForm((f) => ({ ...f, additional_reporting_currencies: e.target.value.toUpperCase() }))}
                   placeholder="USD,EUR" />
          </Field>
        </div>

        <Field label="Notes" className="mt-3">
          <textarea className="input mt-1 min-h-24" value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional architectural notes for this chart definition." />
        </Field>

        <div className="mt-4 flex items-center justify-between gap-3">
          {error ? <p className="text-sm text-red-700">{error}</p> : <div />}
          <button onClick={() => void createDefinition()} className="btn-primary" disabled={saving}>
            {saving ? <Save className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
            {saving ? "Saving..." : "Add Chart Definition"}
          </button>
        </div>
      </section>

      <section className="card mt-5 p-5">
        <h2 className="text-base font-semibold text-gray-900">Current Chart Definitions</h2>
        <p className="mt-1 text-sm text-gray-500">
          These records correspond to the workbook's first green tab and act as the parent layer for accounts, mappings, and dimensions.
        </p>

        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading...</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No CoA definitions yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-canvas-200 text-gray-500">
                  <th className="pb-2 pr-4 font-medium">CoA ID</th>
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Version</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Base / Reporting</th>
                  <th className="pb-2 pr-4 font-medium">Effective</th>
                  <th className="pb-2 font-medium">Linked Accounts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-3 pr-4 font-mono text-gray-700">{item.coa_id}</td>
                    <td className="py-3 pr-4 text-gray-800">{item.name}</td>
                    <td className="py-3 pr-4 text-gray-700">{item.coa_type}</td>
                    <td className="py-3 pr-4 text-gray-700">{item.version_no}</td>
                    <td className="py-3 pr-4">
                      <span className={
                        "rounded-full px-2 py-1 text-[11px] font-medium " +
                        (item.status.toLowerCase() === "active"
                          ? "bg-mint-50 text-mint-800"
                          : "bg-canvas-100 text-gray-600")
                      }>
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-700">
                      {item.base_currency}
                      {item.default_reporting_currency ? ` / ${item.default_reporting_currency}` : ""}
                    </td>
                    <td className="py-3 pr-4 text-gray-700">
                      {item.effective_from || "—"}
                      {item.effective_to ? ` → ${item.effective_to}` : ""}
                    </td>
                    <td className="py-3 text-gray-700">{item.account_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + className}>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

function StatCard({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "neutral" | "green";
}) {
  const cls = tone === "green"
    ? "border-mint-200 bg-mint-50 text-mint-900"
    : "border-canvas-200 bg-white text-gray-900";

  return (
    <div className={"rounded-2xl border p-4 " + cls}>
      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.02em]">{value}</div>
      {note && <p className="mt-2 text-sm text-gray-500">{note}</p>}
    </div>
  );
}
