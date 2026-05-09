"""Render a markdown file to a self-contained printable HTML next to it.

Usage:
    python scripts/_render_md_to_html.py docs/thomas-demo-playbook.md
    python scripts/_render_md_to_html.py docs/database-relationships.md

Outputs `<input>.html` in the same directory. Hit Ctrl+P in any browser
to save as PDF — the embedded print CSS keeps tables intact across pages.

Handles the markdown subset used in our internal docs: # / ## / ### / ####
headings, paragraphs, blockquotes (> ), GFM tables (| col | col |), code
spans (`x`), bold (**x**), italic (_x_), horizontal rules (---), and
fenced code blocks (```).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _render_inline(s: str) -> str:
    """Inline transforms preserving existing HTML entities."""
    # `code` spans
    s = re.sub(r"`([^`]+)`", lambda m: f"<code>{_esc(m.group(1))}</code>", s)
    # **bold**
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    # _italic_  (only when surrounded by spaces or punctuation to avoid file_paths)
    s = re.sub(r"(^|[\s(])_([^_]+)_(?=[\s.,)]|$)",
               r"\1<em>\2</em>", s)
    return s


def render_html(md: str, title: str = "Document") -> str:
    """Convert markdown text into a self-contained printable HTML page."""
    lines = md.split("\n")
    body: list[str] = []
    i = 0
    in_code_block = False
    code_buf: list[str] = []
    code_lang = ""

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Fenced code block
        if stripped.startswith("```"):
            if in_code_block:
                body.append(
                    f'<pre><code class="lang-{code_lang}">'
                    + _esc("\n".join(code_buf))
                    + "</code></pre>"
                )
                code_buf = []
                code_lang = ""
                in_code_block = False
            else:
                in_code_block = True
                code_lang = stripped[3:].strip() or "text"
            i += 1
            continue
        if in_code_block:
            code_buf.append(line)
            i += 1
            continue

        # Horizontal rule
        if stripped == "---":
            body.append("<hr>")
            i += 1
            continue

        # Headings
        if stripped.startswith("#### "):
            body.append(f"<h4>{_render_inline(stripped[5:])}</h4>")
            i += 1
            continue
        if stripped.startswith("### "):
            body.append(f"<h3>{_render_inline(stripped[4:])}</h3>")
            i += 1
            continue
        if stripped.startswith("## "):
            body.append(f"<h2>{_render_inline(stripped[3:])}</h2>")
            i += 1
            continue
        if stripped.startswith("# "):
            body.append(f"<h1>{_render_inline(stripped[2:])}</h1>")
            i += 1
            continue

        # Blockquote (multi-line — group consecutive `> ` lines)
        if stripped.startswith("> "):
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith("> "):
                quote_lines.append(lines[i].strip()[2:])
                i += 1
            body.append(
                "<blockquote>"
                + "<br>".join(_render_inline(q) for q in quote_lines)
                + "</blockquote>"
            )
            continue

        # GFM tables: `|...|` row followed by separator row of dashes/pipes/colons
        if (stripped.startswith("|") and i + 1 < len(lines)
                and re.fullmatch(r"\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?",
                                 lines[i + 1].strip())):
            headers = [c.strip() for c in stripped.strip("|").split("|")]
            body.append("<table>")
            body.append("  <thead><tr>" + "".join(
                f"<th>{_render_inline(h)}</th>" for h in headers
            ) + "</tr></thead>")
            body.append("  <tbody>")
            i += 2  # skip separator
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                body.append("    <tr>" + "".join(
                    f"<td>{_render_inline(c)}</td>" for c in cells
                ) + "</tr>")
                i += 1
            body.append("  </tbody></table>")
            continue

        # Empty line
        if not stripped:
            i += 1
            continue

        # Bullet list (`- item` or `* item`)
        if re.match(r"^[\-\*]\s+", stripped):
            items = []
            while i < len(lines) and re.match(r"^[\-\*]\s+", lines[i].strip()):
                items.append(re.sub(r"^[\-\*]\s+", "", lines[i].strip()))
                i += 1
            body.append("<ul>" + "".join(
                f"<li>{_render_inline(it)}</li>" for it in items
            ) + "</ul>")
            continue

        # Plain paragraph (collect consecutive non-blank lines)
        paragraph_lines = [stripped]
        i += 1
        while (i < len(lines) and lines[i].strip()
               and not lines[i].strip().startswith(("#", ">", "|", "```", "- ", "* ", "---"))):
            paragraph_lines.append(lines[i].strip())
            i += 1
        body.append(
            "<p>" + " ".join(_render_inline(p) for p in paragraph_lines) + "</p>"
        )

    inner = "\n".join(body)
    css = """
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { font: 13px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
               color: #1f2937; background: #fff; max-width: 1080px;
               margin: 28px auto; padding: 0 24px; }
        h1 { font-size: 26px; margin: 0 0 8px; letter-spacing: -0.01em; }
        h2 { font-size: 20px; margin: 32px 0 12px;
             padding-bottom: 6px; border-bottom: 2px solid #0f172a;
             color: #0f172a; }
        h3 { font-size: 15px; margin: 22px 0 6px; color: #1d4ed8; }
        h4 { font-size: 13px; margin: 16px 0 4px; color: #334155;
             text-transform: uppercase; letter-spacing: 0.04em; }
        p  { margin: 6px 0; }
        ul { margin: 4px 0; padding-left: 22px; }
        li { margin: 2px 0; }
        blockquote { margin: 8px 0; padding: 8px 14px;
                     background: #f0f9ff; border-left: 3px solid #0ea5e9;
                     color: #0c4a6e; font-style: italic; font-size: 12.5px; }
        code { font: 12px ui-monospace, "SF Mono", "Cascadia Code", monospace;
               background: #f1f5f9; padding: 1px 6px; border-radius: 4px;
               color: #0f172a; }
        pre { background: #0f172a; color: #f8fafc; padding: 12px 16px;
              border-radius: 6px; overflow-x: auto; font-size: 12px;
              line-height: 1.45; }
        pre code { background: transparent; padding: 0; color: inherit; }
        h3 code { background: transparent; padding: 0; color: #1d4ed8;
                  font-weight: 600; }
        table { border-collapse: collapse; width: 100%; margin: 8px 0 18px;
                font-size: 12.5px; }
        th, td { border: 1px solid #e5e7eb; padding: 6px 9px; text-align: left;
                 vertical-align: top; }
        th { background: #f8fafc; font-weight: 600; color: #334155;
             font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
        td code { font-size: 11.5px; }
        hr { border: 0; border-top: 1px solid #e5e7eb; margin: 32px 0; }
        em { color: #6366f1; font-style: italic; }
        strong { color: #0f172a; }

        @media print {
          body { margin: 0; padding: 12mm 14mm; max-width: none; }
          h2 { break-before: auto; break-after: avoid; }
          h3, h4 { break-after: avoid; }
          table, pre, blockquote { break-inside: avoid; }
          tr { break-inside: avoid; }
          a { color: inherit; text-decoration: none; }
        }
    """
    return f"""<!doctype html>
<html lang=\"en\">
<head>
<meta charset=\"utf-8\">
<title>{_esc(title)}</title>
<style>{css}</style>
</head>
<body>
{inner}
</body>
</html>
"""


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/_render_md_to_html.py <input.md>")
        sys.exit(2)
    src = Path(sys.argv[1]).resolve()
    if not src.exists():
        print(f"File not found: {src}")
        sys.exit(1)
    md = src.read_text(encoding="utf-8")
    title = "Beakon — " + src.stem.replace("-", " ").title()
    html = render_html(md, title=title)
    dst = src.with_suffix(".html")
    dst.write_text(html, encoding="utf-8")
    print(f"Wrote {dst} ({dst.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
