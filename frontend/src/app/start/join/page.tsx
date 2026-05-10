"use client";

/* Stage 0 — "Join Existing Workspace" placeholder.
 *
 * The invitation-acceptance flow is a separate workstream (see the UI
 * philosophy doc). This screen explains the situation cleanly rather
 * than redirecting silently or 404-ing.
 */
import { Suspense } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import Logo from "@/components/logo";
import WorkflowBack from "@/components/workflow-back";


export default function JoinPlaceholderPage() {
  return (
    <main className="min-h-screen bg-canvas-50">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 py-16">
        <div className="mb-8 flex justify-center">
          <Logo variant="horizontal" size={36} />
        </div>

        <div className="w-full rounded-2xl border border-canvas-200/70 bg-white p-8 text-center shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">
            Joining a workspace
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-gray-600">
            Workspace owners invite teammates by email. If you're expecting an
            invitation, check your inbox — the invite link will bring you
            directly to the workspace.
          </p>
          <p className="mt-2 text-[13px] text-gray-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-700 hover:underline">
              Sign in
            </Link>
            .
          </p>

          <div className="mt-6">
            <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
              <WorkflowBack fallbackHref="/start" fallbackLabel="entry" />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  );
}
