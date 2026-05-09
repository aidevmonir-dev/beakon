"use client";

/* AI-driven Chart-of-Accounts import.
 *
 * Three steps:
 *   1. Upload — pick xlsx/csv + entity (or "Shared CoA").
 *   2. Preview — Claude returns one row per account with type/subtype +
 *      confidence + rationale. Every cell is editable inline.
 *   3. Commit — POST the reviewed rows; backend writes Accounts atomically.
 *
 * The AI is never the source of truth; the user's final edits are.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Upload, ArrowLeft, Sparkles, CheckCircle2, AlertCircle, X,
  ChevronRight, FileSpreadsheet, Trash2,
} from "lucide-react";
import { api, API_BASE } from "@/lib/api";


interface Entity { id: number; code: string; name: string; functional_currency: string; }

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
type AccountType = typeof ACCOUNT_TYPES[number];

const SUBTYPES_BY_TYPE: Record<AccountType, string[]> = {
  asset: ["bank","cash","current_asset","accounts_receivable","intercompany_receivable","prepaid","inventory","investment","loan_receivable","vat_receivable","tax_receivable","fixed_asset","accumulated_depreciation","intangible_asset","other_asset"],
  liability: ["accounts_payable","intercompany_payable","accrued_liability","current_liability","loan_payable","long_term_liability","tax_payable","vat_payable","other_liability"],
  equity: ["capital","retained_earnings","revaluation_reserve","fx_translation_reserve","distribution","other_equity"],
  revenue: ["operating_revenue","investment_income","fx_gain","other_income"],
  expense: ["cogs","operating_expense","professional_fees","depreciation","fx_loss","tax_expense","other_expense"],
};

interface PreviewRow {
  code: string;
  name: string;
  account_type: AccountType;
  account_subtype: string;
  parent_code?: string | null;
  is_header?: boolean;
  description?: string;
  confidence: number;
  rationale?: string;
}

interface PreviewResp {
  accounts: PreviewRow[];
  source: { filename: string; format: string; sheet?: string; row_count: number };
}

interface CommitResp {
  created: number;
  skipped: { code: string; reason: string }[];
  errors: { code?: string; reason: string }[];
}


export default function CoAImportPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState<string>("");  // "" = shared
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => setEntities(Array.isArray(d) ? d : (d.results ?? [])))
      .catch(() => setEntities([]));
  }, []);

  const onUpload = async () => {
    if (!file) return;
    setBusy(true); setErr(null); setCommitResult(null); setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;
      const resp = await fetch(`${API_BASE}/beakon/ai/coa-import/preview/`, {
        method: "POST", headers, body: fd,
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error?.message || data?.detail || "Upload failed");
      }
      setPreview(data as PreviewResp);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (idx: number, patch: Partial<PreviewRow>) => {
    if (!preview) return;
    const next = preview.accounts.slice();
    const merged = { ...next[idx], ...patch } as PreviewRow;
    // If type changed and the subtype no longer fits, clear it.
    if (patch.account_type && !SUBTYPES_BY_TYPE[merged.account_type]?.includes(merged.account_subtype)) {
      merged.account_subtype = "";
    }
    next[idx] = merged;
    setPreview({ ...preview, accounts: next });
  };

  const removeRow = (idx: number) => {
    if (!preview) return;
    setPreview({
      ...preview,
      accounts: preview.accounts.filter((_, i) => i !== idx),
    });
  };

  const onCommit = async () => {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      const body = {
        entity_id: entityId ? Number(entityId) : null,
        accounts: preview.accounts,
      };
      const result = await api.post<CommitResp>("/beakon/ai/coa-import/commit/", body);
      setCommitResult(result);
    } catch (e: any) {
      setErr(e?.detail || e?.message || "Commit failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setErr(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const stats = useMemo(() => {
    if (!preview) return null;
    const total = preview.accounts.length;
    const headers = preview.accounts.filter((a) => a.is_header).length;
    const lowConf = preview.accounts.filter((a) => !a.is_header && a.confidence < 0.7).length;
    return { total, headers, lowConf, postable: total - headers };
  }, [preview]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/dashboard/accounts" className="text-gray-400 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-700" /> AI Chart-of-Accounts Import
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Upload an Excel or CSV. Claude proposes the structured CoA. You review every row before it lands in the ledger.
          </p>
        </div>
      </div>

      {commitResult ? (
        <CommitSummary result={commitResult} onDone={reset} />
      ) : !preview ? (
        <UploadStep
          entities={entities}
          entityId={entityId}
          setEntityId={setEntityId}
          file={file}
          setFile={setFile}
          onUpload={onUpload}
          busy={busy}
          err={err}
          fileInputRef={fileInputRef}
        />
      ) : (
        <PreviewStep
          preview={preview}
          stats={stats!}
          entityCode={entities.find((e) => e.id.toString() === entityId)?.code || "Shared"}
          onCommit={onCommit}
          onReset={reset}
          updateRow={updateRow}
          removeRow={removeRow}
          busy={busy}
          err={err}
        />
      )}
    </div>
  );
}


function UploadStep({
  entities, entityId, setEntityId, file, setFile, onUpload, busy, err, fileInputRef,
}: {
  entities: Entity[];
  entityId: string;
  setEntityId: (v: string) => void;
  file: File | null;
  setFile: (f: File | null) => void;
  onUpload: () => void;
  busy: boolean;
  err: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="card p-6 max-w-2xl">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">1. Upload</h2>

      <label className="block mb-4">
        <span className="text-xs font-medium text-gray-600">Attach to</span>
        <select className="input mt-1" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">Shared (every entity sees these accounts)</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.code} — {e.name} ({e.functional_currency})
            </option>
          ))}
        </select>
        <p className="text-[11px] text-gray-400 mt-1">
          Pick an entity to scope the CoA to one set of books. "Shared" makes accounts available to every entity.
        </p>
      </label>

      <label className="block mb-4">
        <span className="text-xs font-medium text-gray-600">File (.xlsx or .csv)</span>
        <div
          className="mt-1 border border-dashed border-canvas-200 rounded-lg p-6 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/40 transition"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
        >
          {file ? (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
              <FileSpreadsheet className="w-4 h-4 text-brand-700" /> {file.name}
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                className="text-gray-400 hover:text-rose-600 ml-2"
                aria-label="Remove file">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <Upload className="w-6 h-6 mx-auto mb-2 text-gray-400" />
              <p className="text-sm text-gray-600">Drop a file here or click to choose</p>
              <p className="text-[11px] text-gray-400 mt-1">.xlsx · .xlsm · .csv · .tsv</p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".xlsx,.xlsm,.csv,.tsv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>

      {err && (
        <div className="mb-3 px-3 py-2 rounded bg-rose-50 text-rose-700 text-xs flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {err}
        </div>
      )}

      <button onClick={onUpload} disabled={!file || busy} className="btn-primary">
        {busy ? "Asking Claude…" : (<>Analyze with AI <ChevronRight className="w-4 h-4 ml-1" /></>)}
      </button>
    </div>
  );
}


function PreviewStep({
  preview, stats, entityCode, onCommit, onReset, updateRow, removeRow, busy, err,
}: {
  preview: PreviewResp;
  stats: { total: number; headers: number; lowConf: number; postable: number };
  entityCode: string;
  onCommit: () => void;
  onReset: () => void;
  updateRow: (idx: number, patch: Partial<PreviewRow>) => void;
  removeRow: (idx: number) => void;
  busy: boolean;
  err: string | null;
}) {
  return (
    <div>
      <div className="card p-4 mb-4 flex items-center gap-6">
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {preview.source.filename}
            {preview.source.sheet && <span className="text-gray-400 font-normal"> · sheet "{preview.source.sheet}"</span>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Will write to <span className="font-mono text-brand-700">{entityCode}</span> · {stats.postable} accounts ({stats.headers} headers skipped)
            {stats.lowConf > 0 && <> · <span className="text-amber-700">{stats.lowConf} low-confidence — review carefully</span></>}
          </p>
        </div>
        <button onClick={onReset} className="text-xs text-gray-500 hover:text-gray-800 underline">
          Start over
        </button>
        <button onClick={onCommit} disabled={busy || stats.postable === 0} className="btn-primary">
          {busy ? "Writing…" : (<>Commit {stats.postable} accounts <CheckCircle2 className="w-4 h-4 ml-1" /></>)}
        </button>
      </div>

      {err && (
        <div className="mb-3 px-3 py-2 rounded bg-rose-50 text-rose-700 text-xs flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {err}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-canvas-50 text-[11px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-2 py-2 text-left">Code</th>
              <th className="px-2 py-2 text-left">Name</th>
              <th className="px-2 py-2 text-left">Type</th>
              <th className="px-2 py-2 text-left">Subtype</th>
              <th className="px-2 py-2 text-left">Confidence</th>
              <th className="px-2 py-2 text-left">AI rationale</th>
              <th className="px-2 py-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-canvas-100">
            {preview.accounts.map((row, idx) => (
              <tr key={idx} className={row.is_header ? "bg-canvas-50/50" : ""}>
                <td className="px-2 py-1.5">
                  <input
                    className="input-cell font-mono"
                    value={row.code}
                    onChange={(e) => updateRow(idx, { code: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={`input-cell ${row.is_header ? "font-semibold" : ""}`}
                    value={row.name}
                    onChange={(e) => updateRow(idx, { name: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    className="input-cell"
                    value={row.account_type}
                    onChange={(e) => updateRow(idx, { account_type: e.target.value as AccountType })}
                  >
                    {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  {row.is_header ? (
                    <span className="text-[11px] text-gray-400 italic">(header)</span>
                  ) : (
                    <select
                      className="input-cell"
                      value={row.account_subtype}
                      onChange={(e) => updateRow(idx, { account_subtype: e.target.value })}
                    >
                      <option value="">—</option>
                      {SUBTYPES_BY_TYPE[row.account_type]?.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <ConfidenceBadge value={row.confidence} isHeader={!!row.is_header} />
                </td>
                <td className="px-2 py-1.5 text-gray-500 max-w-md">
                  {row.rationale || "—"}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => removeRow(idx)}
                    className="text-gray-300 hover:text-rose-600"
                    aria-label="Remove row">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .input-cell {
          width: 100%;
          padding: 4px 6px;
          font-size: 12px;
          border: 1px solid transparent;
          border-radius: 4px;
          background: transparent;
        }
        .input-cell:focus {
          border-color: rgb(37 99 235 / 40%);
          background: white;
          outline: none;
        }
      `}</style>
    </div>
  );
}


function ConfidenceBadge({ value, isHeader }: { value: number; isHeader: boolean }) {
  if (isHeader) return <span className="text-[11px] text-gray-400">—</span>;
  const pct = Math.round((value || 0) * 100);
  const tone =
    pct >= 85 ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
    : pct >= 70 ? "bg-sky-50 text-sky-700 ring-sky-100"
    : "bg-amber-50 text-amber-700 ring-amber-100";
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded ring-1 text-[11px] font-medium ${tone}`}>
      {pct}%
    </span>
  );
}


function CommitSummary({ result, onDone }: { result: CommitResp; onDone: () => void }) {
  return (
    <div className="card p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle2 className="w-6 h-6 text-emerald-600" />
        <h2 className="text-base font-semibold text-gray-900">Imported {result.created} accounts</h2>
      </div>

      {result.skipped.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-gray-600 mb-1">Skipped ({result.skipped.length})</p>
          <ul className="text-xs text-gray-500 space-y-0.5">
            {result.skipped.slice(0, 10).map((s, i) => (
              <li key={i}><span className="font-mono">{s.code}</span> — {s.reason}</li>
            ))}
            {result.skipped.length > 10 && <li>…and {result.skipped.length - 10} more</li>}
          </ul>
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded bg-rose-50">
          <p className="text-xs font-medium text-rose-700 mb-1">Errors ({result.errors.length})</p>
          <ul className="text-xs text-rose-600 space-y-0.5">
            {result.errors.slice(0, 10).map((e, i) => (
              <li key={i}><span className="font-mono">{e.code || "?"}</span> — {e.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3 mt-4">
        <Link href="/dashboard/accounts" className="btn-primary">
          See your CoA <ChevronRight className="w-4 h-4 ml-1" />
        </Link>
        <button onClick={onDone} className="btn-ghost">Import another</button>
      </div>
    </div>
  );
}
