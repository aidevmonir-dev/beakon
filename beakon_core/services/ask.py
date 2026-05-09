"""AskBeakonService — natural-language Q&A over the current ledger state.

Blueprint constraint (p.2): "AI may read documents, draft journal entries,
suggest classifications, generate explanations and reporting commentary."
This service is the **read + explain** path. It NEVER mutates the ledger.

Architecture for v1:
    Build a compact markdown snapshot of the current financial state for the
    organization (entities, trial balance, YTD P&L). Stuff that snapshot into
    the system prompt. Ollama answers from that context. Stream tokens back.

Why not RAG / function-calling for v1?
    - RAG (embed every JE) is overkill for a few hundred journals.
    - Ollama function-calling support varies by model. Keep it simple.
    - The snapshot is small enough (~2 KB) to fit in any model's context.
    - When questions need finer drill-down ("what's in account 4000 in March?"),
      the answer is "look at the account ledger page". v2 can add tools.
"""
from __future__ import annotations

import json
import re
from datetime import date as dt_date
from decimal import Decimal
from typing import Iterator, Optional

import requests
from django.conf import settings

from organizations.models import Organization

from ..models import Entity, JournalEntry
from .reports import ReportsService


# Last N JE history turns sent back to the model — keeps prompt bounded.
MAX_HISTORY_TURNS = 8
# How many TB rows to include per entity. Top-by-magnitude.
MAX_TB_ROWS_PER_ENTITY = 25
# Recent posted JEs to include for activity context.
MAX_RECENT_JES = 8


