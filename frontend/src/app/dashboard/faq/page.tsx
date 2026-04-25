"use client";

/* Meeting FAQ — pre-filled discussion sheet for sessions with Thomas.
 *
 * Left column = the question (and a one-line "why we need to know").
 * Right column = a textarea where Monirul captures Thomas's answer live.
 *
 * Notes persist to localStorage keyed by question id so a refresh, an
 * accidental nav-away, or a Fast-Refresh during the call doesn't wipe
 * the meeting record. "Copy as Markdown" dumps the full Q+A so it can be
 * pasted into Notion / a doc / chat right after the meeting.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Plus, RotateCcw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

type Question = {
  id: string;
  q: string;
  /** One-line reason this matters — shown small under the question. */
  why?: string;
};

type Section = {
  id: string;
  label: string;
  items: Question[];
};

const SECTIONS: Section[] = [
  {
    id: "coa",
    label: "Chart of Accounts & metadata",
    items: [
      {
        id: "coa-versioning",
        q: "Is CoA versioning per template, per entity, or both? When an entity adopts a new version, do open balances re-map automatically or by hand?",
        why: "Drives whether 01 CoA Definition rows attach to entities directly or through a join table.",
      },
      {
        id: "coa-universal-mapping",
        q: "On 03 CoA Mapping — is the mapping percent split used in production today, or aspirational? Should MVP enforce 100% coverage or just flag gaps?",
        why: "Decides if reporting can fall back to local CoA when universal mapping is incomplete.",
      },
      {
        id: "dim-validation",
        q: "For 09 Dimension Validation Rules — should missing required dimensions BLOCK posting, or only warn on draft → pending?",
        why: "Hard block changes the UX from 'fix later' to 'cannot save'. Need Thomas's call.",
      },
      {
        id: "controlled-lists-ownership",
        q: "Who owns controlled-list values in production — Thomas, the entity admin, or both with approval?",
        why: "Drives whether we need an admin UI now or just a seed migration.",
      },
    ],
  },
  {
    id: "intercompany",
    label: "Multi-entity & intercompany",
    items: [
      {
        id: "ic-mirror",
        q: "Should intercompany journals auto-mirror in the counterparty entity, or always require explicit booking on both sides?",
        why: "Auto-mirror simplifies AP/AR but makes 'one-sided' adjustments harder.",
      },
      {
        id: "elimination",
        q: "Are elimination entries generated at consolidation time, or stored as live JEs in a dedicated 'consolidation' entity?",
        why: "Determines whether eliminations are part of the ledger or a reporting layer only.",
      },
      {
        id: "reporting-currency",
        q: "Single base reporting currency for the family, or one per portfolio? What about per-entity functional currency?",
        why: "Drives FX revaluation scope and how we present consolidated reports.",
      },
    ],
  },
  {
    id: "fx",
    label: "FX",
    items: [
      {
        id: "fx-source",
        q: "Where do FX rates come from in production — manual upload, scheduled feed (which provider), or pulled from the custodian?",
        why: "We need a deterministic source before we ship FX revaluation.",
      },
      {
        id: "fx-reval",
        q: "Revaluation policy — every period close, month-end only, or on demand? How is realized vs unrealized split?",
        why: "Affects how we model FX gains/losses in the posting engine.",
      },
    ],
  },
  {
    id: "approvals",
    label: "Approvals",
    items: [
      {
        id: "approvals-levels",
        q: "Multi-level approval (preparer → reviewer → approver) or single approver per JE?",
        why: "Single-approver is what's wired now. Multi-level means schema + UI changes.",
      },
      {
        id: "approvals-thresholds",
        q: "Should approvals escalate by amount threshold? If yes, what currency and what amounts?",
        why: "Determines if we need a rule engine or just a fixed flow.",
      },
      {
        id: "approvals-self",
        q: "Can the same person prepare and approve when they're the only operator at an entity?",
        why: "Common in small family offices but a control failure for auditors. Need Thomas's stance.",
      },
    ],
  },
  {
    id: "periods",
    label: "Period close",
    items: [
      {
        id: "periods-soft-hard",
        q: "Soft-close vs hard-close — what actions does each block? Can a soft-closed period still accept adjusting JEs with a note?",
        why: "The current model treats them similarly; Thomas has the accounting-correct answer.",
      },
      {
        id: "periods-reopen",
        q: "Reopen rules — who can reopen, what gets logged, and do downstream reports get invalidated/regenerated?",
        why: "Audit trail completeness depends on this.",
      },
    ],
  },
  {
    id: "ingestion",
    label: "Ingestion (bank, AP/AR, docs)",
    items: [
      {
        id: "bank-source",
        q: "CSV-only at MVP, or do we need a direct connect (Plaid / SaltEdge / Yodlee) before the first pilot?",
        why: "Direct-connect adds 4–6 weeks; CSV is shippable now.",
      },
      {
        id: "bank-formats",
        q: "Does Thomas have a starter set of bank statement formats we should pre-load (HSBC, Citi, JP Morgan, etc.)?",
      },
      {
        id: "recon-heuristic",
        q: "Auto-match heuristic for bank reconciliation — date + amount + counterparty? What tolerance window in days/amount?",
      },
      {
        id: "recon-unmatched",
        q: "When a bank line has no matching JE, auto-draft a JE or sit in a holding queue for review?",
      },
      {
        id: "docs-required",
        q: "Is a source document required for every JE, or optional with a flag? What's the OCR scope at MVP — invoices only, or bank statements too?",
      },
    ],
  },
  {
    id: "wealth",
    label: "Wealth masters & investments",
    items: [
      {
        id: "tax-lots",
        q: "Tax-lot accounting — needed for MVP pilot, or Phase 4? Which cost-basis method (FIFO / average / specific-ID)?",
        why: "Tax lots add real complexity; want to descope if pilot doesn't need it.",
      },
      {
        id: "counterparty-required",
        q: "Counterparty / related-party — required dimension on every JE, or only for specific account types?",
      },
      {
        id: "instrument-pricing",
        q: "Instrument pricing — manual, custodian feed, or market-data vendor? Frequency?",
      },
    ],
  },
  {
    id: "ai",
    label: "AI layer",
    items: [
      {
        id: "ai-actions",
        q: "Read-only AI surfacing only, or can AI propose a draft JE that a human approves? What about auto-categorisation of bank lines?",
        why: "The blueprint says AI must not define accounting — but 'propose-then-human' may still be in scope.",
      },
      {
        id: "ai-tolerance",
        q: "What false-positive rate would Thomas tolerate on anomaly alerts before he'd want them turned off?",
      },
    ],
  },
  {
    id: "pilot",
    label: "Pilot, commercial, and ops",
    items: [
      {
        id: "pilot-customer",
        q: "Who is the first family-office pilot, by when, and what's their hard 'go-live' definition?",
        why: "Sets the must-have list vs the nice-to-have list for the next 90 days.",
      },
      {
        id: "data-migration",
        q: "Data migration — direct workbook import, CSV per tab, or manual entry assisted by us?",
      },
      {
        id: "permissions-roles",
        q: "Does the family principal log into Beakon, or only the bookkeeping operators? What's the role model — just admin/operator/viewer?",
      },
      {
        id: "compliance",
        q: "SOC2 / audit posture — needed before the first pilot, or after? Any specific frameworks (ISO 27001, etc.) the pilot client requires?",
      },
      {
        id: "next-demo",
        q: "What does Thomas want to see in the next demo — and what would make him sign off on Phase 1?",
        why: "Anchors the next 2–4 weeks of work.",
      },
    ],
  },
];

