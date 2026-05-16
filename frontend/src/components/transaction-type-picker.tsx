"use client";

/* TransactionTypePicker — the top of every JE creation flow.
 *
 * Per Thomas's expanded spec (WhatsApp 2026-04-25, follow-up to the voice
 * note): the journal-entry type is the first field, and there are now 10
 * named types. AI may pre-pick the type from a document — that's the
 * banner at the top, not a card. Cards either "Open form" (working today)
 * or show a "Coming soon" hint that names what blocker has to ship first.
 *
 * Order matches Thomas's verbatim list so this picker reads like the
 * spec he wrote.
 */
import {
  Sparkles, NotebookPen, Receipt, FileText, TrendingUp, Landmark, Building,
  CreditCard, Network, Users, Hourglass, CalendarCheck,
  ChevronRight, X, Clock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";


export type TxType =
  | "ap" | "ar" | "bank" | "general" | "intercompany"
  | "fixed_asset" | "payroll" | "portfolio_trade"
  | "accrual_prepayment" | "period_end" | "loan";

interface TypeCardData {
  key: TxType;
  name: string;
  icon: LucideIcon;
  blurb: string;
  status: "ready" | "coming_soon";
  /** Only used when status=coming_soon — names what has to ship first. */
  comingHint?: string;
}

// Order is Thomas's verbatim list (WhatsApp 2026-04-25). Loan tacked on
// at the end since it was in the earlier voice note and we already have a
// working drawer for it.
const CARDS: TypeCardData[] = [
  { key: "ap", name: "AP invoice", icon: Receipt, status: "ready",
    blurb: "Vendor bill. AP accrual on approve, cash payment on mark-as-paid." },
  { key: "ar", name: "AR invoice", icon: FileText, status: "ready",
    blurb: "Customer invoice. AR accrual on approve, cash receipt on mark-as-paid." },
  { key: "bank", name: "Bank transaction", icon: CreditCard, status: "ready",
    blurb: "Standalone bank movement — transfer, fee, or interest received." },
  { key: "general", name: "Regular journal", icon: NotebookPen, status: "ready",
    blurb: "Manual debit / credit lines. Reclass, accrual, adjustment." },
  { key: "intercompany", name: "Intercompany", icon: Network, status: "ready",
    blurb: "Entry between two related entities. v1 books one side; auto-mirror leg coming." },
  { key: "fixed_asset", name: "Fixed asset", icon: Building, status: "ready",
    blurb: "Capex purchase or depreciation against the fixed-asset register." },
  { key: "payroll", name: "Payroll", icon: Users, status: "ready",
    blurb: "Monthly payroll — gross, employer social, withholding; net pays bank." },
  { key: "portfolio_trade", name: "Investment transaction", icon: TrendingUp, status: "ready",
    blurb: "Buy / sell a security. Captures qty, price, custodian, portfolio." },
  { key: "accrual_prepayment", name: "Accrual / prepayment", icon: Hourglass, status: "ready",
    blurb: "Accrue an expense or record a prepaid asset. Auto-amortise coming with the rules registry." },
  { key: "period_end", name: "Period-end adjustment", icon: CalendarCheck, status: "ready",
    blurb: "FX revaluation, tax provision, reclass — tagged for auto-reversal at close." },
  { key: "loan", name: "Loan transaction", icon: Landmark, status: "ready",
    blurb: "Drawdown, interest accrual, or repayment against a loan." },
];


interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (type: TxType) => void;
  onPickAISuggest: () => void;
}

export default function TransactionTypePicker({
  open, onClose, onPick, onPickAISuggest,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center sm:justify-center"
      role="dialog" aria-modal="true" aria-labelledby="tx-type-picker-title"
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:w-[760px] sm:max-h-[88vh] bg-white sm:rounded-2xl rounded-t-2xl border border-canvas-200 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
              New transaction
            </p>
            <h2 id="tx-type-picker-title" className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">
              What kind of transaction?
            </h2>
            <p className="mt-1 text-xs text-gray-500 max-w-md">
              The journal-entry type drives which fields appear and which sub-ledger gets updated. Pick one below.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100 shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* AI banner */}
        <button
          type="button"
          onClick={() => { onClose(); onPickAISuggest(); }}
          className="mx-4 sm:mx-5 mt-4 group text-left rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50/70 via-brand-50/40 to-white p-3 sm:p-3.5 flex items-center gap-3 hover:border-brand-300 hover:shadow-md transition-all cursor-pointer"
        >
          <div className="h-9 w-9 shrink-0 rounded-lg bg-brand-100 text-brand-700 ring-1 ring-inset ring-brand-200 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-brand-900">Got a document? Let AI pick the type</h3>
              <span className="inline-flex items-center text-[10px] font-semibold text-brand-700 bg-brand-100 ring-1 ring-inset ring-brand-200 rounded-full px-1.5 py-0.5">
                Recommended
              </span>
            </div>
            <p className="mt-0.5 text-xs text-brand-700/80">
              Upload a bill, receipt, or trade confirmation — AI proposes the transaction type and pre-fills the form.
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-brand-700 shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </button>

        {/* Cards — Thomas's full list */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-2">
            Or pick the type yourself
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {CARDS.map((c) => (
              <TypeCard key={c.key} c={c}
                onPick={() => {
                  if (c.status !== "ready") return;
                  onClose();
                  onPick(c.key);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function TypeCard({ c, onPick }: { c: TypeCardData; onPick: () => void }) {
  const Icon = c.icon;
  const ready = c.status === "ready";
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={!ready}
      className={cn(
        "group text-left relative rounded-xl border p-3.5 flex gap-3 items-start transition-all",
        ready
          ? "border-canvas-200 bg-white hover:border-brand-200 hover:bg-brand-50/30 hover:shadow-sm cursor-pointer"
          : "border-canvas-200 bg-canvas-50/40 cursor-not-allowed opacity-80",
      )}
    >
      <div className={cn(
        "h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ring-1 ring-inset transition-colors",
        ready
          ? "bg-canvas-100 text-gray-600 ring-canvas-200 group-hover:bg-brand-100 group-hover:text-brand-700"
          : "bg-canvas-100 text-gray-400 ring-canvas-200",
      )}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className={cn("text-sm font-semibold", ready ? "text-gray-900" : "text-gray-700")}>
            {c.name}
          </h3>
          {!ready && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded-full px-1.5 py-0.5">
              <Clock className="w-2.5 h-2.5" />
              Coming soon
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500 leading-relaxed">{c.blurb}</p>
        {!ready && c.comingHint && (
          <p className="mt-2 text-[10px] text-amber-700/90 italic leading-relaxed">{c.comingHint}</p>
        )}
        {ready && (
          <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 group-hover:text-brand-900">
            Open form
            <ChevronRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        )}
      </div>
    </button>
  );
}
