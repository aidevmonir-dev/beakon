"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { login, register } from "@/lib/api";
import Logo from "@/components/logo";

const PLAN_LABELS: Record<string, { name: string; price: string; cadence?: string; audience: string }> = {
  starter: { name: "Starter", price: "CHF 79", cadence: "/ mo", audience: "Single company / simple setup" },
  professional: { name: "Professional", price: "CHF 199", cadence: "/ mo", audience: "SMEs / growing structures" },
  family: { name: "Family Office", price: "CHF 490", cadence: "/ mo", audience: "Complex / multi-entity structures" },
  enterprise: { name: "Enterprise / Fiduciary", price: "Custom", audience: "Larger firms / platforms" },
};

const VALUE_BULLETS = [
  "Multi-entity, intercompany & multi-currency from day one",
  "Hosted in Switzerland · Swiss-VAT & ELM-ready",
  "AI proposes — your team approves. Audit-traceable to source.",
];

export default function RegisterPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(email, password, firstName, lastName);
      await login(email, password);
      router.push("/setup");
    } catch (err: any) {
      const msg =
        err?.email?.[0] || err?.password?.[0] || err?.detail || "Registration failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper-50 text-brand-950">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr] xl:grid-cols-[1.15fr_1fr]">
        {/* ─────────────────────── LEFT — editorial panel ─────────────────────── */}
        <aside className="relative hidden overflow-hidden hero-mesh grain-overlay text-white lg:block">
          <div className="absolute inset-0 dot-grid opacity-40" />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 top-32 h-[36rem] w-[36rem] rounded-full bg-mint-400/15 blur-3xl float-slow"
          />
          <div className="relative flex min-h-screen flex-col px-10 py-10 xl:px-14">
            {/* Top: brand */}
            <Link href="/" className="flex items-center gap-2" aria-label="Beakon home">
              <Logo variant="horizontal" size={36} colors={{ text: "#ffffff" }} />
            </Link>

            {/* Middle: editorial copy */}
            <div className="my-auto max-w-[34rem]">
              <p
                className="inline-flex items-center gap-2 rounded-full border border-mint-400/30 bg-mint-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-mint-200 reveal"
                style={{ animationDelay: "60ms" }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Start your free trial
              </p>
              <h1
                className="mt-7 font-display text-[clamp(2.4rem,4.6vw,4.6rem)] font-light leading-[0.98] tracking-[-0.035em] reveal"
                style={{ animationDelay: "180ms" }}
              >
                Books that{" "}
                <em className="italic text-mint-300">balance themselves</em>.
                <br />
                Judgment that{" "}
                <em className="italic text-mint-300">stays with you</em>.
              </h1>
              <p
                className="mt-7 max-w-md text-[16px] leading-[1.65] text-white/65 reveal"
                style={{ animationDelay: "320ms" }}
              >
                Create your Beakon workspace — multi-entity, multi-currency,
                Swiss-hosted. Your AI bookkeeper proposes; you approve.
              </p>

              <ul
                className="mt-9 space-y-3.5 reveal"
                style={{ animationDelay: "440ms" }}
              >
                {VALUE_BULLETS.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-[14.5px] text-white/75">
                    <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mint-500/20 text-mint-300 ring-1 ring-mint-400/30">
                      <Check className="h-3 w-3" />
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Bottom: testimonial */}
            <figure
              className="mt-10 max-w-[32rem] rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur reveal"
              style={{ animationDelay: "560ms" }}
            >
              <span className="font-display text-[80px] font-light leading-[0.4] text-mint-300/40 select-none">
                &ldquo;
              </span>
              <blockquote className="-mt-6 font-display text-[18.5px] font-light italic leading-snug text-white">
                We replaced three spreadsheets, two reconciliation tools and a
                monthly crisis with one system that knows our chart of accounts
                as well as we do.
              </blockquote>
              <figcaption className="mt-4 flex items-center gap-3 text-[12.5px]">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[12px] font-semibold text-brand-950">
                  TA
                </span>
                <div>
                  <div className="font-semibold text-white">Thomas Allina</div>
                  <div className="text-white/50">Founder, Beakon</div>
                </div>
              </figcaption>
            </figure>

            <div className="mt-8 flex items-center gap-4 text-[11.5px] text-white/45">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-mint-300" />
                Bank-level security
              </span>
              <span className="text-white/15">·</span>
              <span>Hosted in Switzerland</span>
              <span className="text-white/15">·</span>
              <span>SOC-aligned infrastructure</span>
            </div>
          </div>
        </aside>

        {/* ─────────────────────── RIGHT — form panel ─────────────────────── */}
        <section className="relative flex flex-col bg-paper-50">
          {/* Compact header — only matters on mobile / above form */}
          <header className="flex items-center justify-between px-6 py-6 sm:px-10 lg:px-12">
            <Link href="/" className="flex items-center lg:hidden" aria-label="Beakon">
              <Logo variant="horizontal" size={32} />
            </Link>
            <div className="ml-auto flex items-center gap-5 text-[13.5px] text-brand-900/65">
              <Link href="/pricing" className="hidden font-medium transition hover:text-brand-950 sm:inline">
                Pricing
              </Link>
              <span>
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-brand-950 transition hover:text-mint-700">
                  Sign in
                </Link>
              </span>
            </div>
          </header>

          <div className="flex flex-1 items-center justify-center px-6 pb-16 sm:px-10">
            <div className="w-full max-w-[460px]">
              {plan && (
                <div className="mb-6 flex items-center justify-between rounded-2xl border border-mint-200 bg-mint-50/70 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-mint-700 ring-1 ring-mint-200">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-mint-700">
                        Selected plan
                      </div>
                      <div className="font-display text-[15px] font-medium text-brand-950">
                        {plan.name}
                        <span className="ml-2 text-[12px] font-medium text-brand-900/55">
                          {plan.price}
                          {plan.cadence ?? ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Link
                    href="/pricing"
                    className="text-[12px] font-semibold text-mint-700 transition hover:text-mint-600"
                  >
                    Change
                  </Link>
                </div>
              )}

              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-mint-700">
                Create account
              </p>
              <h2 className="mt-3 font-display text-[clamp(2rem,3.4vw,2.6rem)] font-light leading-[1.05] tracking-[-0.025em] text-brand-950">
                Open your{" "}
                <em className="italic text-mint-700">workspace</em>.
              </h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-brand-900/60">
                Free for 14 days. No card required. Continue to workspace
                setup once you&apos;re in.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-3.5">
                {error && (
                  <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-[13px] text-red-700">
                    <span className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field
                    id="firstName"
                    label="First name"
                    icon={User}
                    type="text"
                    autoComplete="given-name"
                    placeholder="Thomas"
                    value={firstName}
                    onChange={setFirstName}
                  />
                  <Field
                    id="lastName"
                    label="Last name"
                    type="text"
                    autoComplete="family-name"
                    placeholder="Allina"
                    value={lastName}
                    onChange={setLastName}
                  />
                </div>

                <Field
                  id="email"
                  label="Work email"
                  icon={Mail}
                  type="email"
                  autoComplete="email"
                  placeholder="you@firm.ch"
                  value={email}
                  onChange={setEmail}
                />

                <div>
                  <Field
                    id="password"
                    label="Password"
                    icon={Lock}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={setPassword}
                    minLength={8}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="rounded-md p-1 text-brand-900/40 transition hover:text-brand-900/80"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    }
                  />
                  <PasswordMeter strength={passwordStrength} />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-950 text-[14px] font-semibold text-white shadow-[0_20px_40px_-20px_rgba(19,43,55,0.6)] transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Creating account…
                    </>
                  ) : (
                    <>
                      Create account
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>

                <p className="pt-1 text-center text-[11.5px] leading-relaxed text-brand-900/45">
                  By creating an account you agree to our{" "}
                  <a href="#" className="underline decoration-brand-900/20 underline-offset-2 transition hover:text-brand-900/80">
                    Terms
                  </a>{" "}
                  and{" "}
                  <a href="#" className="underline decoration-brand-900/20 underline-offset-2 transition hover:text-brand-900/80">
                    Privacy Policy
                  </a>
                  .
                </p>
              </form>

              <div className="mt-10 rounded-2xl border border-paper-200 bg-white px-5 py-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-brand-700">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[13px] font-semibold text-brand-950">
                      Are you an accounting firm?
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-brand-900/65">
                      Run your book on Beakon — partner pricing for firms with
                      multiple clients.{" "}
                      <Link
                        href="/pricing#partner"
                        className="inline-flex items-center gap-0.5 font-semibold text-mint-700 transition hover:text-mint-600"
                      >
                        Learn more
                        <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

/* ─────────────────────────── Field ─────────────────────────── */

function Field({
  id, label, icon: Icon, type, autoComplete, placeholder, value, onChange, minLength, trailing,
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
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.16em] text-brand-900/55">
        {label}
      </span>
      <span className="group relative flex items-center">
        {Icon && (
          <Icon className="pointer-events-none absolute left-4 h-4 w-4 text-brand-900/35 transition group-focus-within:text-mint-700" />
        )}
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          minLength={minLength}
          required
          className={`h-12 w-full rounded-2xl border border-paper-200 bg-white text-[14px] text-brand-950 outline-none transition placeholder:text-brand-900/30 focus:border-mint-400 focus:bg-white focus:ring-4 focus:ring-mint-100 ${
            Icon ? "pl-11" : "pl-4"
          } ${trailing ? "pr-12" : "pr-4"}`}
        />
        {trailing && <span className="absolute right-3">{trailing}</span>}
      </span>
    </label>
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
    "bg-paper-200",
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
              i <= strength ? tones[strength] : "bg-paper-200"
            }`}
          />
        ))}
      </div>
      <span className="text-[11.5px] font-medium text-brand-900/55">
        {labels[strength]}
      </span>
    </div>
  );
}
