"use client";

/* Employment — add employee.
 *
 * Two-section form: Personal · Role / employment.
 *
 *   Personal       - first name, last name, email, phone
 *   Role           - entity, employment type, title, manager (if any),
 *                    start date, end date (for contract types)
 *   Notes          - free text
 *
 * Manager picker appears only when the org already has at least one
 * employee — keeps the form minimal for the first hire.
 *
 * "Save and add another" resets the form (keeps entity + role defaults)
 * after a successful create — for batch onboarding without round-tripping
 * to the detail page each time.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowRight, Briefcase, CalendarRange, IdCard, Mail, Phone,
  RefreshCcw, User, UserCog, Users,
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

interface EmployeeOpt {
  id: number;
  full_name: string;
  title: string;
  entity: number;
}


const EMPLOYMENT_TYPES = [
  { value: "full_time",  label: "Full-time" },
  { value: "part_time",  label: "Part-time" },
  { value: "contractor", label: "Contractor" },
  { value: "intern",     label: "Intern" },
  { value: "other",      label: "Other" },
];

// Types that typically have a defined end date — surface the `end_date`
// field for these. (Full-time / part-time hires stay open-ended.)
const TYPES_WITH_END_DATE = new Set(["contractor", "intern", "other"]);


export default function NewEmployeePage() {
  const router = useRouter();

  const [entities, setEntities] = useState<Entity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(true);
  const [existingEmployees, setExistingEmployees] = useState<EmployeeOpt[]>([]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [entityId, setEntityId] = useState<number | "">("");
  const [managerId, setManagerId] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

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

    api.get<{ results: EmployeeOpt[] } | EmployeeOpt[]>("/beakon/employees/", { is_active: "true" })
      .then((d) => setExistingEmployees(Array.isArray(d) ? d : (d?.results ?? [])))
      .catch(() => setExistingEmployees([]));
  }, []);

  // Manager candidates = active employees on the same entity (different
  // entity → different employer; cross-entity reporting is rare enough
  // to set on the detail page).
  const managerOptions = useMemo(
    () => existingEmployees.filter((e) => entityId !== "" && e.entity === entityId),
    [existingEmployees, entityId],
  );

  const showEndDate = TYPES_WITH_END_DATE.has(employmentType);

  function resetForNext() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setTitle("");
    // Keep entity, employment type, manager so batch hires on one team
    // don't have to re-pick the same three dropdowns.
    setStartDate("");
    setEndDate("");
    setNotes("");
    setError("");
  }

  const submit = async (e: React.FormEvent, andAnother = false) => {
    e.preventDefault();
    setError("");
    if (!firstName.trim() && !lastName.trim()) {
      setError("Enter the employee's first or last name."); return;
    }
    if (!entityId) {
      setError("Pick the entity that employs this person."); return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
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
      if (showEndDate && endDate) payload.end_date = endDate;
      if (managerId !== "") payload.manager = managerId;

      const created = await api.post<{ id: number; full_name: string }>(
        "/beakon/employees/", payload,
      );

      if (andAnother) {
        setSavedFlash(`Added ${created.full_name || "employee"}. Add another below.`);
        // Bring the newly-created employee into the manager pool for the
        // *next* hire on the same team without an extra fetch.
        setExistingEmployees((prev) => [...prev, {
          id: created.id,
          full_name: created.full_name || `${firstName} ${lastName}`.trim(),
          title: title.trim(),
          entity: Number(entityId),
        }]);
        resetForNext();
        setSubmitting(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      router.push(`/dashboard/employment/${created.id}`);
    } catch (err: any) {
      setError(fmtCreateError(err));
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Add employee"
        description="The basics — you can add contracts, compensation and other details from the detail page."
      />

      <div className="mt-2 mb-4">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref="/dashboard/employment" />
        </Suspense>
      </div>

      <form
        onSubmit={(e) => submit(e, false)}
        className="rounded-xl border border-canvas-200/70 bg-white p-6 max-w-2xl"
      >
        {savedFlash && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-mint-200 bg-mint-50 p-3 text-xs text-mint-800">
            <RefreshCcw className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{savedFlash}</span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="whitespace-pre-wrap">{error}</span>
          </div>
        )}

        <SectionHeader
          icon={User}
          title="Personal"
          subtitle="Identity and contact. Email is optional but recommended for invites."
        />

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First name" required>
              <input
                type="text" className="input"
                value={firstName} onChange={(e) => setFirstName(e.target.value)}
                placeholder="Anna" autoFocus autoComplete="given-name"
              />
            </Field>
            <Field label="Last name" required>
              <input
                type="text" className="input"
                value={lastName} onChange={(e) => setLastName(e.target.value)}
                placeholder="Müller" autoComplete="family-name"
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
        </div>

        <div className="my-6 border-t border-canvas-100" />

        <SectionHeader
          icon={IdCard}
          title="Role & employment"
          subtitle="Employer, type, title and dates. Employee number is auto-generated."
        />

        <div className="space-y-4">
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
                  onChange={(e) => {
                    setEntityId(Number(e.target.value));
                    // Reset manager when switching employer — managers
                    // are scoped to a single entity.
                    setManagerId("");
                  }}
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

          {managerOptions.length > 0 && (
            <Field label="Manager"
              hint={`Choose from the ${managerOptions.length} existing employee${managerOptions.length === 1 ? "" : "s"} on this entity. Optional.`}>
              <div className="relative">
                <UserCog className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <select
                  className="input pl-9"
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <option value="">— No manager —</option>
                  {managerOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}{m.title ? ` · ${m.title}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          )}

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
            {showEndDate ? (
              <Field
                label="End date"
                hint="For contract / intern / fixed-term roles. Leave blank if open-ended."
              >
                <div className="relative">
                  <CalendarRange className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="date" className="input pl-9"
                    min={startDate || undefined}
                    value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
          </div>

          <Field label="Notes" hint="Anything that doesn't fit the structured fields above.">
            <textarea
              className="input min-h-[80px]"
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:items-center">
          {existingEmployees.length > 0 && (
            <button
              type="button"
              onClick={(e) => submit(e, true)}
              className="btn-secondary inline-flex items-center"
              disabled={submitting || entities.length === 0}
              title="Save this employee and reset the form for the next hire on this team"
            >
              <Users className="w-4 h-4 mr-1.5" />
              {submitting ? "Saving…" : "Save and add another"}
            </button>
          )}
          <button
            type="submit"
            className="btn-primary inline-flex items-center gap-1.5"
            disabled={submitting || entities.length === 0}
          >
            {submitting ? "Adding…" : <>Add employee <ArrowRight className="w-4 h-4" /></>}
          </button>
        </div>
      </form>
    </div>
  );
}


function SectionHeader({
  icon: Icon, title, subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string; subtitle: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h2 className="text-[14px] font-semibold text-gray-900">{title}</h2>
        <p className="text-[11.5px] text-gray-500">{subtitle}</p>
      </div>
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


/** Pulls every meaningful message out of a DRF validation error response
 *  rather than guessing one of four fields. */
function fmtCreateError(err: any): string {
  if (!err || typeof err !== "object") return "Failed to add employee.";
  if (typeof err.detail === "string") return err.detail;
  if (err?.error?.message) return err.error.message;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(err)) {
    if (k === "status" || k === "detail" || k === "error") continue;
    const msg = Array.isArray(v) ? v.join(" ") : String(v);
    if (!msg) continue;
    const label = k.replace(/_/g, " ");
    lines.push(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${msg}`);
  }
  return lines.length ? lines.join("\n") : "Failed to add employee.";
}
