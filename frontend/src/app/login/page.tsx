"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { hasOrganizationContext, login } from "@/lib/api";
import Logo from "@/components/logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@beakon.com");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);
      router.push(hasOrganizationContext() ? "/dashboard" : "/setup");
    } catch (err: any) {
      setError(err?.detail || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8fbff] text-slate-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[42%] h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,_rgba(96,130,255,0.24)_0%,_rgba(96,130,255,0.1)_36%,_rgba(255,255,255,0)_74%)] blur-3xl" />
        <div className="absolute left-1/2 top-[58%] h-[22rem] w-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,_rgba(33,228,198,0.3)_0%,_rgba(33,228,198,0.13)_38%,_rgba(255,255,255,0)_76%)] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.84)_0%,rgba(248,251,255,0.94)_100%)]" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-7 py-9 sm:px-10">
        <Link href="/" className="flex items-center" aria-label="Beakon">
          <Logo variant="horizontal" size={36} />
        </Link>

        <div className="flex items-center gap-6 text-sm text-slate-500">
          <Link href="/pricing" className="hidden font-medium text-slate-600 transition hover:text-brand-800 sm:inline">
            Pricing
          </Link>
          <p>
            Need an account?{" "}
            <Link href="/register" className="font-semibold text-brand-700 transition hover:text-brand-900">
              Sign Up
            </Link>
          </p>
        </div>
      </header>

      <main className="relative z-10 flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 pb-20">
        <div className="w-full max-w-sm rounded-[1.9rem] border border-white/70 bg-white/30 p-4 shadow-[0_30px_80px_rgba(79,111,211,0.18)] backdrop-blur-xl">
          <div className="rounded-[1.5rem] border border-[#dfe9fb] bg-white/78 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] backdrop-blur">
            <div className="mb-5">
              <h1 className="text-[1.95rem] font-semibold tracking-[-0.05em] text-brand-900">Sign in to Beakon</h1>
              <p className="mt-1 text-sm text-slate-500">Clearer financial workflows, one secure workspace.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  className="h-12 w-full rounded-2xl border border-[#cddbf2] bg-white/85 pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                  placeholder="Enter email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type="password"
                  className="h-12 w-full rounded-2xl border border-[#cddbf2] bg-white/85 pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#edf4ff] text-sm font-semibold text-brand-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition hover:bg-[#e4efff] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
              >
                <Mail className="h-4 w-4" />
                <span>{loading ? "Signing in..." : "Continue with Email"}</span>
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>

              <div className="pt-1 text-center text-xs font-semibold tracking-[0.22em] text-slate-400">OR</div>

              <button
                type="button"
                className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-[#14e8c5] px-4 text-sm font-semibold text-slate-900 shadow-[0_12px_30px_rgba(20,232,197,0.28)] transition hover:bg-[#10dcbc] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                onClick={() => {
                  setEmail("demo@beakon.com");
                  setPassword("demo1234");
                  setTimeout(() => {
                    const form = document.querySelector("form");
                    form?.requestSubmit();
                  }, 100);
                }}
              >
                <Sparkles className="h-4 w-4" />
                <span>Continue as Demo</span>
              </button>
            </form>

            <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3 text-xs text-slate-500 ring-1 ring-[#dfe9fb]">
              Demo access: <span className="font-medium text-slate-700">demo@beakon.com</span> /{" "}
              <span className="font-medium text-slate-700">demo1234</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 pb-8 text-center text-xs text-slate-400">
        <p>© 2026 Beakon.</p>
        <p className="mt-1">Built on the open-source bookkeeping platform.</p>
        <div className="mt-1 flex items-center justify-center gap-3">
          <span>Terms of Service</span>
          <span>Privacy Policy</span>
        </div>
      </footer>
    </div>
  );
}
