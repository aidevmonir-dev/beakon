"""NarrativeService — short AI-generated executive commentary on reports.

This is a READ-ONLY enhancement to the reporting stack. The service pulls
the specific report data (P&L / BS / CF / TB) for the requested scope,
builds a compact snapshot, and streams a 3-4 sentence commentary.

Two backends behind the same streaming interface:
    * **Ollama** (default, ``OCR_BACKEND=ollama``) — local, free, runs on
      ``OLLAMA_CHAT_MODEL``. Privacy-first.
    * **Claude API** (``OCR_BACKEND=claude``) — Anthropic's Haiku/Sonnet/
      Opus via streaming messages.create. Better prose quality at the
      cost of ~$0.001 per narrative call. Reuses the same
      ``ANTHROPIC_API_KEY`` and ``CLAUDE_OCR_MODEL`` env vars as the
      bill OCR + bank categorization paths.

Prompt discipline (inherits the "quote don't compute" rule from ask.py):
    - Quote numbers verbatim from the snapshot.
    - Currency code on every figure.
    - No preamble, no recommendations, no fabricated line items.
    - If there's no activity, one-sentence "no activity" and stop.
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

from ..models import Entity
from .reports import ReportsService


# Report types this service can narrate. Keep the set small — each type
# needs its own snapshot builder + prompt.
REPORT_TYPES = ("pnl", "bs", "cf", "tb", "recon")


# ── Snapshot builders ──────────────────────────────────────────────────────
# Each returns a short markdown block that gets stuffed into the system
# prompt. Numbers are pre-formatted so the LLM doesn't have to do arithmetic.

def _pnl_snapshot(*, entity, organization, date_from, date_to, reporting_currency):
    data = ReportsService.profit_loss(
        entity=entity, organization=organization,
        date_from=date_from, date_to=date_to,
        reporting_currency=reporting_currency,
    )
    ccy = data["reporting_currency"]
    rev = Decimal(data["revenue"]["total"])
    net = Decimal(data["net_income"])
    gross = Decimal(data["gross_profit"])
    opinc = Decimal(data["operating_income"])

    def _pct(num, den):
        if den == 0:
            return "n/a"
        return f"{(num / den * 100).quantize(Decimal('0.1'))}%"

    parts = [
        f"## P&L for {data['scope'].get('entity') or 'all entities'} "
        f"({data['period_start']} → {data['period_end']}, {ccy})",
        "",
        f"- Revenue: {data['revenue']['total']} {ccy}",
        f"- COGS: {data['cogs']['total']} {ccy}",
        f"- **Gross profit: {data['gross_profit']} {ccy}** "
        f"(gross margin {_pct(gross, rev)})",
        f"- Operating expenses: {data['operating_expenses']['total']} {ccy}",
        f"- **Operating income: {data['operating_income']} {ccy}** "
        f"(op margin {_pct(opinc, rev)})",
        f"- Other income: {data['other_income']['total']} {ccy}",
        f"- Other expenses: {data['other_expenses']['total']} {ccy}",
        f"- **Net income: {data['net_income']} {ccy}** "
        f"(net margin {_pct(net, rev)})",
    ]

    # Top revenue + expense accounts so the LLM can cite sources
    top_rev = sorted(
        data["revenue"]["accounts"] + data["other_income"]["accounts"],
        key=lambda a: Decimal(a["amount"]), reverse=True,
    )[:5]
    top_exp = sorted(
        data["cogs"]["accounts"] + data["operating_expenses"]["accounts"]
        + data["other_expenses"]["accounts"],
        key=lambda a: Decimal(a["amount"]), reverse=True,
    )[:5]
    if top_rev:
        parts.append("\nTop revenue/income accounts:")
        for a in top_rev:
            if Decimal(a["amount"]) > 0:
                parts.append(f"  - `{a['code']}` {a['name']}: {a['amount']} {ccy}")
    if top_exp:
        parts.append("\nTop expense accounts:")
        for a in top_exp:
            if Decimal(a["amount"]) > 0:
                parts.append(f"  - `{a['code']}` {a['name']}: {a['amount']} {ccy}")
    return "\n".join(parts)


def _bs_snapshot(*, entity, organization, as_of, reporting_currency):
    data = ReportsService.balance_sheet(
        entity=entity, organization=organization,
        as_of=as_of, reporting_currency=reporting_currency,
    )
    ccy = data["reporting_currency"]
    parts = [
        f"## Balance Sheet for {data['scope'].get('entity') or 'all entities'} "
        f"as of {data['as_of']}, {ccy}",
        "",
        f"- Total assets: {data['total_assets']} {ccy}",
        f"- Total liabilities: {data['liabilities']['total']} {ccy}",
        f"- Total equity: {data['equity']['total']} {ccy}",
        f"- Total liabilities + equity: {data['total_liabilities_equity']} {ccy}",
        f"- YTD net income (rolled into equity): {data['ytd_net_income']} {ccy}",
        f"- Is balanced: {data['is_balanced']}",
    ]
    # Top asset / liability accounts by magnitude
    for label, section in (("Asset accounts", "assets"),
                           ("Liability accounts", "liabilities"),
                           ("Equity accounts", "equity")):
        accs = data[section]["accounts"]
        top = sorted(accs, key=lambda a: abs(Decimal(a["amount"])),
                     reverse=True)[:5]
        if top:
            parts.append(f"\n{label} (top by magnitude):")
            for a in top:
                parts.append(f"  - `{a['code']}` {a['name']}: {a['amount']} {ccy}")
    return "\n".join(parts)


def _cf_snapshot(*, entity, organization, date_from, date_to, reporting_currency):
    data = ReportsService.cash_flow_statement(
        entity=entity, organization=organization,
        date_from=date_from, date_to=date_to,
        reporting_currency=reporting_currency,
    )
    ccy = data["reporting_currency"]
    parts = [
        f"## Cash Flow for {data['scope'].get('entity') or 'all entities'} "
        f"({data['period_start']} → {data['period_end']}, {ccy})",
        "",
        f"- Opening cash: {data['opening_cash']} {ccy}",
        f"- **Operating activities net: {data['operating_activities']['net']} {ccy}**",
        f"- **Investing activities net: {data['investing_activities']['net']} {ccy}**",
        f"- **Financing activities net: {data['financing_activities']['net']} {ccy}**",
        f"- Net change: {data['net_change']} {ccy}",
        f"- Closing cash: {data['closing_cash']} {ccy}",
        f"- Reconciles to balance sheet: {data['verification']['matches']}",
    ]
    for label, key in (("Operating items", "operating_activities"),
                       ("Investing items", "investing_activities"),
                       ("Financing items", "financing_activities")):
        items = data[key]["items"]
        if items:
            parts.append(f"\n{label}:")
            for it in items:
                parts.append(f"  - {it['label']}: {it['amount']} {ccy}")
    return "\n".join(parts)


def _tb_snapshot(*, entity, organization, as_of, reporting_currency):
    data = ReportsService.trial_balance(
        entity=entity, organization=organization,
        as_of=as_of, reporting_currency=reporting_currency,
    )
    ccy = data["reporting_currency"]
    parts = [
        f"## Trial Balance for {data['scope'].get('entity') or 'all entities'} "
        f"as of {data['as_of']}, {ccy}",
        "",
        f"- Total DR: {data['totals']['total_debits']} {ccy}",
        f"- Total CR: {data['totals']['total_credits']} {ccy}",
        f"- Balanced: {data['totals']['is_balanced']}",
    ]
    # Top 10 accounts by magnitude of net
    top = sorted(data["accounts"], key=lambda a: abs(Decimal(a["net"])),
                 reverse=True)[:10]
    if top:
        parts.append("\nLargest accounts (by |net|):")
        for a in top:
            parts.append(
                f"  - `{a['code']}` {a['name']} ({a['account_type']}): "
                f"{a['net']} {ccy}"
            )
    return "\n".join(parts)


def _recon_snapshot(*, organization, bank_account_id: int, as_of: dt_date):
    """Build a markdown snapshot for a bank-reconciliation verdict.

    Imports lazily so beakon_core doesn't take a hard dependency on
    beakon_banking at module load.
    """
    from beakon_banking.models import BankAccount
    from beakon_banking.services.reconciliation import BankReconciliationService

    ba = BankAccount.objects.select_related("account", "entity").get(
        id=bank_account_id, account__organization=organization,
    )
    report = BankReconciliationService.report(bank_account=ba, as_of=as_of)
    ccy = report.bank_account_currency
    diff = Decimal(report.difference)

    parts = [
        f"## Bank reconciliation for {report.bank_account_name} "
        f"(entity {report.entity_code}) as of {report.as_of}",
        "",
        f"- Bank statement balance: {report.bank_balance} {ccy}",
        f"- GL balance on linked account: {report.gl_balance} {ccy}",
        f"- **Difference (bank − GL): {report.difference} {ccy}**",
        f"- Reconciled: {'YES' if diff == 0 else 'NO'}",
        f"- Matched bank↔GL pairs: {report.matched_count}",
        f"- Outstanding bank txns (no GL match): {len(report.outstanding_bank)}",
        f"- Outstanding GL lines (no bank match): {len(report.outstanding_gl)}",
    ]

    if report.outstanding_bank:
        parts.append("\nOutstanding BANK transactions (top 8 by |amount|):")
        top_bank = sorted(
            report.outstanding_bank,
            key=lambda r: abs(Decimal(r.get("amount", "0"))), reverse=True,
        )[:8]
        for r in top_bank:
            desc = (r.get("description") or "")[:80]
            parts.append(
                f"  - {r.get('date')} | {r.get('amount')} {ccy} | "
                f"\"{desc}\" | status={r.get('status')}"
            )

    if report.outstanding_gl:
        parts.append("\nOutstanding GL lines (top 8 by |amount|):")
        top_gl = sorted(
            report.outstanding_gl,
            key=lambda r: abs(Decimal(r.get("amount_signed", "0"))), reverse=True,
        )[:8]
        for r in top_gl:
            desc = (r.get("description") or "")[:80]
            parts.append(
                f"  - {r.get('date')} | {r.get('amount_signed')} {ccy} | "
                f"JE {r.get('je_number')} | \"{desc}\""
            )

    if report.suggestions:
        parts.append(
            f"\nAuto-match candidates pending operator review: "
            f"{len(report.suggestions)} pair(s) where amount + date "
            f"are within {5} days."
        )

    return "\n".join(parts)


_SNAPSHOT_BUILDERS = {
    "pnl": _pnl_snapshot,
    "bs":  _bs_snapshot,
    "cf":  _cf_snapshot,
    "tb":  _tb_snapshot,
}


# ── Prompt ──────────────────────────────────────────────────────────────────

_RECON_SYSTEM_PROMPT = """You are a senior accountant reviewing a bank \
reconciliation. Your reader is the bookkeeper who is about to close this \
account. They want a clear verdict and a list of the next concrete actions.

