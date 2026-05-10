"use client";

/* Documents — detail.
 *
 * Shows the document metadata, lets the user open / download the file,
 * edit metadata and links, or soft-delete the row.
 */
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle, Building2, Calendar, Download, Edit3, ExternalLink,
  FileText, Hash, Save, Trash2, Upload, User,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import WorkflowBack from "@/components/workflow-back";
import {
  CATEGORY_ICON, formatBytes, type Document, type DocumentCategory,
} from "../page";


interface Entity {
  id: number;
  code: string;
  name: string;
  entity_type: string;
}


interface Employee {
  id: number;
  full_name: string;
  employee_number: string;
}


const CATEGORIES: { value: DocumentCategory; label: string }[] = [
  { value: "contract",    label: "Contract" },
  { value: "statement",   label: "Statement" },
  { value: "policy",      label: "Policy" },
  { value: "certificate", label: "Certificate" },
  { value: "tax",         label: "Tax document" },
  { value: "legal",       label: "Legal" },
  { value: "hr",          label: "HR / Employment" },
  { value: "other",       label: "Other" },
];


export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);

  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const reload = async () => {
    setLoading(true);
    try {
      setDoc(await api.get<Document>(`/beakon/documents/${id}/`));
    } catch {
      setError("Could not load document.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); /* eslint-disable-line */ }, [id]);

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => setEntities(Array.isArray(d) ? d : (d?.results ?? [])))
      .catch(() => setEntities([]));
    api.get<{ results: Employee[] } | Employee[]>("/beakon/employees/", { is_active: "true" })
      .then((d) => setEmployees(Array.isArray(d) ? d : (d?.results ?? [])))
      .catch(() => setEmployees([]));
  }, []);

  if (loading && !doc) {
    return (
      <div>
        <PageHeader title="Document" description="Loading…" />
        <div className="mt-5 h-64 rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div>
        <PageHeader title="Document" />
        <div className="mt-5 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error || "Document not found."}</span>
        </div>
      </div>
    );
  }

  const Icon = CATEGORY_ICON[doc.category] || FileText;
  const isExternal = !doc.file_url && !!doc.external_url;
  const openHref = doc.external_url || resolveFileUrl(doc.file_url);

  return (
    <div>
      <PageHeader
        title={doc.title || doc.original_filename}
        description={doc.category_label}
        actions={
          <div className="flex items-center gap-2">
            {openHref && (
              <a
                href={openHref}
                target="_blank"
                rel="noopener"
                className="btn-secondary text-sm"
              >
                {isExternal ? <ExternalLink className="w-4 h-4 mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}
                {isExternal ? "Open link" : "Download"}
              </a>
            )}
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
          <WorkflowBack fallbackHref="/dashboard/documents" />
        </Suspense>
      </div>

      {editing ? (
        <EditForm
          doc={doc}
          entities={entities}
          employees={employees}
          onSaved={() => { setEditing(false); void reload(); }}
          onCancel={() => setEditing(false)}
          onDeleted={() => router.push("/dashboard/documents")}
        />
      ) : (
        <div className="rounded-2xl border border-canvas-200/70 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
          <div className="flex items-start gap-4">
            <div className="shrink-0 h-14 w-14 rounded-2xl bg-canvas-100 text-gray-700 flex items-center justify-center">
              <Icon className="h-7 w-7" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
                <span className="capitalize">{doc.category_label}</span>
                <span className="text-canvas-300">·</span>
                {isExternal ? (
                  <span className="font-medium text-brand-700 inline-flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />
                    External link
                  </span>
                ) : (
                  <>
                    <span>{doc.original_filename || "uploaded file"}</span>
                    <span className="text-canvas-300">·</span>
                    <span>{formatBytes(doc.size_bytes)}</span>
                  </>
                )}
              </div>

              {doc.description && (
                <p className="text-[13px] text-gray-700 leading-relaxed">
                  {doc.description}
                </p>
              )}

              <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-[12.5px] text-gray-700 pt-1">
                {doc.document_date && (
                  <Stat
                    icon={Calendar}
                    label="Document date"
                    value={new Date(doc.document_date).toLocaleDateString()}
                  />
                )}
                <Stat
                  icon={Upload}
                  label="Uploaded"
                  value={`${new Date(doc.uploaded_at).toLocaleDateString()}${doc.uploaded_by_email ? ` · ${doc.uploaded_by_email}` : ""}`}
                />
                {doc.entity_code && (
                  <Stat
                    icon={Building2}
                    label="Entity"
                    value={
                      <Link
                        href={`/dashboard/entities?code=${encodeURIComponent(doc.entity_code)}&from=/dashboard/documents/${doc.id}`}
                        className="font-mono text-brand-700 hover:underline"
                      >
                        {doc.entity_code}
                      </Link>
                    }
                  />
                )}
                {doc.employee_name && doc.employee && (
                  <Stat
                    icon={User}
                    label="Employee"
                    value={
                      <Link
                        href={`/dashboard/employment/${doc.employee}?from=/dashboard/documents/${doc.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {doc.employee_name}
                      </Link>
                    }
                  />
                )}
                {doc.content_hash && (
                  <Stat
                    icon={Hash}
                    label="SHA-256"
                    value={<span className="font-mono text-[10.5px] text-gray-500 truncate">{doc.content_hash.slice(0, 16)}…</span>}
                  />
                )}
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function Stat({
  icon: Icon, label, value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-start gap-1.5">
      <Icon className="h-3.5 w-3.5 text-gray-400 mt-0.5" />
      <span>
        <span className="text-gray-500">{label}: </span>
        {value}
      </span>
    </div>
  );
}


function EditForm({
  doc, entities, employees, onSaved, onCancel, onDeleted,
}: {
  doc: Document;
  entities: Entity[];
  employees: Employee[];
  onSaved: () => void;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description);
  const [category, setCategory] = useState(doc.category);
  const [documentDate, setDocumentDate] = useState(doc.document_date ?? "");
  const [entityId, setEntityId] = useState<number | "">(doc.entity ?? "");
  const [employeeId, setEmployeeId] = useState<number | "">(doc.employee ?? "");
  const [externalUrl, setExternalUrl] = useState(doc.external_url);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await api.patch(`/beakon/documents/${doc.id}/`, {
        title: title.trim(),
        description: description.trim(),
        category,
        document_date: documentDate || null,
        entity: entityId || null,
        employee: employeeId || null,
        external_url: externalUrl.trim(),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.detail || "Failed to save changes.");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${doc.title || doc.original_filename}"? The file is hidden but kept on disk.`)) return;
    setBusy(true); setError("");
    try {
      await api.delete(`/beakon/documents/${doc.id}/`);
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
        <Field label="Title">
          <input type="text" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Category" required>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Document date">
            <input type="date" className="input" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Linked entity">
            <select
              className="input"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">No entity</option>
              {entities.filter((e) => e.entity_type !== "individual").map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Linked employee">
            <select
              className="input"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">No employee</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.employee_number})</option>
              ))}
            </select>
          </Field>
        </div>

        {!doc.file_url && (
          <Field label="External URL">
            <input type="url" className="input" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
          </Field>
        )}

        <Field label="Description">
          <textarea className="input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-canvas-100 pt-4">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="inline-flex items-center gap-1 text-[12.5px] text-rose-700 hover:text-rose-900"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete document
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


/** Django returns file URLs as relative paths (e.g. /media/...). They
 *  need the absolute host when the dev server proxies through Next.js. */
function resolveFileUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  // Normalize: API_BASE ends in /api/v1, but media is at /media — so
  // we strip API_BASE's path and just keep the origin.
  if (typeof window !== "undefined") {
    return `${window.location.origin}${url}`;
  }
  return url;
}