def build_financial_context(
    organization: Organization,
    entity: Optional[Entity] = None,
    *,
    as_of: Optional[dt_date] = None,
) -> str:
    """Render a markdown snapshot of the current financial state.

    If ``entity`` is given, the snapshot focuses on that entity.
    Otherwise it includes all active entities (consolidated where useful).
    """
    today = as_of or dt_date.today()
    year_start = dt_date(today.year, 1, 1)
    parts: list[str] = ["# Current Beakon ledger snapshot", f"_As of {today}._", ""]

    # ── Entities overview ────────────────────────────────────────────
    ents = list(Entity.objects.filter(organization=organization, is_active=True).order_by("code"))
    parts.append(f"## Entities ({len(ents)})")
    for e in ents:
        parts.append(
            f"- **{e.code}** — {e.name} · {e.entity_type} · "
            f"functional={e.functional_currency} · country={e.country}"
            + (f" · parent={e.parent.code}" if e.parent_id else "")
        )
    parts.append("")

    # ── Per-entity reports ───────────────────────────────────────────
    target_entities = [entity] if entity else ents
    for ent in target_entities:
        parts.append(f"## {ent.code} — {ent.name}")
        parts.append(f"_Functional currency: {ent.functional_currency}_")

        # Trial balance
        try:
            tb = ReportsService.trial_balance(entity=ent, as_of=today)
            tot = tb["totals"]
            parts.append(
                f"### Trial Balance ({tb['reporting_currency']})"
                f" — total DR {tot['total_debits']} / CR {tot['total_credits']}"
                f" {'· balanced' if tot['is_balanced'] else '· OUT OF BALANCE'}"
            )
            # Sort by absolute net for relevance
            sorted_accs = sorted(
                tb["accounts"],
                key=lambda a: abs(Decimal(a.get("net", "0"))),
                reverse=True,
            )[:MAX_TB_ROWS_PER_ENTITY]
            for a in sorted_accs:
                parts.append(
                    f"- `{a['code']}` {a['name']} ({a['account_type']}): "
                    f"DR {a['debit']} / CR {a['credit']} (net {a['net']})"
                )
            if len(tb["accounts"]) > MAX_TB_ROWS_PER_ENTITY:
                parts.append(f"  …and {len(tb['accounts']) - MAX_TB_ROWS_PER_ENTITY} more accounts.")
        except Exception as e:
            parts.append(f"_(trial balance unavailable: {e})_")

        # YTD P&L
        try:
            pnl = ReportsService.profit_loss(
                entity=ent, date_from=year_start, date_to=today,
            )
            rev = Decimal(pnl["revenue"]["total"])
            cogs = Decimal(pnl["cogs"]["total"])
            gross = Decimal(pnl["gross_profit"])
            opex = Decimal(pnl["operating_expenses"]["total"])
            opinc = Decimal(pnl["operating_income"])
            other_in = Decimal(pnl["other_income"]["total"])
            other_ex = Decimal(pnl["other_expenses"]["total"])
            net = Decimal(pnl["net_income"])
            ccy = pnl["reporting_currency"]

            parts.append(f"### YTD P&L ({ccy}, {year_start} to {today})")
            parts.append(
                "Bucket totals (each value already includes every account in that bucket — "
                "DO NOT add the buckets together, the totals below already do that):"
            )
            parts.append(f"- Operating revenue total = {pnl['revenue']['total']} {ccy}")
            parts.append(f"- COGS total = {pnl['cogs']['total']} {ccy}")
            parts.append(f"- **Gross profit (revenue − COGS) = {pnl['gross_profit']} {ccy}**")
            parts.append(f"- Operating expenses total = {pnl['operating_expenses']['total']} {ccy}")
            parts.append(f"- **Operating income (gross profit − opex) = {pnl['operating_income']} {ccy}**")
            parts.append(f"- Other income total = {pnl['other_income']['total']} {ccy}")
            parts.append(f"- Other expenses total = {pnl['other_expenses']['total']} {ccy}")
            parts.append(f"- **Net income (operating income + other income − other expenses) = {pnl['net_income']} {ccy}**")

            # Pre-computed margins so the model never has to divide.
            def _pct(num, den):
                if den == 0:
                    return "n/a (revenue is zero)"
                return f"{(num / den * 100).quantize(Decimal('0.01'))}%"
            parts.append("")
            parts.append("Pre-computed ratios (use these verbatim; do not recompute):")
            parts.append(f"- Gross margin = gross profit / revenue = {_pct(gross, rev)}")
            parts.append(f"- Operating margin = operating income / revenue = {_pct(opinc, rev)}")
            parts.append(f"- Net profit margin = net income / revenue = {_pct(net, rev)}")

            # Per-account breakdown — small enough to fit; lets the model
            # answer "what's in revenue?" without inventing line items.
            for label, key in (
                ("Revenue accounts", "revenue"),
                ("COGS accounts", "cogs"),
                ("Operating expense accounts", "operating_expenses"),
                ("Other income accounts", "other_income"),
                ("Other expense accounts", "other_expenses"),
            ):
                accs = pnl[key]["accounts"]
                if not accs:
                    continue
                parts.append(f"\n{label}:")
                for a in accs[:10]:
                    parts.append(f"  - `{a['code']}` {a['name']}: {a['amount']} {ccy}")
                if len(accs) > 10:
                    parts.append(f"  - …and {len(accs) - 10} more accounts in this bucket.")
        except Exception as e:
            parts.append(f"_(P&L unavailable: {e})_")

        parts.append("")

    # ── Recent activity (org-wide) ──────────────────────────────────
    recent = (
        JournalEntry.objects
        .filter(organization=organization, status="posted")
        .select_related("entity")
        .order_by("-posted_at")[:MAX_RECENT_JES]
    )
    if recent:
        parts.append(f"## Recent posted entries (last {len(recent)})")
        for je in recent:
            parts.append(
                f"- {je.entry_number} · {je.entity.code} · {je.date} · "
                f"{je.total_debit_functional} {je.entity.functional_currency} · "
                f"{(je.memo or je.source_ref or '')[:80]}"
            )

    return "\n".join(parts)


