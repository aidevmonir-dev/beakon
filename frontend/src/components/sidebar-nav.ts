/* Sidebar navigation — single source of truth.
 *
 * Used by the sidebar today and reusable later for a mobile bottom bar or
 * a ⌘K command palette (grouping + icons + hrefs are enough).
 *
 * Structure follows Thomas's founder working paper (2026-04-17).
 * The paper's build order is explicit:
 *
 *   1. accounting kernel
 *   2. reporting logic
 *   3. approval controls
 *   4. data ingestion layers
 *   5. AI reasoning layers
 *   6. specialist modules
 *   7. external productisation
 *
 * We collapse that into five user-facing phases:
 *
 *   Phase 1 — Accounting kernel  (blueprint items 1–3 + the Obj. 1 list
 *                                 verbatim: entity master, CoA, journal
 *                                 engine + lines, debit/credit integrity,
 *                                 approval status, audit trail, period
 *                                 control, reporting foundation, drill-
 *                                 down, FX and intercompany treatment)
 *   Phase 2 — Ingestion & operations  (bank feed, AP/AR, reconciliation —
 *                                      the paper's "What Should Come Next")
 *   Phase 3 — AI layer                (blueprint step 5 — AI reasoning)
 *   Phase 4 — Specialist modules      (blueprint step 6 — dimensional
 *                                      reporting, custom reports, future
 *                                      tax / payroll)
 *   Phase 5 — Platform                (cross-cutting connectors + help)
 *
 * The top (unlabeled) group stays reserved for navigation essentials that
 * aren't a "phase" — Home and the Beakon Tour walkthrough.
 */
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Inbox, TrendingUp, FileBarChart, Landmark,
  Receipt, FileText, Truck, Users, Compass,
  Building2, BookOpen, NotebookPen, ListTree, Repeat, CalendarCheck,
  Coins, Network, Briefcase, MapPin, Map,
  AlertTriangle, Shield, FileStack, Plug, LifeBuoy, HelpCircle, Layers,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** When true, render as disabled with a "Soon" pill — route may not exist yet. */
  soon?: boolean;
  /** Optional short description for tooltips / command palette. */
  description?: string;
}

export interface NavSection {
  /** Shown as a small-caps header above the items. `null` = no header. */
  label: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  // ─── Navigation essentials (above the phase stack) ───────────────────
  {
    label: null,
    items: [
      { name: "Home",        href: "/dashboard",      icon: LayoutDashboard },
      { name: "Blueprint",   href: "/dashboard/blueprint", icon: Map,
        description: "Workbook-driven blueprint for the wealth management model" },
      { name: "Beakon Tour", href: "/dashboard/tour", icon: Compass,
        description: "End-to-end walkthrough of what Beakon does for one entity" },
      { name: "Meeting FAQ", href: "/dashboard/faq", icon: HelpCircle,
        description: "Open questions for the Thomas check-in — Q on the left, answer on the right" },
    ],
  },

  // ─── Phase 1 — Accounting kernel ─────────────────────────────────────
  // Every item here maps to a Phase 1 priority from Thomas's working paper:
  // entity master, CoA, JE engine + lines, D/C integrity, approval status,
  // period control, reporting foundation, drill-down, FX + intercompany,
  // audit trail. The kernel is the only thing the paper requires in the
  // first 90 days.
  {
    label: "Phase 1 · Accounting kernel",
    items: [
      { name: "Entities",         href: "/dashboard/entities",         icon: Building2,
        description: "Entity master — legal and reporting units" },
      { name: "CoA Definitions",  href: "/dashboard/coa-definitions",  icon: Layers,
        description: "Versioned chart registry from Thomas's 01 CoA Definition tab" },
      { name: "Chart of Accounts",href: "/dashboard/accounts",         icon: ListTree,
        description: "Chart of accounts structure per entity" },
      { name: "Journal Entries",  href: "/dashboard/journal-entries",  icon: NotebookPen,
        description: "Journal engine, lines, debit/credit integrity" },
      { name: "Ledger",           href: "/dashboard/ledger",           icon: BookOpen,
        description: "Running log of every posted line" },
      { name: "Review Queue",     href: "/dashboard/approvals",        icon: Inbox,
        description: "Approval status workflow — draft → pending → approved → posted" },
      { name: "Period Close",     href: "/dashboard/periods",          icon: CalendarCheck,
        description: "Period control — open, soft-close, close" },
      { name: "FX Rates",         href: "/dashboard/fx-rates",         icon: Coins,
        description: "Treatment of currencies and FX (Obj. 1)" },
      { name: "Intercompany",     href: "/dashboard/intercompany",     icon: Network,
        description: "Treatment of intercompany entries (Obj. 1)" },
      { name: "Financials",       href: "/dashboard/reports",          icon: TrendingUp,
        description: "Reporting foundation — TB, P&L, balance sheet, drill-down" },
      { name: "Documents",        href: "/dashboard/documents",        icon: FileStack, soon: true,
        description: "Source documents — the bottom of the drill-down chain" },
      { name: "Audit Log",        href: "/dashboard/audit",            icon: Shield,
        description: "Audit trail of every action" },
    ],
  },

