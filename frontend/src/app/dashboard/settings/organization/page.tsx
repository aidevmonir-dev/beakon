"use client";

/* Organization preferences — edit name, country and Beakon Currency.
 *
 * Per the UI philosophy doc (2026-05-10), "Beakon Currency" is the
 * client's personal view currency for dashboards / summaries — distinct
 * from any entity's functional currency or the statutory consolidation
 * currency. Backed by `Organization.currency`; the explainer panel uses
 * the same shared component as Stage 3 of /setup.
 *
 * Per-entity reporting and statutory consolidation currencies live on
 * the Entity model and are edited from /dashboard/entities — they are
 * a different concept and intentionally not relabelled here.
 */
import { Suspense, useEffect, useState } from "react";
import {
  AlertCircle, Building2, Check, Save,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import BeakonCurrencyExplainer from "@/components/beakon-currency-explainer";
import WorkflowBack from "@/components/workflow-back";


interface Organization {
  id: number;
  name: string;
  legal_name: string;
  country: string;
  currency: string;
  selected_activities?: string[];
}


const CURRENCIES = [
  { value: "CHF", label: "CHF — Swiss Franc" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "JPY", label: "JPY — Japanese Yen" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
];


const COUNTRIES = [
  { value: "CH", label: "Switzerland" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "GB", label: "United Kingdom" },
  { value: "LU", label: "Luxembourg" },
  { value: "US", label: "United States" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SG", label: "Singapore" },
  { value: "JP", label: "Japan" },
];


export default function OrganizationPreferencesPage() {
  const [orgId, setOrgId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("CH");
  const [currency, setCurrency] = useState("CHF");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = typeof window !== "undefined"
      ? localStorage.getItem("organization_id")
      : null;
    if (!id) { setLoading(false); return; }
    api.get<Organization>(`/organizations/${id}/`)
      .then((org) => {
        setOrgId(org.id);
        setName(org.name || "");
        setLegalName(org.legal_name || "");
        setCountry(org.country || "CH");
        setCurrency(org.currency || "CHF");
      })
      .catch(() => setError("Could not load workspace preferences."))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setError(""); setSaved(false); setSaving(true);
    try {
      await api.patch(`/organizations/${orgId}/`, {
        name, legal_name: legalName, country, currency,
      });
      setSaved(true);
    } catch (err: any) {
      setError(err?.detail || "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Organization preferences"
        description="The basics of your workspace — name, jurisdiction and your personal Beakon Currency for overall dashboards."
      />

      <div className="mt-2 mb-4">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref="/dashboard/settings" />
        </Suspense>
      </div>

      {loading ? (
        <div className="h-[400px] rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse" />
      ) : (
        <form
          onSubmit={submit}
          className="rounded-2xl border border-canvas-200/70 bg-white p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] max-w-2xl"
        >
          <div className="mb-5 flex items-center gap-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <Building2 className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-gray-900">{name || "Workspace"}</h2>
              <p className="text-[11.5px] text-gray-500">Visible to everyone in this workspace.</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {saved && !error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-mint-200 bg-mint-50 p-3 text-xs text-mint-800">
              <Check className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Preferences saved.</span>
            </div>
          )}

          <div className="space-y-4">
            <Field label="Workspace name" required>
              <input
                type="text" className="input"
                value={name} onChange={(e) => setName(e.target.value)}
                required autoComplete="organization"
              />
            </Field>

            <Field label="Legal name" hint="The legal name on contracts and statements. Optional.">
              <input
                type="text" className="input"
                value={legalName} onChange={(e) => setLegalName(e.target.value)}
                autoComplete="organization"
              />
            </Field>

            <Field label="Country" required>
              <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>

            <Field
              label="Beakon Currency"
              required
              hint="The currency you personally want to view your overall reports in."
            >
              <select
                className="input font-mono max-w-xs"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>

            <BeakonCurrencyExplainer />
          </div>

          <div className="mt-6 flex justify-end">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : <>Save preferences <Save className="w-4 h-4 ml-1.5" /></>}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}


function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-gray-400 leading-relaxed">{hint}</span>}
    </label>
  );
}
