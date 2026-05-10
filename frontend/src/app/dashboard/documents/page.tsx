"use client";

/* Documents — central document store.
 *
 * Per the UI philosophy doc (2026-05-10):
 *   "Contracts, statements and supporting evidence."
 *
 * This is the horizontal documents module — contracts, policies,
 * statements, certificates, anything not tied to a specific accounting
 * parent. Documents bound to a Bill / Invoice / JournalEntry continue
 * to live on the engine's SourceDocument table (stricter constraints
 * around posting finality).
 *
 * Cross-module references are first-class: a document can be linked
 * to an Entity or an Employee so it surfaces alongside that row's
 * other artefacts.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Award, FileText, Filter, FolderOpen, Plus, Receipt,
  Scale, Shield,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";


export type DocumentCategory =
  | "contract" | "statement" | "policy" | "certificate"
  | "tax" | "legal" | "hr" | "other";


export interface Document {
  id: number;
  title: string;
  description: string;
  category: DocumentCategory;
  category_label: string;
  file: string | null;
  file_url: string;
  external_url: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  content_hash: string;
  entity: number | null;
  entity_code: string;
  employee: number | null;
  employee_name: string;
  document_date: string | null;
  uploaded_by: number | null;
  uploaded_by_email: string;
  uploaded_at: string;
  is_deleted: boolean;
}


const CATEGORY_FILTERS: { slug: "all" | DocumentCategory; label: string }[] = [
  { slug: "all",         label: "All" },
  { slug: "contract",    label: "Contracts" },
  { slug: "statement",   label: "Statements" },
  { slug: "policy",      label: "Policies" },
  { slug: "certificate", label: "Certificates" },
  { slug: "tax",         label: "Tax" },
  { slug: "legal",       label: "Legal" },
  { slug: "hr",          label: "HR" },
  { slug: "other",       label: "Other" },
];


export const CATEGORY_ICON: Record<DocumentCategory, React.ComponentType<{ className?: string }>> = {
  contract:    Scale,
  statement:   Receipt,
  policy:      FolderOpen,
  certificate: Award,
  tax:         FileText,
  legal:       Scale,
  hr:          Shield,
  other:       FileText,
};


export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | DocumentCategory>("all");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    const params: Record<string, string> = {};
    if (filter !== "all") params.category = filter;
    try {
      const d = await api.get<{ results: Document[] } | Document[]>("/beakon/documents/", params);
      const list = Array.isArray(d) ? d : (d?.results ?? []);
      setDocuments(list);
    } catch {
      setError("Could not load documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-line */ }, [filter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    documents.forEach((d) => { out[d.category] = (out[d.category] || 0) + 1; });
    return out;
  }, [documents]);

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Contracts, statements, certificates and other supporting evidence. Link a document to an entity or employee so it shows up where you need it."
        actions={
          <Link href="/dashboard/documents/new" className="btn-primary text-sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Upload document
          </Link>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        <Filter className="h-3.5 w-3.5 text-gray-400 mr-1" />
        {CATEGORY_FILTERS.map((f) => {
          const active = filter === f.slug;
          const count = f.slug === "all" ? documents.length : (counts[f.slug] || 0);
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
              {filter === "all" && f.slug !== "all" && count > 0 && (
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
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-[120px] rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse"
            />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <EmptyDocuments />
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((d) => (
            <li key={d.id}>
              <DocumentCard document={d} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


export function DocumentCard({ document }: { document: Document }) {
  const Icon = CATEGORY_ICON[document.category] || FileText;
  const isExternal = !document.file_url && !!document.external_url;

  return (
    <Link
      href={`/dashboard/documents/${document.id}`}
      className="group flex h-full flex-col rounded-2xl border border-canvas-200/70 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(15,23,42,0.18)]"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 h-10 w-10 rounded-xl flex items-center justify-center bg-canvas-100 text-gray-700">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-gray-900 truncate">
            {document.title || document.original_filename}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
            <span className="capitalize">{document.category_label}</span>
            <span className="text-canvas-300">·</span>
            <span>{formatBytes(document.size_bytes)}</span>
            {isExternal && (
              <>
                <span className="text-canvas-300">·</span>
                <span className="font-medium text-brand-700">External link</span>
              </>
            )}
          </div>
        </div>
      </div>

      {document.description && (
        <p className="mt-3 text-[12px] text-gray-600 leading-relaxed line-clamp-2">
          {document.description}
        </p>
      )}

      <div className="mt-auto pt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
        {document.entity_code && (
          <span className="font-mono">{document.entity_code}</span>
        )}
        {document.employee_name && (
          <>
            {document.entity_code && <span>·</span>}
            <span>{document.employee_name}</span>
          </>
        )}
        {(document.entity_code || document.employee_name) && <span>·</span>}
        <span>
          {new Date(document.document_date || document.uploaded_at).toLocaleDateString()}
        </span>
      </div>
    </Link>
  );
}


function EmptyDocuments() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-canvas-300 bg-canvas-50/40 p-10 text-center">
      <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <FolderOpen className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900">No documents yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 leading-relaxed">
        Upload contracts, policy documents and statements that aren't
        already attached to a bill, invoice or journal entry.
      </p>
      <Link href="/dashboard/documents/new" className="btn-primary mt-5 inline-flex">
        <Plus className="w-4 h-4 mr-1.5" />
        Upload document
      </Link>
    </div>
  );
}


export function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
