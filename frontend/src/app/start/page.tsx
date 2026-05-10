"use client";

/* Stage 0 — Entry screen.
 *
 * Per the UI philosophy doc (2026-05-10): the very first surface a
 * visitor sees should be premium and minimal — three options only:
 *   [ Create Workspace ] [ Join Existing Workspace ] [ Login ]
 *
 * "Join Existing Workspace" is intentionally a placeholder for now —
 * the invitation-acceptance flow doesn't exist yet. It surfaces a
 * helpful note rather than a 404.
 */
import Link from "next/link";
import { ArrowRight, LogIn, PlusCircle, UserPlus } from "lucide-react";
import Logo from "@/components/logo";


export default function StartPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas-50">
      {/* Soft ambient gradient — calm, premium, not loud. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(80%_60%_at_20%_0%,rgba(58,168,136,0.12),transparent_60%),radial-gradient(70%_50%_at_100%_100%,rgba(35,79,96,0.10),transparent_60%)]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center px-6 py-16">
        <div className="mb-10 flex justify-center">
          <Logo variant="horizontal" size={40} />
        </div>

        <div className="mb-12 max-w-xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
            Welcome to <span className="italic font-normal text-brand-700">get</span>
            <span className="font-bold text-brand-700">BEAKON</span>
          </h1>
          <p className="mt-3 text-base leading-relaxed text-gray-600 sm:text-[17px]">
            The intelligent operating system for structures, accounting,
            and organizational management.
          </p>
        </div>

        <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          <EntryCard
            href="/pricing"
            icon={PlusCircle}
            title="Create Workspace"
            body="Start a new organization. Pick a plan, set up your structure, and start operating."
            primary
          />
          <EntryCard
            href="/start/join"
            icon={UserPlus}
            title="Join Existing Workspace"
            body="Accept an invitation to a workspace someone has already set up for you."
          />
          <EntryCard
            href="/login"
            icon={LogIn}
            title="Login"
            body="Sign in to a workspace you already use."
          />
        </div>

        <p className="mt-10 text-center text-xs text-gray-400">
          Hosted in Switzerland · Swiss-VAT &amp; ELM-ready · AI proposes, your team approves.
        </p>
      </div>
    </main>
  );
}


function EntryCard({
  href, icon: Icon, title, body, primary = false,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "group relative flex flex-col rounded-2xl border bg-white p-6 transition " +
        "hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)] " +
        (primary
          ? "border-brand-200 ring-1 ring-brand-100"
          : "border-canvas-200/70")
      }
    >
      <div
        className={
          "mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl " +
          (primary ? "bg-brand-50 text-brand-700" : "bg-canvas-100 text-gray-600")
        }
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-[15px] font-semibold text-gray-900">{title}</div>
      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-gray-600">{body}</p>
      <div
        className={
          "mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium " +
          (primary ? "text-brand-700" : "text-gray-700")
        }
      >
        Continue
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
