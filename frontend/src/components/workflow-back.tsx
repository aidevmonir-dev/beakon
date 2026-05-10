"use client";

/* Workflow-context Back link.
 *
 * Reads `?from=` from the URL via `useWorkflowBack` (see lib/workflow-back.ts)
 * and renders a Back link that returns to the workflow the user came
 * from — even if that workflow lives in a different module.
 *
 * Wrapped in <Suspense> at the consumer side: `useSearchParams()`
 * triggers a client boundary on Next.js App Router pages.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useWorkflowBack } from "@/lib/workflow-back";


export default function WorkflowBack({
  fallbackHref,
  fallbackLabel,
  className,
}: {
  fallbackHref: string;
  fallbackLabel?: string;
  className?: string;
}) {
  const target = useWorkflowBack({ href: fallbackHref, label: fallbackLabel });
  return (
    <Link
      href={target.href}
      className={
        className ??
        "inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
      }
    >
      <ArrowLeft className="h-4 w-4" />
      Back to {target.label}
    </Link>
  );
}
