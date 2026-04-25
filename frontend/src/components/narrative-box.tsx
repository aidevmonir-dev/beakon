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
          }
          // ignore: snapshot_built, done
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

  return (
    <div className="rounded-lg border border-brand-200 bg-gradient-to-r from-brand-50/70 to-white p-3 mb-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          <Sparkles className="w-4 h-4 text-brand-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-brand-900 uppercase tracking-wider">
              AI commentary
            </span>
            {!streaming && !text && (
              <button
                onClick={generate}
                className="text-xs bg-brand-700 text-white px-3 py-1 rounded-full hover:bg-brand-800 font-medium inline-flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" /> Get AI commentary
              </button>
            )}
            {!streaming && text && (
              <button
                onClick={generate}
                className="text-xs text-brand-700 hover:text-brand-900 font-medium inline-flex items-center gap-1"
                title="Regenerate"
              >
                <RotateCcw className="w-3 h-3" /> Regenerate
              </button>
            )}
            {streaming && (
              <span className="text-xs text-brand-700 inline-flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />
                Generating…
              </span>
            )}
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </p>
          )}
          {text && (
            <p className="mt-2 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
              {text}
              {streaming && (
                <span className="inline-block w-1.5 h-3.5 bg-slate-500 ml-0.5 animate-pulse align-middle" />
              )}
            </p>
          )}
          {!text && !streaming && !error && (
            <p className="mt-1 text-xs text-slate-500">
              Local Ollama will read the report and write a 3-4 sentence executive summary.
              Nothing leaves your machine.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
