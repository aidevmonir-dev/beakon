"use client";

/* Ask Beakon — natural-language Q&A over the current ledger.
 * Streams from the local Ollama text model via SSE. Read-only — no posting,
 * no approvals, no mutations of any kind. Conversation lives in component
 * state only (refresh = blank slate).
 */
import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Trash2 } from "lucide-react";
import { API_BASE } from "@/lib/api";


type Role = "user" | "assistant";
interface Message {
  role: Role;
  content: string;
}


const SUGGESTIONS = [
  "What was our revenue this year?",
  "Which entities have the largest cash balances?",
  "Are any accounts out of balance?",
  "Summarize the recent posted journal entries.",
];


export default function AskBeakon() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamBuf, setStreamBuf] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamBuf, open]);

  const submit = async (text: string) => {
    const question = text.trim();
    if (!question || streaming) return;
    setError(null);
    setPrompt("");

    // History to send (everything BEFORE this question)
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setStreamBuf("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = localStorage.getItem("access_token");
      const orgId = localStorage.getItem("organization_id");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (orgId) headers["X-Organization-ID"] = orgId;

      const resp = await fetch(`${API_BASE}/beakon/ask/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ question, history }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(body?.detail || `HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          if (!block.startsWith("data:")) continue;
          let data: any;
          try { data = JSON.parse(block.slice(5).trim()); }
          catch { continue; }
          if (data.type === "token") {
            acc += data.text || "";
            setStreamBuf(acc);
          } else if (data.type === "error") {
            throw new Error(data.message || "Ask Beakon failed");
          }
          // ignore: context_built, done — done is implicit when stream closes
        }
      }

      setMessages((prev) => [...prev, { role: "assistant", content: acc }]);
      setStreamBuf("");
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // user cancelled — keep what we got so far as the assistant message
        if (streamBuf) {
          setMessages((prev) => [...prev, { role: "assistant", content: streamBuf + " …(stopped)" }]);
        }
      } else {
        setError(e?.message || "Failed");
      }
      setStreamBuf("");
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const clear = () => {
    setMessages([]);
    setStreamBuf("");
    setError(null);
  };

  // ── Collapsed pill (default state) ─────────────────────────────
  if (!open) {
    return (
      <div className="fixed bottom-6 left-0 lg:left-64 right-0 z-20 flex justify-center pointer-events-none px-4">
        <div className="pointer-events-auto">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full bg-white shadow-lg border border-slate-200 pl-3 pr-5 py-2 text-sm text-slate-500 hover:text-slate-700 hover:shadow-xl transition"
          >
            <LogoMark />
            <span>Ask Beakon AI…</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Expanded chat panel ────────────────────────────────────────
  return (
    <div className="fixed bottom-4 left-0 lg:left-64 right-0 lg:right-4 top-20 md:top-24 z-40 flex justify-center pointer-events-none px-3 sm:px-4">
      <div className="pointer-events-auto w-full max-w-[720px] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-brand-50/60 to-white">
          <div className="flex items-center gap-2">
            <LogoMark />
            <div>
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                Ask Beakon AI
                <Sparkles className="w-3.5 h-3.5 text-brand-600" />
              </div>
              <div className="text-[10px] text-slate-400">
                Local Ollama · read-only · nothing leaves your machine
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clear}
                title="Clear conversation"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && !streaming && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                Ask anything about the current ledger snapshot — entities, balances, P&amp;L,
                recent activity. Beakon answers from posted data only.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-3">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="text-left text-xs text-slate-700 bg-slate-50 hover:bg-brand-50 hover:text-brand-800 border border-slate-200 rounded-lg px-3 py-2 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} />
          ))}
          {streaming && (
            <Bubble role="assistant" content={streamBuf} streaming />
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); submit(prompt); }}
          className="border-t border-slate-100 p-3 flex items-center gap-2"
        >
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={streaming}
            placeholder={streaming ? "Generating…" : "Ask anything about your ledger…"}
            autoFocus
            className="flex-1 bg-slate-50 outline-none border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-300 focus:bg-white disabled:opacity-50"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-xl bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 hover:bg-slate-300"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!prompt.trim()}
              className="rounded-xl bg-brand-700 text-white text-sm font-medium px-4 py-2 hover:bg-brand-800 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> Ask
            </button>
          )}
        </form>
      </div>
    </div>
  );
}


function Bubble({
  role, content, streaming,
}: { role: Role; content: string; streaming?: boolean }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-700 text-white text-sm px-3 py-2 whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-slate-100 text-slate-800 text-sm px-3 py-2 whitespace-pre-wrap leading-relaxed">
        {content || <span className="text-slate-400 italic">Thinking…</span>}
        {streaming && content && (
          <span className="inline-block w-1.5 h-3 bg-slate-500 ml-0.5 animate-pulse align-middle" />
        )}
      </div>
    </div>
  );
}


function LogoMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <clipPath id="ask-beakon-tile-clip">
          <rect x="0" y="0" width="48" height="48" rx="11" />
        </clipPath>
      </defs>
      <g clipPath="url(#ask-beakon-tile-clip)">
        <rect x="0" y="0" width="48" height="48" rx="11" fill="#234f60" />
        <circle cx="44" cy="4" r="13" fill="#3aa888" />
      </g>
      <text
        x="13"
        y="36"
        fontFamily='system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", sans-serif'
        fontSize="31"
        fontWeight="800"
        letterSpacing="-1"
        fill="#ffffff"
      >
        B
      </text>
    </svg>
  );
}
