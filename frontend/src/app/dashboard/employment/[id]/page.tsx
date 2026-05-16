"use client";

/* Employment — employee detail.
 *
 * Shows the canonical record + cross-module references (trip claims).
 * Edit form is inline; manager selector pulls from the same org.
 *
 * Per the data-architecture principle "data lives once. modules
 * reference it." — when the linked Travel claims load, they're a
 * cross-module reference, not a copy: the underlying records still
 * live in beakon_travel.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle, Briefcase, CalendarRange, Check, Edit3, Mail, Phone,
  Plane, Save, Trash2, User, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import WorkflowBack from "@/components/workflow-back";
import type { Employee } from "../page";
import type { TripClaim } from "../../travel/_lib";
import {
  formatDateRange, formatMoney, StatusPill,
} from "../../travel/_lib";


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


export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const [entities, setEntities] = useState<Entity[]>([]);
  const [colleagues, setColleagues] = useState<Employee[]>([]);

  const [claims, setClaims] = useState<TripClaim[]>([]);
  const [loadingClaims, setLoadingClaims] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await api.get<Employee>(`/beakon/employees/${id}/`);
      setEmployee(data);
    } catch {
      setError("Could not load employee.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); /* eslint-disable-line */ }, [id]);

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        setEntities(list.filter((e) => e.entity_type !== "individual"));
      })
      .catch(() => setEntities([]));
    api.get<{ results: Employee[] } | Employee[]>("/beakon/employees/", { is_active: "true" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        setColleagues(list);
      })
      .catch(() => setColleagues([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoadingClaims(true);
    api.get<{ results: TripClaim[] } | TripClaim[]>("/beakon/trip-claims/", {
      employee: String(id),
    })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        setClaims(list);
      })
      .catch(() => setClaims([]))
      .finally(() => setLoadingClaims(false));
  }, [id]);

  if (loading && !employee) {
    return (
      <div>
        <PageHeader title="Employee" description="Loading…" />
        <div className="mt-5 h-48 rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse" />
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div>
        <PageHeader title="Employee" />
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error || "Employee not found."}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={employee.full_name}
        description={employee.title || "Employee"}
        actions={
          <div className="flex items-center gap-2">
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="btn-secondary text-sm"
              >
                <Edit3 className="w-4 h-4 mr-1.5" />
                Edit
              </button>
            )}
          </div>
        }
      />

      <div className="mt-2 mb-4">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref="/dashboard/employment" />
        </Suspense>
      </div>

      {editing ? (
        <EditForm
          employee={employee}
          entities={entities}
          colleagues={colleagues.filter((c) => c.id !== employee.id)}
          onSaved={() => { setEditing(false); void reload(); }}
          onCancel={() => setEditing(false)}
          onDeleted={() => router.push("/dashboard/employment")}
        />
      ) : (
        <DetailView employee={employee} />
      )}

      <CrossModulePanel
        employee={employee}
        claims={claims}
        loading={loadingClaims}
      />
    </div>
  );
}


// ── Detail view ───────────────────────────────────────────────────


