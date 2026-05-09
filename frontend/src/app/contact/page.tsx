"use client";

import Link from "next/link";
import { ArrowRight, Mail, MessageSquare, Sparkles } from "lucide-react";
import Logo from "@/components/logo";


export default function ContactPage() {
  return (
    <div className="bg-brand-950 text-white min-h-screen flex flex-col">
      <PublicHeader />

      <main className="flex-1 flex items-center justify-center px-6 py-16 sm:px-10">
        <div className="max-w-2xl w-full text-center">
          {/* Coming-soon badge */}
          <p className="inline-flex items-center gap-2 rounded-full border border-mint-400/30 bg-mint-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-mint-200">
            <Sparkles className="h-3 w-3" />
            Coming soon · next phase
          </p>

          <h1 className="mt-6 font-display text-[42px] sm:text-[56px] font-light leading-[1.05] tracking-tight">
            Let&apos;s talk
            <br />
            <span className="italic text-mint-300">— very soon.</span>
          </h1>

          <p className="mt-6 text-base sm:text-lg leading-relaxed text-white/70 max-w-lg mx-auto">
            Our contact form, demo booking, and live chat are arriving in the next phase
            of the Beakon rollout. Until then, the team is happy to hear from you directly.
          </p>

          {/* Phase boxes */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
            <PhaseCard
              status="Now"
              title="Direct outreach"
              text="Reach out by email or LinkedIn — every message lands with the founders."
              accent
            />
            <PhaseCard
              status="Phase 2"
              title="Self-serve form"
              text="A typed contact form with topic routing — sales, support, partnerships."
            />
            <PhaseCard
              status="Phase 3"
              title="Live chat & demo booking"
              text="Real-time chat with the team and a calendar to schedule a Beakon walkthrough."
            />
          </div>

          {/* Action row */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="mailto:hello@getbeakon.com"
              className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-brand-950 shadow-xl shadow-mint-500/10 transition hover:bg-mint-200"
            >
              <Mail className="h-4 w-4" />
              hello@getbeakon.com
            </a>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white/80 transition hover:border-white/40 hover:text-white"
            >
              Back to home
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <p className="mt-12 text-[11px] uppercase tracking-[0.2em] text-white/30">
            We typically respond within one business day
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}


function PhaseCard({
  status, title, text, accent,
}: { status: string; title: string; text: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl p-4 backdrop-blur-sm ${
        accent
          ? "border border-mint-400/40 bg-mint-500/5"
          : "border border-white/10 bg-white/[0.02]"
      }`}
    >
      <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
        accent ? "text-mint-300" : "text-white/40"
      }`}>
        {status}
      </p>
      <p className="mt-2 text-sm font-semibold text-white">{title}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/60">{text}</p>
    </div>
  );
}


function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-brand-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-center" aria-label="Beakon">
          <Logo variant="horizontal" size={34} colors={{ text: "#ffffff" }} />
        </Link>
        <nav className="hidden items-center gap-9 text-[13.5px] text-white/70 md:flex">
          <Link href="/#capabilities" className="transition hover:text-white">Product</Link>
          <Link href="/pricing" className="transition hover:text-white">Pricing</Link>
          <Link href="/#trust" className="transition hover:text-white">Trust</Link>
          <Link href="/contact" className="text-white">Contact</Link>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-white/80 transition hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="group inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-950 transition hover:bg-mint-200"
          >
            Start free trial
            <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}


function SiteFooter() {
  return (
    <footer className="border-t border-white/5 bg-brand-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo variant="horizontal" size={28} colors={{ text: "#ffffff" }} />
            <span className="text-[11px] text-white/40">
              © {new Date().getFullYear()} Beakon · Accounting. Reimagined.
            </span>
          </div>
          <div className="flex items-center gap-6 text-[12px] text-white/60">
            <Link href="/" className="transition hover:text-white">Home</Link>
            <Link href="/pricing" className="transition hover:text-white">Pricing</Link>
            <Link href="/contact" className="text-white">Contact</Link>
            <span className="inline-flex items-center gap-1 text-mint-300">
              <MessageSquare className="h-3 w-3" />
              Coming soon
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
