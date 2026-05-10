"use client";

/* Beakon Currency explainer panel — shared between onboarding (Stage 3
 * of /setup) and post-onboarding edit (/dashboard/settings/organization).
 *
 * Copy is taken verbatim from the UI philosophy doc (2026-05-10) so the
 * client gets the same framing in both surfaces.
 */
import { Globe2 } from "lucide-react";


export default function BeakonCurrencyExplainer() {
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4 text-[12.5px] leading-relaxed text-gray-700">
      <div className="flex items-start gap-2">
        <Globe2 className="h-4 w-4 mt-0.5 shrink-0 text-brand-700" />
        <div className="space-y-1.5">
          <p>
            <span className="font-semibold text-gray-900">Beakon Currency</span> is
            the currency in which <em>you</em> — the Client / the Beakon —
            want to view your dashboards, summaries and consolidated overviews.
          </p>
          <p className="text-gray-600">
            It is <strong>not</strong> the legal accounting currency, the entity
            functional currency, or the statutory consolidation currency.
            Each entity keeps its own functional currency; statutory
            consolidation can sit in a different one again.
          </p>
          <p className="text-gray-600">
            Example: a Swiss company in CHF, a Japanese subsidiary in JPY,
            and a US sub in USD may consolidate financially in GBP — while
            you personally view the overall Beakon reports in EUR.
          </p>
        </div>
      </div>
    </div>
  );
}