function DetailView({ employee }: { employee: Employee }) {
  return (
    <div className="rounded-2xl border border-canvas-200/70 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-4">
        <Avatar name={employee.full_name} active={employee.is_active} large />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-gray-400">
              {employee.employee_number}
            </span>
            <span className="text-canvas-300">·</span>
            <span className="text-[12px] text-gray-600 capitalize">
              {employee.employment_type_label}
            </span>
            {!employee.is_active && (
              <span className="inline-flex items-center rounded-full bg-canvas-100 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-gray-500">
                Inactive
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 text-[12.5px] text-gray-700">
            {employee.email && (
              <div className="inline-flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-gray-400" />
                <a href={`mailto:${employee.email}`} className="hover:underline">{employee.email}</a>
              </div>
            )}
            {employee.phone && (
              <div className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-gray-400" />
                {employee.phone}
              </div>
            )}
            {employee.entity_code && (
              <div className="inline-flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 text-gray-400" />
                Employer: <span className="font-mono">{employee.entity_code}</span>
              </div>
            )}
            {(employee.start_date || employee.end_date) && (
              <div className="inline-flex items-center gap-1.5">
                <CalendarRange className="h-3.5 w-3.5 text-gray-400" />
                {formatDateRange(employee.start_date, employee.end_date) || "Open-ended"}
              </div>
            )}
            {employee.manager_name && (
              <div className="inline-flex items-center gap-1.5 col-span-full">
                <User className="h-3.5 w-3.5 text-gray-400" />
                Reports to <span className="font-medium">{employee.manager_name}</span>
              </div>
            )}
            {employee.user_email && (
              <div className="inline-flex items-center gap-1.5 col-span-full text-[11.5px] text-gray-500">
                Linked Beakon login: {employee.user_email}
              </div>
            )}
          </div>
          {employee.notes && (
            <p className="mt-3 text-[12.5px] text-gray-600 leading-relaxed border-t border-canvas-100 pt-3">
              {employee.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


function Avatar({ name, active, large }: { name: string; active: boolean; large?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div className={cn(
      "shrink-0 rounded-full flex items-center justify-center font-semibold",
      large ? "h-14 w-14 text-[18px]" : "h-10 w-10 text-[13px]",
      active
        ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
        : "bg-canvas-100 text-gray-500",
    )}>
      {initials}
    </div>
  );
}


// ── Edit form ─────────────────────────────────────────────────────


function EditForm({
  employee, entities, colleagues, onSaved, onCancel, onDeleted,
}: {
  employee: Employee;
  entities: Entity[];
  colleagues: Employee[];
  onSaved: () => void;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [firstName, setFirstName] = useState(employee.first_name);
  const [lastName, setLastName] = useState(employee.last_name);
  const [email, setEmail] = useState(employee.email);
  const [phone, setPhone] = useState(employee.phone);
  const [title, setTitle] = useState(employee.title);
  const [employmentType, setEmploymentType] = useState(employee.employment_type);
  const [entityId, setEntityId] = useState<number | "">(employee.entity);
  const [managerId, setManagerId] = useState<number | "">(employee.manager ?? "");
  const [startDate, setStartDate] = useState(employee.start_date ?? "");
  const [endDate, setEndDate] = useState(employee.end_date ?? "");
  const [isActive, setIsActive] = useState(employee.is_active);
  const [notes, setNotes] = useState(employee.notes);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await api.patch(`/beakon/employees/${employee.id}/`, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        title: title.trim(),
        employment_type: employmentType,
        entity: entityId,
        manager: managerId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        is_active: isActive,
        notes: notes.trim(),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.detail || "Failed to save changes.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete employee "${employee.full_name}"? Trip claims linked to this employee will keep the record but lose the dimension reference.`)) return;
    setBusy(true); setError("");
    try {
      await api.delete(`/beakon/employees/${employee.id}/`);
      onDeleted();
    } catch (err: any) {
      setError(err?.detail || "Failed to delete.");
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className="rounded-2xl border border-canvas-200/70 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]"
    >
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" required>
            <input type="text" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </Field>
          <Field label="Last name" required>
            <input type="text" className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email">
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>

        <Field label="Job title">
          <input type="text" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Employer (entity)" required>
            <select className="input" value={entityId} onChange={(e) => setEntityId(Number(e.target.value))}>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}
            </select>
          </Field>
          <Field label="Employment type" required>
            <select className="input" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
              {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Reports to">
          <select
            className="input"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">No manager</option>
            {colleagues.map((c) => (
              <option key={c.id} value={c.id}>{c.full_name} ({c.employee_number})</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Start date">
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date" hint="Set when employment ends.">
            <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Notes">
          <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <label className="flex items-center gap-2 text-[12.5px] text-gray-700 cursor-pointer">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active employee
        </label>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-canvas-100 pt-4">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12.5px] text-rose-700 hover:text-rose-900"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete employee
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="text-[13px] text-gray-600 hover:text-gray-900">
            Cancel
          </button>
          <button type="submit" className="btn-primary text-sm" disabled={busy}>
            {busy ? "Saving…" : <>Save <Save className="w-4 h-4 ml-1.5" /></>}
          </button>
        </div>
      </div>
    </form>
  );
}


// ── Cross-module references ───────────────────────────────────────


function CrossModulePanel({
  employee, claims, loading,
}: {
  employee: Employee;
  claims: TripClaim[];
  loading: boolean;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-canvas-200/70 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between border-b border-canvas-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Plane className="h-4 w-4 text-brand-700" />
          <h2 className="text-[14px] font-semibold text-gray-900">Travel claims</h2>
        </div>
        <span className="text-[11.5px] text-gray-500">
          {loading ? "…" : `${claims.length} on record`}
        </span>
      </div>

      {loading ? (
        <div className="px-5 py-6 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-canvas-100 animate-pulse" />
          ))}
        </div>
      ) : claims.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-gray-500">
          No trip claims linked to {employee.full_name} yet.
        </div>
      ) : (
        <ul className="divide-y divide-canvas-100">
          {claims.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/travel/${c.id}?from=/dashboard/employment/${employee.id}`}
                className="group flex items-center justify-between gap-3 px-5 py-3 hover:bg-canvas-50/60"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-gray-900 truncate">{c.title}</span>
                    <StatusPill status={c.status} label={c.status_label} />
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-gray-500">
                    {c.destination || "Trip"} · {formatDateRange(c.start_date, c.end_date) || "No dates"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[12.5px] font-mono font-medium text-gray-900">
                    {formatMoney(Number(c.total_amount || 0), c.currency)}
                  </div>
                  <div className="text-[10.5px] text-gray-400">
                    {c.expense_count} {c.expense_count === 1 ? "line" : "lines"}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// ── Helpers ───────────────────────────────────────────────────────


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
