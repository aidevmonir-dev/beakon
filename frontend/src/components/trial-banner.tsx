"use client";

/* Trial pill — compact header indicator showing trial status.
 *
 * Originally a full-width strip across every dashboard page. Thomas's
 * 2026-05-12 design feedback (§5.10) moved it to a compact pill in the
 * top bar so the full-width banner doesn't compete with page content.
 * Wording: "Professional Trial — N days left." Clicking the pill opens
 * the ActivationModal that files an ActivationRequest with Thomas.
 *
 * Silently hides for non-trial subscriptions and for unauthenticated
 * routes (the dashboard layout already gates that anyway).
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Mail, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";


interface Plan {
  slug: string;
  name: string;
  price: string | null;
  currency: string;
  billing_cadence: string;
}

interface Subscription {
  id: number | null;
  plan: Plan | null;
  // "none" — org has no subscription yet (pre-trial state); banner hides.
  status: "none" | "trial" | "active" | "expired" | "cancelled";
  trial_ends_at: string | null;
  days_left: number | null;
  activated_at: string | null;
}


export default function TrialBanner() {
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<Subscription>("/beakon/billing/subscription/");
        if (!cancelled) setSub(r);
      } catch {
        // Endpoint always returns 200 (including {status: "none"} for
        // pre-trial state) — a thrown error here means a real failure
        // (network, auth). Silently hide the banner.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loaded || !sub || sub.status !== "trial" || !sub.plan) return null;
  const plan = sub.plan;

  const daysLeft = sub.days_left ?? 0;
  // Tone escalates with urgency — green/brand at the start, amber as
  // the trial nears expiry, rose at the wire.
  const tone =
    daysLeft <= 3 ? "rose" :
    daysLeft <= 7 ? "amber" :
    "brand";

  const tones: Record<string, string> = {
    brand: "bg-brand-50 ring-brand-200 text-brand-900 hover:bg-brand-100",
    amber: "bg-amber-50 ring-amber-200 text-amber-900 hover:bg-amber-100",
    rose:  "bg-rose-50 ring-rose-200 text-rose-900 hover:bg-rose-100",
  };

  // Thomas's wording (§5.10), verbatim: "Professional Trial - N days left."
  const label = `${plan.name} Trial - ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;

  return (
    <>
      {requested ? (
        <span
          className="hidden md:inline-flex items-center gap-1.5 rounded-full bg-mint-50 px-2.5 py-1 text-[11px] font-semibold text-mint-700 ring-1 ring-mint-200"
          title="Activation requested — we'll be in touch."
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Activation requested
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title="Click to activate your plan"
          className={cn(
            "hidden md:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
            "text-[11px] font-semibold ring-1 transition-colors",
            tones[tone],
          )}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </button>
      )}

      {modalOpen && (
        <ActivationModal
          plan={plan}
          onClose={() => setModalOpen(false)}
          onDone={() => { setRequested(true); setModalOpen(false); }}
        />
      )}
    </>
  );
}


function ActivationModal({ plan, onClose, onDone }: {
  plan: Plan;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("/beakon/billing/subscription/activate/", {
        contact_name: contactName,
        contact_email: contactEmail,
        notes,
      });
      onDone();
    } catch (e: any) {
      setErr(e?.error?.message || e?.message || "Could not file the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        <header className="flex items-start justify-between gap-2 px-5 py-4 border-b border-canvas-200">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Activate your {plan.name} plan
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              We'll send an invoice for {plan.price ? `${plan.currency} ${plan.price} / ${plan.billing_cadence}` : "a custom-priced contract"}.
              Your trial continues until activation is confirmed.
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </header>

        <form onSubmit={submit} className="p-5 space-y-4">
          {err && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {err}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Contact name">
              <input type="text" className="input"
                value={contactName} onChange={(e) => setContactName(e.target.value)}
                placeholder="Thomas Allina" />
            </Field>
            <Field label="Contact email">
              <input type="email" className="input"
                value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                placeholder="thomas@allina.ch" />
            </Field>
          </div>
          <Field label="Anything we should know?" hint="Billing entity, VAT number, special requirements…">
            <textarea className="input min-h-[80px]" rows={3}
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <div className="rounded-lg bg-canvas-50/60 px-3 py-2.5 text-[11px] text-gray-600 leading-relaxed">
            <Mail className="inline h-3.5 w-3.5 mr-1 mb-0.5 text-gray-500" />
            Once you submit, our team will send the invoice within one
            business day. Your subscription stays in trial until payment
            is confirmed.
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
                    className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2">
              Cancel
            </button>
            <button type="submit" disabled={busy}
                    className="btn-primary">
              {busy ? "Submitting…" : "Send activation request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-gray-400">{hint}</span>}
    </label>
  );
}
