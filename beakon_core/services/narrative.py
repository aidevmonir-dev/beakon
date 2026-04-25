"""NarrativeService — short AI-generated executive commentary on reports.

This is a READ-ONLY enhancement to the reporting stack. The service pulls
the specific report data (P&L / BS / CF / TB) for the requested scope,
builds a compact snapshot, and streams a 3-4 sentence commentary from the
local LLM. Same privacy stance as AskBeakon — nothing leaves the machine.

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
REPORT_TYPES = ("pnl", "bs", "cf", "tb")


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


_SNAPSHOT_BUILDERS = {
    "pnl": _pnl_snapshot,
    "bs":  _bs_snapshot,
    "cf":  _cf_snapshot,
    "tb":  _tb_snapshot,
}


# ── Prompt ──────────────────────────────────────────────────────────────────

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

        yield {"type": "snapshot_built", "chars": len(snapshot)}

        system = _SYSTEM_PROMPT.format(snapshot=snapshot)
        user_msg = "Write the commentary now."
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
