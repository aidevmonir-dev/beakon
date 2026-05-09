"use client";

/* Transaction Type drawers — purpose-built JE creation forms.
 *
 * Per Thomas (voice note 2026-04-25): each transaction type has its
 * own field set. These four drawers are the v1 forms for the types
 * that don't have a dedicated existing screen (AP and AR already
 * have Bills / Invoices). All drawers share:
 *
 *   - common header/shell + Cancel / Create draft footer
 *   - entity + date pickers
 *   - submit POSTs to /beakon/journal-entries/ then routes to the new
 *     JE detail page
 *
 * Each drawer composes a 2-line balanced JE under the hood — the user
 * sees the type-natural fields (qty / price / loan code / asset code),
 * the form derives the debit/credit lines and attaches the right
 * dimension codes (custodian, portfolio, instrument, etc.).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X, AlertCircle, Plus, Minus, TrendingUp, Landmark, Building, NotebookPen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";


// ── Shared types ──────────────────────────────────────────────────────────

interface EntityOpt {
  id: number; code: string; name: string;
  functional_currency: string;
}
interface AccountOpt {
  id: number; code: string; name: string;
  account_type: string; account_subtype: string;
  entity_code: string | null;
}
interface BankAccountOpt {
  id: number; name: string; bank_name: string;
  currency: string; account: number; entity: number;
}
interface DimensionValueOpt {
  id: number; code: string; name: string;
  dimension_type_code?: string;
}

interface TypedDrawerProps {
  open: boolean;
  onClose: () => void;
}


// ── Shared shell ──────────────────────────────────────────────────────────

function DrawerShell({
  open, onClose, icon: Icon, kicker, title, subtitle, children, footer,
}: {
  open: boolean;
  onClose: () => void;
  icon: LucideIcon;
  kicker: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[600px] bg-white border-l border-canvas-200 overflow-y-auto flex flex-col">
        <div className="px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 shrink-0 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center ring-1 ring-inset ring-brand-200">
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">{kicker}</p>
                <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">{title}</h2>
                <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {children}
        </div>
        <div className="sticky bottom-0 border-t border-canvas-100 bg-white/95 backdrop-blur px-5 py-3 flex justify-end gap-2">
          {footer}
        </div>
      </div>
    </div>
  );
}

function Field({
  label, hint, required, children, span,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  span?: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", span === 2 && "col-span-2")}>
      <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10px] text-gray-400">{hint}</span>}
    </label>
  );
}

function ErrorBlock({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <span className="whitespace-pre-wrap">{msg}</span>
    </div>
  );
}

function asArray<T>(d: { results?: T[] } | T[]): T[] {
  return Array.isArray(d) ? d : (d.results ?? []);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtErr(e: any): string {
  if (typeof e?.detail === "string") return e.detail;
  if (e?.error?.message) return e.error.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e?.detail || e || "Failed", null, 2); } catch { return "Failed"; }
}


// ── Shared loader for entities + bank accounts ────────────────────────────

function useEntities(open: boolean) {
  const [entities, setEntities] = useState<EntityOpt[]>([]);
  useEffect(() => {
    if (!open) return;
    api.get<{ results: EntityOpt[] } | EntityOpt[]>("/beakon/entities/")
      .then((d) => setEntities(asArray(d).filter((e: any) => e.is_active !== false)))
      .catch(() => setEntities([]));
  }, [open]);
  return entities;
}

function useBankAccounts(open: boolean, entityId: string) {
  const [bas, setBAs] = useState<BankAccountOpt[]>([]);
  useEffect(() => {
    if (!open) return;
    api.get<{ results: BankAccountOpt[] } | BankAccountOpt[]>("/beakon/bank-accounts/")
      .then((d) => setBAs(asArray(d)))
      .catch(() => setBAs([]));
  }, [open]);
  return useMemo(
    () => entityId ? bas.filter((b) => String(b.entity) === entityId) : bas,
    [bas, entityId],
  );
}

function useAccounts(open: boolean, params: Record<string, string>) {
  const [accs, setAccs] = useState<AccountOpt[]>([]);
  // Stringify params for stable dependency
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!open) return;
    api.get<{ results: AccountOpt[] } | AccountOpt[]>("/beakon/accounts/", params)
      .then((d) => setAccs(asArray(d).filter((a) => a.entity_code === null || true)))
      .catch(() => setAccs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);
  return accs;
}

function useDimensionValues(open: boolean, dimCode: string) {
  // Fetch all dimension values once, filter client-side by dimension_type_code.
  const [all, setAll] = useState<DimensionValueOpt[]>([]);
  useEffect(() => {
    if (!open) return;
    api.get<{ results: DimensionValueOpt[] } | DimensionValueOpt[]>(
      "/beakon/dimension-values/", { active_flag: "true", page_size: "500" },
    )
      .then((d) => setAll(asArray(d)))
      .catch(() => setAll([]));
  }, [open]);
  return useMemo(
    () => all.filter((v) => v.dimension_type_code === dimCode),
    [all, dimCode],
  );
}


// ── 1. General Journal Entry ──────────────────────────────────────────────

interface JLine {
  account_id: string;
  description: string;
  debit: string;
  credit: string;
  currency: string;
  // Phase 1.5 additions per Thomas's expanded JE spec (WhatsApp 2026-04-25).
  // Cost centre and tax code are captured here today; on submit they're
  // appended to the line description as labelled markers — `[CC: …]`,
  // `[TAX: …]` — until the dimension and tax engines have proper columns.
  cost_centre: string;
  tax_code: string;
}

function periodLabelForDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" });
}

export function GeneralJEDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const accounts = useAccounts(open, {});

  const [entityId, setEntityId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [memo, setMemo] = useState("");
  const [explanation, setExplanation] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<JLine[]>([
    { account_id: "", description: "", debit: "", credit: "", currency: "", cost_centre: "", tax_code: "" },
    { account_id: "", description: "", debit: "", credit: "", currency: "", cost_centre: "", tax_code: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);

  const entity = entities.find((e) => String(e.id) === entityId);
  const ccyDefault = entity?.functional_currency || "EUR";

  const sums = useMemo(() => {
    const dr = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const cr = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    return { dr, cr, diff: dr - cr };
  }, [lines]);

  function updateLine(i: number, patch: Partial<JLine>) {
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  async function submit() {
    if (!entityId || lines.length < 2) return;
    if (Math.abs(sums.diff) > 0.005) {
      setErr(`Lines don't balance: DR ${sums.dr.toFixed(2)} vs CR ${sums.cr.toFixed(2)}.`);
      return;
    }
    setBusy(true); setErr(null);
    try {
      const payload = {
        entity_id: Number(entityId),
        date,
        memo: memo.trim(),
        explanation: explanation.trim(),
        reference: reference.trim(),
        currency: ccyDefault,
        source_type: "manual",
        lines: lines
          .filter((l) => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
          .map((l) => {
            // Pack cost_centre + tax_code into description with labelled
            // markers — the proper dimension / tax columns are a Phase 2
            // schema change (per Thomas's "dynamic engine" spec).
            const tags: string[] = [];
            if (l.cost_centre.trim()) tags.push(`[CC: ${l.cost_centre.trim()}]`);
            if (l.tax_code.trim()) tags.push(`[TAX: ${l.tax_code.trim()}]`);
            const desc = [l.description.trim(), tags.join(" ")].filter(Boolean).join(" ");
            return {
              account_id: Number(l.account_id),
              description: desc,
              debit: l.debit || "0",
              credit: l.credit || "0",
              currency: (l.currency || ccyDefault).toUpperCase(),
            };
          }),
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={NotebookPen}
      kicker="New transaction"
      title="General journal entry"
      subtitle="Manual debit / credit. Use this for one-off bookings — bank against expense, accruals, adjustments."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button
            type="button" onClick={submit}
            disabled={busy || !entityId || Math.abs(sums.diff) > 0.005 || sums.dr === 0}
            className="btn-primary"
          >
            {busy ? "Saving…" : "Create draft"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Posting date" required hint={`Accounting period: ${periodLabelForDate(date)}`}>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Description" span={2}>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="One-line subject — e.g. April rent — WeWork" />
        </Field>
        <Field
          label="Explanation"
          hint="Optional — why each side is debited or credited, and any auditor-facing context."
          span={2}
        >
          <textarea
            className="input font-mono text-sm"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={3}
            placeholder="e.g. Debit Office Rent — April service period consumed. Credit Operating Bank — wire cleared 2026-04-30."
          />
        </Field>
        <Field label="Reference" hint="Optional — invoice no., wire ref, etc." span={2}>
          <input className="input font-mono" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Lines</h3>
          <button
            type="button" onClick={() => setLines([...lines, { account_id: "", description: "", debit: "", credit: "", currency: "", cost_centre: "", tax_code: "" }])}
            className="text-xs text-brand-700 hover:text-brand-900 font-medium"
          ><Plus className="inline w-3 h-3 mr-0.5" />Add line</button>
        </div>

        {/* Header row — names match Thomas's spec table.
            12-col grid: Account 3, Description 2, Cost centre 2, Tax 1, Debit 2, Credit 2. */}
        <div className="grid grid-cols-12 gap-1.5 px-1 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          <span className="col-span-3">Account</span>
          <span className="col-span-2">Description</span>
          <span className="col-span-2">Cost centre</span>
          <span className="col-span-1">Tax</span>
          <span className="col-span-2 text-right">Debit</span>
          <span className="col-span-2 text-right">Credit</span>
        </div>

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5">
              <select
                className="input col-span-3 text-xs"
                value={l.account_id}
                onChange={(e) => updateLine(i, { account_id: e.target.value })}
              >
                <option value="">— Account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                ))}
              </select>
              <input
                className="input col-span-2 text-xs"
                placeholder="Description"
                value={l.description}
                onChange={(e) => updateLine(i, { description: e.target.value })}
              />
              <input
                className="input col-span-2 text-xs"
                placeholder="Client A"
                value={l.cost_centre}
                onChange={(e) => updateLine(i, { cost_centre: e.target.value })}
                title="Cost centre / counterparty / dimension — captured today as a tag on the line description"
              />
              <input
                className="input col-span-1 text-xs uppercase font-mono"
                placeholder="VAT"
                value={l.tax_code}
                onChange={(e) => updateLine(i, { tax_code: e.target.value })}
                title="Tax code — captured as a tag until the tax engine ships"
              />
              <input
                className="input col-span-2 text-right font-mono text-xs"
                placeholder="Debit"
                inputMode="decimal"
                value={l.debit}
                onChange={(e) => updateLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
              />
              <input
                className="input col-span-2 text-right font-mono text-xs"
                placeholder="Credit"
                inputMode="decimal"
                value={l.credit}
                onChange={(e) => updateLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
              />
              {lines.length > 2 && (
                <button
                  type="button" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                  className="col-span-12 text-[10px] text-rose-600 hover:underline text-right -mt-1"
                ><Minus className="inline w-2.5 h-2.5 mr-0.5" />Remove line</button>
              )}
            </div>
          ))}
        </div>

        <p className="mt-2 text-[10px] text-gray-400 italic">
          Cost centre and tax code are captured as line-description tags today
          (`[CC: …]`, `[TAX: …]`). Proper dimension / tax-engine columns ship with the dynamic-engine refactor.
        </p>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-gray-500">Balance check</span>
          <span className={cn(
            "font-mono tabular-nums",
            Math.abs(sums.diff) < 0.005 ? "text-mint-700" : "text-rose-600 font-semibold",
          )}>
            DR {sums.dr.toFixed(2)} · CR {sums.cr.toFixed(2)}{" "}
            {Math.abs(sums.diff) >= 0.005 && <>· diff {sums.diff.toFixed(2)}</>}
          </span>
        </div>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 2. Portfolio Trade ────────────────────────────────────────────────────

