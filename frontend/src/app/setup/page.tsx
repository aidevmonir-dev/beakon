"use client";

/* Stages 1–4 of the onboarding flow, per the UI philosophy doc
 * (2026-05-10).
 *
 *   Stage 1 — Welcome
 *   Stage 2 — AI / Infrastructure Approval (platform consent — NOT compliance)
 *   Stage 3 — Organization Preferences (Name, Country, Beakon Currency)
 *   Stage 4 — Activity Selection (drives which modules render)
 *
 * After Stage 4 we POST a single Organization create that carries the
 * activity selection + the AI/infra consent timestamp, attach the plan,
 * and route the user into the dashboard. Stage 5 (Guided Org Setup —
 * entity tree, accounting setup) is a separate workstream.
 *
 * "Beakon Currency" is the client-personal view currency. Per the doc
 * it is distinct from legal accounting currency and statutory
 * consolidation currency — the explainer panel makes the distinction
 * explicit. Backend storage stays in `Organization.currency` for v1.
 *
 * The plan slug is read from `?plan=<slug>` (set by the pricing →
 * register funnel). Falls back to "professional" if absent.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, Briefcase, Building2, Check,
  Cloud, Cpu, FileText, Plane, ShieldCheck, Sparkles, TrendingUp,
  Users, Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { safeNextPath } from "@/lib/safe-next";
import Logo from "@/components/logo";
import BeakonCurrencyExplainer from "@/components/beakon-currency-explainer";


// ── Static option lists ────────────────────────────────────────────


const CURRENCIES = [
  { value: "CHF", label: "CHF — Swiss Franc" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "JPY", label: "JPY — Japanese Yen" },
];


const COUNTRIES = [
  { value: "CH", label: "Switzerland" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "GB", label: "United Kingdom" },
  { value: "LU", label: "Luxembourg" },
  { value: "US", label: "United States" },
];


/** Activities a client can pick during onboarding. The slug is what
 *  the backend stores on `Organization.selected_activities`; the rest
 *  is presentation. Order matches the philosophy doc. */
const ACTIVITIES: ActivityCard[] = [
  {
    slug: "structure_management",
    title: "Structure Management",
    body: "Entities, ownership, holdings, trusts and the relationships between them.",
    icon: Building2,
  },
  {
    slug: "accounting_finance",
    title: "Accounting & Finance",
    body: "Books, ledger, bills, invoices, period close and reporting.",
    icon: TrendingUp,
  },
  {
    slug: "travel_expense",
    title: "Travel Expense Management",
    body: "Trips, claims, receipts, approvals and reimbursements.",
    icon: Plane,
  },
  {
    slug: "employment",
    title: "Employment",
    body: "Employees, contracts, payroll feeds — referenced as a dimension elsewhere.",
    icon: Users,
  },
  {
    slug: "wealth_oversight",
    title: "Wealth Oversight",
    body: "Portfolios, custodian feeds, performance and consolidation.",
    icon: Wallet,
  },
  {
    slug: "document_management",
    title: "Document Management",
    body: "Contracts, statements, supporting evidence and AI-assisted classification.",
    icon: FileText,
  },
];

interface ActivityCard {
  slug: string;
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
}


const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  family: "Family Office",
  enterprise: "Enterprise / Fiduciary",
};


type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "Welcome",
  2: "Infrastructure",
  3: "Organization",
  4: "Activities",
};


// ── Page ───────────────────────────────────────────────────────────


export default function SetupPage() {
  // useSearchParams() forces this component into client-side bailout
  // during static export. Wrap inner content in <Suspense> so the build
  // can emit a placeholder.
  return (
    <Suspense fallback={<p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}>
      <SetupPageContent />
    </Suspense>
  );
}

function SetupPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [planSlug, setPlanSlug] = useState<string>("professional");
  const nextPath = safeNextPath(params?.get("next"));

  useEffect(() => {
    const p = params?.get("plan");
    if (p && PLAN_LABELS[p]) setPlanSlug(p);
  }, [params]);

  const [step, setStep] = useState<Step>(1);

  // Stage 2
  const [aiConsent, setAiConsent] = useState(false);

  // Stage 3
  const [name, setName] = useState("");
  const [country, setCountry] = useState("CH");
  const [beakonCurrency, setBeakonCurrency] = useState("CHF");

  // Stage 4
  const [activities, setActivities] = useState<string[]>([
    "structure_management", "accounting_finance",
  ]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const planName = PLAN_LABELS[planSlug] ?? "Professional";

  const goNext = (e?: FormEvent) => {
    if (e) e.preventDefault();
    setError("");
    if (step === 2 && !aiConsent) {
      setError("Please review and accept the platform consent to continue.");
      return;
    }
    if (step === 3 && !name.trim()) {
      setError("Organization name is required.");
      return;
    }
    if (step === 4 && activities.length === 0) {
      setError("Pick at least one activity so we can shape your workspace.");
      return;
    }
    if (step < 4) setStep((s) => (s + 1) as Step);
    else void finish();
  };

  const goBack = () => { if (step > 1) setStep((s) => (s - 1) as Step); };

  const toggleActivity = (slug: string) => {
    setActivities((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  };

  const finish = async () => {
    setError(""); setLoading(true);
    try {
      const org: any = await api.post("/organizations/", {
        name,
        currency: beakonCurrency,
        country,
        selected_activities: activities,
        ai_infra_consent_at: new Date().toISOString(),
      });
      localStorage.setItem("organization_id", org.id.toString());

      try {
        await api.post("/beakon/billing/subscription/start/", { plan: planSlug });
      } catch (e) {
        // Non-fatal — dashboard offers a "pick a plan" fallback if no
        // subscription exists.
        console.warn("Could not attach plan; continuing", e);
      }

      router.push(nextPath || "/dashboard");
    } catch (err: any) {
      setError(err?.name?.[0] || err?.detail || "Failed to create workspace");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-canvas-100 via-canvas-50 to-white px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex justify-center">
          <Logo variant="horizontal" size={32} />
        </div>

        <div className="mb-4 flex items-center justify-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-brand-700 ring-1 ring-brand-100 font-medium">
            <Sparkles className="h-3 w-3" />
            {planName} · 30-day trial
          </span>
        </div>

        {/* Stepper */}
        <ol className="mb-6 flex items-center justify-center gap-2 text-[11px] font-medium">
          {([1, 2, 3, 4] as Step[]).map((n, i, arr) => (
            <li key={n} className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full ring-1",
                  step > n
                    ? "bg-mint-50 text-mint-700 ring-mint-200"
                    : step === n
                      ? "bg-brand-600 text-white ring-brand-700"
                      : "bg-white text-gray-400 ring-canvas-200",
                )}
              >
                {step > n ? <Check className="h-3.5 w-3.5" /> : n}
              </span>
              <span className={cn(step >= n ? "text-gray-900" : "text-gray-400")}>
                {STEP_LABELS[n]}
              </span>
              {i < arr.length - 1 && <span className="w-6 h-px bg-canvas-200" />}
            </li>
          ))}
        </ol>

        <div className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
          <form onSubmit={goNext} className="p-6 space-y-5">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {step === 1 && <Stage1Welcome />}
            {step === 2 && (
              <Stage2Consent consent={aiConsent} setConsent={setAiConsent} />
            )}
            {step === 3 && (
              <Stage3Preferences
                name={name} setName={setName}
                country={country} setCountry={setCountry}
                currency={beakonCurrency} setCurrency={setBeakonCurrency}
              />
            )}
            {step === 4 && (
              <Stage4Activities
                activities={activities}
                onToggle={toggleActivity}
              />
            )}

            <div className="flex items-center justify-between pt-2">
              {step > 1 ? (
                <button
                  type="button" onClick={goBack}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
              ) : <span />}

              <button type="submit" className="btn-primary" disabled={loading}>
                {step < 4
                  ? <>Continue <ArrowRight className="w-4 h-4 ml-1.5" /></>
                  : loading
                    ? "Creating workspace…"
                    : <>Build my workspace <ArrowRight className="w-4 h-4 ml-1.5" /></>}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-5 text-center text-[11px] text-gray-400">
          You can adjust currencies, add entities, activities and invite teammates anytime.
        </p>
      </div>
    </div>
  );
}


// ── Stages ─────────────────────────────────────────────────────────


function Stage1Welcome() {
  return (
    <>
      <div className="text-center py-2">
        <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Sparkles className="h-6 w-6" />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
          Welcome to <span className="italic font-normal text-brand-700">get</span>
          <span className="font-bold text-brand-700">BEAKON</span>
        </h1>
        <p className="mt-3 text-sm text-gray-600 leading-relaxed max-w-md mx-auto">
          The intelligent operating system for structures, accounting,
          and organizational management.
        </p>
      </div>

      <ul className="mt-2 space-y-2 text-[13px] text-gray-700 leading-relaxed">
        <BulletItem>Your platform adapts to you — not the other way around.</BulletItem>
        <BulletItem>AI proposes; your team approves. Every line audit-traceable.</BulletItem>
        <BulletItem>Hosted in Switzerland · Swiss-VAT &amp; ELM-ready.</BulletItem>
      </ul>
    </>
  );
}


function Stage2Consent({
  consent, setConsent,
}: {
  consent: boolean;
  setConsent: (v: boolean) => void;
}) {
  return (
    <>
      <Heading
        title="Platform infrastructure"
        subtitle="A short, transparent note on the systems Beakon runs on. This is platform consent, not compliance — compliance only activates if and when you turn on regulated activities."
      />

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ConsentItem
          icon={Cloud}
          title="Swiss cloud hosting"
          body="Your data and processing live in Swiss data centres."
        />
        <ConsentItem
          icon={Cpu}
          title="AWS &amp; Bedrock"
          body="Underlying compute and AI orchestration."
        />
        <ConsentItem
          icon={Sparkles}
          title="Claude AI"
          body="Drafts journal entries, classifies documents — never auto-posts."
        />
        <ConsentItem
          icon={ShieldCheck}
          title="Document analysis"
          body="OCR &amp; extraction on documents you upload, kept inside your workspace."
        />
      </ul>

      <label className="mt-2 flex items-start gap-3 rounded-xl border border-canvas-200 bg-canvas-50/50 p-4 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span className="text-[13px] text-gray-700 leading-relaxed">
          I acknowledge that Beakon may use the platform infrastructure
          described above to host my workspace and assist my team. I can
          review or revoke this in Settings later.
        </span>
      </label>
    </>
  );
}


function Stage3Preferences({
  name, setName, country, setCountry, currency, setCurrency,
}: {
  name: string; setName: (v: string) => void;
  country: string; setCountry: (v: string) => void;
  currency: string; setCurrency: (v: string) => void;
}) {
  return (
    <>
      <Heading
        title="Your organization"
        subtitle="Just the basics — you can refine everything later."
      />

      <Field label="Organization name" required>
        <input
          type="text" className="input"
          placeholder="Smith Family Office"
          value={name} onChange={(e) => setName(e.target.value)}
          autoFocus required autoComplete="organization"
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
          className="input font-mono"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>

      <BeakonCurrencyExplainer />
    </>
  );
}


function Stage4Activities({
  activities, onToggle,
}: {
  activities: string[];
  onToggle: (slug: string) => void;
}) {
  return (
    <>
      <Heading
        title="Which activities would you like to manage in Beakon?"
        subtitle="Pick the ones you'll use today. We'll only show modules and onboarding steps relevant to what you select — and you can turn more on at any time."
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ACTIVITIES.map((a) => {
          const active = activities.includes(a.slug);
          const Icon = a.icon;
          return (
            <button
              key={a.slug}
              type="button"
              onClick={() => onToggle(a.slug)}
              aria-pressed={active}
              className={cn(
                "text-left rounded-xl border p-4 transition-colors",
                active
                  ? "border-brand-300 bg-brand-50/40 ring-1 ring-brand-200"
                  : "border-canvas-200 bg-white hover:bg-canvas-50",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "shrink-0 h-9 w-9 rounded-lg flex items-center justify-center",
                    active ? "bg-brand-100 text-brand-700" : "bg-canvas-100 text-gray-500",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-gray-900">{a.title}</h3>
                    {active && <Check className="h-3.5 w-3.5 text-brand-600" />}
                  </div>
                  <p className="mt-0.5 text-[12px] text-gray-600 leading-relaxed">
                    {a.body}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-[11.5px] text-gray-500 leading-relaxed">
        <Briefcase className="inline-block h-3.5 w-3.5 mr-1 -mt-0.5 text-gray-400" />
        Compliance, fiduciary and trustee features only activate later, when
        you turn on regulated activities.
      </p>
    </>
  );
}


// ── Helpers ────────────────────────────────────────────────────────


function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-[20px] font-semibold text-gray-900 tracking-[-0.01em] leading-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">{subtitle}</p>
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


function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="h-4 w-4 mt-0.5 shrink-0 text-mint-600" />
      <span>{children}</span>
    </li>
  );
}


function ConsentItem({
  icon: Icon, title, body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-xl border border-canvas-200 bg-white p-3.5">
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 h-8 w-8 rounded-lg bg-canvas-100 text-gray-600 flex items-center justify-center">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-gray-900" dangerouslySetInnerHTML={{ __html: title }} />
          <p className="mt-0.5 text-[12px] text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: body }} />
        </div>
      </div>
    </li>
  );
}