# Hard rules
1. **Quote, do not compute.** Every figure you cite MUST appear verbatim in the \
snapshot. Do not invent amounts, transaction names, or dates.
2. **Verdict first.** Open with one sentence: "Reconciled" or "NOT reconciled — \
out by <amount> <ccy>".
3. **Currency codes.** Every monetary figure carries its currency code.
4. **Diagnosis, not narration.** Identify the most likely cause of any \
difference (e.g. "WeWork CHF debit on Apr 15 has not been booked to GL") by \
pointing at specific outstanding items in the snapshot.
5. **Concrete actions.** Then list 1-3 specific next steps as bullets, each \
referencing a specific outstanding txn or GL line by date + amount + memo \
where helpful. Examples:
   - "Categorise the bank txn from 2026-04-15 (CHF -1,924.18 WeWork) — likely \
hits Office Rent."
   - "Investigate JE-001234 — outstanding GL line that has no bank counterpart."
6. **If reconciled** (difference == 0 and no outstanding items): one sentence \
saying so, optionally noting any auto-match candidates still pending review. \
Do not invent issues.
7. **No suggestions to post entries.** You are advisory. The user will act.
8. **Brevity.** Verdict + diagnosis ≤ 3 sentences, then up to 3 bullets.

Output format: opening sentence, then optional second/third sentence diagnosis, \
then optional Markdown bullet list. No headers.

