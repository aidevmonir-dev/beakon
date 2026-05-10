"use client";

/* Generic "coming soon" panel used by placeholder module pages
 * (Employment, Documents). Replaces the previously-inlined helper from
 * /dashboard/travel/page.tsx, which is now a real module.
 */
import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import WorkflowBack from "@/components/workflow-back";


export default function ComingSoon({
  icon: Icon, title, body, fallbackHref = "/dashboard",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  fallbackHref?: string;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-canvas-300 bg-canvas-50/40 p-10 text-center">
      <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 leading-relaxed">{body}</p>
      <div className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-brand-100">
        <Sparkles className="h-3 w-3" />
        Coming soon
      </div>
      <div className="mt-6">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref={fallbackHref} />
        </Suspense>
      </div>
    </div>
  );
}
