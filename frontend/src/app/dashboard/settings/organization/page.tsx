"use client";

/* Organization preferences — edit name, country and Beakon Currency.
 *
 * Per the UI philosophy doc (2026-05-10), "Beakon Currency" is the
 * client's personal view currency for dashboards / summaries — distinct
 * from any entity's functional currency or the statutory consolidation
 * currency. Backed by `Organization.currency`; the explainer panel uses
 * the same shared component as Stage 3 of /setup.
 *
 * Visual language follows the 2026-05-11 Settings dashboard refactor:
 * 28px header, Export + Save Changes action buttons top-right, the
 * shared Settings tab nav across the top (with "Organization" active),
 * card body matching the rest of the dashboards.
 *
 * Field set is intentionally unchanged from the previous version —
 * Workspace name, Legal name, Country, Beakon Currency.
 */
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import {
  AlertCircle, Building2, Check, Download, Save,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
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


// Settings tab nav — kept in sync with /dashboard/settings/page.tsx.
const TABS: { name: string; href: string }[] = [
  { name: "Overview",            href: "/dashboard/settings" },
  { name: "Organization",        href: "/dashboard/settings/organization" },
  { name: "Users & Permissions", href: "/dashboard/settings" },
  { name: "AI & Data Approval",  href: "/dashboard/settings" },
  { name: "Modules",             href: "/dashboard/settings/activities" },
  { name: "Billing & Plan",      href: "/dashboard/settings" },
  { name: "Integrations",        href: "/dashboard/settings" },
  { name: "Security",            href: "/dashboard/settings" },
  { name: "Audit Log",           href: "/dashboard/audit" },
];
const ACTIVE_TAB = "Organization";


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

  // Auto-dismiss the "Preferences saved." banner after a few seconds.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  const submit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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

  const countryLabel = COUNTRIES.find((c) => c.value === country)?.label ?? country;
  const currencyLabel = CURRENCIES.find((c) => c.value === currency)?.label ?? currency;

  return (
    <div className="px-1 py-2 sm:px-2 sm:py-4">
      <div className="mx-auto w-full max-w-7xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
              Organization
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              The basics of your workspace — name, jurisdiction and your personal Beakon Currency for overall dashboards.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 hover:text-gray-900 transition"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || loading || !orgId}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm transition-colors",
                (saving || loading || !orgId)
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:bg-brand-700",
              )}
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────── */}
        <div className="mt-5 -mb-px overflow-x-auto border-b border-canvas-200">
          <ul className="flex min-w-max items-center gap-1">
            {TABS.map((t) => {
              const active = t.name === ACTIVE_TAB;
              return (
                <li key={t.name}>
                  <Link
                    href={t.href}
                    className={cn(
                      "inline-block px-3.5 py-2.5 text-[12.5px] font-medium border-b-2 -mb-px transition-colors",
                      active
                        ? "border-brand-600 text-brand-700"
                        : "border-transparent text-gray-500 hover:text-gray-900 hover:border-canvas-300",
                    )}
                  >
                    {t.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ── Back link (for entries from a workflow context) ─────── */}
        <div className="mt-4">
          <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
            <WorkflowBack fallbackHref="/dashboard/settings" />
          </Suspense>
        </div>

        {/* ── Inline status banners ─────────────────────────────── */}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {saved && !error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-mint-200 bg-mint-50 p-3 text-xs text-mint-800">
            <Check className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Preferences saved.</span>
          </div>
        )}

        {/* ── Body: summary card (left) + edit form (right) ──────── */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SummaryCard
            name={name}
            legalName={legalName}
            countryLabel={countryLabel}
            currency={currency}
            currencyLabel={currencyLabel}
            loading={loading}
          />
          <div className="lg:col-span-2">
            <EditCard
              loading={loading}
              saving={saving}
              orgId={orgId}
              name={name} setName={setName}
              legalName={legalName} setLegalName={setLegalName}
              country={country} setCountry={setCountry}
              currency={currency} setCurrency={setCurrency}
              onSubmit={submit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Summary card (left rail) ───────────────────────────────────────


function SummaryCard({
  name, legalName, countryLabel, currency, currencyLabel, loading,
}: {
  name: string;
  legalName: string;
  countryLabel: string;
  currency: string;
  currencyLabel: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5">
        <div className="h-9 w-9 rounded-lg bg-canvas-100/80 animate-pulse" />
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-7 rounded-md bg-canvas-100/80 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-gray-900 truncate">
            {name || "Untitled workspace"}
          </div>
          <div className="text-[11.5px] text-gray-500 mt-0.5 truncate">
            {legalName || "No legal name set"}
          </div>
          <span className="mt-2 inline-flex items-center rounded-full bg-mint-50 px-2 py-0.5 text-[10.5px] font-medium text-mint-700 ring-1 ring-mint-100">
            Active
          </span>
        </div>
      </div>

      <dl className="mt-5 divide-y divide-canvas-100">
        <Row label="Country" value={countryLabel} />
        <Row label="Beakon Currency"
          value={
            <span className="font-mono text-brand-700">{currency}</span>
          }
          hint={currencyLabel} />
        <Row label="Visibility" value="Workspace members" />
      </dl>
    </section>
  );
}


function Row({
  label, value, hint,
}: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[11.5px] text-gray-500">{label}</dt>
      <dd className="text-[12.5px] text-gray-900 font-medium text-right truncate max-w-[60%]">
        {value}
        {hint && (
          <div className="text-[10.5px] text-gray-400 font-normal mt-0.5">{hint}</div>
        )}
      </dd>
    </div>
  );
}


// ── Edit card (form) ───────────────────────────────────────────────


function EditCard({
  loading, saving, orgId,
  name, setName,
  legalName, setLegalName,
  country, setCountry,
  currency, setCurrency,
  onSubmit,
}: {
  loading: boolean;
  saving: boolean;
  orgId: number | null;
  name: string; setName: (v: string) => void;
  legalName: string; setLegalName: (v: string) => void;
  country: string; setCountry: (v: string) => void;
  currency: string; setCurrency: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void | Promise<void>;
}) {
  return (
    <section className="rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-6">
      <header className="mb-4">
        <h2 className="text-[14px] font-semibold text-gray-900">Workspace details</h2>
        <p className="mt-0.5 text-[11.5px] text-gray-500">
          These show up on dashboards, reports and member invites.
        </p>
      </header>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-24 rounded-md bg-canvas-100/80 animate-pulse" />
              <div className="h-9 rounded-md bg-canvas-100/80 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <Field label="Workspace name" required>
            <input
              type="text" className="input"
              value={name} onChange={(e) => setName(e.target.value)}
              required autoComplete="organization"
              placeholder="e.g. Beakon Group Ltd."
            />
          </Field>

          <Field label="Legal name" hint="The legal name on contracts and statements. Optional.">
            <input
              type="text" className="input"
              value={legalName} onChange={(e) => setLegalName(e.target.value)}
              autoComplete="organization"
              placeholder="e.g. Beakon Group SA"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Country" required>
              <select className="input"
                value={country}
                onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>

            <Field
              label="Beakon Currency"
              required
              hint="The currency you personally want to view your overall reports in."
            >
              <select
                className="input font-mono"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>

          <BeakonCurrencyExplainer />

          <div className="flex flex-col-reverse items-stretch gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="submit"
              disabled={saving || !orgId}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm transition-colors",
                (saving || !orgId) ? "opacity-60 cursor-not-allowed" : "hover:bg-brand-700",
              )}
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}


function Field({
  label, hint, required, children,
}: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-medium text-gray-700 flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <span className="mt-1 block text-[11px] text-gray-400 leading-relaxed">{hint}</span>
      )}
    </label>
  );
}
