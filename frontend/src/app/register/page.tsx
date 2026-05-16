"use client";

/* Register / Sign in — unified email-first flow.
 *
 * Step 1: ask only for email.
 * Step 2 — If an account exists for that email:
 *           "Welcome back" → password → /auth/login → app
 *         If no account exists:
 *           "Create your account" → first/last name + password →
 *           /auth/register → /auth/login → /setup
 *
 * Calm-light theme matching `/`, `/get-started`. Plan-aware via
 * `?plan=<slug>` from /get-started; the slug is forwarded to /setup
 * after a successful registration so the trial activates on the
 * right tier.
 *
 * Error handling deliberately surfaces *every* backend validation
 * field — earlier the page only displayed `email`, `password`, or
 * `detail`, so an error on `first_name` showed up as a useless
 * "Registration failed" message.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, Eye, EyeOff, Lock, Mail, Sparkles, User,
} from "lucide-react";
import { checkEmailExists, login, register } from "@/lib/api";
import Logo from "@/components/logo";
import WorkflowBack from "@/components/workflow-back";


const PLAN_LABELS: Record<string, { name: string; price: string; cadence?: string }> = {
  starter: { name: "Starter", price: "CHF 79", cadence: "/ mo" },
  professional: { name: "Professional", price: "CHF 199", cadence: "/ mo" },
  family: { name: "Family Office", price: "CHF 490", cadence: "/ mo" },
  enterprise: { name: "Enterprise / Fiduciary", price: "Custom" },
};


type Mode = "email" | "signin" | "signup";


export default function RegisterPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [planSlug, setPlanSlug] = useState<string | null>(null);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("plan");
    if (slug && PLAN_LABELS[slug]) setPlanSlug(slug);
  }, []);

  const plan = useMemo(() => (planSlug ? PLAN_LABELS[planSlug] : null), [planSlug]);
  const passwordStrength = useMemo(() => scorePassword(password), [password]);

  const targetAfterAuth = (hasOrg: boolean): string => {
    // After a brand-new registration we always land in /setup so the
    // user goes through Stages 2–4. After a sign-in we either continue
    // in /setup (if they never finished it) or go to the dashboard.
    if (mode === "signup") return planSlug ? `/setup?plan=${planSlug}` : "/setup";
    return hasOrg ? "/dashboard" : "/setup";
  };

  // ── Step 1: check email ─────────────────────────────────────────

  async function checkEmail(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Enter your work email to continue.");
      return;
    }
    setLoading(true);
    try {
      const exists = await checkEmailExists(email.trim().toLowerCase());
      setMode(exists ? "signin" : "signup");
    } catch (err: unknown) {
      setError(parseApiError(err, "Could not check that email — try again."));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2a: existing user → sign in ────────────────────────────

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      // syncOrganizationContext was called inside login(); we don't
      // know yet whether the user has an org. The dashboard layout
      // bootstrap will route them to /setup if not.
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(parseApiError(err, "Couldn't sign you in. Check your password."));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2b: new user → register + auto-login ───────────────────

  async function signUp(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter your first and last name.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      await register(email.trim().toLowerCase(), password, firstName.trim(), lastName.trim());
      await login(email.trim().toLowerCase(), password);
      router.push(planSlug ? `/setup?plan=${planSlug}` : "/setup");
    } catch (err: unknown) {
      setError(parseApiError(err, "Couldn't create your account."));
    } finally {
      setLoading(false);
    }
  }

  const heading =
    mode === "signin"
      ? "Welcome back."
      : mode === "signup"
        ? "Create your account."
        : "Sign in or create your workspace.";

  const subhead =
    mode === "signin"
      ? "Enter your password to continue where you left off."
      : mode === "signup"
        ? "30-day trial · no credit card · change plan anytime."
        : "Enter your email — we'll sign you in if you have an account, or set you up if you're new.";

  const stepLabel =
    mode === "email"
      ? "Step 2 of 5 · Sign in or sign up"
      : mode === "signin"
        ? "Step 2 of 5 · Sign in"
        : "Step 2 of 5 · Create account";

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas-50">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(70%_50%_at_15%_-10%,rgba(58,168,136,0.10),transparent_60%),radial-gradient(60%_45%_at_100%_100%,rgba(35,79,96,0.08),transparent_60%)]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8 sm:py-12">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center" aria-label="Beakon home">
            <Logo variant="horizontal" size={32} />
          </Link>
          <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
            <WorkflowBack fallbackHref="/get-started" fallbackLabel="plans" />
          </Suspense>
        </div>

        {/* Hero */}
        <div className="mt-10 sm:mt-14">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700 ring-1 ring-brand-100">
            <Sparkles className="h-3 w-3" />
            {stepLabel}
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900 sm:text-[34px] sm:leading-[1.1]">
            {heading}
          </h1>
          <p className="mt-2 max-w-lg text-[14.5px] leading-relaxed text-gray-600">
            {subhead}
          </p>
        </div>

        {/* Plan badge — visible across all modes when a plan is selected */}
        {plan && mode !== "signin" && (
          <div className="mt-6 flex w-full max-w-xl items-center justify-between rounded-xl border border-mint-200 bg-mint-50/60 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-mint-700 ring-1 ring-mint-200">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mint-700">
                  Selected plan
                </div>
                <div className="text-[14px] font-semibold text-gray-900">
                  {plan.name}
                  <span className="ml-2 text-[12px] font-normal text-gray-500">
                    {plan.price}{plan.cadence ?? ""}
                  </span>
                </div>
              </div>
            </div>
            <Link
              href="/get-started"
              className="text-[12px] font-semibold text-mint-700 hover:underline"
            >
              Change
            </Link>
          </div>
        )}

        {/* Form card — content shifts by mode but the card frame stays */}
        <div className="mt-6 w-full max-w-xl">
          <div className="rounded-2xl border border-canvas-200/70 bg-white p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] sm:p-7">
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            {mode === "email" && (
              <form onSubmit={checkEmail} className="space-y-3">
                <Field
                  id="email" label="Work email" icon={Mail}
                  type="email" autoComplete="email" placeholder="you@firm.ch"
                  value={email} onChange={setEmail} autoFocus
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-[14px] font-semibold text-white shadow-[0_8px_24px_-12px_rgba(35,79,96,0.45)] transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Checking…" : <>Continue <ArrowRight className="h-4 w-4" /></>}
                </button>
              </form>
            )}

            {mode === "signin" && (
              <form onSubmit={signIn} className="space-y-3">
                <button
                  type="button"
                  onClick={() => { setMode("email"); setError(""); setPassword(""); }}
                  className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Use a different email
                </button>

                <div className="rounded-lg bg-canvas-100 px-3 py-2 text-[12.5px] text-gray-700">
                  <span className="text-gray-500">Signing in as </span>
                  <span className="font-medium text-gray-900">{email}</span>
                </div>

                <PasswordField
                  password={password} setPassword={setPassword}
                  showPassword={showPassword} setShowPassword={setShowPassword}
                  meter={false} autoComplete="current-password"
                  placeholder="Your password"
                />

                <div className="flex justify-end">
                  <Link href="/forgot-password" className="text-[12px] text-gray-500 hover:text-brand-700 hover:underline">
                    Forgot password?
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={loading || !password}
                  className="mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-[14px] font-semibold text-white shadow-[0_8px_24px_-12px_rgba(35,79,96,0.45)] transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Signing in…" : <>Sign in <ArrowRight className="h-4 w-4" /></>}
                </button>
              </form>
            )}

            {mode === "signup" && (
              <form onSubmit={signUp} className="space-y-3">
                <button
                  type="button"
                  onClick={() => { setMode("email"); setError(""); setPassword(""); }}
                  className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-800"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Use a different email
                </button>

                <div className="rounded-lg bg-canvas-100 px-3 py-2 text-[12.5px] text-gray-700">
                  <span className="text-gray-500">Creating account for </span>
                  <span className="font-medium text-gray-900">{email}</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id="firstName" label="First name" icon={User}
                    type="text" autoComplete="given-name" placeholder="Anna"
                    value={firstName} onChange={setFirstName} autoFocus
                  />
                  <Field
                    id="lastName" label="Last name"
                    type="text" autoComplete="family-name" placeholder="Müller"
                    value={lastName} onChange={setLastName}
                  />
                </div>

                <PasswordField
                  password={password} setPassword={setPassword}
                  showPassword={showPassword} setShowPassword={setShowPassword}
                  meter strength={passwordStrength}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-[14px] font-semibold text-white shadow-[0_8px_24px_-12px_rgba(35,79,96,0.45)] transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Creating account…" : <>Create account <ArrowRight className="h-4 w-4" /></>}
                </button>

                <p className="pt-2 text-center text-[11px] leading-relaxed text-gray-500">
                  By creating an account you agree to our{" "}
                  <a href="#" className="underline decoration-gray-300 underline-offset-2 hover:text-gray-800">Terms</a>{" "}
                  and{" "}
                  <a href="#" className="underline decoration-gray-300 underline-offset-2 hover:text-gray-800">Privacy Policy</a>
                  .
                </p>
              </form>
            )}
          </div>
        </div>

        {/* Reassurance footer */}
        <div className="mt-auto pt-10">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-canvas-200 pt-5 text-[11.5px] text-gray-500">
            <Reassurance>30-day trial</Reassurance>
            <Reassurance>No credit card</Reassurance>
            <Reassurance>Hosted in Switzerland</Reassurance>
            <Reassurance>Bank-level security</Reassurance>
          </div>
        </div>
      </div>
    </main>
  );
}