export function PortfolioTradeDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const investmentAccounts = useAccounts(open, { account_subtype: "investment" });
  const custodians = useDimensionValues(open, "CUST");
  const portfolios = useDimensionValues(open, "PORT");

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [instrument, setInstrument] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [investmentAccountId, setInvestmentAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [custodian, setCustodian] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);

  const entity = entities.find((e) => String(e.id) === entityId);
  useEffect(() => {
    if (entity && !currency) setCurrency(entity.functional_currency);
  }, [entity, currency]);

  const total = useMemo(() => {
    const q = parseFloat(qty) || 0;
    const p = parseFloat(price) || 0;
    return q * p;
  }, [qty, price]);

  async function submit() {
    if (!entityId || !instrument || total <= 0 || !investmentAccountId || !bankAccountId) {
      setErr("Fill in entity, instrument, quantity, price, investment account, and bank account.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const ba = bankAccounts.find((b) => String(b.id) === bankAccountId);
      if (!ba) throw new Error("Selected bank account not found.");
      const ccy = (currency || entity?.functional_currency || "EUR").toUpperCase();
      const amount = total.toFixed(2);
      const description = `${direction === "buy" ? "Buy" : "Sell"} ${qty} ${instrument} @ ${price} ${ccy}`;

      // BUY:  DR investment (with portfolio/custodian/instrument tags), CR bank
      // SELL: DR bank, CR investment (with the same tags)
      // v1 sell ignores realised gain/loss split — user can adjust manually.
      const investmentLine = {
        account_id: Number(investmentAccountId),
        description,
        currency: ccy,
        dimension_instrument_code: instrument,
        dimension_custodian_code: custodian || "",
        dimension_portfolio_code: portfolio || "",
      };
      const bankLine = {
        account_id: ba.account,
        description,
        currency: ccy,
        dimension_bank_code: ba.name.slice(0, 50),
      };
      const lines = direction === "buy"
        ? [{ ...investmentLine, debit: amount, credit: "0" },
           { ...bankLine,       debit: "0",   credit: amount }]
        : [{ ...bankLine,       debit: amount, credit: "0" },
           { ...investmentLine, debit: "0",   credit: amount }];
      const payload = {
        entity_id: Number(entityId),
        date,
        memo: (memo || description).slice(0, 500),
        currency: ccy,
        source_type: "manual",
        source_ref: instrument,
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={TrendingUp}
      kicker="New transaction"
      title="Portfolio trade"
      subtitle="Buy or sell a security. The form auto-derives the JE; instrument / custodian / portfolio dims attach to the investment line."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy || total <= 0} className="btn-primary">
            {busy ? "Saving…" : `Create ${direction} draft`}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Trade date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <div className="inline-flex rounded-xl border border-canvas-200 bg-white p-0.5 text-xs">
        {(["buy", "sell"] as const).map((d) => (
          <button
            key={d} type="button" onClick={() => setDirection(d)}
            className={cn(
              "px-4 py-1.5 rounded-lg font-semibold capitalize transition-colors",
              direction === d ? "bg-brand-50 text-brand-800" : "text-gray-500 hover:text-gray-800",
            )}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Instrument code" required hint="e.g. INS_AAPL — free text until the Instrument master ships" span={2}>
          <input className="input font-mono uppercase" value={instrument} onChange={(e) => setInstrument(e.target.value.toUpperCase())} placeholder="INS_AAPL" />
        </Field>
        <Field label="Quantity" required>
          <input className="input text-right font-mono" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="50" />
        </Field>
        <Field label="Price per unit" required>
          <input className="input text-right font-mono" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="190.50" />
        </Field>
        <Field label="Currency">
          <input className="input font-mono uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="USD" />
        </Field>
        <Field label="Total" hint="Auto = quantity × price">
          <div className="input bg-canvas-50 text-right font-mono tabular-nums">{total ? total.toFixed(2) : "0.00"}</div>
        </Field>
        <Field label="Investment account" required hint={investmentAccounts.length ? undefined : "No investment-subtype accounts yet — create one in CoA"} span={2}>
          <select className="input" value={investmentAccountId} onChange={(e) => setInvestmentAccountId(e.target.value)}>
            <option value="">— Pick an investment account —</option>
            {investmentAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Bank account (cash side)" required hint={bankAccounts.length ? undefined : "No bank account on this entity yet"} span={2}>
          <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">— Pick a bank account —</option>
            {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
          </select>
        </Field>
        <Field label="Custodian" hint={custodians.length ? "From CUST dimension" : "No custodian dimensions loaded"}>
          <select className="input font-mono" value={custodian} onChange={(e) => setCustodian(e.target.value)}>
            <option value="">— None —</option>
            {custodians.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="Portfolio" hint={portfolios.length ? "From PORT dimension" : "No portfolio dimensions loaded"}>
          <select className="input font-mono" value={portfolio} onChange={(e) => setPortfolio(e.target.value)}>
            <option value="">— None —</option>
            {portfolios.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
          </select>
        </Field>
        <Field label="Memo" hint="Auto-suggested from the trade — override if needed" span={2}>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={`${direction === "buy" ? "Buy" : "Sell"} ${qty || "N"} ${instrument || "INS_…"} @ ${price || "0"} ${currency}`} />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 3. Loan transaction ───────────────────────────────────────────────────

type LoanKind = "drawdown" | "interest" | "repayment";

const LOAN_KINDS: { key: LoanKind; label: string; blurb: string }[] = [
  { key: "drawdown",  label: "Drawdown",  blurb: "Loan funds received — DR bank, CR loan-payable" },
  { key: "interest",  label: "Interest accrual", blurb: "Period interest charge — DR interest expense, CR loan-payable" },
  { key: "repayment", label: "Repayment", blurb: "Principal paid back — DR loan-payable, CR bank" },
];

export function LoanTxnDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const loanAccounts = useAccounts(open, { account_subtype: "loan_payable" });
  const interestAccounts = useAccounts(open, { account_type: "expense" });

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [loanCode, setLoanCode] = useState("");
  const [kind, setKind] = useState<LoanKind>("drawdown");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [loanAccountId, setLoanAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [interestAccountId, setInterestAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);
  useEffect(() => {
    if (entity && !currency) setCurrency(entity.functional_currency);
  }, [entity, currency]);

  async function submit() {
    const amt = parseFloat(amount);
    if (!entityId || !loanAccountId || !amt || amt <= 0) {
      setErr("Fill in entity, loan account, and amount.");
      return;
    }
    if (kind !== "interest" && !bankAccountId) {
      setErr("Drawdown and repayment need a bank account for the cash side.");
      return;
    }
    if (kind === "interest" && !interestAccountId) {
      setErr("Interest accrual needs an interest expense account.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (currency || entity?.functional_currency || "EUR").toUpperCase();
      const ba = bankAccounts.find((b) => String(b.id) === bankAccountId);
      const amtStr = amt.toFixed(2);
      const description = `${LOAN_KINDS.find((k) => k.key === kind)?.label} · ${loanCode || "loan"}`;

      const loanLine = {
        account_id: Number(loanAccountId),
        description,
        currency: ccy,
      };
      const bankLine = ba ? {
        account_id: ba.account,
        description,
        currency: ccy,
        dimension_bank_code: ba.name.slice(0, 50),
      } : null;
      const interestLine = {
        account_id: Number(interestAccountId || 0),
        description,
        currency: ccy,
      };

      let lines: any[];
      if (kind === "drawdown") {
        lines = [
          { ...bankLine!, debit: amtStr, credit: "0" },
          { ...loanLine,  debit: "0",     credit: amtStr },
        ];
      } else if (kind === "interest") {
        lines = [
          { ...interestLine, debit: amtStr, credit: "0" },
          { ...loanLine,     debit: "0",     credit: amtStr },
        ];
      } else {
        lines = [
          { ...loanLine,  debit: amtStr, credit: "0" },
          { ...bankLine!, debit: "0",     credit: amtStr },
        ];
      }

      const payload = {
        entity_id: Number(entityId),
        date,
        memo: (memo || description).slice(0, 500),
        currency: ccy,
        source_type: "manual",
        source_ref: loanCode || "",
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={Landmark}
      kicker="New transaction"
      title="Loan transaction"
      subtitle="Drawdown, interest accrual, or repayment against a loan agreement."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Create draft"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Transaction type" required>
        <div className="grid grid-cols-3 gap-2">
          {LOAN_KINDS.map((k) => (
            <button
              key={k.key} type="button" onClick={() => setKind(k.key)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                kind === k.key
                  ? "border-brand-300 bg-brand-50/60"
                  : "border-canvas-200 bg-white hover:border-brand-200 hover:bg-brand-50/30",
              )}
            >
              <div className="text-xs font-semibold text-gray-900">{k.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{k.blurb}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Loan code" hint="e.g. LOAN_MTG_001 — free text until the Loan master ships" span={2}>
          <input className="input font-mono uppercase" value={loanCode} onChange={(e) => setLoanCode(e.target.value.toUpperCase())} placeholder="LOAN_MTG_001" />
        </Field>
        <Field label="Amount" required>
          <input className="input text-right font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000.00" />
        </Field>
        <Field label="Currency">
          <input className="input font-mono uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
        </Field>
        <Field label="Loan account (liability)" required hint={loanAccounts.length ? undefined : "No loan_payable accounts in CoA yet"} span={2}>
          <select className="input" value={loanAccountId} onChange={(e) => setLoanAccountId(e.target.value)}>
            <option value="">— Pick a loan-payable account —</option>
            {loanAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        {kind !== "interest" && (
          <Field label="Bank account (cash side)" required span={2}>
            <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">— Pick a bank account —</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
            </select>
          </Field>
        )}
        {kind === "interest" && (
          <Field label="Interest expense account" required span={2}>
            <select className="input" value={interestAccountId} onChange={(e) => setInterestAccountId(e.target.value)}>
              <option value="">— Pick an expense account —</option>
              {interestAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Memo" span={2}>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Auto-suggested" />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}


// ── 4. Fixed Asset transaction ────────────────────────────────────────────

type AssetKind = "purchase" | "depreciation";

const ASSET_KINDS: { key: AssetKind; label: string; blurb: string }[] = [
  { key: "purchase",     label: "Purchase",     blurb: "Capex acquisition — DR fixed asset, CR bank" },
  { key: "depreciation", label: "Depreciation", blurb: "Period charge — DR depreciation expense, CR accumulated depreciation" },
];

export function FixedAssetDrawer({ open, onClose }: TypedDrawerProps) {
  const router = useRouter();
  const entities = useEntities(open);
  const fixedAssetAccounts = useAccounts(open, { account_subtype: "fixed_asset" });
  const accumDepAccounts = useAccounts(open, { account_subtype: "accumulated_depreciation" });
  const depExpenseAccounts = useAccounts(open, { account_subtype: "depreciation" });

  const [entityId, setEntityId] = useState("");
  const bankAccounts = useBankAccounts(open, entityId);

  const [date, setDate] = useState(todayISO());
  const [assetCode, setAssetCode] = useState("");
  const [kind, setKind] = useState<AssetKind>("purchase");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [fixedAssetAccountId, setFixedAssetAccountId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [accumDepAccountId, setAccumDepAccountId] = useState("");
  const [depExpenseAccountId, setDepExpenseAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (entities.length && !entityId) setEntityId(String(entities[0].id));
  }, [entities, entityId]);
  const entity = entities.find((e) => String(e.id) === entityId);
  useEffect(() => {
    if (entity && !currency) setCurrency(entity.functional_currency);
  }, [entity, currency]);

  async function submit() {
    const amt = parseFloat(amount);
    if (!entityId || !fixedAssetAccountId || !amt || amt <= 0) {
      setErr("Fill in entity, fixed-asset account, and amount.");
      return;
    }
    if (kind === "purchase" && !bankAccountId) {
      setErr("Purchase needs a bank account for the cash side.");
      return;
    }
    if (kind === "depreciation" && (!accumDepAccountId || !depExpenseAccountId)) {
      setErr("Depreciation needs both depreciation expense and accumulated depreciation accounts.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const ccy = (currency || entity?.functional_currency || "EUR").toUpperCase();
      const ba = bankAccounts.find((b) => String(b.id) === bankAccountId);
      const amtStr = amt.toFixed(2);
      const description = `${ASSET_KINDS.find((k) => k.key === kind)?.label} · ${assetCode || "fixed asset"}`;

      const faLine = {
        account_id: Number(fixedAssetAccountId),
        description,
        currency: ccy,
      };
      const bankLine = ba ? {
        account_id: ba.account,
        description,
        currency: ccy,
        dimension_bank_code: ba.name.slice(0, 50),
      } : null;
      const accDepLine = {
        account_id: Number(accumDepAccountId || 0),
        description,
        currency: ccy,
      };
      const depExpLine = {
        account_id: Number(depExpenseAccountId || 0),
        description,
        currency: ccy,
      };

      let lines: any[];
      if (kind === "purchase") {
        lines = [
          { ...faLine,    debit: amtStr, credit: "0" },
          { ...bankLine!, debit: "0",     credit: amtStr },
        ];
      } else {
        lines = [
          { ...depExpLine, debit: amtStr, credit: "0" },
          { ...accDepLine, debit: "0",     credit: amtStr },
        ];
      }

      const payload = {
        entity_id: Number(entityId),
        date,
        memo: (memo || description).slice(0, 500),
        currency: ccy,
        source_type: "manual",
        source_ref: assetCode || "",
        lines,
      };
      const created = await api.post<{ id: number; entry_number: string }>(
        "/beakon/journal-entries/", payload,
      );
      router.push(`/dashboard/journal-entries/${created.id}`);
      onClose();
    } catch (e: any) {
      setErr(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell
      open={open} onClose={onClose}
      icon={Building}
      kicker="New transaction"
      title="Fixed asset transaction"
      subtitle="Capex purchase or depreciation charge against the fixed-asset register."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Create draft"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity" required>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Transaction type" required>
        <div className="grid grid-cols-2 gap-2">
          {ASSET_KINDS.map((k) => (
            <button
              key={k.key} type="button" onClick={() => setKind(k.key)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                kind === k.key
                  ? "border-brand-300 bg-brand-50/60"
                  : "border-canvas-200 bg-white hover:border-brand-200 hover:bg-brand-50/30",
              )}
            >
              <div className="text-xs font-semibold text-gray-900">{k.label}</div>
              <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{k.blurb}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Asset code" hint="e.g. FA-LAPTOP-001 — free text until the Fixed Asset master ships" span={2}>
          <input className="input font-mono uppercase" value={assetCode} onChange={(e) => setAssetCode(e.target.value.toUpperCase())} placeholder="FA-LAPTOP-001" />
        </Field>
        <Field label="Amount" required>
          <input className="input text-right font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500.00" />
        </Field>
        <Field label="Currency">
          <input className="input font-mono uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
        </Field>
        <Field label="Fixed asset account" required hint={fixedAssetAccounts.length ? undefined : "No fixed_asset accounts in CoA yet"} span={2}>
          <select className="input" value={fixedAssetAccountId} onChange={(e) => setFixedAssetAccountId(e.target.value)}>
            <option value="">— Pick a fixed-asset account —</option>
            {fixedAssetAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        {kind === "purchase" && (
          <Field label="Bank account (cash side)" required span={2}>
            <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">— Pick a bank account —</option>
              {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}
            </select>
          </Field>
        )}
        {kind === "depreciation" && (
          <>
            <Field label="Depreciation expense account" required>
              <select className="input" value={depExpenseAccountId} onChange={(e) => setDepExpenseAccountId(e.target.value)}>
                <option value="">— Pick —</option>
                {depExpenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
            <Field label="Accumulated depreciation account" required>
              <select className="input" value={accumDepAccountId} onChange={(e) => setAccumDepAccountId(e.target.value)}>
                <option value="">— Pick —</option>
                {accumDepAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="Memo" span={2}>
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Auto-suggested" />
        </Field>
      </div>

      <ErrorBlock msg={err} />
    </DrawerShell>
  );
}
