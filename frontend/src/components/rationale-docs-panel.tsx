"use client";

/* Rationale + source-docs panel — used on Bill, Invoice, and Journal-Entry
 * detail pages. Implements the "double-layer cross-check" UX Thomas asked
 * for during import flows: the auditor sees the editable rationale next to
 * the original PDF/image so they can verify each debit and credit against
 * the source before approving.
 *
 * Layout:
 *   ┌───────────────────────────┬───────────────────────────┐
 *   │ Explanation (textbox)     │ Source documents          │
 *   ├───────────────────────────┤   - file 1                │
 *   │ Source files list         │   - file 2  ← selected    │
 *   │   (filenames + actions)   │ ┌───────────────────────┐ │
 *   │                           │ │ inline preview pane    │ │
 *   │                           │ │ (PDF iframe / <img>)   │ │
 *   │                           │ └───────────────────────┘ │
 *   └───────────────────────────┴───────────────────────────┘
 */

import { useEffect, useRef, useState } from "react";
import {
  Pencil, Check, Loader2, Paperclip, Upload, FileText, Download,
  Trash2, Sparkles,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";


export interface SourceDoc {
  id: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  description?: string;
  uploaded_by_email: string | null;
  uploaded_at: string;
}

interface Props {
  /** Base path for the parent record's documents endpoint, e.g.
   *  "/beakon/bills/42" — `/documents/` and `/explanation/` are appended. */
  parentBasePath: string;
  initialExplanation: string;
  initialDocuments?: SourceDoc[];
  /** Locks editing the explanation (e.g. JE posted, bill approved). */
  explanationLocked: boolean;
  /** Locks soft-delete of attachments — uploads stay open even when locked
   *  because supporting docs sometimes arrive after the JE has posted. */
  attachmentsLocked: boolean;
  onExplanationSaved?: (next: string) => void;
  onDocumentsChanged?: (count: number) => void;
  /** When set, the rationale was auto-drafted by AI from this source.
   *  Renders a Sparkles strip atop the rationale so the reviewer treats
   *  the text as an AI proposal to verify against the source document. */
  aiSource?: { model: string; filename?: string | null } | null;
}

export function RationaleDocsPanel({
  parentBasePath,
  initialExplanation,
  initialDocuments,
  explanationLocked,
  attachmentsLocked,
  onExplanationSaved,
  onDocumentsChanged,
  aiSource,
}: Props) {
  const [docs, setDocs] = useState<SourceDoc[]>(initialDocuments || []);
  const [docsLoaded, setDocsLoaded] = useState(Boolean(initialDocuments));
  const [selectedDocId, setSelectedDocId] = useState<number | null>(
    initialDocuments && initialDocuments.length ? initialDocuments[0].id : null,
  );
  const [docsErr, setDocsErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = async () => {
    setDocsErr(null);
    try {
      const list = await api.get<SourceDoc[]>(`${parentBasePath}/documents/`);
      setDocs(list);
      setDocsLoaded(true);
      onDocumentsChanged?.(list.length);
      if (selectedDocId && !list.some((d) => d.id === selectedDocId)) {
        setSelectedDocId(list[0]?.id ?? null);
      } else if (!selectedDocId && list.length) {
        setSelectedDocId(list[0].id);
      }
    } catch (e: any) {
      setDocsErr(e?.error?.message || e?.detail || "Failed to load attachments");
    }
  };

  useEffect(() => {
    if (!initialDocuments) void reload();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [parentBasePath]);

  const upload = async (file: File) => {
    setUploading(true); setDocsErr(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;
      const resp = await fetch(`${API_BASE}${parentBasePath}/documents/`, {
        method: "POST", headers, body: fd,
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body?.detail || body?.error?.message || `HTTP ${resp.status}`);
      }
      const created = await resp.json().catch(() => null);
      await reload();
      if (created?.id) setSelectedDocId(created.id);
    } catch (e: any) {
      setDocsErr(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const remove = async (docId: number) => {
    if (!confirm("Remove this attachment? (soft-delete only — file stays in the audit trail)")) return;
    setDocsErr(null);
    try {
      await api.delete(`/beakon/documents/${docId}/`);
      await reload();
    } catch (e: any) {
      setDocsErr(e?.error?.message || e?.detail || "Failed to remove");
    }
  };

  // Plain <a href> can't carry the JWT Authorization header, so download
  // via authenticated fetch + a synthetic anchor pointing at a blob URL.
  const downloadDoc = async (d: SourceDoc) => {
    setDocsErr(null);
    try {
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;
      const resp = await fetch(`${API_BASE}/beakon/documents/${d.id}/`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = d.original_filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setDocsErr(e?.message || "Download failed");
    }
  };

  const selectedDoc = docs.find((d) => d.id === selectedDocId) || null;

  // Drop zone — accept dragged files anywhere on the docs card.
  const [dragActive, setDragActive] = useState(false);
  const onDragEnter = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragActive(true);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the wrapping element entirely — otherwise
    // dragenter on a child would flicker the highlight off.
    if (e.currentTarget === e.target) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
      {/* ── Left: rationale + file list ───────────────────────── */}
      <div className="space-y-4">
        <ExplanationCard
          parentBasePath={parentBasePath}
          initialText={initialExplanation}
          locked={explanationLocked}
          onSaved={onExplanationSaved}
          aiSource={aiSource ?? null}
        />

        <div
          className={
            "card p-4 relative transition-colors " +
            (dragActive ? "ring-2 ring-brand-400 bg-brand-50/40" : "")
          }
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {dragActive && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <div className="rounded-lg bg-white/80 backdrop-blur px-4 py-2 text-sm font-medium text-brand-900 ring-1 ring-brand-300 shadow-sm inline-flex items-center gap-2">
                <Upload className="w-4 h-4" /> Drop to attach
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <Paperclip className="w-4 h-4 text-gray-500" /> Source documents
                {docs.length > 0 && (
                  <span className="text-[11px] font-normal text-gray-500">({docs.length})</span>
                )}
              </h3>
              <p className="text-[11px] text-gray-500">
                Click a file to preview it. Drag and drop to attach.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-secondary text-xs inline-flex items-center gap-1"
            >
              {uploading
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
                : <><Upload className="w-3 h-3" /> Upload</>}
            </button>
          </div>
          {docsErr && <p className="text-xs text-red-700 mb-2">{docsErr}</p>}
          {!docsLoaded ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              No source documents attached. Drop a bill PDF, receipt, contract,
              or screenshot here — or click Upload above.
            </p>
          ) : (
            <ul className="divide-y divide-canvas-100">
              {docs.map((d) => {
                const isSelected = d.id === selectedDocId;
                return (
                  <li
                    key={d.id}
                    className={
                      "py-2 flex items-center gap-2 cursor-pointer rounded px-1 -mx-1 " +
                      (isSelected ? "bg-brand-50 text-brand-900" : "hover:bg-canvas-50")
                    }
                    onClick={() => setSelectedDocId(d.id)}
                  >
                    <FileText className={"w-4 h-4 shrink-0 " + (isSelected ? "text-brand-700" : "text-gray-400")} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" title={d.original_filename}>
                        {d.original_filename}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {fmtSize(d.size_bytes)} · {d.uploaded_by_email || "system"} · {fmtDateTime(d.uploaded_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void downloadDoc(d); }}
                      className="p-1 text-gray-500 hover:text-gray-900"
                      title="Download"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    {!attachmentsLocked && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void remove(d.id); }}
                        className="p-1 text-gray-400 hover:text-red-600"
                        title="Remove (soft-delete)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Right: inline preview pane ───────────────────────── */}
      <DocumentPreviewPane doc={selectedDoc} />
    </div>
  );
}


/* ── Explanation textarea (inline edit) ───────────────────── */
function ExplanationCard({
  parentBasePath, initialText, locked, onSaved, aiSource,
}: {
  parentBasePath: string;
  initialText: string;
  locked: boolean;
  onSaved?: (next: string) => void;
  aiSource: { model: string; filename?: string | null } | null;
}) {
  const [text, setText] = useState(initialText || "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setText(initialText || ""); }, [initialText]);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const updated = await api.patch<{ explanation: string }>(
        `${parentBasePath}/explanation/`, { explanation: text },
      );
      onSaved?.(updated.explanation);
      setEditing(false);
    } catch (e: any) {
      setErr(e?.error?.message || e?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setText(initialText || "");
    setEditing(false);
    setErr(null);
  };

  return (
    <div className="card p-4">
      {aiSource && (
        <div className="-mx-4 -mt-4 mb-3 px-4 py-2 border-b border-brand-100 bg-brand-50/60 rounded-t-2xl text-[11px] text-brand-900 inline-flex items-center gap-1.5 w-[calc(100%+2rem)]">
          <Sparkles className="w-3.5 h-3.5 text-brand-700 shrink-0" />
          <span>
            Rationale auto-drafted by AI
            {aiSource.filename && <> from <span className="font-mono text-brand-800">{aiSource.filename}</span></>}
            <span className="text-brand-700/70"> · {aiSource.model}</span>.
            <span className="text-brand-800/80"> Verify against the source document and edit anything that doesn't match.</span>
          </span>
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Why this debit / credit
          </h3>
          <p className="text-[11px] text-gray-500">
            Explain the posting in plain English. Visible to auditors and
            propagates onto the journal entry.
          </p>
        </div>
        {!locked && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" /> {initialText ? "Edit" : "Add"}
          </button>
        )}
        {locked && (
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Locked</span>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="e.g. Debited Office Rent because the vendor invoice covers April. Credited Accounts Payable because the bill is unpaid as of the invoice date. Booked under operating expense rather than prepaid since the service period is fully consumed."
            className="input w-full text-sm"
            disabled={saving}
            autoFocus
          />
          {err && <p className="text-xs text-red-700">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancel} disabled={saving}
                    className="btn-secondary text-xs">Cancel</button>
            <button type="button" onClick={save} disabled={saving}
                    className="btn-primary text-xs inline-flex items-center gap-1">
              {saving
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                : <><Check className="w-3 h-3" /> Save</>}
            </button>
          </div>
        </div>
      ) : initialText ? (
        <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
          {initialText}
        </p>
      ) : (
        <p className="text-sm text-gray-400 italic">
          {locked
            ? "No rationale was recorded."
            : "Click Add to record why each side was debited or credited."}
        </p>
      )}
    </div>
  );
}


/* ── Inline preview pane ──────────────────────────────────── *
 * The document download endpoint is JWT-auth'd. We can't set headers on
 * <iframe> / <img> / <object> tags, so for GET we pass the same JWT
 * already in localStorage as ?token= + ?org= in the URL — the backend's
 * SourceDocumentDetailView.initialize_request promotes them back into
 * Authorization / X-Organization-ID headers before auth runs.
 *
 * Real HTTP URLs (vs. blob: URLs) are also significantly more reliable
 * for PDF.js — Edge / Chrome's built-in viewer makes range requests
 * that don't always succeed against blob URLs, surfacing as "Failed to
 * load PDF document" inside the embedded viewer.
 */
function DocumentPreviewPane({ doc }: { doc: SourceDoc | null }) {
  const [authedUrl, setAuthedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) { setAuthedUrl(null); return; }
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    const orgId = typeof window !== "undefined" ? localStorage.getItem("organization_id") : null;
    const params = new URLSearchParams({ inline: "1" });
    if (token) params.set("token", token);
    if (orgId) params.set("org", orgId);
    setAuthedUrl(`${API_BASE}/beakon/documents/${doc.id}/?${params.toString()}`);
  }, [doc?.id]);

  if (!doc) {
    return (
      <div className="card p-6 flex items-center justify-center min-h-[400px] bg-canvas-50/40">
        <p className="text-xs text-gray-400 text-center max-w-[260px]">
          Select a source file on the left to preview it here.
          PDFs and images render inline so you can cross-check each posted
          line against the original.
        </p>
      </div>
    );
  }

  const effectiveMime = inferMime(doc, "");
  const isPdf = effectiveMime === "application/pdf";
  const isImage = effectiveMime.startsWith("image/");

  // The Download button uses an authenticated fetch to keep the JWT out
  // of the saved file's referer/log trail; the inline preview's URL
  // already carries the token because <iframe>/<img>/<object> can't set
  // headers, but the Save action doesn't need to.
  const triggerDownload = async () => {
    try {
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;
      const resp = await fetch(`${API_BASE}/beakon/documents/${doc.id}/`, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.original_filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* button stays — user can retry */
    }
  };

  return (
    <div className="card p-0 overflow-hidden flex flex-col min-h-[400px] lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)]">
      <div className="flex-1 bg-canvas-100/40 min-h-[400px]">
        {!authedUrl ? (
          <div className="p-6 flex items-center justify-center min-h-[400px]">
            <div className="text-center text-xs text-gray-400 inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Preparing preview…
            </div>
          </div>
        ) : isPdf ? (
          // Real HTTP URL — PDF.js handles range requests reliably here.
          // We deliberately use <iframe> rather than <object>: <object>
          // can trigger a download when the user's browser is set to
          // "open PDFs externally", whereas <iframe> always tries to
          // render in the embedded viewer. #toolbar=1 keeps the viewer
          // chrome (zoom, pages); navpanes=0 hides the thumbnails;
          // view=FitH fits the page to width.
          <iframe
            src={`${authedUrl}#toolbar=1&navpanes=0&view=FitH`}
            title={doc.original_filename}
            className="w-full h-full min-h-[600px] block bg-white"
          />
        ) : isImage ? (
          <div className="p-3 flex items-center justify-center h-full">
            <img
              src={authedUrl}
              alt={doc.original_filename}
              className="max-w-full max-h-[700px] object-contain rounded border border-canvas-200"
            />
          </div>
        ) : (
          <div className="p-6 flex items-center justify-center min-h-[400px]">
            <div className="text-center max-w-[300px]">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-xs text-gray-600">
                Preview not supported for {doc.content_type || "this file type"}.
              </p>
              <button
                type="button"
                onClick={triggerDownload}
                className="btn-secondary text-xs mt-3 inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" /> Download to view
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}


/* Pick the most useful MIME type for the blob URL — prefer something
 * the browser knows how to render inline. Trust an explicit
 * application/pdf or image/* on the SourceDocument record; otherwise
 * fall back to the filename extension. We deliberately ignore
 * application/octet-stream because that's what the browser sends when
 * it didn't recognise the file at upload time, and it always triggers a
 * download. */
function inferMime(doc: SourceDoc, fallback: string): string {
  const stored = (doc.content_type || "").toLowerCase();
  if (stored === "application/pdf" || stored.startsWith("image/")) return stored;
  const name = doc.original_filename.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".svg")) return "image/svg+xml";
  if (stored && stored !== "application/octet-stream") return stored;
  return fallback || "application/octet-stream";
}
