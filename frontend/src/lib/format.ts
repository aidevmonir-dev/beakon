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

/** Money: 2 decimals, thousands separators. "1234.5678" -> "1,234.57". */
export function fmt2(s: string | number | null | undefined): string {
  const n = Number(s ?? 0);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
