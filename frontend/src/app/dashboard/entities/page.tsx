"use client";

/* Entities — legal / reporting units inside an organization.
 *
 * Every journal entry posts to exactly one entity. The entity tree drives
 * consolidated reporting and intercompany.
 *
 * Design intent: ruthless one-screen scan. Header → search + status → table.
 * No summary cards, no chip rails. The table itself carries the whole
 * story (type, jurisdiction, currency, accounting standard, parent/sub
 * hint, status). Drawer is single-section, no accordion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Building2, Plus, X, Search, MoreHorizontal, Archive, Pencil,
  ExternalLink, AlertCircle, Command, Network, Building, User, Briefcase,
} from "lucide-react";
import { api, syncOrganizationContext } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";


// ── Types ─────────────────────────────────────────────────────────────────

interface Entity {
  id: number;
  code: string;
  name: string;
  legal_name: string;
  entity_type: string;
  parent: number | null;
  parent_code: string | null;
  functional_currency: string;
  reporting_currency: string;
  country: string;
  accounting_standard: string;
  fiscal_year_start_month: number;
  tax_id: string;
  notes?: string;
  is_active: boolean;
}

interface EntityTypeOption {
  value: string;
  label: string;
  pill?: string;
  is_custom?: boolean;
  id?: number;
}

const ENTITY_TYPES: EntityTypeOption[] = [
  { value: "company",          label: "Company",            pill: "bg-brand-50 text-brand-800 ring-brand-100" },
  { value: "holding_company",  label: "Holding Company",    pill: "bg-cyan-50 text-cyan-800 ring-cyan-100" },
  { value: "operating_company",label: "Operating Company",  pill: "bg-blue-50 text-blue-800 ring-blue-100" },
  { value: "trust",            label: "Trust",              pill: "bg-indigo-50 text-indigo-700 ring-indigo-100" },
  { value: "foundation",       label: "Foundation",         pill: "bg-violet-50 text-violet-700 ring-violet-100" },
  { value: "partnership",      label: "Partnership",        pill: "bg-amber-50 text-amber-700 ring-amber-100" },
  { value: "fund",             label: "Fund",               pill: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  { value: "branch",           label: "Branch",             pill: "bg-sky-50 text-sky-700 ring-sky-100" },
  { value: "individual",       label: "Person",             pill: "bg-rose-50 text-rose-700 ring-rose-100" },
  { value: "family",           label: "Family",             pill: "bg-orange-50 text-orange-700 ring-orange-100" },
  { value: "spv",              label: "SPV",                pill: "bg-teal-50 text-teal-700 ring-teal-100" },
  { value: "other",            label: "Other",              pill: "bg-gray-100 text-gray-700 ring-gray-200" },
];

const ACCOUNTING_STANDARDS: { value: string; short: string; label: string }[] = [
  { value: "ifrs",    short: "IFRS",    label: "IFRS — International (used outside the US)" },
  { value: "us_gaap", short: "US GAAP", label: "US GAAP — United States" },
  { value: "uk_gaap", short: "UK GAAP", label: "UK GAAP — FRS 102 / FRS 105" },
  { value: "other",   short: "Other",   label: "Other / local (AI defaults to IFRS-equivalent)" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const COUNTRY_OPTIONS: { value: string; label: string }[] = [
  { value: "CH", label: "Switzerland" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "IT", label: "Italy" },
  { value: "ES", label: "Spain" },
  { value: "NL", label: "Netherlands" },
  { value: "LU", label: "Luxembourg" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
];

const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "EUR", label: "EUR — Euro" },
  { value: "CHF", label: "CHF — Swiss Franc" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "JPY", label: "JPY — Japanese Yen" },
  { value: "INR", label: "INR — Indian Rupee" },
];

const COUNTRY_DATALIST_ID = "entity-country-options";
const CURRENCY_DATALIST_ID = "entity-currency-options";

type StatusFilter = "active" | "all" | "archived";


// ── Helpers ───────────────────────────────────────────────────────────────

function typeMeta(k: string) {
  return ENTITY_TYPES.find((t) => t.value === k) || {
    value: k,
    label: titleCase(k),
    pill: ENTITY_TYPES[ENTITY_TYPES.length - 1].pill,
  };
}

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function defaultStandardForCountry(cc: string): string {
  const code = (cc || "").toUpperCase().trim();
  if (code === "US") return "us_gaap";
  if (code === "GB") return "uk_gaap";
  return "ifrs";
}

function standardShort(value: string): string {
  return ACCOUNTING_STANDARDS.find((s) => s.value === value)?.short || value || "—";
}

function standardLabel(value: string): string {
  return ACCOUNTING_STANDARDS.find((s) => s.value === value)?.label || value || "—";
}


// ── Page ──────────────────────────────────────────────────────────────────

export default function EntitiesPage() {
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [memberOrgCount, setMemberOrgCount] = useState<number>(0);

  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<EntityTypeOption[]>(ENTITY_TYPES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgSwitchError, setOrgSwitchError] = useState<string | null>(null);
  const [switchingOrg, setSwitchingOrg] = useState(false);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");

  const [drawer, setDrawer] =
    useState<{ mode: "create" } | { mode: "edit"; entity: Entity } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  // Org bootstrap.
  useEffect(() => {
    const id = typeof window !== "undefined" ? localStorage.getItem("organization_id") : null;
    setHasOrg(!!id);
    api.get<{ organizations?: { id: number; name: string }[] }>("/auth/me/")
      .then((d) => {
        const orgs = d.organizations || [];
        setMemberOrgCount(orgs.length);
        if (id) {
          const org = orgs.find((o) => String(o.id) === id);
          setOrgName(org?.name || "");
        }
      })
      .catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/");
      setEntities(Array.isArray(r) ? r : (r.results ?? []));
    } catch (e: any) {
      setLoadError(typeof e?.detail === "string" ? e.detail : "Failed to load entities");
    } finally {
      setLoading(false);
    }
  };

  const loadEntityTypes = async () => {
    const options = await api.get<EntityTypeOption[]>("/beakon/entity-types/").catch(() => ENTITY_TYPES);
    setEntityTypeOptions(options?.length ? options : ENTITY_TYPES);
  };

  useEffect(() => {
    if (!hasOrg) return;
    void load();
    void loadEntityTypes();
  }, [hasOrg]);

  // ── Derived ──────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();

  // Children-per-parent count, pre-computed once so each row render is O(1).
  const childrenOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of entities) {
      if (e.parent !== null) m.set(e.parent, (m.get(e.parent) || 0) + 1);
    }
    return m;
  }, [entities]);

  const filtered = useMemo(() => entities.filter((e) => {
    if (status === "active" && !e.is_active) return false;
    if (status === "archived" && e.is_active) return false;
    if (q) {
      const hay = `${e.code} ${e.name} ${e.legal_name} ${e.tax_id} ${e.entity_type} ${e.country} ${e.functional_currency}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [entities, status, q]);

  useEffect(() => {
    if (focusedIdx !== null && focusedIdx >= filtered.length) setFocusedIdx(null);
  }, [filtered, focusedIdx]);

  // Keyboard: / focus, ⌘K, arrows, Enter, Esc.
  const handleKey = useCallback((e: KeyboardEvent) => {
    const tgt = e.target as HTMLElement | null;
    const inField = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return;
    }
    if (inField) return;
    if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
    if (e.key === "Escape" && drawer) { setDrawer(null); return; }
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIdx((i) => (i === null ? 0 : Math.min(filtered.length - 1, i + 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocusedIdx((i) => (i === null ? 0 : Math.max(0, i - 1))); }
    else if (e.key === "Enter" && focusedIdx !== null && filtered[focusedIdx]) {
      e.preventDefault(); setDrawer({ mode: "edit", entity: filtered[focusedIdx] });
    }
  }, [filtered, focusedIdx, drawer]);

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  useEffect(() => {
    if (focusedIdx === null) return;
    const el = document.querySelector<HTMLTableRowElement>(`tr[data-row-idx="${focusedIdx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIdx]);

  async function archiveEntity(e: Entity) {
    if (!confirm(`Archive "${e.code} · ${e.name}"? Historical journal entries remain untouched; it just won't appear in pickers.`)) return;
    try {
      await api.patch(`/beakon/entities/${e.id}/`, { is_active: false });
      await load();
    } catch (err: any) {
      alert("Archive failed: " + JSON.stringify(err?.detail || err));
    }
  }

  async function unarchiveEntity(e: Entity) {
    try {
      await api.patch(`/beakon/entities/${e.id}/`, { is_active: true });
      await load();
    } catch (err: any) {
      alert("Restore failed: " + JSON.stringify(err?.detail || err));
    }
  }

  async function switchToFirstOrg() {
    setSwitchingOrg(true);
    setOrgSwitchError(null);
    try {
      const org = await syncOrganizationContext();
      if (!org) {
        setOrgSwitchError("No organization is available on this account.");
        setSwitchingOrg(false);
        return;
      }
      window.location.reload();
    } catch (e: any) {
      const msg = typeof e?.detail === "string" ? e.detail : "Couldn't switch organization. Please try again.";
      setOrgSwitchError(msg);
      setSwitchingOrg(false);
    }
  }

  // ── No-org state ─────────────────────────────────────────────────────
  if (hasOrg === false) {
    const hasMemberships = memberOrgCount > 0;
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Entities" />
        <div className="mt-6">
          <EmptyState
            tone="brand"
            icon={Building2}
            title={
              switchingOrg
                ? "Switching organization…"
                : hasMemberships
                  ? "Select an organization to continue"
                  : "Create an organization to get started"
            }
            description={
              hasMemberships
                ? "Entities live inside an organization. Pick one to see and manage its legal units."
                : "Entities live inside an organization. The ledger, reporting, intercompany, and approvals all scope around it."
            }
            primaryAction={
              hasMemberships
                ? { label: switchingOrg ? "Switching…" : "Switch organization", icon: Building2, onClick: () => void switchToFirstOrg() }
                : { label: "Create organization", icon: Plus, onClick: () => { window.location.href = "/setup"; } }
            }
            secondaryAction={
              hasMemberships
                ? { label: "Create new organization", onClick: () => { window.location.href = "/setup"; } }
                : undefined
            }
          />
          {orgSwitchError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{orgSwitchError}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Header used by every org-scoped state.
  const activeCount = entities.filter((e) => e.is_active).length;
  const header = (
    <PageHeader
      title="Entities"
      description="Legal and reporting units. Each has its own books, accounting standard, and fiscal calendar — every journal entry posts to exactly one."
      context={
        orgName ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
            <Building2 className="h-3.5 w-3.5 text-brand-600" />
            <span className="font-medium text-gray-800">{orgName}</span>
            {entities.length > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="tabular-nums">{activeCount} active</span>
                {entities.length !== activeCount && (
                  <span className="text-gray-400 tabular-nums">/ {entities.length}</span>
                )}
              </>
            )}
          </div>
        ) : null
      }
      actions={
        <button onClick={() => setDrawer({ mode: "create" })} className="btn-primary">
          <Plus className="w-4 h-4 mr-1.5" /> New Entity
        </button>
      }
    />
  );

  // First-paint loading.
  if (loading && entities.length === 0 && !loadError) {
    return (
      <div>
        {header}
        <div className="mt-5 overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <table className="w-full text-sm">
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} columns={6} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Load error.
  if (loadError && entities.length === 0) {
    return (
      <div>
        {header}
        <div className="mt-6">
          <EmptyState
            tone="warning"
            icon={AlertCircle}
            title="Couldn't load entities"
            description={loadError}
            primaryAction={{ label: "Retry", onClick: () => void load() }}
          />
        </div>
      </div>
    );
  }

  // Has org, zero entities.
  if (entities.length === 0) {
    return (
      <div>
        {header}
        <div className="mt-6">
          <EmptyState
            tone="brand"
            icon={Building2}
            title="Create your first entity"
            description="Start with the top-of-house — typically the holding company or family trust. Subsidiaries can be added once the parent exists."
            primaryAction={{ label: "Create first entity", icon: Plus, onClick: () => setDrawer({ mode: "create" }) }}
          />
        </div>
        {drawer && (
          <EntityDrawer
            key="create"
            mode={drawer.mode}
            entity={drawer.mode === "edit" ? drawer.entity : undefined}
            entities={entities}
            entityTypeOptions={entityTypeOptions}
            onEntityTypeCatalogChange={loadEntityTypes}
            onClose={() => setDrawer(null)}
            onSaved={async () => { setDrawer(null); await load(); }}
          />
        )}
      </div>
    );
  }

  // ── Main page ────────────────────────────────────────────────────────
  return (
    <div>
      {header}

      {/* Search + status — single row, no chip rails. */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code, name, country, or currency"
            className="w-full h-10 pl-9 pr-20 rounded-xl border border-canvas-200 bg-white text-sm placeholder-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none transition"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-canvas-50" aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded-md border border-canvas-200 bg-canvas-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 sm:inline-flex">
              <Command className="h-2.5 w-2.5" /> K
            </kbd>
          )}
        </div>
        <div className="inline-flex rounded-xl border border-canvas-200 bg-white p-0.5 text-xs shrink-0">
          {(["active", "all", "archived"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg font-medium capitalize transition-colors",
                status === s
                  ? "bg-brand-50 text-brand-800"
                  : "text-gray-500 hover:text-gray-800",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-canvas-50/80 backdrop-blur border-b border-canvas-200/70">
              <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                <th className="w-24 pl-5 pr-2 py-2.5 font-semibold">Code</th>
                <th className="pr-4 py-2.5 font-semibold">Entity</th>
                <th className="hidden md:table-cell pr-4 py-2.5 font-semibold">Type</th>
                <th className="hidden md:table-cell pr-4 py-2.5 font-semibold">Standard</th>
                <th className="hidden lg:table-cell pr-4 py-2.5 font-semibold">Country</th>
                <th className="hidden lg:table-cell pr-4 py-2.5 font-semibold">Currency</th>
                <th className="pr-4 py-2.5 font-semibold">Status</th>
                <th className="w-10 pr-3 py-2.5"></th>
              </tr>
            </thead>

            {filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      icon={Search}
                      title="No entities match"
                      description="Clear the search or switch the status filter to see archived entities."
                      primaryAction={
                        q || status !== "active"
                          ? { label: "Reset", onClick: () => { setQuery(""); setStatus("active"); } }
                          : undefined
                      }
                      className="border-0 shadow-none rounded-none"
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-canvas-100">
                {filtered.map((e, i) => {
                  const meta = typeMeta(e.entity_type);
                  const isPerson = e.entity_type === "individual";
                  const AvatarIcon = isPerson ? User : Building;
                  const isFocused = focusedIdx === i;
                  const subCount = childrenOf.get(e.id) || 0;
                  return (
                    <tr
                      key={e.id}
                      data-row-idx={i}
                      onMouseEnter={() => setFocusedIdx(i)}
                      onClick={() => setDrawer({ mode: "edit", entity: e })}
                      className={cn(
                        "group cursor-pointer transition-colors relative",
                        isFocused
                          ? "bg-brand-50/50 [&>td:first-child]:shadow-[inset_2px_0_0_0_var(--color-brand-500)]"
                          : "hover:bg-brand-50/30",
                      )}
                    >
                      <td className="pl-5 pr-2 py-2.5 font-mono text-[11px] text-gray-500 tabular-nums">
                        {e.code}
                      </td>
                      <td className="pr-4 py-2.5 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-7 w-7 shrink-0 rounded-lg bg-canvas-100 ring-1 ring-inset ring-canvas-200/80 flex items-center justify-center">
                            <AvatarIcon className="h-3.5 w-3.5 text-gray-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm font-medium text-gray-900 truncate">{e.name}</span>
                              {e.parent_code && (
                                <span
                                  className="inline-flex items-center gap-0.5 rounded bg-canvas-50 px-1.5 py-0.5 text-[9px] font-medium font-mono text-gray-500 ring-1 ring-inset ring-canvas-200/70 shrink-0"
                                  title={`Subsidiary of ${e.parent_code}`}
                                >
                                  <Network className="h-2.5 w-2.5" />
                                  {e.parent_code}
                                </span>
                              )}
                              {subCount > 0 && (
                                <span
                                  className="inline-flex items-center rounded-full bg-brand-50 px-1.5 py-0.5 text-[9px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 shrink-0"
                                  title={`Parent of ${subCount} ${subCount === 1 ? "entity" : "entities"}`}
                                >
                                  {subCount} sub{subCount === 1 ? "" : "s"}
                                </span>
                              )}
                            </div>
                            {e.legal_name && e.legal_name !== e.name && (
                              <div className="text-[11px] text-gray-400 truncate">{e.legal_name}</div>
                            )}
                            {/* Mobile-only meta line — folds the type/standard/
                                country/currency columns (which are hidden
                                <md) into a single compact secondary row so
                                nothing is invisible on phones. */}
                            <div className="md:hidden mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-gray-500">
                              <span className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded-full ring-1 ring-inset",
                                meta.pill,
                              )}>
                                {meta.label}
                              </span>
                              <span className="font-mono text-gray-600">{e.country || "—"}</span>
                              <span className="text-gray-300">·</span>
                              <span className="font-mono text-gray-600">
                                {e.functional_currency}
                                {e.reporting_currency && e.reporting_currency !== e.functional_currency && (
                                  <span className="text-gray-400"> → {e.reporting_currency}</span>
                                )}
                              </span>
                              <span className="text-gray-300">·</span>
                              <span
                                className="inline-flex items-center rounded bg-canvas-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600 ring-1 ring-inset ring-canvas-200"
                                title={standardLabel(e.accounting_standard)}
                              >
                                {standardShort(e.accounting_standard)}
                              </span>
                            </div>
                          </div>
                          <Link
                            href={`/dashboard/entities/${e.id}?tab=investments`}
                            onClick={(ev) => ev.stopPropagation()}
                            title="View investments"
                            className="hidden sm:inline-flex items-center gap-1 rounded-full border border-brand-100 bg-brand-50/80 px-2 py-0.5 text-[10px] font-semibold text-brand-700 hover:bg-brand-100 transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                          >
                            <Briefcase className="h-3 w-3" />
                            Investments
                          </Link>
                        </div>
                      </td>
                      <td className="hidden md:table-cell pr-4 py-2.5">
                        <span className={cn(
                          "inline-flex items-center text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset",
                          meta.pill,
                        )}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="hidden md:table-cell pr-4 py-2.5">
                        <span
                          className="inline-flex items-center rounded-full bg-canvas-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 ring-1 ring-inset ring-canvas-200"
                          title={standardLabel(e.accounting_standard)}
                        >
                          {standardShort(e.accounting_standard)}
                        </span>
                      </td>
                      <td className="hidden lg:table-cell pr-4 py-2.5 font-mono text-xs text-gray-600">
                        {e.country || "—"}
                      </td>
                      <td className="hidden lg:table-cell pr-4 py-2.5 font-mono text-xs text-gray-700">
                        {e.functional_currency}
                        {e.reporting_currency && e.reporting_currency !== e.functional_currency && (
                          <span className="text-[10px] text-gray-400 ml-1">→ {e.reporting_currency}</span>
                        )}
                      </td>
                      <td className="pr-4 py-2.5">
                        <span className={cn(
                          "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset",
                          e.is_active
                            ? "bg-mint-50 text-mint-700 ring-mint-200/80"
                            : "bg-gray-100 text-gray-600 ring-gray-200",
                        )}>
                          <span className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            e.is_active ? "bg-mint-500" : "bg-gray-400",
                          )} />
                          {e.is_active ? "Active" : "Archived"}
                        </span>
                      </td>
                      <td className="pr-3 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                        <RowActions
                          entity={e}
                          onEdit={() => setDrawer({ mode: "edit", entity: e })}
                          onArchive={() => archiveEntity(e)}
                          onUnarchive={() => unarchiveEntity(e)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
      </div>

      {drawer && (
        <EntityDrawer
          key={drawer.mode === "edit" ? drawer.entity.id : "create"}
          mode={drawer.mode}
          entity={drawer.mode === "edit" ? drawer.entity : undefined}
          entities={entities}
          entityTypeOptions={entityTypeOptions}
          onEntityTypeCatalogChange={loadEntityTypes}
          onClose={() => setDrawer(null)}
          onSaved={async () => { setDrawer(null); await load(); }}
        />
      )}
    </div>
  );
}


// ── Row actions ───────────────────────────────────────────────────────────

function RowActions({
  entity, onEdit, onArchive, onUnarchive,
}: {
  entity: Entity;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-canvas-100"
        aria-label="Row actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-50 w-44 rounded-lg border border-canvas-200 bg-white shadow-lg py-1 text-sm">
            <button
              onClick={(ev) => { ev.stopPropagation(); setOpen(false); onEdit(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-canvas-50"
            >
              <Pencil className="h-3.5 w-3.5 text-gray-400" /> Edit
            </button>
            <Link
              href={`/dashboard/entities/${entity.id}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-gray-700 hover:bg-canvas-50"
            >
              <ExternalLink className="h-3.5 w-3.5 text-gray-400" /> View detail
            </Link>
            <Link
              href={`/dashboard/entities/${entity.id}?tab=investments`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-brand-700 hover:bg-brand-50"
            >
              <Briefcase className="h-3.5 w-3.5" /> View investments
            </Link>
            {entity.is_active ? (
              <button
                onClick={(ev) => { ev.stopPropagation(); setOpen(false); onArchive(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-amber-700 hover:bg-amber-50"
              >
                <Archive className="h-3.5 w-3.5" /> Archive
              </button>
            ) : (
              <button
                onClick={(ev) => { ev.stopPropagation(); setOpen(false); onUnarchive(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-mint-700 hover:bg-mint-50"
              >
                <Archive className="h-3.5 w-3.5" /> Restore
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}


// ── Drawer ────────────────────────────────────────────────────────────────

function EntityDrawer({
  mode, entity, entities, entityTypeOptions, onEntityTypeCatalogChange, onClose, onSaved,
}: {
  mode: "create" | "edit";
  entity?: Entity;
  entities: Entity[];
  entityTypeOptions: EntityTypeOption[];
  onEntityTypeCatalogChange: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = mode === "edit" && !!entity;
  const [form, setForm] = useState({
    code: entity?.code || "",
    name: entity?.name || "",
    legal_name: entity?.legal_name || "",
    entity_type: entity?.entity_type || "company",
    parent: entity?.parent ? String(entity.parent) : "",
    functional_currency: entity?.functional_currency || "EUR",
    reporting_currency: entity?.reporting_currency || "",
    country: entity?.country || "CH",
    accounting_standard:
      entity?.accounting_standard || defaultStandardForCountry(entity?.country || "CH"),
    // Stops the country->standard auto-update from clobbering an explicit pick.
    accounting_standard_touched: Boolean(entity?.accounting_standard),
    fiscal_year_start_month: entity?.fiscal_year_start_month || 1,
    tax_id: entity?.tax_id || "",
    notes: entity?.notes || "",
    is_active: entity?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const parentCandidates = entities.filter(
    (e) => e.id !== entity?.id && e.is_active,
  );

  function deriveCode(name: string, type: string): string {
    const stem = name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || type.toUpperCase().slice(0, 4);
    const suffix = Date.now().toString(36).slice(-3).toUpperCase();
    return `${stem}-${suffix}`;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSaving(true); setError(null);
    const code = form.code.trim() || (isEdit ? (entity?.code || "") : deriveCode(form.name, form.entity_type));
    const payload = {
      code,
      name: form.name.trim(),
      legal_name: form.legal_name.trim(),
      entity_type: form.entity_type,
      parent: form.parent ? Number(form.parent) : null,
      functional_currency: form.functional_currency.trim().toUpperCase(),
      reporting_currency: form.reporting_currency.trim().toUpperCase() || "",
      country: form.country.trim().toUpperCase().slice(0, 2),
      accounting_standard: form.accounting_standard,
      fiscal_year_start_month: Number(form.fiscal_year_start_month),
      tax_id: form.tax_id.trim(),
      notes: form.notes.trim(),
      is_active: form.is_active,
    };
    try {
      if (isEdit && entity) {
        await api.patch(`/beakon/entities/${entity.id}/`, payload);
      } else {
        await api.post("/beakon/entities/", payload);
      }
      await onSaved();
    } catch (e: any) {
      setError(typeof e?.detail === "string" ? e.detail : JSON.stringify(e?.detail || e || "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  const isPerson = form.entity_type === "individual";
  const namePlaceholder = isPerson
    ? "e.g. Thomas Müller"
    : form.entity_type === "holding_company"
      ? "e.g. Schmidt Holdings AG"
      : form.entity_type === "operating_company"
        ? "e.g. Alpine Wealth Management Ltd"
      : form.entity_type === "trust"
        ? "e.g. Müller Family Trust"
        : form.entity_type === "family"
          ? "e.g. Müller Family Office"
          : form.entity_type === "foundation"
            ? "e.g. Stiftung Helvetia"
            : form.entity_type === "spv"
              ? "e.g. Aurora SPV I Ltd"
              : form.entity_type === "fund"
                ? "e.g. Alpine Growth Fund"
                : "e.g. Schmidt Holdings AG";

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[560px] bg-white border-l border-canvas-200 overflow-y-auto flex flex-col">
        {/* Drawer header */}
        <div className="px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                {isEdit ? "Edit entity" : "New entity"}
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">
                {isEdit ? `${entity?.code} · ${entity?.name}` : "Add an entity"}
              </h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Identity */}
          <Section title="Identity">
            <FieldLabel label="Name" required>
              <input
                className="input"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder={namePlaceholder}
                autoFocus={!isEdit}
              />
            </FieldLabel>

            <FieldLabel label="Type" required>
              <EntityTypeField
                value={form.entity_type}
                options={entityTypeOptions}
                onChange={(next) => update("entity_type", next)}
                onCatalogChange={onEntityTypeCatalogChange}
              />
            </FieldLabel>

            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Code" hint={isEdit ? "Fixed once created." : "Auto-generated from the name if blank."}>
                <input
                  className="input font-mono uppercase"
                  value={form.code}
                  onChange={(e) => update("code", e.target.value.toUpperCase())}
                  placeholder={isEdit ? "" : "Auto"}
                  disabled={isEdit}
                />
              </FieldLabel>
              <FieldLabel label="Legal name" hint="Full registered name">
                <input
                  className="input"
                  value={form.legal_name}
                  onChange={(e) => update("legal_name", e.target.value)}
                  placeholder={isPerson ? "e.g. Thomas Jakob Müller" : "e.g. Schmidt Holdings AG"}
                />
              </FieldLabel>
            </div>
          </Section>

          {/* Books & jurisdiction */}
          <Section title="Books & jurisdiction">
            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Country" hint="ISO 3166-1 alpha-2">
                <input
                  className="input uppercase font-mono"
                  list={COUNTRY_DATALIST_ID}
                  value={form.country}
                  onChange={(e) => {
                    const next = e.target.value.toUpperCase().slice(0, 2);
                    setForm((f) => ({
                      ...f,
                      country: next,
                      accounting_standard: f.accounting_standard_touched
                        ? f.accounting_standard
                        : defaultStandardForCountry(next),
                    }));
                  }}
                  maxLength={2}
                  placeholder="CH"
                />
              </FieldLabel>
              <FieldLabel label="Functional currency" required hint="ISO 4217">
                <input
                  className="input font-mono"
                  list={CURRENCY_DATALIST_ID}
                  value={form.functional_currency}
                  onChange={(e) => update("functional_currency", e.target.value.toUpperCase().slice(0, 3))}
                  maxLength={3}
                  placeholder="EUR"
                />
              </FieldLabel>
            </div>

            <FieldLabel
              label="Accounting standard"
              required
              hint="Drives AI account suggestions and the teaching note shown next to each AI proposal. Defaults from country."
            >
              <select
                className="input"
                value={form.accounting_standard}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    accounting_standard: e.target.value,
                    accounting_standard_touched: true,
                  }))
                }
              >
                {ACCOUNTING_STANDARDS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </FieldLabel>

            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Reporting currency" hint="Blank = same as functional">
                <input
                  className="input font-mono"
                  list={CURRENCY_DATALIST_ID}
                  value={form.reporting_currency}
                  onChange={(e) => update("reporting_currency", e.target.value.toUpperCase().slice(0, 3))}
                  maxLength={3}
                  placeholder="Same as functional"
                />
              </FieldLabel>
              <FieldLabel label="Fiscal year starts">
                <select
                  className="input"
                  value={form.fiscal_year_start_month}
                  onChange={(e) => update("fiscal_year_start_month", Number(e.target.value))}
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </FieldLabel>
            </div>

            <FieldLabel label="Tax ID" hint="UID, VAT, TIN, etc.">
              <input
                className="input font-mono"
                value={form.tax_id}
                onChange={(e) => update("tax_id", e.target.value)}
                placeholder={isPerson ? "e.g. 756.1234.5678.90" : "e.g. CHE-123.456.789"}
              />
            </FieldLabel>
          </Section>

          {/* Hierarchy */}
          <Section title="Hierarchy">
            <FieldLabel label="Parent entity" hint="Leave blank for top-of-house (consolidation root).">
              <select className="input" value={form.parent} onChange={(e) => update("parent", e.target.value)}>
                <option value="">— Top-of-house —</option>
                {parentCandidates.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                ))}
              </select>
            </FieldLabel>
          </Section>

          {/* Notes */}
          <Section title="Notes">
            <FieldLabel label="Internal notes" hint="Not shown on external reports">
              <textarea
                className="input min-h-[80px] resize-y"
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder={isPerson
                  ? "e.g. Principal beneficiary of the Müller Family Trust."
                  : "e.g. Zug-based holding — parent of the Swiss OpCo and the German subsidiary."}
              />
            </FieldLabel>

            {isEdit && (
              <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer mt-3">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-canvas-200"
                  checked={form.is_active}
                  onChange={(e) => update("is_active", e.target.checked)}
                />
                <span>
                  <span className="font-medium">Entity is active</span>
                  <span className="block text-gray-400 mt-0.5">
                    Archived entities are hidden from pickers. History remains intact.
                  </span>
                </span>
              </label>
            )}
          </Section>

          <EntityReferenceDatalists />

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-canvas-100 bg-white/95 backdrop-blur px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            type="submit"
            onClick={(e) => submit(e as any)}
            disabled={saving || !form.name.trim()}
            className="btn-primary"
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create entity"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Tiny helpers ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function EntityReferenceDatalists() {
  return (
    <>
      <datalist id={COUNTRY_DATALIST_ID}>
        {COUNTRY_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </datalist>
      <datalist id={CURRENCY_DATALIST_ID}>
        {CURRENCY_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </datalist>
    </>
  );
}

function EntityTypeField({
  value, options, onChange, onCatalogChange,
}: {
  value: string;
  options: EntityTypeOption[];
  onChange: (next: string) => void;
  onCatalogChange: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function saveCustom() {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.post<{ value: string }>("/beakon/entity-types/", {
        label: newLabel.trim(),
        value: newValue.trim(),
      });
      await onCatalogChange();
      onChange(created.value);
      setAdding(false);
      setNewLabel("");
      setNewValue("");
    } catch (e: any) {
      setErr(typeof e?.detail === "string" ? e.detail : JSON.stringify(e?.detail || e));
    } finally {
      setBusy(false);
    }
  }

  async function removeCustom(id?: number) {
    if (!id) return;
    try {
      await api.delete(`/beakon/entity-types/${id}/`);
      if (options.find((o) => o.id === id)?.value === value) onChange("company");
      await onCatalogChange();
    } catch (e: any) {
      setErr(typeof e?.detail === "string" ? e.detail : JSON.stringify(e?.detail || e));
    }
  }

  return (
    <div className="space-y-2">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Built-in">
          {options.filter((o) => !o.is_custom).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </optgroup>
        {options.some((o) => o.is_custom) && (
          <optgroup label="Custom">
            {options.filter((o) => o.is_custom).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        )}
      </select>

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:text-brand-900"
        >
          <Plus className="h-3 w-3" /> Add custom type
        </button>
      ) : (
        <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-2.5 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-800">
            New entity type
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              autoFocus
              className="input"
              placeholder="Label (e.g. Private Foundation)"
              value={newLabel}
              onChange={(e) => {
                setNewLabel(e.target.value);
                if (!newValue) setNewValue(slugify(e.target.value));
              }}
            />
            <input
              className="input font-mono text-xs"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(slugify(e.target.value))}
            />
          </div>
          {err && <div className="text-[11px] text-rose-700">{err}</div>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAdding(false); setErr(null); setNewLabel(""); setNewValue(""); }}
              className="text-[11px] px-2 py-1 rounded text-gray-600 hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !newLabel.trim() || !newValue.trim()}
              onClick={saveCustom}
              className="text-[11px] px-2.5 py-1 rounded bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Add type"}
            </button>
          </div>
        </div>
      )}

      {options.some((o) => o.is_custom) && (
        <div className="flex flex-wrap gap-1.5">
          {options.filter((o) => o.is_custom).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => void removeCustom(o.id)}
              className="inline-flex items-center gap-1 rounded-full border border-canvas-200 bg-white px-2 py-0.5 text-[10px] text-gray-600 hover:border-rose-200 hover:text-rose-700"
              title="Delete custom type"
            >
              <span>{o.label}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <span className="block text-[10px] text-gray-400">
        Built-ins stay available. Custom types are organization-specific.
      </span>
    </div>
  );
}


function FieldLabel({
  label, hint, required, className, children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10px] text-gray-400">{hint}</span>}
    </label>
  );
}
