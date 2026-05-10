"use client";

/* Documents — upload.
 *
 * Two upload modes:
 *   • File upload — multipart, hashed and sized server-side.
 *   • External URL — link to a doc that lives in DocuSign / cloud
 *     drive / DMS. Useful when the canonical copy lives elsewhere.
 *
 * Optional cross-module references (entity, employee) — set on upload
 * so the document surfaces alongside that row's other artefacts.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowRight, FileText, Link2, Upload, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import WorkflowBack from "@/components/workflow-back";


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


const CATEGORIES = [
  { value: "contract",    label: "Contract" },
  { value: "statement",   label: "Statement" },
  { value: "policy",      label: "Policy" },
  { value: "certificate", label: "Certificate" },
  { value: "tax",         label: "Tax document" },
  { value: "legal",       label: "Legal" },
  { value: "hr",          label: "HR / Employment" },
  { value: "other",       label: "Other" },
];


type Mode = "file" | "external";


export default function UploadDocumentPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("file");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("contract");
  const [documentDate, setDocumentDate] = useState("");
  const [entityId, setEntityId] = useState<number | "">("");
  const [employeeId, setEmployeeId] = useState<number | "">("");
  const [externalUrl, setExternalUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [entities, setEntities] = useState<Entity[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => setEntities(Array.isArray(d) ? d : (d?.results ?? [])))
      .catch(() => setEntities([]));
    api.get<{ results: Employee[] } | Employee[]>("/beakon/employees/", { is_active: "true" })
      .then((d) => setEmployees(Array.isArray(d) ? d : (d?.results ?? [])))
      .catch(() => setEmployees([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "file" && !file) {
      setError("Pick a file to upload."); return;
    }
    if (mode === "external" && !externalUrl.trim()) {
      setError("Paste the external URL."); return;
    }

    setSubmitting(true);
    try {
      let created: { id: number };
      if (mode === "file" && file) {
        const form = new FormData();
        form.append("file", file);
        form.append("title", title.trim() || file.name);
        form.append("description", description.trim());
        form.append("category", category);
        if (documentDate) form.append("document_date", documentDate);
        if (entityId) form.append("entity", String(entityId));
        if (employeeId) form.append("employee", String(employeeId));
        created = await api.postForm<{ id: number }>("/beakon/documents/", form);
      } else {
        const payload: any = {
          title: title.trim() || externalUrl.trim(),
          description: description.trim(),
          category,
          external_url: externalUrl.trim(),
        };
        if (documentDate) payload.document_date = documentDate;
        if (entityId) payload.entity = entityId;
        if (employeeId) payload.employee = employeeId;
        created = await api.post<{ id: number }>("/beakon/documents/", payload);
      }
      router.push(`/dashboard/documents/${created.id}`);
    } catch (err: any) {
      setError(
        err?.detail ||
        err?.file?.[0] ||
        err?.external_url?.[0] ||
        "Failed to upload document.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Upload document"
        description="Add a contract, statement or any document. Use external URL when the canonical copy lives elsewhere."
      />

      <div className="mt-2 mb-4">
        <Suspense fallback={<span className="text-sm text-gray-400">Back</span>}>
          <WorkflowBack fallbackHref="/dashboard/documents" />
        </Suspense>
      </div>

      <form
        onSubmit={submit}
        className="rounded-2xl border border-canvas-200/70 bg-white p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] max-w-2xl"
      >
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mb-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-canvas-200 bg-canvas-50/60 p-1">
            <ModeButton
              active={mode === "file"} icon={Upload} label="Upload file"
              onClick={() => setMode("file")}
            />
            <ModeButton
              active={mode === "external"} icon={Link2} label="External link"
              onClick={() => setMode("external")}
            />
          </div>
        </div>

        {mode === "file" ? (
          <FileDropzone
            file={file}
            onPick={setFile}
            onClear={() => {
              setFile(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            inputRef={fileInputRef}
          />
        ) : (
          <Field label="External URL" required hint="DocuSign / SharePoint / Google Drive — anywhere outside Beakon.">
            <input
              type="url" className="input"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://…"
              required
            />
          </Field>
        )}

        <div className="mt-5 space-y-4">
          <Field label="Title" hint="Defaults to the filename.">
            <input
              type="text" className="input"
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Lease agreement — Geneva office"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Category" required>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Document date" hint="Signature / statement / issue date.">
              <input
                type="date" className="input"
                value={documentDate} onChange={(e) => setDocumentDate(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Linked entity" hint="Optional. The doc will appear on that entity.">
              <select
                className="input"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">No entity</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} · {e.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Linked employee" hint="Optional. The doc will appear on that employee.">
              <select
                className="input"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">No employee</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.employee_number})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Description">
            <textarea
              className="input min-h-[80px]"
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? "Uploading…"
              : <>Upload <ArrowRight className="w-4 h-4 ml-1.5" /></>}
          </button>
        </div>
      </form>
    </div>
  );
}


function ModeButton({
  active, icon: Icon, label, onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
        active ? "bg-white text-brand-800 shadow-sm ring-1 ring-brand-100" : "text-gray-600 hover:text-gray-900",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}


function FileDropzone({
  file, onPick, onClear, inputRef,
}: {
  file: File | null;
  onPick: (f: File) => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [drag, setDrag] = useState(false);

  if (file) {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50/30 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="shrink-0 h-10 w-10 rounded-lg bg-white text-brand-700 flex items-center justify-center ring-1 ring-brand-100">
            <FileText className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-gray-900 truncate">{file.name}</div>
            <div className="text-[11px] text-gray-500">
              {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown type"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md p-1.5 text-gray-400 hover:bg-canvas-100 hover:text-gray-700"
            title="Remove"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <label
      htmlFor="file-input"
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPick(f);
      }}
      className={cn(
        "block rounded-xl border-2 border-dashed px-4 py-10 text-center cursor-pointer transition-colors",
        drag
          ? "border-brand-400 bg-brand-50/50"
          : "border-canvas-300 bg-canvas-50/40 hover:border-brand-300 hover:bg-brand-50/20",
      )}
    >
      <Upload className="mx-auto h-8 w-8 text-gray-400" />
      <p className="mt-3 text-[13px] font-medium text-gray-700">
        Drop a file here, or click to browse
      </p>
      <p className="mt-1 text-[11.5px] text-gray-500">
        PDF, image, doc — anything supported by your stack.
      </p>
      <input
        ref={inputRef}
        id="file-input"
        type="file"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
    </label>
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
