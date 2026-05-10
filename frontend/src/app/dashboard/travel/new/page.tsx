"use client";

/* Travel & Expense — new claim.
 *
 * Captures the trip header. Lines are added on the detail page once
 * the claim exists — keeps the create form short and lets users land
 * straight into "add receipts" mode after a single Continue.
 */
import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowRight, Plane, MapPin, CalendarRange, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import WorkflowBack from "@/components/workflow-back";


interface Entity {
  id: number;
  code: string;
  name: string;
  entity_type: string;
  functional_currency: string;
}


const CURRENCIES = ["CHF", "EUR", "USD", "GBP", "JPY", "CAD", "AUD", "AED", "SGD"];


export default function NewTripClaimPage() {
  const router = useRouter();

  const [entities, setEntities] = useState<Entity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(true);

  const [entityId, setEntityId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currency, setCurrency] = useState("CHF");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        const usable = list.filter((e) => e.entity_type !== "individual");
        setEntities(usable);
        if (usable.length > 0) {
          setEntityId(usable[0].id);
          setCurrency(usable[0].functional_currency || "CHF");
        }
      })
      .catch(() => setEntities([]))
      .finally(() => setLoadingEntities(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!title.trim()) { setError("Give your trip a short title."); return; }
    if (!entityId) { setError("Pick the entity that bears this cost."); return; }
    if (startDate && endDate && startDate > endDate) {
      setError("End date must be on or after the start date.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        entity: entityId,
        title: title.trim(),
        purpose: purpose.trim(),
        destination: destination.trim(),
        currency,
      };
      if (startDate) payload.start_date = startDate;
      if (endDate) payload.end_date = endDate;
      const claim = await api.post<{ id: number }>("/beakon/trip-claims/", payload);
      router.push(`/dashboard/travel/${claim.id}`);
    } catch (err: any) {
      setError(err?.detail || err?.title?.[0] || "Failed to create claim.");
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="New trip claim"
        description="The basics of the trip — you'll add receipts on the next screen."
      />

      <div className="mt-2 mb-4">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref="/dashboard/travel" />
        </Suspense>
      </div>

      <form
        onSubmit={submit}
        className="rounded-2xl border border-canvas-200/70 bg-white p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] max-w-2xl"
      >
        <div className="mb-5 flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <Plane className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-gray-900">Trip details</h2>
            <p className="text-[11.5px] text-gray-500">Just enough to start collecting receipts.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <Field label="Trip title" required>
            <input
              type="text" className="input"
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Trip to Geneva — May 2026"
              autoFocus required
            />
          </Field>

          <Field label="Entity that bears this cost" required>
            {loadingEntities ? (
              <div className="h-10 rounded-lg bg-canvas-100 animate-pulse" />
            ) : entities.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
                No entities yet — add at least one in <span className="font-mono">Structure</span> first.
              </p>
            ) : (
              <select
                className="input"
                value={entityId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setEntityId(id);
                  const ent = entities.find((x) => x.id === id);
                  if (ent) setCurrency(ent.functional_currency || currency);
                }}
              >
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} · {e.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Destination" hint="City, country, or both.">
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text" className="input pl-9"
                  value={destination} onChange={(e) => setDestination(e.target.value)}
                  placeholder="Geneva, Switzerland"
                />
              </div>
            </Field>
            <Field label="Claim currency" required hint="Defaults to the entity's functional currency.">
              <select
                className="input font-mono"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start date">
              <div className="relative">
                <CalendarRange className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="date" className="input pl-9"
                  value={startDate} onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </Field>
            <Field label="End date">
              <div className="relative">
                <CalendarRange className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="date" className="input pl-9"
                  value={endDate} onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </Field>
          </div>

          <Field label="Business purpose" hint="Optional but helpful for approvers.">
            <textarea
              className="input min-h-[80px]"
              value={purpose} onChange={(e) => setPurpose(e.target.value)}
              placeholder="Client kickoff with Lombard Odier, on-site review with Geneva team."
            />
          </Field>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-[11.5px] text-gray-500 inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-brand-600" />
            You can add and edit receipts after creating the claim.
          </p>
          <button type="submit" className="btn-primary" disabled={submitting || entities.length === 0}>
            {submitting ? "Creating…" : <>Continue <ArrowRight className="w-4 h-4 ml-1.5" /></>}
          </button>
        </div>
      </form>
    </div>
  );
}


function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-gray-400 leading-relaxed">{hint}</span>}
    </label>
  );
}