const STORAGE_KEY = "beakon.faq.notes.v1";
const CUSTOM_KEY = "beakon.faq.custom.v1";
const ANSWERED_KEY = "beakon.faq.answered.v1";

type CustomQuestion = { id: string; sectionId: string; q: string };

export default function FAQPage() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const [custom, setCustom] = useState<CustomQuestion[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load persisted state once on mount.
  useEffect(() => {
    try {
      const n = localStorage.getItem(STORAGE_KEY);
      const a = localStorage.getItem(ANSWERED_KEY);
      const c = localStorage.getItem(CUSTOM_KEY);
      if (n) setNotes(JSON.parse(n));
      if (a) setAnswered(JSON.parse(a));
      if (c) setCustom(JSON.parse(c));
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true);
  }, []);

  // Persist whenever any of the three state slices change.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(ANSWERED_KEY, JSON.stringify(answered));
  }, [answered, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
  }, [custom, hydrated]);

  const allSections = useMemo<Section[]>(() => {
    return SECTIONS.map((s) => ({
      ...s,
      items: [
        ...s.items,
        ...custom
          .filter((c) => c.sectionId === s.id)
          .map((c) => ({ id: c.id, q: c.q })),
      ],
    }));
  }, [custom]);

  const totalQuestions = useMemo(
    () => allSections.reduce((acc, s) => acc + s.items.length, 0),
    [allSections],
  );
  const answeredCount = useMemo(
    () => Object.values(answered).filter(Boolean).length,
    [answered],
  );

  const setNote = useCallback((id: string, value: string) => {
    setNotes((prev) => ({ ...prev, [id]: value }));
  }, []);

  const toggleAnswered = useCallback((id: string) => {
    setAnswered((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const addCustom = useCallback((sectionId: string) => {
    const q = window.prompt("New question to ask Thomas:");
    if (!q || !q.trim()) return;
    setCustom((prev) => [
      ...prev,
      { id: `custom-${Date.now()}`, sectionId, q: q.trim() },
    ]);
  }, []);

  const removeCustom = useCallback((id: string) => {
    setCustom((prev) => prev.filter((c) => c.id !== id));
    setNotes((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    setAnswered((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const copyMarkdown = useCallback(async () => {
    const lines: string[] = [
      `# Meeting FAQ — Thomas`,
      ``,
      `_Captured ${new Date().toLocaleString()}_`,
      ``,
    ];
    for (const section of allSections) {
      lines.push(`## ${section.label}`, ``);
      for (const item of section.items) {
        const mark = answered[item.id] ? "x" : " ";
        lines.push(`- [${mark}] **${item.q}**`);
        const note = (notes[item.id] || "").trim();
        if (note) {
          for (const ln of note.split("\n")) lines.push(`  > ${ln}`);
        }
        lines.push("");
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.alert("Couldn't copy — your browser blocked clipboard access.");
    }
  }, [allSections, answered, notes]);

  const resetAll = useCallback(() => {
    if (!window.confirm("Clear all notes and answered marks? Custom questions will also be removed.")) {
      return;
    }
    setNotes({});
    setAnswered({});
    setCustom([]);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meeting FAQ — Thomas"
        description="Open questions for the founder check-in. Type Thomas's answers on the right; everything auto-saves locally. Use 'Copy as Markdown' to export the full record after the meeting."
        actions={
          <>
            <button
              onClick={copyMarkdown}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                copied
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-canvas-200 bg-white text-gray-700 hover:bg-canvas-50",
              )}
              title="Copy all questions and answers as Markdown"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy as Markdown"}
            </button>
            <button
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-canvas-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-canvas-50"
              title="Clear all notes and answered marks"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </>
        }
      />

      <div className="text-xs text-gray-500">
        {answeredCount} of {totalQuestions} marked answered
      </div>

      <div className="space-y-8">
        {allSections.map((section) => (
          <section key={section.id} className="space-y-3">
            <div className="flex items-center justify-between border-b border-canvas-100 pb-2">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-gray-500">
                {section.label}
              </h2>
              <button
                onClick={() => addCustom(section.id)}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900"
                title={`Add a question to ${section.label}`}
              >
                <Plus className="w-3.5 h-3.5" />
                Add question
              </button>
            </div>

            <div className="divide-y divide-canvas-100 rounded-lg border border-canvas-100 bg-white">
              {section.items.map((item) => {
                const isAnswered = !!answered[item.id];
                const isCustom = item.id.startsWith("custom-");
                const why = (item as Question).why;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "grid grid-cols-1 md:grid-cols-2 gap-4 p-4 transition-colors",
                      isAnswered && "bg-emerald-50/40",
                    )}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <input
                          id={`ans-${item.id}`}
                          type="checkbox"
                          checked={isAnswered}
                          onChange={() => toggleAnswered(item.id)}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-canvas-300 text-brand-600 focus:ring-brand-500"
                        />
                        <label
                          htmlFor={`ans-${item.id}`}
                          className={cn(
                            "text-sm leading-relaxed text-gray-900 cursor-pointer",
                            isAnswered && "line-through text-gray-500",
                          )}
                        >
                          {item.q}
                        </label>
                      </div>
                      {why && (
                        <p className="ml-6 text-xs italic text-gray-500 leading-relaxed">
                          {why}
                        </p>
                      )}
                      {isCustom && (
                        <button
                          onClick={() => removeCustom(item.id)}
                          className="ml-6 inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                          Remove
                        </button>
                      )}
                    </div>
                    <div>
                      <textarea
                        value={notes[item.id] || ""}
                        onChange={(e) => setNote(item.id, e.target.value)}
                        placeholder="Thomas's answer / requirement…"
                        rows={3}
                        className="w-full resize-y rounded-md border border-canvas-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
