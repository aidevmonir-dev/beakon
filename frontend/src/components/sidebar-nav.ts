/* Sidebar navigation — single source of truth.
 *
 * Used by the sidebar today and reusable later for a mobile bottom bar or
 * a ⌘K command palette (grouping + icons + hrefs are enough).
 *
 * Grouping is "Digits-style": frequent surfaces at the top, then daily
 * money flow, then the parties involved, then the heavy accounting
 * machinery, then reference material, then a developer-only group.
 *
 *   (Daily)     Home, Approvals, Financials, Anomalies   — open all day
 *   Money       Bank Feed, Bills, Invoices, Disbursements — the flow
 *   People      Vendors, Customers, Entities             — parties
 *   Accounting  CoA, JE, Ledger, Period, Recognition, IC — the engine
 *   Setup       Dimensions, Tax Codes, FX, VAT, Audit    — configured once
 *   Reference   Tour, New organization                   — user-facing setup
 *   Developer   Workflow, Blueprint, Workbook→DB, FAQ    — internal tools
 *
 * Collapsibility: the unlabelled "daily" group is always open. Money +
 * People default open. Accounting + Reference + Developer default
 * collapsed — power-user surfaces stay one click away rather than
 * hogging vertical space.
 *
 * The Developer group is gated by `is_staff` from /auth/me/ — it only
 * renders for staff/superuser accounts.
 */
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle, BookOpen, Building2, CalendarCheck, Calculator, CheckCircle2,
  Coins, Compass, FileText, HelpCircle, Inbox, Landmark, LayoutDashboard,
  Layers, ListTree, Map, Network, NotebookPen, Percent, PlusCircle, Receipt,
  Repeat, Scale, Send, Shield, Tags, TrendingUp, Truck, Users, Workflow,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** Optional short description for tooltips / command palette. */
  description?: string;
}

export interface NavSection {
  /** Shown as a small-caps header above the items. `null` = no header. */
  label: string | null;
  items: NavItem[];
  /** When true, the section header acts as a toggle. Sections without
   *  a label are never collapsible (they sit at the top of the rail). */
  collapsible?: boolean;
  /** Initial collapsed state when collapsible. Defaults to false. */
  defaultCollapsed?: boolean;
  /** When true, only render for users with `is_staff` from /auth/me/. */
  developerOnly?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  // ─── Daily — opens all day, no label so it sits at the very top ─────
  {
    label: null,
    items: [
      { name: "Home",        href: "/dashboard",            icon: LayoutDashboard,
        description: "Today's headline numbers and AI summary" },
      { name: "Approvals",   href: "/dashboard/approvals",  icon: Inbox,
        description: "Bookkeeper review queue — draft → pending → approved → posted" },
      { name: "Financials",  href: "/dashboard/reports",    icon: TrendingUp,
        description: "TB, P&L, balance sheet, cash flow, AP/AR aging" },
      { name: "Anomalies",   href: "/dashboard/anomalies",  icon: AlertTriangle,
        description: "AI-surfaced oddities in the ledger" },
    ],
  },

  // ─── Money — the daily flow ─────────────────────────────────────────
  {
    label: "Money",
    collapsible: true,
    items: [
      { name: "Bank Feed",     href: "/dashboard/bank",            icon: Landmark,
        description: "Bank statements, AI categorisation, draft JEs" },
      { name: "Reconcile",     href: "/dashboard/reconciliations", icon: Scale,
        description: "Match bank statement vs general ledger; surface differences" },
      { name: "Pay Bills",     href: "/dashboard/bills",         icon: Receipt,
        description: "Vendor bills — AI OCR, approval, payment" },
      { name: "Invoices",      href: "/dashboard/invoices",      icon: FileText,
        description: "Customer invoices — issue, track, collect" },
      { name: "Disbursements", href: "/dashboard/disbursements", icon: Send,
        description: "Rebillable costs to invoice to a client" },
    ],
  },

  // ─── People — counterparties + entity master ────────────────────────
  {
    label: "People",
    collapsible: true,
    items: [
      { name: "Vendors",   href: "/dashboard/vendors",   icon: Truck,
        description: "Counterparties on the AP side" },
      { name: "Customers", href: "/dashboard/customers", icon: Users,
        description: "Counterparties on the AR side" },
      { name: "Entities",  href: "/dashboard/entities",  icon: Building2,
        description: "Legal and reporting units across the group" },
    ],
  },

  // ─── Accounting — the kernel, collapsed by default ──────────────────
  {
    label: "Accounting",
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { name: "Chart of Accounts", href: "/dashboard/accounts",        icon: ListTree,
        description: "Chart of accounts per entity" },
      { name: "Journal Entries",   href: "/dashboard/journal-entries", icon: NotebookPen,
        description: "Journal engine, lines, debit/credit integrity" },
      { name: "Ledger",            href: "/dashboard/ledger",          icon: BookOpen,
        description: "Running log of every posted line" },
      { name: "Period Close",      href: "/dashboard/periods",         icon: CalendarCheck,
        description: "Period control — open, soft-close, close, run closing entries" },
      { name: "Recognition",       href: "/dashboard/recognition",     icon: Repeat,
        description: "Multi-period recognition — prepaid / deferred / accrued" },
      { name: "Intercompany",      href: "/dashboard/intercompany",    icon: Network,
        description: "Intercompany entries and netting" },
    ],
  },

  // ─── Setup — configured once, collapsed by default ──────────────────
  {
    label: "Setup",
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { name: "Dimensions", href: "/dashboard/blueprint/data/dimension-types", icon: Tags,
        description: "Dimension types and allowed values (CCY, PORT, CUST, …)" },
      { name: "Tax Codes",  href: "/dashboard/tax-codes",                      icon: Percent,
        description: "VAT rates and the GL accounts they post to" },
      { name: "FX Rates",   href: "/dashboard/fx-rates",                       icon: Coins,
        description: "Live ECB feed — daily fixings + CHF cross-rates" },
      { name: "VAT Report", href: "/dashboard/reports/vat",                    icon: Calculator,
        description: "Period summary of input/output VAT by tax code" },
      { name: "Audit Log",  href: "/dashboard/audit",                          icon: Shield,
        description: "Audit trail of every action" },
    ],
  },

  // ─── Reference — user-facing setup, collapsed by default ────────────
  {
    label: "Reference",
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { name: "Beakon Tour",      href: "/dashboard/tour", icon: Compass,
        description: "End-to-end walkthrough of what Beakon does for one entity" },
      { name: "New organization", href: "/setup",          icon: PlusCircle,
        description: "Create a new organization (separate books, separate users)" },
    ],
  },

  // ─── Developer — internal tooling, only visible to staff/superusers ─
  {
    label: "Developer",
    collapsible: true,
    defaultCollapsed: true,
    developerOnly: true,
    items: [
      { name: "Engine workflow", href: "/dashboard/workflow",                 icon: Workflow,
        description: "Visual flow: how a transaction moves from intake to posted ledger" },
      { name: "Blueprint",       href: "/dashboard/blueprint",                icon: Map,
        description: "Workbook-driven blueprint for the wealth management model" },
      { name: "Workbook → DB",   href: "/dashboard/blueprint/implementation", icon: CheckCircle2,
        description: "Live evidence: every workbook tab → Django model → row count" },
      { name: "CoA Definitions", href: "/dashboard/coa-definitions",          icon: Layers,
        description: "Versioned chart registry from the 01 CoA Definition tab" },
      { name: "Meeting FAQ",     href: "/dashboard/faq",                      icon: HelpCircle,
        description: "Open questions for the Thomas check-in" },
    ],
  },
];
