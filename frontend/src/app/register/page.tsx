"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Check, Minus } from "lucide-react";
import { login, register } from "@/lib/api";

const plans = [
  {
    name: "Essentials",
    description: "Solopreneurs and early stage businesses",
    price: "$65",
    suffix: "/mo",
    tone: "bg-[#dcf7fb]",
    accent: "bg-[#54d7df]",
    button: "Start free trial",
    buttonStyle: "bg-[#16efc8] text-black hover:bg-[#08ddb8]",
  },
  {
    name: "Core",
    description: "Small businesses and growing companies",
    price: "$100",
    suffix: "/mo",
    tone: "bg-[#dff8ef]",
    accent: "bg-[#29dcc6]",
    badge: "Most Popular",
    button: "Start free trial",
    buttonStyle: "bg-[#16efc8] text-black hover:bg-[#08ddb8]",
  },
  {
    name: "Advanced",
    description: "Multi entity businesses and global operations",
    price: "Custom",
    suffix: "",
    tone: "bg-[#fff7d8]",
    accent: "bg-[#ffc63a]",
    button: "Request early access",
    buttonStyle: "border border-[#ccd2dd] bg-white text-[#61697a] hover:bg-[#f6f7fb]",
  },
];

const features = [
  {
    title: "Live Dashboards & Financials",
    note: "Your finances at your fingertips",
    availability: [true, true, true],
  },
  {
    title: "Invoicing & Bill Pay",
    note: "Pay & get paid faster",
    availability: [true, true, true],
  },
  {
    title: "24/7 AI Bookkeeping & Reconciliation",
    note: "Books that keep themselves",
    availability: [true, true, true],
  },
  {
    title: "Ask Digits",
    note: "Your always-on financial assistant",
    availability: [true, true, true],
  },
  {
    title: "Vendor & Customer Tracking",
    note: "Manage who you do business with",
    availability: [true, true, true],
  },
  {
    title: "Banking & Payroll Integrations",
    note: "12,000+ financial institutions",
    availability: [true, true, true],
  },
  {
    title: "Revenue & Spend Integrations",
    note: "Stripe, Ramp, BILL and more",
    availability: [false, true, true],
  },
  {
    title: "Custom Dashboards",
    note: "Build your own view",
    availability: [false, true, true],
  },
  {
    title: "Dimensional Accounting",
    note: "Department and location tracking",
    availability: [false, true, true],
  },
  {
    title: "Close Automation",
    note: "Month end on autopilot",
    availability: [false, false, true],
  },
  {
    title: "Custom Management Reporting",
    note: "Investor ready reporting",
    availability: [false, false, true],
  },
  {
    title: "Multi Entity Accounting",
    note: "All your businesses in one place",
    availability: [false, false, true],
  },
];

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await register(email, password, firstName, lastName);
      await login(email, password);
      router.push("/setup");
    } catch (err: any) {
      const msg = err?.email?.[0] || err?.password?.[0] || err?.detail || "Registration failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f5f1fa_0%,#f8f5fb_30%,#fbfbff_68%,#ffffff_100%)] px-4 py-8 text-black sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-semibold tracking-[0.22em] text-black/70 uppercase"
          >
            Beakon
          </Link>
          <Link href="/login" className="text-sm font-medium text-black/65 hover:text-black">
            Sign in
          </Link>
        </div>

        <section className="rounded-[32px] border border-[#ece7f2] bg-white/80 px-4 py-8 shadow-[0_30px_80px_rgba(95,79,117,0.08)] backdrop-blur sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[640px] text-center">
            <h1 className="text-[2.3rem] leading-[0.95] tracking-[-0.07em] text-black sm:text-[3.6rem]">
              Accounting software
              <span className="block font-semibold">that works for you.</span>
            </h1>
          </div>

          <div className="mt-8 overflow-hidden rounded-[18px] border border-[#e8e3ea] bg-white">
            <div className="hidden lg:block">
              <div className="grid lg:grid-cols-[1.1fr_1fr_1fr_1fr]">
                <div className="border-r border-[#ebe6ed] bg-white">
                  <div className="h-[6px] bg-[#f0edf3]" />
                  <div className="flex min-h-[158px] items-start px-4 pb-4 pt-4">
                    <h2 className="text-sm font-semibold tracking-[-0.04em] text-black">
                      Compare all plans
                    </h2>
                  </div>
                </div>

                {plans.map((plan) => (
                  <div
                    key={plan.name}
                    className={`${plan.tone} border-r border-[#ebe6ed] last:border-r-0`}
                  >
                    <div className={`h-[6px] ${plan.accent}`} />
                    <div className="flex min-h-[158px] flex-col px-4 pb-4 pt-4">
                      <div className="flex min-h-[20px] items-start justify-between gap-2">
                        <div className="text-sm font-semibold tracking-[-0.04em] text-black">
                          {plan.name}
                        </div>
                        {plan.badge ? (
                          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-black/70">
                            {plan.badge}
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-2 min-h-[40px] text-[10px] leading-4 text-black/55 sm:text-[11px]">
                        {plan.description}
                      </p>

                      <div className="mt-4 flex items-end gap-1">
                        <span
                          className={`tracking-[-0.08em] text-black ${
                            plan.price === "Custom" ? "text-[2rem] sm:text-[2.25rem]" : "text-[2.5rem] sm:text-[3rem]"
                          }`}
                        >
                          {plan.price}
                        </span>
                        {plan.suffix ? (
                          <span className="pb-1 text-[11px] text-black/70">{plan.suffix}</span>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className={`mt-4 w-full rounded-full px-3 py-2 text-[11px] font-semibold transition sm:text-xs ${plan.buttonStyle}`}
                      >
                        {plan.button}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="grid min-h-[66px] border-t border-[#ebe6ed] lg:grid-cols-[1.1fr_1fr_1fr_1fr]"
                >
                  <div className="flex items-center border-r border-[#ebe6ed] bg-white px-4 py-3">
                    <div>
                      <div className="text-[12px] font-semibold leading-4 text-black sm:text-[13px]">
                        {feature.title}
                      </div>
                      <div className="mt-1 text-[10px] leading-4 text-black/45 sm:text-[11px]">
                        {feature.note}
                      </div>
                    </div>
                  </div>

                  {plans.map((plan, planIndex) => (
                    <div
                      key={`${feature.title}-${plan.name}`}
                      className={`${plan.tone} flex items-center justify-center border-r border-[#ebe6ed] px-3 last:border-r-0`}
                    >
                      {feature.availability[planIndex] ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#14ecc7] text-black">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <Minus className="h-4 w-4 text-black/35" />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="lg:hidden">
              {plans.map((plan, planIndex) => (
                <div
                  key={plan.name}
                  className={`${plan.tone} border-b border-[#ebe6ed] last:border-b-0`}
                >
                  <div className={`h-[6px] ${plan.accent}`} />
                  <div className="px-4 pb-4 pt-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold tracking-[-0.04em] text-black">
                        {plan.name}
                      </div>
                      {plan.badge ? (
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-black/70">
                          {plan.badge}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] leading-4 text-black/55">{plan.description}</p>
                    <div className="mt-4 flex items-end gap-1">
                      <span className={`tracking-[-0.08em] text-black ${plan.price === "Custom" ? "text-[2rem]" : "text-[2.5rem]"}`}>
                        {plan.price}
                      </span>
                      {plan.suffix ? <span className="pb-1 text-[11px] text-black/70">{plan.suffix}</span> : null}
                    </div>
                    <button
                      type="button"
                      className={`mt-4 w-full rounded-full px-3 py-2 text-[11px] font-semibold transition ${plan.buttonStyle}`}
                    >
                      {plan.button}
                    </button>
                  </div>

                  <div className="border-t border-[#ebe6ed] bg-white/55">
                    {features.map((feature) => (
                      <div
                        key={`${plan.name}-${feature.title}`}
                        className="flex items-center justify-between gap-4 border-t border-[#ebe6ed] px-4 py-3 first:border-t-0"
                      >
                        <div>
                          <div className="text-[12px] font-semibold leading-4 text-black">
                            {feature.title}
                          </div>
                          <div className="mt-1 text-[10px] leading-4 text-black/45">
                            {feature.note}
                          </div>
                        </div>
                        {feature.availability[planIndex] ? (
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#14ecc7] text-black">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <Minus className="h-4 w-4 shrink-0 text-black/35" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-[#ece7ee] bg-white p-3">
              <div className="flex flex-col gap-3 rounded-[14px] border border-[#ece8ef] bg-[#fbfbfd] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] font-medium text-black/70 sm:text-[13px]">
                  Are you an accounting firm? Build an AI-native practice with Beakon.
                </p>
                <button
                  type="button"
                  className="rounded-full bg-[#16efc8] px-4 py-2 text-[11px] font-semibold text-black transition hover:bg-[#08ddb8]"
                >
                  Learn more
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-8 max-w-[720px] rounded-[28px] border border-[#ece7f2] bg-white/92 p-6 shadow-[0_24px_60px_rgba(95,79,117,0.08)] sm:p-8">
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-black/45">
              Register
            </div>
            <h2 className="mt-3 text-[1.9rem] font-semibold tracking-[-0.05em] text-black">
              Start your free trial
            </h2>
            <p className="mt-2 text-sm text-black/55">
              Create your account and continue to workspace setup.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <input
                id="firstName"
                type="text"
                className="h-12 rounded-2xl border border-[#e7e5eb] bg-[#f7f6fa] px-4 text-sm outline-none transition placeholder:text-black/35 focus:border-[#6adfcb] focus:bg-white focus:ring-4 focus:ring-[#d8fbf3]"
                placeholder="First name"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
              <input
                id="lastName"
                type="text"
                className="h-12 rounded-2xl border border-[#e7e5eb] bg-[#f7f6fa] px-4 text-sm outline-none transition placeholder:text-black/35 focus:border-[#6adfcb] focus:bg-white focus:ring-4 focus:ring-[#d8fbf3]"
                placeholder="Last name"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>

            <input
              id="email"
              type="email"
              className="h-12 w-full rounded-2xl border border-[#e7e5eb] bg-[#f7f6fa] px-4 text-sm outline-none transition placeholder:text-black/35 focus:border-[#6adfcb] focus:bg-white focus:ring-4 focus:ring-[#d8fbf3]"
              placeholder="Work email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <input
              id="password"
              type="password"
              className="h-12 w-full rounded-2xl border border-[#e7e5eb] bg-[#f7f6fa] px-4 text-sm outline-none transition placeholder:text-black/35 focus:border-[#6adfcb] focus:bg-white focus:ring-4 focus:ring-[#d8fbf3]"
              placeholder="Create password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />

            <button
              type="submit"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Creating account..." : "Create account"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-black/55">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-black">
              Sign in
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
