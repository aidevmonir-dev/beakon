"use client";

/* Organization setup — first-run / "create organization" flow.
 *
 * Visual vocabulary matches the dashboard: brand tint, restrained card,
 * typography and spacing consistent with PageHeader + EmptyState. This is
 * the primary CTA target from the Entities page's no-org state, so it
 * needs to feel as polished as the rest of the product.
 */
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AlertCircle, ArrowRight, Building2, Check } from "lucide-react";
import { api } from "@/lib/api";
import Logo from "@/components/logo";


const CURRENCIES: { value: string; label: string }[] = [
  { value: "EUR", label: "EUR — Euro" },
  { value: "CHF", label: "CHF — Swiss Franc" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "JPY", label: "JPY — Japanese Yen" },
  { value: "INR", label: "INR — Indian Rupee" },
];

const COUNTRIES: { value: string; label: string }[] = [
  { value: "CH", label: "Switzerland" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "JP", label: "Japan" },
  { value: "IN", label: "India" },
];


export default function SetupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [country, setCountry] = useState("CH");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const org: any = await api.post("/organizations/", { name, currency, country });
      localStorage.setItem("organization_id", org.id.toString());
      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.name?.[0] || err?.detail || "Failed to create organization");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-canvas-100 via-canvas-50 to-white px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        {/* Brand row */}
        <div className="mb-8 flex justify-center">
          <Logo variant="horizontal" size={32} />
        </div>

        {/* Heading */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
            <Building2 className="h-6 w-6" />
          </div>
          <h1 className="text-[22px] font-semibold text-gray-900 tracking-[-0.01em] leading-tight">
            Create your organization
          </h1>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-gray-500 leading-relaxed">
            Your workspace holds every entity, ledger, report, and approval. You can add more entities and members later.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Field
              label="Organization name"
              hint="Appears across reports, approvals, and audit trails."
              required
            >
              <input
                id="name"
                type="text"
                className="input"
                placeholder="Smith Family Office"
                autoComplete="organization"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Base currency"
                hint="Default for new entities and reports. Entities may override."
              >
                <select
                  id="currency"
                  className="input font-mono"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="Primary country"
                hint="Drives default chart-of-accounts conventions."
              >
                <select
                  id="country"
                  className="input"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* What happens next */}
            <div className="rounded-xl border border-canvas-200/70 bg-canvas-50/60 p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2">
                What gets created
              </p>
              <ul className="space-y-1.5 text-xs text-gray-600">
                <CreatedItem>A workspace you can invite teammates into</CreatedItem>
                <CreatedItem>A default chart of accounts aligned to your country</CreatedItem>
                <CreatedItem>An open fiscal period so you can start posting</CreatedItem>
              </ul>
            </div>

            <button
              type="submit"
              className="btn-primary w-full justify-center"
              disabled={loading || !name.trim()}
            >
              {loading ? (
                "Creating workspace…"
              ) : (
                <>
                  Create workspace
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-400">
          You can add entities, currencies, and team members after setup.
        </p>
      </div>
    </div>
  );
}


function Field({
  label, hint, required, children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
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


function CreatedItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="h-3.5 w-3.5 mt-0.5 text-mint-600 shrink-0" />
      <span>{children}</span>
    </li>
  );
}