/* ─────────────────────── Error parsing ─────────────────────── */

/** Pull a human-readable error string out of whatever the api lib threw.
 *  DRF returns `{field: [msg]}` for serializer errors and `{detail: msg}`
 *  for custom errors. Earlier versions of this page only checked `email`,
 *  `password`, and `detail`, which is why genuine first_name / last_name
 *  / non_field_errors were collapsed into "Registration failed". */
function parseApiError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  const e = err as Record<string, unknown>;

  if (typeof e.detail === "string") return e.detail;
  if (typeof e.message === "string") return e.message;

  // Collect every {field: [msg, ...]} or {field: msg} entry into a list,
  // skipping infrastructural keys.
  const skip = new Set(["status", "code"]);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(e)) {
    if (skip.has(key)) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (typeof v === "string") lines.push(humanizeFieldError(key, v));
      });
    } else if (typeof value === "string") {
      lines.push(humanizeFieldError(key, value));
    }
  }
  return lines.length ? lines.join(" ") : fallback;
}


function humanizeFieldError(field: string, message: string): string {
  // DRF often returns "user with this email already exists." which
  // reads fine; for less-friendly ones we lightly prefix the field.
  if (field === "non_field_errors" || field === "detail") return message;
  if (message.toLowerCase().startsWith(field.replace(/_/g, " "))) return message;
  const label = field === "first_name" ? "First name"
              : field === "last_name"  ? "Last name"
              : field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
  return `${label}: ${message}`;
}


