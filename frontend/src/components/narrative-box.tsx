"use client";

/* AI-generated executive commentary for a report.
 *
 * Collapsed banner by default ("✨ Get AI commentary"). Click → streams
 * tokens from the local Ollama chat model. "↻ Regenerate" re-requests
 * with whatever the current report params are.
 *
 * Used on Reports page tabs (P&L, BS, CF, TB).
 */
import { useState } from "react";
import { Sparkles, RotateCcw } from "lucide-react";
import { API_BASE } from "@/lib/api";


interface Props {
  reportType: "pnl" | "bs" | "cf" | "tb";
  entityId: string;                  // "" = consolidated
  dateFrom?: string;                 // required for pnl/cf
  dateTo?: string;                   // required for pnl/cf
  asOf?: string;                     // required for bs/tb
  reportingCurrency?: string;
}


export default function NarrativeBox(props: Props) {
  const [streaming, setStreaming] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [backend, setBackend] = useState<{ backend: string; model: string } | null>(null);

  const generate = async () => {
    if (streaming) return;
    setError(null);
    setText("");
    setStreaming(true);

    const body: any = {
      report_type: props.reportType,
      entity: props.entityId ? Number(props.entityId) : null,
      reporting_currency: props.reportingCurrency || null,
    };
    if (props.reportType === "pnl" || props.reportType === "cf") {
      body.date_from = props.dateFrom;
      body.date_to = props.dateTo;
    } else {
      body.as_of = props.asOf;
    }

    try {
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;

      const resp = await fetch(`${API_BASE}/beakon/narrative/`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      if (!resp.ok || !resp.body) {
        const b = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(b?.detail || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let errMsg: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          if (!block.startsWith("data:")) continue;
          let data: any;
          try { data = JSON.parse(block.slice(5).trim()); } catch { continue; }
          if (data.type === "token") {
            acc += data.text || "";
            setText(acc);
          } else if (data.type === "error") {
            errMsg = data.message || "Commentary failed";
          } else if (data.type === "snapshot_built") {
            // First event of every stream — surfaces the active backend
            // ("ollama" / "claude") + model so the helper text below the
            // button stays honest when the env var flips.
            if (data.backend) {
              setBackend({ backend: data.backend, model: data.model || "" });
            }
          }
          // ignore: done — done is implicit when stream closes
        }
      }
      if (errMsg) throw new Error(errMsg);
      setGenerated(true);
    } catch (e: any) {
      setError(e?.message || "Commentary failed");
    } finally {
      setStreaming(false);
    }
  };

  // Idle state collapses to a single inline link so the report stays the
  // focus. Once the user generates / streams / errors, the panel expands.
  const idle = !streaming && !text && !error;

  if (idle) {
    return (
      <div className="mb-3 print:hidden">
        <button
          onClick={generate}
          className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
          title="Generate a 3-4 sentence executive summary"
        >
          <Sparkles className="w-3 h-3" />
          Generate AI commentary
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-b border-gray-200 py-2.5 mb-4 print:hidden">
      <div className="flex items-start gap-2">
        <Sparkles className="w-3.5 h-3.5 text-gray-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              AI commentary
              {backend && (
                <span className="ml-2 font-normal normal-case text-gray-400">
                  · {backend.backend}{backend.model ? ` ${backend.model}` : ""}
                </span>
              )}
            </span>
            {!streaming && text && (
              <button
                onClick={generate}
                className="text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
                title="Regenerate"
              >
                <RotateCcw className="w-3 h-3" /> Regenerate
              </button>
            )}
            {streaming && (
              <span className="text-[11px] text-gray-600 inline-flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse" />
                Generating…
              </span>
            )}
          </div>
          {error && (
            <p className="text-xs text-red-700">
              {error}
            </p>
          )}
          {text && (
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              {text}
              {streaming && (
                <span className="inline-block w-1.5 h-3.5 bg-gray-500 ml-0.5 animate-pulse align-middle" />
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