SYSTEM_PROMPT_TEMPLATE = """You are Beakon AI, a finance copilot for family offices and \
multi-entity groups.

# Who you're talking to
{user_block}

# Hard rules

1. **Read-only.** NEVER claim to have made a posting, an approval, or any change to the ledger. \
If asked to post or approve, say you can only suggest — direct them to the UI.

2. **Quote, do not compute.** The snapshot already contains every total, subtotal, and ratio you need. \
- If a number is not literally in the snapshot, the answer is "I don't have that figure in the current snapshot — please check [the relevant page]."
- DO NOT add bucket totals together. Each "total" in the snapshot already includes its sub-accounts.
- DO NOT divide numbers to compute margins. Use the pre-computed ratios labelled "Pre-computed ratios".
- DO NOT invent sub-account names or breakdowns. Per-account lists are in the snapshot — quote them only if they exist.

3. **Currency discipline.** Always cite numbers with the currency code shown in the snapshot. Never convert across currencies (the snapshot is per-entity in functional currency).

4. **Honest scope.** If asked about taxation, payroll, compliance, multi-currency consolidation, or anything not in the snapshot — say "Beakon's [X] module is not built yet" or "that data is on the [Y] page". Do not make up numbers.

5. **Be terse.** Bullet lists welcome. Skip preamble. No re-explaining what the user asked.

# Where to find things in Beakon (use this map for "where can I see X?" questions)

| Question type | Where to point them |
|---|---|
| Trial Balance, P&L, Balance Sheet, Cash Flow | **Reports** (sidebar) — Trial Balance is the default tab |
| AP Aging (outstanding bills by age) | **Reports → AP Aging** tab |
| AR Aging (outstanding invoices by age) | **Reports → AR Aging** tab |
| Account ledger (lines per account) | **Reports → Trial Balance** → click any account row |
| Vendor bills (lifecycle) | **Bills (AP)** in sidebar |
| Customer invoices (lifecycle) | **Invoices (AR)** in sidebar |
| Anything needing human sign-off | **Approvals** in sidebar |
| Issues Beakon spotted automatically | **Anomalies** in sidebar |
| Bank transactions, CSV import, categorize | **Bank Feed** in sidebar → click an account |
| Chart of accounts | **Chart of Accounts** in sidebar |
| Companies, trusts, individuals (the org structure) | **Entities** in sidebar |
| Vendor master records | **Vendors** in sidebar |
| Customer master records | **Customers** in sidebar |
| Open / soft-close / closed periods + FX revaluation | **Periods** in sidebar |
| FX rates table (add / view) | **FX Rates** in sidebar |
| Intercompany groups + balance check | **Intercompany** in sidebar |
| Approval / posting / reversal history per JE | Open the journal entry → right panel |
| Source documents attached to a JE | Open the journal entry → Attachments section |
| Audit log (every system + AI action) | **Audit Log** in sidebar |
| Upload a vendor bill (AI OCR) | **Journal Entries** → top-right "Upload Bill (AI)" button |
| Get AI suggestion for a bank transaction | **Bank Feed → Categorize → ✨ Get AI suggestion** |
| AI executive commentary on any report | Open the report → "✨ Get AI commentary" button at top |

When the user asks "where", quote one matching row from this table verbatim. Don't invent paths that aren't in the table.

# Snapshot
{context}
"""


def _build_user_block(user, organization) -> str:
    """Render a short 'who am I talking to' block for the system prompt.
    The model uses this to greet by name and tailor pronouns."""
    if user is None or not getattr(user, "is_authenticated", False):
        return f"You are speaking with an unauthenticated viewer at {organization.name}."
    full_name = (
        f"{getattr(user, 'first_name', '') or ''} "
        f"{getattr(user, 'last_name', '') or ''}"
    ).strip()
    display = full_name or getattr(user, "email", None) or "the user"
    org = getattr(organization, "name", "their organization")
    first_name = (getattr(user, "first_name", "") or "").strip()
    greet_name = first_name or display
    parts = [
        f"You are speaking with **{display}**.",
        f"Their organization is **{org}**.",
    ]
    if full_name and getattr(user, "email", None):
        parts.append(f"Their login email is {user.email}.")
    parts.append("")
    parts.append("**Greeting protocol** — follow EXACTLY when the user's message is "
                 "a greeting only (Hi / Hello / Hey / Good morning / etc., with no question):")
    parts.append(f'  Reply: "Hi {greet_name} — how can I help with your books today?"')
    parts.append("  Then stop. Do NOT add bullet points, summaries, or unsolicited info.")
    parts.append(f"For any other message, address them by first name ({greet_name}) at "
                 "least once when natural, but focus on the actual question.")
    return "\n".join(parts)


class AskBeakonService:
    build_financial_context = staticmethod(build_financial_context)

    @staticmethod
    def stream_answer(
        *,
        organization: Organization,
        entity: Optional[Entity],
        question: str,
        history: list[dict],
        user=None,
    ) -> Iterator[dict]:
        return _stream_answer(
            organization=organization, entity=entity,
            question=question, history=history, user=user,
        )


