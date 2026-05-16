/* Sidebar navigation — single source of truth.
 *
 * Per Thomas's "Clean Left Navigation Proposal" (2026-05-11) the sidebar
 * shows MODULES, not every feature. Shared features (Dimensions, FX
 * Rates, VAT Reports, etc.) live inside their owning module and are
 * reached from that module's in-page navigation — they are NOT sidebar
 * entries. The principle on the proposal sheet says it explicitly:
 *
 *   "the sidebar shows modules, not every feature. Shared features like
 *    Dimensions live inside their owning module and are used across the
 *    platform."
 *
 * Module order is fixed (matches panel 1 of the proposal):
 *   1. Home                          — `/dashboard`             (launcher)
 *   2. Dashboard                     — `/dashboard/overview`    (KPIs)
 *   3. Structure                     — `/dashboard/structure`
 *   4. Accounting                    — `/dashboard/accounting`
 *   5. Travel Expense Management     — `/dashboard/travel`
 *   6. Employment                    — `/dashboard/employment`
 *   7. Documents                     — `/dashboard/documents`
 *   8. Wealth Management             — `/dashboard/wealth`
 *   9. Settings                      — `/dashboard/settings`
 *
 * Pinned at the bottom:
 *   - Developer  (staff-only, collapsible — internal tooling)
 *   - Help / Beakon Tour
 *
 * Dimensions stay reachable via the legacy `/dashboard/dimensions` route
 * (intentional — many drafts and AI proposals link to it). Thomas flagged
 * that Dimensions need easier access than "Accounting > Settings >
 * Dimensions"; that's a future iteration. For now they live inside the
 * Accounting module's in-page nav.
 *
 * Reusable later for a mobile bottom bar or a ⌘K command palette
 * (icon + label + href is all those surfaces need).
 */
import type { LucideIcon } from "lucide-react";
import {
  BarChart3, BookOpen, Building2, CheckCircle2, FolderOpen, HelpCircle, Home,
  Layers, LineChart, Map, Network, Settings, Plane, Users, Workflow,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** Optional short description for tooltips / command palette. */
  description?: string;
  /** Additional path prefixes that should also light up this row.
   *  Used so a module (e.g. Accounting) stays highlighted while the
   *  user is on any of its sub-pages (e.g. /dashboard/bills) — even
   *  though those sub-pages are no longer sidebar entries themselves. */
  matches?: string[];
  /** When true, render as a normal anchor opening in a new tab. Used
   *  for links that leave the Next.js app (e.g. the Django admin) so
   *  Next doesn't try to client-route a non-app path. */
  external?: boolean;
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
  /** When true, pin this section to the bottom of the rail (above the
   *  flex spacer). Used for Help and Developer tooling. */
  pinBottom?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  // ─── Modules — the 9 top-level destinations, no header ─────────────
  {
    label: null,
    items: [
      { name: "Home",                      href: "/dashboard",            icon: Home,
        description: "Workspace launcher — open any module" },
      { name: "Dashboard",                 href: "/dashboard/overview",   icon: BarChart3,
        description: "Financial overview, approvals, anomalies, alerts, AI insights",
        matches: ["/dashboard/approvals", "/dashboard/anomalies", "/dashboard/reports"] },
      { name: "Structure",                 href: "/dashboard/structure",  icon: Network,
        description: "Entities, ownership, shareholders, org chart",
        matches: ["/dashboard/entities"] },
      { name: "Accounting",                href: "/dashboard/accounting", icon: BookOpen,
        description: "Bank, transactions, reconciliations, AP/AR, journal entries, ledger, CoA",
        matches: [
          "/dashboard/accounts", "/dashboard/journal-entries", "/dashboard/ledger",
          "/dashboard/periods", "/dashboard/recognition", "/dashboard/intercompany",
          "/dashboard/dimensions", "/dashboard/tax-codes", "/dashboard/fx-rates",
          "/dashboard/bills", "/dashboard/invoices", "/dashboard/disbursements",
          "/dashboard/vendors", "/dashboard/customers",
          "/dashboard/bank", "/dashboard/reconciliations",
          "/dashboard/accounting-setup",
          "/dashboard/learning-rules",
        ] },
      { name: "Travel Expense Management", href: "/dashboard/travel",     icon: Plane,
        description: "Claims, receipts, trips, approvals, reimbursements, policies" },
      { name: "Employment",                href: "/dashboard/employment", icon: Users,
        description: "Employees, contracts, roles, departments, salaries" },
      { name: "Documents",                 href: "/dashboard/documents",  icon: FolderOpen,
        description: "Vault for entity, employee, accounting and travel documents" },
      { name: "Wealth Management",         href: "/dashboard/wealth",     icon: LineChart,
        description: "Portfolios, custodian statements, assets, performance",
        matches: ["/dashboard/bank-feed"] },
      { name: "Settings",                  href: "/dashboard/settings",   icon: Settings,
        description: "Organization, users, AI approvals, billing, integrations, audit log",
        matches: ["/dashboard/audit"] },
    ],
  },

  // ─── Platform Admin — Thomas-only cockpit. Dashboard rolls up KPIs +
  //     trial-ending alerts + module adoption; Customers is the drill-in.
  //     Gated by `developerOnly` (is_staff) so non-staff users don't see it.
  {
    label: "Platform",
    collapsible: false,
    developerOnly: true,
    pinBottom: true,
    items: [
      { name: "Admin Dashboard", href: "/dashboard/admin", icon: BarChart3,
        description: "Owner cockpit — customers, MRR, trials ending, module adoption" },
      { name: "Customers",       href: "/dashboard/admin/customers", icon: Building2,
        description: "All client organisations — plans, subscription state, activities, members" },
    ],
  },

  // ─── Developer — internal tooling, pinned to the bottom, staff-only ─
  {
    label: "Developer",
    collapsible: true,
    defaultCollapsed: true,
    developerOnly: true,
    pinBottom: true,
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

  // ─── Help — single link, pinned to the very bottom ─────────────────
  {
    label: null,
    pinBottom: true,
    items: [
      { name: "Help / Beakon Tour", href: "/dashboard/tour", icon: HelpCircle,
        description: "End-to-end walkthrough of what Beakon does" },
    ],
  },
];