  // ─── Phase 2 — Ingestion & operations ────────────────────────────────
  // The paper's "What Should Come Next": bank feed, invoice/receipt
  // ingestion, AP / AR operational surfaces. Every feeder flows through
  // the Phase 1 approval pipe.
  {
    label: "Phase 2 · Ingestion & operations",
    items: [
      { name: "Bank Feed",       href: "/dashboard/bank",            icon: Landmark,
        description: "One feeder into the ledger — CSV imports become draft JEs" },
      { name: "Bills",           href: "/dashboard/bills",           icon: Receipt,
        description: "Accounts payable — vendor bills pending approval" },
      { name: "Invoices",        href: "/dashboard/invoices",        icon: FileText,
        description: "Accounts receivable — customer invoices" },
      { name: "Vendors",         href: "/dashboard/vendors",         icon: Truck,
        description: "Counterparties on the AP side" },
      { name: "Customers",       href: "/dashboard/customers",       icon: Users,
        description: "Counterparties on the AR side" },
      { name: "Reconciliations", href: "/dashboard/reconciliations", icon: Repeat, soon: true,
        description: "Match bank lines to the ledger" },
    ],
  },

  // ─── Phase 3 — AI layer ──────────────────────────────────────────────
  // Blueprint step 5. Layers AI on top of a validated kernel — the paper
  // is explicit that AI must not define the accounting model, only assist.
  {
    label: "Phase 3 · AI layer",
    items: [
      { name: "Anomalies", href: "/dashboard/anomalies", icon: AlertTriangle,
        description: "AI-surfaced oddities in the ledger — read-only, escalate-on-exception" },
    ],
  },

  // ─── Phase 4 — Specialist modules ────────────────────────────────────
  // Blueprint step 6. Dimensional reporting, custom reports, and the
  // future home for tax / payroll / investment-instrument tooling once
  // Thomas signs off on treatment.
  {
    label: "Phase 4 · Specialist modules",
    items: [
      { name: "Custom Reports", href: "/dashboard/reports/custom",  icon: FileBarChart, soon: true,
        description: "User-defined reports beyond TB / P&L / BS" },
      { name: "Departments",    href: "/dashboard/departments",     icon: Briefcase,    soon: true,
        description: "Dimensional reporting — cost centers" },
      { name: "Locations",      href: "/dashboard/locations",       icon: MapPin,       soon: true,
        description: "Dimensional reporting — geographies" },
    ],
  },

  // ─── Phase 5 — Platform ──────────────────────────────────────────────
  // Cross-cutting and housekeeping. Not in the blueprint's phase ladder,
  // but every platform needs connectors + a help surface eventually.
  {
    label: "Phase 5 · Platform",
    items: [
      { name: "Connections", href: "/dashboard/connections", icon: Plug,     soon: true,
        description: "Integrations — banks, payroll, tax, market data" },
      { name: "Help",        href: "/help",                  icon: LifeBuoy, soon: true,
        description: "Support and documentation" },
    ],
  },
];