def _stream_answer(
    *,
    organization: Organization,
    entity: Optional[Entity],
    question: str,
    history: list[dict],
    user=None,
) -> Iterator[dict]:
    """Stream tokens for a chat-style answer.

    Dispatches to the configured backend (``ASK_BACKEND`` setting):
        "ollama" → local Ollama (privacy-first default)
        "claude" → Anthropic API (faster, smarter; chat leaves machine)

    Yields:
        {"type": "context_built", "ctx_chars": int}
        {"type": "token", "text": str}
        {"type": "done", "full": str}
        {"type": "error", "message": str}
    """
    context = build_financial_context(organization, entity)
    backend = (getattr(settings, "ASK_BACKEND", "ollama") or "ollama").lower()
    if backend == "claude":
        model = getattr(settings, "CLAUDE_ASK_MODEL", "claude-haiku-4-5")
    else:
        model = getattr(settings, "OLLAMA_CHAT_MODEL", "")
    yield {
        "type": "context_built",
        "ctx_chars": len(context),
        "backend": backend,
        "model": model,
    }

    user_block = _build_user_block(user, organization)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        user_block=user_block, context=context,
    )

    # Trim history to last N turns (each turn = user + assistant pair = 2 items)
    trimmed = (history or [])[-(MAX_HISTORY_TURNS * 2):]
    chat_history: list[dict] = []
    for h in trimmed:
        role = h.get("role")
        content = (h.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            chat_history.append({"role": role, "content": content})

    if backend == "claude":
        yield from _stream_claude(system_prompt, chat_history, question)
    else:
        yield from _stream_ollama(system_prompt, chat_history, question)


def _stream_ollama(
    system_prompt: str, chat_history: list[dict], question: str,
) -> Iterator[dict]:
    """Local-Ollama path. Streams via /api/chat with `stream=True`."""
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    messages.extend(chat_history)
    messages.append({"role": "user", "content": question})

    url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
    chat_model = settings.OLLAMA_CHAT_MODEL
    payload = {
        "model": chat_model,
        "messages": messages,
        "stream": True,
        "keep_alive": "30m",
        "options": {
            "temperature": 0.3,
            "num_predict": 800,
            # 8K context — snapshot + a few turns of chat fits comfortably.
            "num_ctx": 8192,
        },
    }
    try:
        resp = requests.post(
            url, json=payload, stream=True,
            timeout=settings.OLLAMA_CHAT_TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        yield {"type": "error", "message": f"Could not reach Ollama: {e}"}
        return

    if resp.status_code == 404:
        yield {"type": "error",
               "message": f"Model '{chat_model}' not pulled. "
                          f"Run: ollama pull {chat_model}"}
        return
    if resp.status_code != 200:
        yield {"type": "error",
               "message": f"Ollama returned {resp.status_code}: {resp.text[:200]}"}
        return

    full = ""
    try:
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                chunk = json.loads(line)
            except json.JSONDecodeError:
                continue
            content = chunk.get("message", {}).get("content", "")
            if content:
                full += content
                yield {"type": "token", "text": content}
            if chunk.get("done"):
                break
    finally:
        resp.close()

    yield {"type": "done", "full": full}


def _stream_claude(
    system_prompt: str, chat_history: list[dict], question: str,
) -> Iterator[dict]:
    """Anthropic path. Uses messages.stream() so token-deltas arrive
    in the same shape as the Ollama path (UI doesn't have to know).
    """
    try:
        import anthropic
    except ImportError:
        yield {"type": "error",
               "message": "anthropic SDK is not installed; "
                          "set ASK_BACKEND=ollama or pip install anthropic."}
        return
    api_key = settings.ANTHROPIC_API_KEY or None
    if not api_key:
        yield {"type": "error",
               "message": "ANTHROPIC_API_KEY is not configured "
                          "(needed when ASK_BACKEND=claude)."}
        return

    # Anthropic takes `system` separately and message roles only ever
    # alternate user/assistant — we already filtered the history to those
    # two roles, so it's safe to forward verbatim.
    messages = list(chat_history) + [{"role": "user", "content": question}]
    model = getattr(settings, "CLAUDE_ASK_MODEL", "claude-haiku-4-5")

    from .anthropic_throttle import claude_throttle

    client = anthropic.Anthropic(api_key=api_key)
    claude_throttle()
    full = ""
    try:
        with client.messages.stream(
            model=model,
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
        ) as stream:
            for delta in stream.text_stream:
                if not delta:
                    continue
                full += delta
                yield {"type": "token", "text": delta}
    except anthropic.AuthenticationError:
        yield {"type": "error",
               "message": "ANTHROPIC_API_KEY is invalid or revoked."}
        return
    except anthropic.RateLimitError as e:
        try:
            retry_after = int(e.response.headers.get("retry-after", "0")) or None
        except (AttributeError, ValueError, TypeError):
            retry_after = None
        wait_msg = (f"Try again in ~{retry_after}s."
                    if retry_after else "Try again shortly.")
        yield {"type": "error",
               "message": f"Claude rate limit reached (5/min per org). {wait_msg}"}
        return
    except anthropic.APIError as e:
        yield {"type": "error", "message": f"Claude API error: {e}"}
        return

    yield {"type": "done", "full": full}
