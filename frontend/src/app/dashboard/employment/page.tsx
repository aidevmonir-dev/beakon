"use client";

/* Employment — employees list.
 *
 * Per the UI philosophy doc (2026-05-10):
 *   "Employee data lives in Employment. Accounting references employees
 *    as dimensions. Travel Expense Management references employees."
 * This is the canonical roster.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Briefcase, Filter, Mail, Plus, User, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";


export interface Employee {
  id: number;
  employee_number: string;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  title: string;
  employment_type: string;
  employment_type_label: string;
  entity: number;
  entity_code: string;
  user: number | null;
  user_email: string;
  manager: number | null;
  manager_name: string;
  start_date: string | null;
  end_date: string | null;
  notes: string;
  is_active: boolean;
  report_count?: number;
}


const TYPE_FILTERS: { slug: string; label: string }[] = [
  { slug: "all",        label: "All" },
  { slug: "full_time",  label: "Full-time" },
  { slug: "part_time",  label: "Part-time" },
  { slug: "contractor", label: "Contractor" },
  { slug: "intern",     label: "Intern" },
  { slug: "inactive",   label: "Inactive" },
];


export default function EmploymentPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true); setError("");
    const params: Record<string, string> = {};
    if (filter === "inactive") {
      params.is_active = "false";
    } else if (filter !== "all") {
      params.is_active = "true";
      params.employment_type = filter;
    } else {
      params.is_active = "true";
    }
    api.get<{ results: Employee[] } | Employee[]>("/beakon/employees/", params)
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        setEmployees(list);
      })
      .catch(() => setError("Could not load employees."))
      .finally(() => setLoading(false));
  }, [filter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    employees.forEach((e) => {
      out[e.employment_type] = (out[e.employment_type] || 0) + 1;
    });
    return out;
  }, [employees]);

  return (
    <div>
      <PageHeader
        title="Employment"
        description="The canonical roster of people in your workspace. Other modules (Travel, Accounting dimensions) reference these records."
        actions={
          <Link href="/dashboard/employment/new" className="btn-primary text-sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Add employee
          </Link>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        <Filter className="h-3.5 w-3.5 text-gray-400 mr-1" />
        {TYPE_FILTERS.map((f) => {
          const active = filter === f.slug;
          const count = f.slug === "all"
            ? employees.length
            : f.slug === "inactive"
              ? null
              : (counts[f.slug] || 0);
          return (
            <button
              key={f.slug}
              type="button"
              onClick={() => setFilter(f.slug)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ring-1 transition-colors",
                active
                  ? "bg-brand-50 text-brand-800 ring-brand-200"
                  : "bg-white text-gray-600 ring-canvas-200 hover:text-gray-900",
              )}
            >
              {f.label}
              {filter === "all" && f.slug !== "all" && f.slug !== "inactive" && count !== null && count > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-canvas-100 px-1 text-[10px] font-semibold text-gray-600">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="mt-5 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[78px] rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse"
            />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <EmptyEmployees />
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((e) => (
            <li key={e.id}>
              <EmployeeCard employee={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


export function EmployeeCard({ employee }: { employee: Employee }) {
  return (
    <Link
      href={`/dashboard/employment/${employee.id}`}
      className="group flex items-start gap-3 h-full rounded-2xl border border-canvas-200/70 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]"
    >
      <Avatar name={employee.full_name} active={employee.is_active} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 truncate">
          <span className="text-[13.5px] font-semibold text-gray-900 truncate">
            {employee.full_name}
          </span>
          {!employee.is_active && (
            <span className="inline-flex items-center rounded-full bg-canvas-100 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-gray-500">
              Inactive
            </span>
          )}
        </div>
        {employee.title && (
          <div className="text-[12px] text-gray-600 truncate">{employee.title}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
          <span className="font-mono text-gray-400">{employee.employee_number}</span>
          {employee.entity_code && (
            <>
              <span className="text-canvas-300">·</span>
              <span className="font-mono">{employee.entity_code}</span>
            </>
          )}
          <span className="text-canvas-300">·</span>
          <span className="capitalize">{employee.employment_type_label}</span>
        </div>
        {employee.email && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500 truncate">
            <Mail className="h-3 w-3" />
            <span className="truncate">{employee.email}</span>
          </div>
        )}
      </div>
    </Link>
  );
}


function Avatar({ name, active }: { name: string; active: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

  return (
    <div className={cn(
      "shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-[13px] font-semibold",
      active
        ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
        : "bg-canvas-100 text-gray-500",
    )}>
      {initials}
    </div>
  );
}


function EmptyEmployees() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-canvas-300 bg-canvas-50/40 p-10 text-center">
      <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <Users className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900">No employees yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 leading-relaxed">
        Add the people on your team — full-time, part-time, contractor or
        intern. Travel claims, dimensions and reports will reference these
        records.
      </p>
      <Link href="/dashboard/employment/new" className="btn-primary mt-5 inline-flex">
        <Plus className="w-4 h-4 mr-1.5" />
        Add employee
      </Link>
    </div>
  );
}
