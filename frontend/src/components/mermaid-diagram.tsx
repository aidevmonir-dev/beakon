"use client";

/* MermaidDiagram — render a Mermaid source string to inline SVG.
 *
 * Each <MermaidDiagram /> instance renders independently; the underlying
 * library is loaded once. Failures (malformed syntax) display a small
 * red error message rather than throwing, so the surrounding page stays
 * usable while the operator edits the source. */
import { useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "default",
        flowchart: {
          curve: "basis",
          padding: 12,
          nodeSpacing: 40,
          rankSpacing: 50,
          useMaxWidth: true,
        },
        themeVariables: {
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: "13px",
        },
        securityLevel: "loose",
      });
      return m.default;
    });
  }
  return mermaidPromise;
}


interface Props {
  /** Mermaid source string. */
  source: string;
  /** Stable id used for the rendered SVG; one diagram per page is fine. */
  id?: string;
  /** Extra wrapper className. */
  className?: string;
}

let renderCounter = 0;

export function MermaidDiagram({ source, id, className }: Props) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadMermaid().then(async (mermaid) => {
      const renderId = id || `mermaid-${++renderCounter}-${Date.now()}`;
      try {
        // Mermaid validates by attempting to parse; render returns { svg, ... }.
        const { svg: out } = await mermaid.render(renderId, source);
        if (!cancelled) setSvg(out);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : String(e);
        setError(msg);
        setSvg("");
        // Mermaid leaves an injected <div id="d<renderId>"> behind on parse
        // error in some versions; clean it up.
        document.getElementById(`d${renderId}`)?.remove();
      }
    });
    return () => { cancelled = true; };
  }, [source, id]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 font-mono whitespace-pre-wrap">
        Mermaid parse error:
        {"\n"}
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
