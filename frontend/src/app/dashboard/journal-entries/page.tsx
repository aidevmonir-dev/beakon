"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileText, Search, Sparkles, X } from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { fmt2, fmtDate, fmtLabel } from "@/lib/format";


interface EntityOpt { id: number; code: string; name: string; functional_currency: string; }


const STATUSES = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending Approval" },
  { key: "approved", label: "Approved" },
  { key: "posted", label: "Posted" },
  { key: "rejected", label: "Rejected" },
  { key: "reversed", label: "Reversed" },
];

function statusBadge(status: string) {
  switch (status) {
    case "posted": return "badge-green";
    case "approved": return "badge-blue";
    case "pending_approval": return "badge-yellow";
    case "rejected": return "badge-red";
    case "reversed": return "badge-gray";
    default: return "badge-gray";
  }
}


interface JESummary {
  id: number;
  entry_number: string;
  entity_code: string;
  entity_name: string;
  date: string;
  status: string;
  source_type: string;
  source_ref: string;
  memo: string;
  // /beakon/reports/journal-listing/ returns the value as `total`.
  total: string;
  currency: string;
  functional_currency: string;
  period: string | null;
}


export default function JournalEntriesPage() {
  const search = useSearchParams();
  const [entries, setEntries] = useState<JESummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(search.get("status") ?? "");
  const [q, setQ] = useState("");
  const [billModal, setBillModal] = useState(false);

  useEffect(() => {
    const params: Record<string, string> = { limit: "500" };
    if (status) params.status = status;
    api.get<{ entries: JESummary[] }>("/beakon/reports/journal-listing/", params)
      .then((d) => { setEntries(d.entries || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [status]);

  const visible = useMemo(() => entries.filter((e) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      e.entry_number.toLowerCase().includes(s) ||
      e.memo?.toLowerCase().includes(s) ||
      e.entity_code.toLowerCase().includes(s) ||
      e.source_ref?.toLowerCase().includes(s)
    );
  }), [entries, q]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Journal Entries</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Every transaction in the ledger. Every write goes through the approval state machine.
          </p>
        </div>
        <button onClick={() => setBillModal(true)} className="btn-primary">
          <Sparkles className="w-4 h-4 mr-1.5" /> Upload Bill (AI)
        </button>
      </div>
      {billModal && (
        <UploadBillModal onClose={() => setBillModal(false)} />
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9"
                   placeholder="Search by entry #, entity, memo…"
                   value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatus(s.key)}
                className={
                  "px-2.5 py-1 rounded-full border transition-colors " +
                  (status === s.key
                    ? "bg-brand-50 border-brand-200 text-brand-800"
                    : "bg-white border-canvas-200 text-gray-600 hover:bg-canvas-50")
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No entries match your filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                  <th className="pb-2 pr-4 font-medium">Entry #</th>
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 pr-4 font-medium">Memo</th>
                  <th className="pb-2 pl-4 font-medium text-right">Total</th>
                  <th className="pb-2 pl-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-100">
                {visible.map((e) => (
                  <tr key={e.id} className="hover:bg-canvas-50">
                    <td className="py-2.5 pr-4 font-mono text-xs">
                      <Link href={`/dashboard/journal-entries/${e.id}`}
                            className="text-brand-700 hover:underline">
                        {e.entry_number}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-700 font-mono">{e.entity_code}</td>
                    <td className="py-2.5 pr-4 text-xs text-gray-500 whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td className="py-2.5 pr-4 text-xs text-gray-500">{fmtLabel(e.source_type)}</td>
                    <td className="py-2.5 pr-4 text-sm text-gray-800 max-w-sm truncate">{e.memo || "—"}</td>
                    <td className="py-2.5 pl-4 text-right text-gray-900 font-mono text-xs tabular-nums whitespace-nowrap">
                      {fmt2(e.total)} <span className="text-gray-400">{e.functional_currency}</span>
                    </td>
                    <td className="py-2.5 pl-4">
                      <span className={statusBadge(e.status)}>{fmtLabel(e.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


function UploadBillModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [entities, setEntities] = useState<EntityOpt[]>([]);
  const [entityId, setEntityId] = useState("");
  const [paymentVia, setPaymentVia] = useState<"ap" | "cash">("ap");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Progress state — driven by an interval since we can't see backend phase.
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState("");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    api.get<{ results: EntityOpt[] } | EntityOpt[]>("/beakon/entities/")
      .then((d) => {
        const list = Array.isArray(d) ? d : (d.results ?? []);
        setEntities(list);
        if (list.length && !entityId) setEntityId(String(list[0].id));
      })
      .catch(() => setEntities([]));
  }, []);

  // Vision models are slower than text — bump estimate when uploading an image
  const isImage = file?.type?.startsWith("image/");
  const estimatedSeconds = isImage ? 90 : 45;

  // Estimated total LLM tokens for the response — used to translate token
  // count events into a percent. JSON extraction responses cluster
  // around 200-400 tokens; 350 puts the bar near 90% by the time the
  // model finishes. Adjust if you swap models.
  const ESTIMATED_TOKENS = 350;

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!file || !entityId) return;
    setBusy(true);
    setErr(null);
    setPct(1);
    setPhase("Uploading file…");
    setElapsed(0);

    const startedAt = Date.now();
    // Lightweight tick just to update the elapsed-seconds counter. The
    // bar itself is driven by real backend events, not this timer.
    const tick = setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 200);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entity", entityId);
      fd.append("payment_via", paymentVia);
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;
      const resp = await fetch(
        `${API_BASE}/beakon/ocr/draft-from-bill-stream/`,
        { method: "POST", headers, body: fd },
      );
      if (!resp.ok || !resp.body) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body?.error?.message || body?.detail || `HTTP ${resp.status}`);
      }

      // ── Read SSE stream ──────────────────────────────────────────
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastPhasePct = 12;  // tracks where the last 'phase' event placed us
      let doneEvent: any = null;
      let errEvent: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events end with a blank line (\n\n)
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";  // last chunk may be incomplete
        for (const block of events) {
          if (!block.startsWith("data:")) continue;
          let data: any;
          try { data = JSON.parse(block.slice(5).trim()); }
          catch { continue; }

          if (data.type === "phase") {
            lastPhasePct = data.pct ?? lastPhasePct;
            setPct(lastPhasePct);
            setPhase(data.phase);
          } else if (data.type === "token") {
            // Token events fire during the LLM call. Map count → percent
            // between the "model started" phase pct (lastPhasePct, ~12)
            // and 92% (cap; we leave room for the JE creation step).
            const fraction = Math.min(1, data.n / ESTIMATED_TOKENS);
            const target = lastPhasePct + (92 - lastPhasePct) * fraction;
            setPct(target);
            setPhase(`Model generating (${data.n} tokens)…`);
          } else if (data.type === "done") {
            doneEvent = data;
          } else if (data.type === "error") {
            errEvent = data;
          }
        }
      }

      if (errEvent) {
        throw new Error(errEvent.message || "Extraction failed");
      }
      if (!doneEvent) {
        throw new Error("Stream closed without a result.");
      }
      setPct(100);
      setPhase(`Done — opening ${doneEvent.entry_number}…`);
      await new Promise((r) => setTimeout(r, 250));
      router.push(`/dashboard/journal-entries/${doneEvent.entry_id}`);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
      setPct(0);
      setPhase("");
    } finally {
      clearInterval(tick);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full sm:w-[460px] bg-white border-l border-canvas-200 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-canvas-100">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-600" /> Upload Bill (AI-drafted)
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Upload a vendor bill or receipt (PDF or image). A local AI model
            extracts the vendor, amount, date, and suggests an expense
            account. The bill is saved as a <strong>draft journal entry</strong>{" "}
            with the file attached — you review and approve before posting.
            Nothing is sent off your machine.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Entity *</span>
            <select className="input mt-1" value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Payment status *</span>
            <select className="input mt-1" value={paymentVia}
                    onChange={(e) => setPaymentVia(e.target.value as "ap" | "cash")}>
              <option value="ap">Bill — to be paid later (CR Accounts Payable)</option>
              <option value="cash">Already paid (CR Cash / Bank)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">File *</span>
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp"
                   className="input mt-1"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="text-[10px] text-gray-400 mt-0.5 block">
              PDFs with embedded text use a text model (works with any Ollama
              text model). Images / scanned PDFs need a vision model
              (e.g. <code>ollama pull llama3.2-vision:11b</code>).
            </span>
          </label>
          {busy && (
            <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-brand-800">
                <span className="font-medium">{phase}</span>
                <span className="font-mono tabular-nums">{Math.round(pct)}%</span>
              </div>
              <div className="h-2 rounded-full bg-brand-100 overflow-hidden">
                <div
                  className="h-full bg-brand-600 transition-[width] duration-200 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-[10px] text-brand-700/70 flex justify-between">
                <span>Live progress from local Ollama · nothing leaves your machine</span>
                <span className="tabular-nums">{elapsed.toFixed(1)}s elapsed</span>
              </div>
            </div>
          )}
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 whitespace-pre-wrap break-words">
              {err}
            </div>
          )}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !file || !entityId} className="btn-primary">
              {busy ? "Processing…" : "Extract & Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