/* ─────────────────────── Field ─────────────────────── */

function Field({
  id, label, icon: Icon, type, autoComplete, placeholder, value, onChange,
  minLength, trailing, autoFocus,
}: {
  id: string;
  label: string;
  icon?: typeof User;
  type: string;
  autoComplete?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
  trailing?: React.ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
        {label}
      </span>
      <span className="group relative flex items-center">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 h-4 w-4 text-gray-400 transition group-focus-within:text-brand-700" />
        )}
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          minLength={minLength}
          autoFocus={autoFocus}
          required
          className={`h-11 w-full rounded-xl border border-canvas-200 bg-white text-[14px] text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 ${
            Icon ? "pl-10" : "pl-3.5"
          } ${trailing ? "pr-11" : "pr-3.5"}`}
        />
        {trailing && <span className="absolute right-2.5">{trailing}</span>}
      </span>
    </label>
  );
}


function PasswordField({
  password, setPassword, showPassword, setShowPassword,
  meter, strength, autoComplete, placeholder,
}: {
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (fn: (s: boolean) => boolean) => void;
  meter: boolean;
  strength?: 0 | 1 | 2 | 3 | 4;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <div>
      <Field
        id="password" label="Password" icon={Lock}
        type={showPassword ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={password} onChange={setPassword}
        minLength={meter ? 8 : undefined}
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="rounded-md p-1 text-gray-400 transition hover:text-gray-700"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
      />
      {meter && strength !== undefined && <PasswordMeter strength={strength} />}
    </div>
  );
}


/* ─────────────────────── Password meter ─────────────────────── */

function scorePassword(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

function PasswordMeter({ strength }: { strength: 0 | 1 | 2 | 3 | 4 }) {
  if (strength === 0) return null;
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const tones = [
    "bg-canvas-200",
    "bg-rose-400",
    "bg-amber-400",
    "bg-mint-400",
    "bg-mint-600",
  ];
  return (
    <div className="mt-2 flex items-center gap-2.5">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition ${
              i <= strength ? tones[strength] : "bg-canvas-200"
            }`}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-gray-500">
        {labels[strength]}
      </span>
    </div>
  );
}


function Reassurance({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="h-3 w-3 text-mint-600" />
      {children}
    </span>
  );
}
