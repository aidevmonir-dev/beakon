/* Display formatters for the Beakon UI.
 *
 * The accounting kernel stores amounts at 4 decimal places for FX precision
 * (see digits_clone migrations). Presentation always rounds to 2 decimals
 * with thousands separators so the screen is readable.
 *
 * Usage:
 *   import { fmt2, fmtRate, fmtMoney, fmtDate, fmtDateTime } from "@/lib/format";
 *   <td>{fmt2(line.debit)}</td>
 */

/** Money: up to 2 decimals, thousands separators. Drops trailing zeros so
 * round amounts read cleanly on dashboards. "1234.5678" -> "1,234.57",
 * "5000000.00" -> "5,000,000", "1234.50" -> "1,234.5". */
export function fmt2(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Money with EXACT decimals — for financial reports that need every cell
 * pinned to the same scale. Pair with a "Hide decimals" toggle: pass 2 for
 * audit views, 0 for executive views. Negative numbers use a leading minus
 * (use fmtAccountingFixed for parens-style). */
export function fmt2Fixed(
  s: string | number | null | undefined,
  decimals: number,
): string {
  const n = Number(s ?? 0);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Money with a trailing currency code. "1234.56" + "USD" -> "1,234.56 USD". */
export function fmtMoney(
  s: string | number | null | undefined,
  ccy?: string | null,
): string {
  const v = fmt2(s);
  return ccy ? `${v} ${ccy}` : v;
}

/** Money with a leading currency code (good for tight columns). */
export function fmtMoneyLead(
  s: string | number | null | undefined,
  ccy?: string | null,
): string {
  const v = fmt2(s);
  return ccy ? `${ccy} ${v}` : v;
}

/** Same as fmtMoneyLead but pinned to N decimals — use on financial
 *  reports / reconciliation views where every cell must show the same
 *  scale ("CHF 5,000.00", not "CHF 5,000"). */
export function fmtMoneyLeadFixed(
  s: string | number | null | undefined,
  ccy: string | null | undefined,
  decimals: number,
): string {
  const v = fmt2Fixed(s, decimals);
  return ccy ? `${ccy} ${v}` : v;
}

/** Accounting-style money: positive plain, negative in parentheses, zero as
 * em-dash. "1234.56" -> "1,234.56", "-1234.56" -> "(1,234.56)", "0" -> "—".
 * This is the convention every financial report (Xero, QuickBooks, SAP)
 * uses — auditors expect it and reading rows of negatives with leading
 * minus signs is harder than scanning parentheses. */
export function fmtAccounting(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${abs})` : abs;
}

/** Accounting-style money with EXACT decimals — same parens/em-dash rules
 * as `fmtAccounting`, but min=max=`decimals` so financial reports can pin
 * the column width and let the user toggle between 2dp (default audit
 * convention) and 0dp ("hide decimals"). */
export function fmtAccountingFixed(
  s: string | number | null | undefined,
  decimals: number,
): string {
  const n = Number(s ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return n < 0 ? `(${abs})` : abs;
}

/** Percent for common-size reports — "% of revenue" on P&L, "% of total
 * assets" on BS. Returns blank for zero or non-finite, "n/a" for divide-by-
 * zero. ``denom`` is required so we never silently fall back to a wrong base. */
export function fmtPct(
  num: string | number | null | undefined,
  denom: string | number | null | undefined,
  fractionDigits: number = 1,
): string {
  const n = Number(num ?? 0);
  const d = Number(denom ?? 0);
  if (!Number.isFinite(n) || !Number.isFinite(d)) return "—";
  if (d === 0) return "n/a";
  if (n === 0) return "—";
  const pct = (n / d) * 100;
  const sign = pct < 0 ? "(" : "";
  const close = pct < 0 ? ")" : "";
  return `${sign}${Math.abs(pct).toFixed(fractionDigits)}%${close}`;
}

/** Compact money: scale to K / M / B with 1 decimal; under 1k stays exact.
 *  "13532917" -> "13.5M", "1245" -> "1.2K", "523" -> "523".
 *  Use on dashboard headlines / executive views, never on line items. */
export function fmtCompact(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000)     return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)         return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

/** Compact money with leading currency: "CHF 13.5M". */
export function fmtCompactLead(
  s: string | number | null | undefined,
  ccy?: string | null,
): string {
  const v = fmtCompact(s);
  return ccy ? `${ccy} ${v}` : v;
}

/** FX rate — strip trailing zeros, cap at 6dp. "1.0000000000" -> "1". */
export function fmtRate(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (n === 1) return "1";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

/** Date — "2026-04-15" -> "Apr 15, 2026". Pass through if not parseable. */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s + (s.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

/** Date+time — for audit trail / approval history. */
export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** Title-case a snake/lower string for display. "pending_approval" -> "Pending Approval". */
export function fmtLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
