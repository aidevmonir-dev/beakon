"use client";

/* Employment — add employee.
 *
 * Captures the employee's identity, employer (entity), employment type,
 * title and dates. Manager FK is left to the detail page once people
 * exist; keeps the create form approachable for the first hire.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowRight, Briefcase, CalendarRange, Mail, Phone, User,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import WorkflowBack from "@/components/workflow-back";


interface Entity {
  id: number;
  code: string;
  name: string;
  entity_type: string;
}


const EMPLOYMENT_TYPES = [
  { value: "full_time",  label: "Full-time" },
  { value: "part_time",  label: "Part-time" },
  { value: "contractor", label: "Contractor" },
  { value: "intern",     label: "Intern" },
  { value: "other",      label: "Other" },
];


export default function NewEmployeePage() {
  const router = useRouter();

  const [entities, setEntities] = useState<Entity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(true);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [entityId, setEntityId] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        const usable = list.filter((e) => e.entity_type !== "individual");
        setEntities(usable);
        if (usable.length > 0) setEntityId(usable[0].id);
      })
      .catch(() => setEntities([]))
      .finally(() => setLoadingEntities(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!firstName.trim() && !lastName.trim()) {
      setError("Enter the employee's name."); return;
    }
    if (!entityId) {
      setError("Pick the entity that employs this person."); return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        title: title.trim(),
        employment_type: employmentType,
        entity: entityId,
        notes: notes.trim(),
        is_active: true,
      };
      if (startDate) payload.start_date = startDate;
      const created = await api.post<{ id: number }>("/beakon/employees/", payload);
      router.push(`/dashboard/employment/${created.id}`);
    } catch (err: any) {
      setError(
        err?.detail ||
        err?.first_name?.[0] ||
        err?.last_name?.[0] ||
        err?.employee_number?.[0] ||
        "Failed to add employee.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Add employee"
        description="The basics — you can add manager, contracts and other details from the detail page."
      />

      <div className="mt-2 mb-4">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref="/dashboard/employment" />
        </Suspense>
      </div>

      <form
        onSubmit={submit}
        className="rounded-2xl border border-canvas-200/70 bg-white p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] max-w-2xl"
      >
        <div className="mb-5 flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <User className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-gray-900">Identity &amp; role</h2>
            <p className="text-[11.5px] text-gray-500">Employee number is auto-generated.</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <input
                type="text" className="input"
                value={firstName} onChange={(e) => setFirstName(e.target.value)}
                placeholder="Anna" autoFocus required autoComplete="given-name"
              />
            </Field>
            <Field label="Last name" required>
              <input
                type="text" className="input"
                value={lastName} onChange={(e) => setLastName(e.target.value)}
                placeholder="Müller" required autoComplete="family-name"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email" className="input pl-9"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="anna@example.ch" autoComplete="email"
                />
              </div>
            </Field>
            <Field label="Phone">
              <div className="relative">
                <Phone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="tel" className="input pl-9"
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="+41 …" autoComplete="tel"
                />
              </div>
            </Field>
          </div>

          <Field label="Job title">
            <div className="relative">
              <Briefcase className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text" className="input pl-9"
                value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Senior Accountant"
              />
            </div>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Employer (entity)" required>
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
                  onChange={(e) => setEntityId(Number(e.target.value))}
                >
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Employment type" required>
              <select
                className="input"
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value)}
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Start date">
            <div className="relative">
              <CalendarRange className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="date" className="input pl-9"
                value={startDate} onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </Field>

          <Field label="Notes" hint="Anything that doesn't fit the structured fields.">
            <textarea
              className="input min-h-[80px]"
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end">
          <button type="submit" className="btn-primary" disabled={submitting || entities.length === 0}>
            {submitting ? "Adding…" : <>Add employee <ArrowRight className="w-4 h-4 ml-1.5" /></>}
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