# Snapshot
{snapshot}
"""


_SYSTEM_PROMPT = """You are a senior finance analyst writing a very short \
executive commentary for a family-office CFO. Your reader already knows what \
the report is; they want the takeaway.

# Hard rules
1. **Quote, do not compute.** Every figure in your output MUST appear in the \
snapshot below. Do not invent numbers, percentages, line items, or ratios.
2. **Be brief.** 3-4 sentences MAXIMUM. Skip preamble ("Here is your P&L…"). \
Start with the headline finding.
3. **Currency codes.** Every monetary figure must carry its currency code.
4. **Focus on signal.**
   - Lead with the headline metric (net income for P&L, total assets for BS, \
closing cash + net change for CF).
   - Call out the biggest driver OR any anomaly visible in the data.
   - Name a concrete "watch" item only if something in the snapshot warrants it \
(e.g. a dominant single account, a net loss, a reconciliation mismatch, concentrated revenue).
5. **Read-only.** Never suggest you can post, fix, or modify anything. \
Do not recommend actions — just observe.
6. **If there is no activity**, say so in one sentence and stop.

Output format: plain text, no markdown headers, no bullet list. Prose paragraph only.

# Snapshot
{snapshot}
"""


# ── Streaming API ──────────────────────────────────────────────────────────

class NarrativeService:
    @staticmethod
    def stream_narrative(
        *,
        organization: Organization,
        entity: Optional[Entity],
        report_type: str,
        params: dict,
    ) -> Iterator[dict]:
        """Yield events for a live-streaming narrative.

        Events:
            {"type": "snapshot_built", "chars": int}
            {"type": "token", "text": str}
            {"type": "done", "full": str}
            {"type": "error", "message": str}
        """
        if report_type not in REPORT_TYPES:
            yield {"type": "error",
                   "message": f"Unknown report_type '{report_type}'. "
                              f"Expected one of {REPORT_TYPES}."}
            return

        reporting_currency = params.get("reporting_currency") or None
        try:
            if report_type == "pnl":
                snapshot = _pnl_snapshot(
                    entity=entity, organization=organization,
                    date_from=params["date_from"], date_to=params["date_to"],
                    reporting_currency=reporting_currency,
                )
            elif report_type == "bs":
                snapshot = _bs_snapshot(
                    entity=entity, organization=organization,
                    as_of=params["as_of"],
                    reporting_currency=reporting_currency,
                )
            elif report_type == "cf":
                snapshot = _cf_snapshot(
                    entity=entity, organization=organization,
                    date_from=params["date_from"], date_to=params["date_to"],
                    reporting_currency=reporting_currency,
                )
            elif report_type == "recon":
                snapshot = _recon_snapshot(
                    organization=organization,
                    bank_account_id=params["bank_account_id"],
                    as_of=params["as_of"],
                )
            else:  # tb
                snapshot = _tb_snapshot(
                    entity=entity, organization=organization,
                    as_of=params["as_of"],
                    reporting_currency=reporting_currency,
                )
        except KeyError as e:
            yield {"type": "error",
                   "message": f"Missing parameter for {report_type}: {e}"}
            return
        except Exception as e:
            yield {"type": "error",
                   "message": f"Failed to build snapshot: {e}"}
            return

        backend = getattr(settings, "OCR_BACKEND", "ollama").lower()
        if backend == "claude":
            model = getattr(settings, "CLAUDE_OCR_MODEL", "claude-haiku-4-5")
        else:
            model = getattr(settings, "OLLAMA_CHAT_MODEL", "")
        yield {
            "type": "snapshot_built",
            "chars": len(snapshot),
            "backend": backend,
            "model": model,
        }

        if report_type == "recon":
            system = _RECON_SYSTEM_PROMPT.format(snapshot=snapshot)
            user_msg = "Write the verdict now."
        else:
            system = _SYSTEM_PROMPT.format(snapshot=snapshot)
            user_msg = "Write the commentary now."

        if backend == "claude":
            yield from _stream_via_claude(system=system, user_msg=user_msg)
        else:
            yield from _stream_via_ollama(system=system, user_msg=user_msg)


def _stream_via_ollama(*, system: str, user_msg: str) -> Iterator[dict]:
    """Stream commentary tokens from the local Ollama chat model. Yields
    ``token`` events token-by-token and an ``error`` on transport issues."""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]
    url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
    model = settings.OLLAMA_CHAT_MODEL
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "keep_alive": "30m",
        "options": {
            "temperature": 0.2,
            "num_predict": 350,   # hard cap on commentary length
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
               "message": f"Model '{model}' not pulled. "
                          f"Run: ollama pull {model}"}
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


def _stream_via_claude(*, system: str, user_msg: str) -> Iterator[dict]:
    """Stream commentary tokens from Claude. Same yield shape as the
    Ollama path so the SSE consumer doesn't care which backend ran.

    Uses ``client.messages.stream()`` so tokens render live in the UI.
    Caches the system prompt with ``cache_control: ephemeral`` — for
    repeat narrations of the same report (regenerate button) the cached
    prefix is reused, dropping cost ~10x on input tokens.
    """
    import anthropic

    api_key = settings.ANTHROPIC_API_KEY or None
    if not api_key:
        yield {"type": "error",
               "message": "OCR_BACKEND=claude but ANTHROPIC_API_KEY is not set."}
        return

    model = settings.CLAUDE_OCR_MODEL
    client = anthropic.Anthropic(api_key=api_key)
    kwargs = {
        "model": model,
        "max_tokens": 600,  # ~3-4 sentences of prose
        # System as a list so we can cache_control the snapshot block.
        "system": [{
            "type": "text",
            "text": system,
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": [{"role": "user", "content": user_msg}],
    }
    # Adaptive thinking on Opus/Sonnet 4.6+, skipped on Haiku (would 400).
    # Narrative is plain prose so thinking doesn't change quality much
    # — keep token usage low.
    if not model.startswith("claude-haiku"):
        kwargs["thinking"] = {"type": "adaptive"}

    from .anthropic_throttle import claude_throttle

    claude_throttle()
    full = ""
    try:
        with client.messages.stream(**kwargs) as stream:
            for text in stream.text_stream:
                if text:
                    full += text
                    yield {"type": "token", "text": text}
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
        yield {"type": "error",
               "message": f"Claude API error: {e}"}
        return
    yield {"type": "done", "full": full}
