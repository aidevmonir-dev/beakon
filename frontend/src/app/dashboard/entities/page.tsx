"use client";

/* Entities — legal / reporting units inside an organization.
 *
 * Every journal entry binds to exactly one entity. The entity tree also
 * drives consolidated reporting and intercompany relationships, so this
 * page is core, not incidental.
 *
 * UI rule: show only what carries information.
 *   · no organization  → one strong empty state, nothing else
 *   · no entities yet   → one strong empty state, nothing else
 *   · with data         → summary cards + toolbar + table, with filter
 *                         controls hidden when the dataset makes them
 *                         meaningless (one currency, no hierarchy, etc.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Building2, Plus, X, Search, Globe, Coins, Check,
  User, MoreHorizontal, Archive, Pencil, ExternalLink,
  AlertCircle, Command, Info, Network, Building, ChevronDown, Briefcase,
} from "lucide-react";
import { api, syncOrganizationContext } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryStat } from "@/components/ui/summary-stat";
import { FilterChip } from "@/components/ui/filter-chip";
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

// Per Thomas's spec: every entity declares its reporting framework. Drives
// AI proposal conventions and the teaching note shown in the JE detail view.
const ACCOUNTING_STANDARDS: { value: string; short: string; label: string }[] = [
  { value: "ifrs",    short: "IFRS",    label: "IFRS — International (used outside the US)" },
  { value: "us_gaap", short: "US GAAP", label: "US GAAP — United States" },
  { value: "uk_gaap", short: "UK GAAP", label: "UK GAAP — FRS 102 / FRS 105" },
  { value: "other",   short: "Other",   label: "Other / local (AI defaults to IFRS-equivalent)" },
];

function defaultStandardForCountry(cc: string): string {
  const code = (cc || "").toUpperCase().trim();
  if (code === "US") return "us_gaap";
  if (code === "GB") return "uk_gaap";
  return "ifrs";
}

function standardShort(value: string): string {
  return ACCOUNTING_STANDARDS.find((s) => s.value === value)?.short || value || "—";
}

interface EntityTypeOption {
  value: string;
  label: string;
  pill?: string;
  is_custom?: boolean;
  id?: number;
}

const ENTITY_TYPES: EntityTypeOption[] = [
  { value: "company",     label: "Company",     pill: "bg-brand-50 text-brand-800 ring-brand-100" },
  { value: "holding_company", label: "Holding Company", pill: "bg-cyan-50 text-cyan-800 ring-cyan-100" },
  { value: "operating_company", label: "Operating Company", pill: "bg-blue-50 text-blue-800 ring-blue-100" },
  { value: "trust",       label: "Trust",       pill: "bg-indigo-50 text-indigo-700 ring-indigo-100" },
  { value: "foundation",  label: "Foundation",  pill: "bg-violet-50 text-violet-700 ring-violet-100" },
  { value: "partnership", label: "Partnership", pill: "bg-amber-50 text-amber-700 ring-amber-100" },
  { value: "fund",        label: "Fund",        pill: "bg-emerald-50 text-emerald-700 ring-emerald-100" },
  { value: "branch",      label: "Branch",      pill: "bg-sky-50 text-sky-700 ring-sky-100" },
  { value: "individual",  label: "Person",      pill: "bg-rose-50 text-rose-700 ring-rose-100" },
  { value: "family",      label: "Family",      pill: "bg-orange-50 text-orange-700 ring-orange-100" },
  { value: "spv",         label: "SPV",         pill: "bg-teal-50 text-teal-700 ring-teal-100" },
  { value: "other",       label: "Other",       pill: "bg-gray-100 text-gray-700 ring-gray-200" },
];

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// Europe-first dropdowns used by the create / edit drawer. Keeping these
// short and meaningful beats a 200-item select — users who need something
// exotic can type it (the input still accepts uppercase 3-letter / 2-letter
// overrides via the Advanced section).
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

const COUNTRY_DATALIST_ID = "entity-country-options";
const CURRENCY_DATALIST_ID = "entity-currency-options";

type StatusFilter = "all" | "active" | "inactive";


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

  // Filters
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");
  const [country, setCountry] = useState<string>("all");
  const [currency, setCurrency] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [hierarchy, setHierarchy] = useState<"all" | "top" | "sub">("all");

  const [drawer, setDrawer] =
    useState<{ mode: "create" } | { mode: "edit"; entity: Entity } | null>(null);

  // Keyboard
  const searchRef = useRef<HTMLInputElement>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  // ── Org bootstrap ────────────────────────────────────────────────────
  // Always fetch memberships so the no-org state knows whether "Switch
  // organization" is a real option or whether the only path is create.
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

  // ── Derived data ─────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => entities.filter((e) => {
    if (typeFilter !== "all" && e.entity_type !== typeFilter) return false;
    if (country !== "all" && e.country !== country) return false;
    if (currency !== "all" && e.functional_currency !== currency) return false;
    if (status === "active" && !e.is_active) return false;
    if (status === "inactive" && e.is_active) return false;
    if (hierarchy === "top" && e.parent !== null) return false;
    if (hierarchy === "sub" && e.parent === null) return false;
    if (q) {
      const hay = `${e.code} ${e.name} ${e.legal_name} ${e.tax_id} ${e.entity_type} ${e.country}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [entities, typeFilter, country, currency, status, hierarchy, q]);

  // Summary stats across *full* dataset so they reflect the org, not the filter.
  const stats = useMemo(() => {
    const total = entities.length;
    const active = entities.filter((e) => e.is_active).length;
    const jurisdictions = new Set(entities.map((e) => e.country).filter(Boolean));
    const currencies = new Set(entities.map((e) => e.functional_currency).filter(Boolean));
    return { total, active, jurisdictions: jurisdictions.size, currencies: currencies.size };
  }, [entities]);

  // Unique countries + currencies for the dropdowns.
  const uniqueCountries = useMemo(
    () => Array.from(new Set(entities.map((e) => e.country).filter(Boolean))).sort(),
    [entities],
  );
  const uniqueCurrencies = useMemo(
    () => Array.from(new Set(entities.map((e) => e.functional_currency).filter(Boolean))).sort(),
    [entities],
  );
  const hasHierarchy = useMemo(() => entities.some((e) => e.parent !== null), [entities]);
  const hasMultipleTypes = useMemo(
    () => new Set(entities.map((e) => e.entity_type)).size > 1,
    [entities],
  );

  // Type counts (apply every filter except type itself).
  const typeCounts = useMemo(() => {
    const base = entities.filter((e) => {
      if (country !== "all" && e.country !== country) return false;
      if (currency !== "all" && e.functional_currency !== currency) return false;
      if (status === "active" && !e.is_active) return false;
      if (status === "inactive" && e.is_active) return false;
      if (hierarchy === "top" && e.parent !== null) return false;
      if (hierarchy === "sub" && e.parent === null) return false;
      return true;
    });
    const counts = new Map<string, number>();
    for (const t of ENTITY_TYPES) counts.set(t.value, 0);
    for (const e of base) counts.set(e.entity_type, (counts.get(e.entity_type) || 0) + 1);
    return { counts, total: base.length };
  }, [entities, country, currency, status, hierarchy]);

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (country !== "all" ? 1 : 0) +
    (currency !== "all" ? 1 : 0) +
    (status !== "active" ? 1 : 0) +
    (hierarchy !== "all" ? 1 : 0) +
    (q ? 1 : 0);

  function resetFilters() {
    setQuery(""); setTypeFilter("all"); setCountry("all");
    setCurrency("all"); setStatus("active"); setHierarchy("all");
  }

  useEffect(() => {
    if (focusedIdx !== null && focusedIdx >= filtered.length) setFocusedIdx(null);
  }, [filtered, focusedIdx]);

  // Keyboard: / focus, ⌘K, arrows, Enter.
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
  // One strong empty state. No header description, no cards, no table —
  // nothing competes with the decision the user needs to make.
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

  // Header + CTA used by every org-scoped state below.
  const header = (
    <PageHeader
      title="Entities"
      description="Legal and reporting units. Each has its own books, functional currency, and fiscal calendar — and every journal entry posts to exactly one of them."
      context={
        orgName ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
            <Building2 className="h-3.5 w-3.5 text-brand-600" />
            <span className="font-medium text-gray-800">{orgName}</span>
            {stats.total > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="tabular-nums">{stats.total} {stats.total === 1 ? "entity" : "entities"}</span>
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

  // ── Loading (first paint) ────────────────────────────────────────────
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

  // ── Load error ───────────────────────────────────────────────────────
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

  // ── Has org, zero entities ───────────────────────────────────────────
  // Skip the cards and the toolbar entirely — they would all be zero or
  // empty. Let the create action be the whole screen.
  if (entities.length === 0) {
    return (
      <div>
        {header}
        <div className="mt-6">
          <EmptyState
            tone="brand"
            icon={Building2}
            title="Create your first entity"
            description="Start with the top-of-house — typically the holding company or family trust. Subsidiaries and branches can be added once the parent exists."
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

  // Toolbar controls are only useful once the underlying dataset has
  // more than one value to filter on. Build these flags once.
  const showCountryFilter  = uniqueCountries.length > 1;
  const showCurrencyFilter = uniqueCurrencies.length > 1;
  const showStructureChips = hasHierarchy;
  const showTypeChips      = hasMultipleTypes;
  const hasAnySelect       = showCountryFilter || showCurrencyFilter || true; // status always useful
  const hasAnyChipRail     = showStructureChips || showTypeChips;

  // ── Main page (has data) ─────────────────────────────────────────────
  return (
    <div>
      {header}

      {/* Summary stats — only rendered when there is data to describe. */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryStat
          label="Total entities"
          value={stats.total}
          hint={`${stats.active} active · ${stats.total - stats.active} archived`}
          icon={Building2}
          tone="brand"
        />
        <SummaryStat
          label="Active"
          value={stats.active}
          hint={
            stats.total === 0
              ? "—"
              : stats.active === 0
                ? "All archived"
                : stats.active === stats.total
                  ? "All active"
                  : `${Math.round((stats.active / stats.total) * 100)}% of total`
          }
          icon={Check}
          tone="mint"
        />
        <SummaryStat
          label="Jurisdictions"
          value={stats.jurisdictions}
          hint={stats.jurisdictions === 1 ? "Single jurisdiction" : "Distinct countries"}
          icon={Globe}
          tone="indigo"
        />
        <SummaryStat
          label="Currencies"
          value={stats.currencies}
          hint={stats.currencies === 1 ? "Single currency" : "Distinct functional currencies"}
          icon={Coins}
          tone="amber"
        />
      </div>

      {/* Toolbar */}
      <div className="mt-5 rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by code, name, legal name, tax ID"
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
          {hasAnySelect && (
            <div className="flex flex-wrap items-center gap-2">
              {showCountryFilter && (
                <select className="h-10 rounded-xl border border-canvas-200 bg-white text-sm px-3 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none" value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="all">All jurisdictions</option>
                  {uniqueCountries.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              )}
              {showCurrencyFilter && (
                <select className="h-10 rounded-xl border border-canvas-200 bg-white text-sm px-3 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="all">All currencies</option>
                  {uniqueCurrencies.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              )}
              <select className="h-10 rounded-xl border border-canvas-200 bg-white text-sm px-3 focus:border-brand-400 focus:ring-4 focus:ring-brand-50 outline-none" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                <option value="active">Active only</option>
                <option value="all">All statuses</option>
                <option value="inactive">Archived</option>
              </select>
            </div>
          )}
        </div>

        {/* Chip rail — hierarchy + type. Hidden entirely until the dataset
            has either a parent relationship or more than one type. */}
        {hasAnyChipRail && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-canvas-100 px-3 py-2.5">
            {showStructureChips && (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mr-1">Structure</span>
                <FilterChip active={hierarchy === "all"} onClick={() => setHierarchy("all")}>All</FilterChip>
                <FilterChip active={hierarchy === "top"} onClick={() => setHierarchy("top")}>Top-of-house</FilterChip>
                <FilterChip active={hierarchy === "sub"} onClick={() => setHierarchy("sub")}>Subsidiaries</FilterChip>
              </>
            )}

            {showStructureChips && showTypeChips && (
              <span className="mx-2 h-4 w-px bg-canvas-200" />
            )}

            {showTypeChips && (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 mr-1">Type</span>
                <FilterChip active={typeFilter === "all"} onClick={() => setTypeFilter("all")} count={typeCounts.total}>All</FilterChip>
                {ENTITY_TYPES.map((t) => {
                  const c = typeCounts.counts.get(t.value) || 0;
                  if (c === 0 && typeFilter !== t.value) return null;
                  return (
                    <FilterChip
                      key={t.value}
                      active={typeFilter === t.value}
                      onClick={() => setTypeFilter(t.value)}
                      count={c}
                    >
                      {t.label}
                    </FilterChip>
                  );
                })}
              </>
            )}

            {activeFilterCount > 0 && (
              <>
                <span className="mx-2 h-4 w-px bg-canvas-200" />
                <button type="button" onClick={resetFilters} className="text-xs text-brand-700 font-medium hover:text-brand-900 hover:underline">
                  Reset filters
                </button>
              </>
            )}
          </div>
        )}
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
                <th className="hidden lg:table-cell pr-4 py-2.5 font-semibold">Jurisdiction</th>
                <th className="hidden lg:table-cell pr-4 py-2.5 font-semibold">Currency</th>
                <th className="hidden xl:table-cell pr-4 py-2.5 font-semibold">Parent</th>
                <th className="pr-4 py-2.5 font-semibold">Status</th>
                <th className="w-10 pr-3 py-2.5"></th>
              </tr>
            </thead>

            {loading ? (
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} columns={8} />)}
              </tbody>
            ) : filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      icon={Search}
                      title="No entities match these filters"
                      description="Try broadening the type, clearing the search, or switching status to see archived entities."
                      primaryAction={
                        activeFilterCount > 0
                          ? { label: "Reset filters", onClick: resetFilters }
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
                            <div className="text-sm font-medium text-gray-900 truncate">{e.name}</div>
                            {e.legal_name && e.legal_name !== e.name && (
                              <div className="text-[11px] text-gray-400 truncate">{e.legal_name}</div>
                            )}
                          </div>
                          <Link
                            href={`/dashboard/entities/${e.id}?tab=investments`}
                            onClick={(ev) => ev.stopPropagation()}
                            title="View investments"
                            className="hidden sm:inline-flex items-center gap-1 rounded-full border border-brand-100 bg-brand-50/80 px-2 py-0.5 text-[10px] font-semibold text-brand-700 hover:bg-brand-100 transition-colors shrink-0"
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
                      <td className="hidden lg:table-cell pr-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                          <Globe className="h-3 w-3 text-gray-400" />
                          <span className="font-mono">{e.country || "—"}</span>
                        </span>
                      </td>
                      <td className="hidden lg:table-cell pr-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="font-mono text-xs text-gray-700">{e.functional_currency}</div>
                          {e.accounting_standard && (
                            <span
                              className="inline-flex items-center rounded-full bg-canvas-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600 ring-1 ring-inset ring-canvas-200"
                              title={`Accounting standard: ${ACCOUNTING_STANDARDS.find((s) => s.value === e.accounting_standard)?.label || e.accounting_standard}`}
                            >
                              {standardShort(e.accounting_standard)}
                            </span>
                          )}
                        </div>
                        {e.reporting_currency && e.reporting_currency !== e.functional_currency && (
                          <div className="text-[10px] text-gray-400">reports in {e.reporting_currency}</div>
                        )}
                      </td>
                      <td className="hidden xl:table-cell pr-4 py-2.5 text-xs">
                        {e.parent_code ? (
                          <span className="inline-flex items-center gap-1 font-mono text-gray-600">
                            <Network className="h-3 w-3 text-gray-400" />
                            {e.parent_code}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">top-of-house</span>
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
  entity, onEdit, onArchive,
}: { entity: Entity; onEdit: () => void; onArchive: () => void }) {
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
            {entity.is_active && (
              <button
                onClick={(ev) => { ev.stopPropagation(); setOpen(false); onArchive(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-amber-700 hover:bg-amber-50"
              >
                <Archive className="h-3.5 w-3.5" /> Archive
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
    // Tracks whether the user manually picked a standard. Until they do,
    // changing the country auto-updates the standard. After a manual pick,
    // we stop overriding so we don't clobber an explicit choice.
    accounting_standard_touched: Boolean(entity?.accounting_standard),
    fiscal_year_start_month: entity?.fiscal_year_start_month || 1,
    tax_id: entity?.tax_id || "",
    notes: entity?.notes || "",
    is_active: entity?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "More options" is collapsed by default on create, expanded on edit so
  // existing values (code, legal name, tax ID) stay visible for review.
  const [advancedOpen, setAdvancedOpen] = useState(isEdit);

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const parentCandidates = entities.filter(
    (e) => e.id !== entity?.id && e.is_active,
  );

  // Auto-derive a short unique code from the name when the user hasn't
  // set one. Client-side only — Thomas can rename via edit later.
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

  const meta = typeMeta(form.entity_type);
  const isPerson = form.entity_type === "individual";
  // Pick an example name that fits the selected type — helps Thomas see what
  // to type for a Swiss family-office setup.
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
      <div className="w-full sm:w-[520px] bg-white border-l border-canvas-200 overflow-y-auto flex flex-col">
        {/* Drawer header */}
        <div className="relative px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                {isEdit ? "Edit entity" : "New entity"}
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">
                {isEdit ? `${entity?.code} · ${entity?.name}` : "Add an entity"}
              </h2>
              {!isEdit && (
                <p className="mt-1 text-xs text-gray-500 max-w-sm">
                  Just name it and pick a type — we'll fill in sensible Swiss defaults. Refine the rest in "More options".
                </p>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Primary fields — name, type, country, currency */}
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
            <FieldLabel label="Country" hint="Pick a suggestion or type any ISO 3166-1 alpha-2 code">
              <input
                className="input uppercase font-mono"
                list={COUNTRY_DATALIST_ID}
                value={form.country}
                onChange={(e) => {
                  const next = e.target.value.toUpperCase().slice(0, 2);
                  setForm((f) => ({
                    ...f,
                    country: next,
                    // Only override the standard if the user hasn't manually
                    // picked one yet — otherwise we'd clobber an explicit
                    // choice when they tweak the country code.
                    accounting_standard: f.accounting_standard_touched
                      ? f.accounting_standard
                      : defaultStandardForCountry(next),
                  }));
                }}
                maxLength={2}
                placeholder="CH"
              />
            </FieldLabel>
            <FieldLabel label="Functional currency" required hint="Pick a suggestion or type any ISO 4217 code">
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
            hint="Drives how the AI proposes entries and what rule it cites in its teaching note. Defaults from country — change if your books follow a different framework."
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

          <EntityReferenceDatalists />

          {/* Contextual reassurance */}
          <div className="inline-flex items-center gap-2 rounded-lg bg-canvas-50 px-2.5 py-1.5 text-[11px] text-gray-600 ring-1 ring-inset ring-canvas-200/70">
            <Info className="h-3 w-3 text-gray-400" />
            <span>
              <span className={cn("inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full ring-1 ring-inset mr-1.5", meta.pill)}>
                {meta.label}
              </span>
              {isPerson
                ? "A person — can hold investments, bank accounts, and their own books."
                : form.parent
                  ? "Subsidiary — rolls up to its parent for consolidation."
                  : "Top-of-house — consolidation root for everything below."}
            </span>
          </div>

          {/* More options — collapsed by default on create */}
          <div className="rounded-xl border border-canvas-200/70 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-canvas-50 transition-colors"
              aria-expanded={advancedOpen}
            >
              <span className="text-xs font-semibold text-gray-700">More options</span>
              <span className="flex items-center gap-2">
                {!advancedOpen && (
                  <span className="text-[10px] text-gray-400">
                    Code, parent, reporting currency, FY, tax ID, notes
                  </span>
                )}
                <ChevronDown className={cn(
                  "h-4 w-4 text-gray-400 transition-transform",
                  advancedOpen && "rotate-180",
                )} />
              </span>
            </button>

            {advancedOpen && (
              <div className="border-t border-canvas-100 px-3.5 pt-3.5 pb-4 space-y-3.5 bg-canvas-50/40">
                <FieldLabel label="Code" hint={isEdit ? "The code is fixed once the entity exists." : "Leave blank to auto-generate from the name."}>
                  <input
                    className="input font-mono uppercase"
                    value={form.code}
                    onChange={(e) => update("code", e.target.value.toUpperCase())}
                    placeholder={isEdit ? "" : "Auto"}
                    disabled={isEdit}
                  />
                </FieldLabel>

                <FieldLabel label="Legal name" hint="Full registered name on legal documents">
                  <input
                    className="input"
                    value={form.legal_name}
                    onChange={(e) => update("legal_name", e.target.value)}
                    placeholder={isPerson ? "e.g. Thomas Jakob Müller" : "e.g. Schmidt Holdings AG"}
                  />
                </FieldLabel>

                <FieldLabel label="Parent entity" hint="For subsidiaries / sub-funds">
                  <select className="input" value={form.parent} onChange={(e) => update("parent", e.target.value)}>
                    <option value="">— Top-of-house —</option>
                    {parentCandidates.map((p) => (
                      <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                    ))}
                  </select>
                </FieldLabel>

                <div className="grid grid-cols-2 gap-3">
                  <FieldLabel label="Reporting currency" hint="Blank = same as functional. You can type any ISO 4217 code.">
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

                <FieldLabel label="Internal notes" hint="Not shown on external reports">
                  <textarea
                    className="input min-h-[64px] resize-y"
                    value={form.notes}
                    onChange={(e) => update("notes", e.target.value)}
                    placeholder={isPerson
                      ? "e.g. Principal beneficiary of the Müller Family Trust."
                      : "e.g. Zug-based holding — parent of the Swiss OpCo and the German subsidiary."}
                  />
                </FieldLabel>

                {isEdit && (
                  <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
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
              </div>
            )}
          </div>

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
