/* Workflow-context Back navigation.
 *
 * Per the UI philosophy doc (2026-05-10):
 *
 *   "Users always return to the workflow context they came from.
 *    If a user adds an employee while inside Accounting → Dimensions,
 *    clicking 'Back' returns them to Accounting, not to the Employment
 *    module. Data ownership and navigation ownership are different
 *    concepts."
 *
 * Mechanism: when a link crosses module boundaries (e.g. from
 * Accounting → Dimensions to Employment's "add employee" form), append
 * `?from=<origin path>` via `withOrigin(href, currentPath)`. The
 * destination page reads it via `useWorkflowBack({ fallbackHref })` and
 * renders a Back link that points to that origin instead of the
 * module's natural parent. If no `from=` is present, the fallback is
 * used — so direct deep-links still get a sensible Back.
 *
 * The origin is whitelisted to same-app paths (must start with `/`
 * and not contain `:` or `//` after the leading slash) to avoid open
 * redirect risk if a malicious link injects `?from=https://evil`.
 */
"use client";
import { useSearchParams } from "next/navigation";


/** Friendly label for paths the launcher / sidebar know about.
 *  Anything not in this map falls back to a humanized last URL segment.
 */
const PATH_LABELS: Record<string, string> = {
  "/dashboard": "Home",
  "/dashboard/overview": "Dashboard",
  "/dashboard/settings": "Settings",
  "/dashboard/settings/organization": "Organization",
  "/dashboard/structure": "Structure",
  "/dashboard/accounting-setup": "Accounting Setup",
  "/dashboard/dimensions": "Dimensions",
  "/dashboard/entities": "Entities",
  "/dashboard/accounts": "Chart of Accounts",
  "/dashboard/journal-entries": "Journal Entries",
  "/dashboard/ledger": "Ledger",
  "/dashboard/periods": "Period Close",
  "/dashboard/recognition": "Recognition",
  "/dashboard/intercompany": "Intercompany",
  "/dashboard/bank": "Bank Feed",
  "/dashboard/bank-feed": "Custodian Statements",
  "/dashboard/reconciliations": "Reconcile",
  "/dashboard/bills": "Pay Bills",
  "/dashboard/invoices": "Invoices",
  "/dashboard/disbursements": "Disbursements",
  "/dashboard/vendors": "Vendors",
  "/dashboard/customers": "Customers",
  "/dashboard/tax-codes": "Tax Codes",
  "/dashboard/fx-rates": "FX Rates",
  "/dashboard/audit": "Audit Log",
  "/dashboard/reports": "Financials",
  "/dashboard/reports/vat": "VAT Report",
  "/dashboard/approvals": "Approvals",
  "/dashboard/anomalies": "Anomalies",
  "/dashboard/employment": "Employment",
  "/dashboard/travel": "Travel Expense",
  "/dashboard/documents": "Documents",
};


export function labelFor(path: string): string {
  if (PATH_LABELS[path]) return PATH_LABELS[path];
  const seg = path.split("/").filter(Boolean).pop();
  if (!seg) return "Home";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


/** Returns href with `from=<originPath>` appended. Preserves any
 *  existing query on the destination link. */
export function withOrigin(href: string, originPath: string): string {
  const [pathPart, queryPart] = href.split("?");
  const params = new URLSearchParams(queryPart || "");
  params.set("from", originPath);
  return `${pathPart}?${params.toString()}`;
}


/** Pulls a same-app path out of `?from=`. Refuses anything that
 *  doesn't look like an in-app path — protects against open-redirect. */
function safeOriginParam(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;     // must be relative
  if (raw.startsWith("//")) return null;     // protocol-relative URL
  if (/[\x00-\x1f]/.test(raw)) return null;  // control chars
  return raw;
}


export interface WorkflowBackTarget {
  href: string;
  label: string;
}


/** Read the workflow origin from the URL and return a Back target.
 *  Falls back to the provided default if `?from=` is missing or unsafe. */
export function useWorkflowBack(fallback: {
  href: string;
  label?: string;
}): WorkflowBackTarget {
  const params = useSearchParams();
  const from = safeOriginParam(params?.get("from") ?? null);
  if (from) {
    return { href: from, label: labelFor(from) };
  }
  return {
    href: fallback.href,
    label: fallback.label ?? labelFor(fallback.href),
  };
}
