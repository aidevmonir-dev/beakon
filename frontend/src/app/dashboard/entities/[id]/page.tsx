"use client";

/* Entity detail — single-entity view.
 *
 * Mirrors the listing page's visual vocabulary: PageHeader at top, tonal
 * chips for type/status, quiet card panels, restrained color. Keeps the
 * existing overview, investments tab, edit drawer, and delete/deactivate
 * flow intact — only the surrounding chrome has been calmed down.
 */
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle, AlertTriangle, ArrowLeft, Briefcase, Building, Building2,
  ChevronRight, Coins, Globe, Info, Landmark, Network, Pencil, Plus, TrendingUp,
  Trash2, User, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRow } from "@/components/ui/skeleton";


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
  fiscal_year_start_month: number;
  tax_id: string;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface EntityTypeOption {
  value: string;
  label: string;
  is_custom?: boolean;
  id?: number;
}


const ENTITY_TYPE_LABELS: Record<string, string> = {
  company: "Company",
  holding_company: "Holding Company",
  operating_company: "Operating Company",
  trust: "Trust",
  foundation: "Foundation",
  partnership: "Partnership",
  individual: "Person",
  family: "Family",
  fund: "Fund",
  branch: "Branch",
  spv: "SPV",
  other: "Other",
};

const ENTITY_TYPE_PILLS: Record<string, string> = {
  company:     "bg-brand-50 text-brand-800 ring-brand-100",
  holding_company: "bg-cyan-50 text-cyan-800 ring-cyan-100",
  operating_company: "bg-blue-50 text-blue-800 ring-blue-100",
  trust:       "bg-indigo-50 text-indigo-700 ring-indigo-100",
  foundation:  "bg-violet-50 text-violet-700 ring-violet-100",
  partnership: "bg-amber-50 text-amber-700 ring-amber-100",
  fund:        "bg-emerald-50 text-emerald-700 ring-emerald-100",
  branch:      "bg-sky-50 text-sky-700 ring-sky-100",
  individual:  "bg-rose-50 text-rose-700 ring-rose-100",
  family:      "bg-orange-50 text-orange-700 ring-orange-100",
  spv:         "bg-teal-50 text-teal-700 ring-teal-100",
  other:       "bg-gray-100 text-gray-700 ring-gray-200",
};

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
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

const COUNTRY_DATALIST_ID = "entity-detail-country-options";
const CURRENCY_DATALIST_ID = "entity-detail-currency-options";

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}


export default function EntityDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params?.id;
  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Initial tab: honour ?tab=investments, otherwise default to overview.
  const initialTab = (searchParams?.get("tab") === "investments") ? "investments" : "overview";
  const [tab, setTab] = useState<"overview" | "investments">(initialTab);
  const [tabInitialized, setTabInitialized] = useState(searchParams?.get("tab") != null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = async () => {
    try {
      const e = await api.get<Entity>(`/beakon/entities/${id}/`);
      setEntity(e);
    } catch (err: any) {
      setError(typeof err?.detail === "string" ? err.detail : "Failed to load entity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Once the entity is loaded, lock in the initial tab state.
  useEffect(() => {
    if (!entity || tabInitialized) return;
    setTabInitialized(true);
  }, [entity, tabInitialized]);

  // Back link is always visible — it frames the page even during loading/error.
  const backLink = (
    <Link
      href="/dashboard/entities"
      className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" /> Back to entities
    </Link>
  );

  if (loading) {
    return (
      <div>
        {backLink}
        <div className="mt-3 overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <table className="w-full text-sm">
            <tbody>
              {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} columns={3} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  if (error || !entity) {
    return (
      <div>
        {backLink}
        <div className="mt-4">
          <EmptyState
            tone="warning"
            icon={AlertCircle}
            title="Couldn't load this entity"
            description={error || "It may have been deleted or you may not have access."}
            primaryAction={{ label: "Back to entities", onClick: () => router.push("/dashboard/entities") }}
          />
        </div>
      </div>
    );
  }

  const isPerson = entity.entity_type === "individual";
  const AvatarIcon = isPerson ? User : Building;
  const typeLabel = ENTITY_TYPE_LABELS[entity.entity_type] || entity.entity_type;
  const typePill = ENTITY_TYPE_PILLS[entity.entity_type] || ENTITY_TYPE_PILLS.other;

  return (
    <div>
      {backLink}

      <div className="mt-3">
        <PageHeader
          title={entity.name}
          description={entity.legal_name && entity.legal_name !== entity.name ? entity.legal_name : undefined}
          context={
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-xs text-gray-600">
                <AvatarIcon className="h-3.5 w-3.5 text-gray-500" />
                <span className="font-mono font-medium text-gray-800">{entity.code}</span>
              </span>
              <span className={cn(
                "inline-flex items-center text-[11px] px-2 py-1 rounded-full ring-1 ring-inset",
                typePill,
              )}>
                {typeLabel}
              </span>
              <span className={cn(
                "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full ring-1 ring-inset",
                entity.is_active
                  ? "bg-mint-50 text-mint-700 ring-mint-200/80"
                  : "bg-gray-100 text-gray-600 ring-gray-200",
              )}>
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  entity.is_active ? "bg-mint-500" : "bg-gray-400",
                )} />
                {entity.is_active ? "Active" : "Archived"}
              </span>
              {entity.parent_code && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-canvas-200 bg-white/80 px-2.5 py-1 text-[11px] text-gray-600">
                  <Network className="h-3 w-3 text-gray-400" />
                  <span>Parent: <span className="font-mono text-gray-800">{entity.parent_code}</span></span>
                </span>
              )}
            </div>
          }
          actions={
            <>
              <button
                onClick={() => setEditOpen(true)}
                className="btn-secondary"
                title="Edit entity"
              >
                <Pencil className="w-4 h-4 mr-1.5" /> Edit
              </button>
              <button
                onClick={() => setDeleteOpen(true)}
                className="btn-secondary text-red-600 hover:bg-red-50"
                title="Delete entity"
              >
                <Trash2 className="w-4 h-4 mr-1.5" /> Delete
              </button>
            </>
          }
        />
      </div>

      <div className="mt-5 border-b-2 border-canvas-200">
        <div className="flex gap-2">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
            <Info className="w-4 h-4 mr-2" /> Overview
          </TabButton>
          <TabButton active={tab === "investments"} onClick={() => setTab("investments")}>
            <Briefcase className="w-4 h-4 mr-2" /> Investments
          </TabButton>
        </div>
      </div>

      <div className="mt-5">
        {tab === "overview" && <OverviewTab entity={entity} />}
        {tab === "investments" && <InvestmentsTab entity={entity} />}
      </div>

      {editOpen && (
        <EditDrawer
          entity={entity}
          onClose={() => setEditOpen(false)}
          onSaved={async () => { setEditOpen(false); await load(); }}
        />
      )}
      {deleteOpen && (
        <DeleteConfirm
          entity={entity}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => router.push("/dashboard/entities")}
          onDeactivated={async () => { setDeleteOpen(false); await load(); }}
        />
      )}
    </div>
  );
}


// ── Overview tab ──────────────────────────────────────────────────────────

function OverviewTab({ entity }: { entity: Entity }) {
  const fyStart = MONTHS[Math.max(0, Math.min(11, (entity.fiscal_year_start_month || 1) - 1))];

  const identity: Row[] = [
    ["Code", <span className="font-mono text-gray-800" key="code">{entity.code}</span>],
    ["Name", entity.name],
    ["Legal name", entity.legal_name || <Muted>—</Muted>],
    ["Entity type", ENTITY_TYPE_LABELS[entity.entity_type] || entity.entity_type],
  ];

  const structure: Row[] = [
    ["Parent", entity.parent_code
      ? <span className="font-mono text-gray-800">{entity.parent_code}</span>
      : <Muted italic>top-of-house</Muted>],
  ];

  const reporting: Row[] = [
    ["Functional currency", <span className="font-mono text-gray-800" key="fc">{entity.functional_currency}</span>],
    ["Reporting currency", entity.reporting_currency && entity.reporting_currency !== entity.functional_currency
      ? <span className="font-mono text-gray-800" key="rc">{entity.reporting_currency}</span>
      : <Muted>same as functional</Muted>],
    ["Fiscal year starts", fyStart],
  ];

  const jurisdiction: Row[] = [
    ["Country", entity.country
      ? <span className="inline-flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-gray-400" /><span className="font-mono">{entity.country}</span></span>
      : <Muted>—</Muted>],
    ["Tax ID", entity.tax_id
      ? <span className="font-mono">{entity.tax_id}</span>
      : <Muted>—</Muted>],
  ];

  return (
    <div className="space-y-4">
      <Panel title="Identity" rows={identity} />
      <Panel title="Structure" rows={structure} />
      <Panel title="Reporting" rows={reporting} />
      <Panel title="Jurisdiction" rows={jurisdiction} />
      {entity.notes && (
        <Panel
          title="Notes"
          rows={[["Internal notes", <span className="whitespace-pre-wrap" key="notes">{entity.notes}</span>]]}
        />
      )}
    </div>
  );
}

type Row = [string, React.ReactNode];

function Panel({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="border-b border-canvas-100 bg-canvas-50/60 px-4 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">{title}</h3>
      </div>
      <dl className="divide-y divide-canvas-100">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-3 gap-4 px-4 py-2.5 text-sm">
            <dt className="text-xs font-medium text-gray-500">{label}</dt>
            <dd className="col-span-2 text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Muted({ children, italic }: { children: React.ReactNode; italic?: boolean }) {
  return <span className={cn("text-gray-400", italic && "italic")}>{children}</span>;
}


// ── Investments tab ───────────────────────────────────────────────────────

interface LedgerEntry {
  line_id: number;
  journal_entry_id: number;
  date: string;
  memo: string;
  debit: string;
  credit: string;
  native_currency: string;
  native_debit: string;
  native_credit: string;
  exchange_rate: string;
  running_balance: string;
}

interface LedgerResponse {
  account: { id: number; code: string; name: string };
  opening_balance: string;
  closing_balance: string;
  entries: LedgerEntry[];
}

interface AccountRow {
  id: number;
  code: string;
  name: string;
  account_subtype: string;
}


interface HoldingRow {
  account: AccountRow;
  closingBalance: number;
  currency: string;
  lastDate: string | null;
  ledger: LedgerResponse;
}


function InvestmentsTab({ entity }: { entity: Entity }) {
  const [loading, setLoading] = useState(true);
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [cash, setCash] = useState<HoldingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newHoldingOpen, setNewHoldingOpen] = useState(false);
  const [drillInto, setDrillInto] = useState<HoldingRow | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const accts = await api.get<{ results: AccountRow[] } | AccountRow[]>(
        `/beakon/accounts/?entity=${entity.id}&is_active=true`,
      );
      const list = Array.isArray(accts) ? accts : (accts.results ?? []);
      const invAccts  = list.filter((a) => a.account_subtype === "investment");
      const bankAccts = list.filter((a) => a.account_subtype === "bank" || a.account_subtype === "cash");

      const fetchLedger = (id: number) =>
        api.get<LedgerResponse>(`/beakon/reports/account-ledger/?account_id=${id}`);

      const toRow = (a: AccountRow, l: LedgerResponse): HoldingRow => {
        const entries = l.entries || [];
        const lastDate = entries.length ? entries[entries.length - 1].date : null;
        const currency = entries.length ? entries[entries.length - 1].native_currency : entity.functional_currency;
        return {
          account: a,
          ledger: l,
          closingBalance: parseFloat(l.closing_balance || "0"),
          currency,
          lastDate,
        };
      };

      const [invLedgers, cashLedgers] = await Promise.all([
        Promise.all(invAccts.map((a) => fetchLedger(a.id))),
        Promise.all(bankAccts.map((a) => fetchLedger(a.id))),
      ]);
      setHoldings(invAccts.map((a, i) => toRow(a, invLedgers[i])));
      setCash(bankAccts.map((a, i) => toRow(a, cashLedgers[i])));
    } catch (e: any) {
      setError(typeof e?.detail === "string" ? e.detail : "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id]);

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} columns={3} />)}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) return (
    <EmptyState
      tone="warning"
      icon={AlertCircle}
      title="Couldn't load investment ledger"
      description={error}
      primaryAction={{ label: "Retry", onClick: () => void load() }}
    />
  );

  const fc = entity.functional_currency;
  const invTotal  = holdings.reduce((s, h) => s + h.closingBalance, 0);
  const cashTotal = cash.reduce((s, h) => s + h.closingBalance, 0);
  const totalValue = invTotal + cashTotal;
  const hasNothing = holdings.length === 0 && cash.length === 0;

  // Distinct currencies across all positions (for the summary chip).
  const currencies = new Set<string>();
  [...holdings, ...cash].forEach((h) => { if (h.currency) currencies.add(h.currency); });

  // ── Empty state — individual with nothing booked yet ────────────────
  if (hasNothing) {
    return (
      <>
        <div className="rounded-2xl border border-brand-100 bg-gradient-to-b from-brand-50/60 to-white px-6 py-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-brand-600 ring-1 ring-inset ring-brand-100">
            <Briefcase className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">
            No holdings yet for {entity.name}
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-gray-500 leading-relaxed">
            Add securities, funds, private assets, or cash positions for this entity.
            Each one becomes a trackable holding in the ledger.
          </p>
          <div className="mt-5">
            <button onClick={() => setNewHoldingOpen(true)} className="btn-primary">
              <Plus className="w-4 h-4 mr-1.5" /> Add first holding
            </button>
          </div>
          <DraftBadge className="mt-6" />
        </div>
        {newHoldingOpen && (
          <NewHoldingDialog
            entity={entity}
            onClose={() => setNewHoldingOpen(false)}
            onCreated={async () => { setNewHoldingOpen(false); await load(); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-[28px] border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_34%),linear-gradient(180deg,rgba(249,250,251,0.9),rgba(255,255,255,1))] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500">
                Investment workspace
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 sm:text-[30px]">
                {formatAmount(totalValue, fc)}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500">
                Book-value view across investment positions and treasury balances for {entity.name}.
                This snapshot is sourced directly from posted accounting entries in {fc}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DraftBadge />
              <button onClick={() => setNewHoldingOpen(true)} className="btn-primary">
                <Plus className="w-4 h-4 mr-1.5" /> New Holding
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t border-canvas-100 bg-canvas-50/50 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:px-6">
          <MetricCard
            label="Total portfolio"
            value={formatAmount(totalValue, fc)}
            note={`${holdings.length + cash.length} ledger-backed positions`}
            icon={Briefcase}
          />
          <MetricCard
            label="Investments"
            value={formatAmount(invTotal, fc)}
            note={`${holdings.length} ${holdings.length === 1 ? "holding" : "holdings"}`}
            icon={TrendingUp}
          />
          <MetricCard
            label="Cash & bank"
            value={formatAmount(cashTotal, fc)}
            note={`${cash.length} treasury ${cash.length === 1 ? "account" : "accounts"}`}
            icon={Landmark}
          />
          <MetricCard
            label="Currency footprint"
            value={`${currencies.size || 1}`}
            note={`${Array.from(currencies).join(" · ") || fc}`}
            icon={Coins}
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.85fr)]">
        <div className="space-y-5">
          <HoldingSection
            title="Investments"
            subtitle="Equities, bonds, funds, and other investment positions"
            icon={TrendingUp}
            rows={holdings}
            total={invTotal}
            fc={fc}
            emptyLabel="No investment positions yet. Add a holding to start tracking this portfolio."
            onClick={setDrillInto}
            accent="brand"
          />

          <HoldingSection
            title="Cash & bank"
            subtitle="Treasury balances and settlement cash"
            icon={Landmark}
            rows={cash}
            total={cashTotal}
            fc={fc}
            emptyLabel="No bank or cash accounts linked to this entity yet."
            accent="canvas"
          />
        </div>

        <div className="space-y-5">
          <PortfolioSidebarCard
            title="Allocation view"
            rows={[
              { label: "Investments", amount: invTotal, tone: "brand" },
              { label: "Cash & bank", amount: cashTotal, tone: "neutral" },
            ]}
            total={totalValue}
            fc={fc}
          />

          <div className="rounded-2xl border border-canvas-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
              What this view means
            </p>
            <div className="mt-3 space-y-3 text-sm text-gray-600">
              <div>
                <p className="font-medium text-gray-900">Accounting-first portfolio view</p>
                <p className="mt-1 leading-relaxed">
                  Balances come from posted journal lines, not market feeds, so this screen stays tied
                  to the books Thomas reviews.
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-900">Next phase</p>
                <p className="mt-1 leading-relaxed">
                  Instrument master, quantity, ticker, ISIN, pricing, and unrealised P&amp;L can sit on
                  top once Thomas signs off the workbook-driven dimension model.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-[12px] leading-relaxed text-amber-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <strong className="font-semibold">Draft scope.</strong> Values shown are book values in
            {` ${fc} `}derived from posted entries. Market valuation, FX revaluation, and performance
            analytics are intentionally deferred until the instrument and dimension layers are finalized.
          </div>
        </div>
      </div>

      {newHoldingOpen && (
        <NewHoldingDialog
          entity={entity}
          onClose={() => setNewHoldingOpen(false)}
          onCreated={async () => { setNewHoldingOpen(false); await load(); }}
        />
      )}
      {drillInto && (
        <HoldingLedgerModal
          holding={drillInto}
          fc={fc}
          onClose={() => setDrillInto(null)}
        />
      )}
    </div>
  );
}


function DraftBadge({ className }: { className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ring-1 ring-inset",
      "bg-amber-50 text-amber-700 ring-amber-100",
      className,
    )}>
      Draft
    </span>
  );
}


function HoldingSection({
  title, subtitle, icon: Icon, rows, total, fc, emptyLabel, onClick, accent,
}: {
  title: string;
  subtitle: string;
  icon: typeof TrendingUp;
  rows: HoldingRow[];
  total: number;
  fc: string;
  emptyLabel: string;
  onClick?: (r: HoldingRow) => void;
  accent: "brand" | "canvas";
}) {
  const accentClasses = accent === "brand"
    ? "from-brand-50/70 to-white"
    : "from-canvas-50/90 to-white";

  return (
    <div className="overflow-hidden rounded-2xl border border-canvas-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className={cn("border-b border-canvas-100 bg-gradient-to-b px-4 py-4 sm:px-5", accentClasses)}>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <Icon className="h-3.5 w-3.5 text-gray-500" />
              {title}
              <span className="ml-1 text-xs font-medium text-gray-400">
                ({rows.length})
              </span>
            </h2>
            <p className="mt-1 text-[11px] text-gray-500">{subtitle}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">Subtotal</p>
            <p className="text-sm font-semibold tabular-nums text-gray-900">{formatAmount(total, fc)}</p>
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {emptyLabel}
        </div>
      ) : (
        <div className="divide-y divide-canvas-100">
          {rows.map((r) => (
            <HoldingRowItem key={r.account.id} row={r} fc={fc} onClick={onClick} />
          ))}
        </div>
      )}
    </div>
  );
}


function HoldingRowItem({
  row, fc, onClick,
}: {
  row: HoldingRow;
  fc: string;
  onClick?: (r: HoldingRow) => void;
}) {
  const clickable = !!onClick && row.ledger.entries.length > 0;
  const native = row.currency;
  const showNative = native && native !== fc;
  const latestNative = row.ledger.entries.length
    ? (() => {
        // Sum native amounts as a rough native-book-value proxy.
        let n = 0;
        for (const e of row.ledger.entries) {
          n += parseFloat(e.native_debit || "0") - parseFloat(e.native_credit || "0");
        }
        return n;
      })()
    : 0;

  return (
    <button
      type="button"
      onClick={clickable ? () => onClick!(row) : undefined}
      disabled={!clickable}
      className={cn(
        "group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors sm:px-5",
        clickable ? "hover:bg-brand-50/40 cursor-pointer" : "cursor-default",
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-canvas-100 ring-1 ring-inset ring-canvas-200/80">
        <TrendingUp className="h-4 w-4 text-gray-500" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">{row.account.name}</span>
          <span className="font-mono text-[10px] text-gray-400">{row.account.code}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
          <span className="font-mono">{native || fc}</span>
          {row.lastDate && (
            <>
              <span className="text-gray-300">·</span>
              <span>Last activity {row.lastDate}</span>
            </>
          )}
          {row.ledger.entries.length === 0 && (
            <>
              <span className="text-gray-300">·</span>
              <span className="italic">No posted lines yet</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold tabular-nums text-gray-900">
          {formatAmount(row.closingBalance, fc)}
        </p>
        {showNative && (
          <p className="text-[11px] text-gray-400 tabular-nums">
            {formatAmount(latestNative, native)}
          </p>
        )}
      </div>
      {clickable && (
        <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 shrink-0" />
      )}
    </button>
  );
}

function MetricCard({
  label, value, note, icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Briefcase;
}) {
  return (
    <div className="rounded-2xl border border-canvas-200/70 bg-white/90 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">{label}</p>
          <p className="mt-2 text-lg font-semibold tracking-tight text-gray-900">{value}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{note}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-canvas-50 text-gray-500 ring-1 ring-inset ring-canvas-200/70">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function PortfolioSidebarCard({
  title, rows, total, fc,
}: {
  title: string;
  rows: { label: string; amount: number; tone: "brand" | "neutral" }[];
  total: number;
  fc: string;
}) {
  return (
    <div className="rounded-2xl border border-canvas-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">{title}</p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => {
          const share = total === 0 ? 0 : (row.amount / total) * 100;
          return (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-gray-700">{row.label}</span>
                <span className="font-mono text-xs text-gray-500">{share.toFixed(1)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-canvas-100">
                <div
                  className={cn("h-full rounded-full", row.tone === "brand" ? "bg-brand-500" : "bg-slate-400")}
                  style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
                />
              </div>
              <div className="text-[11px] font-medium tabular-nums text-gray-900">
                {formatAmount(row.amount, fc)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function HoldingLedgerModal({
  holding, fc, onClose,
}: {
  holding: HoldingRow;
  fc: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[680px] bg-white border-l border-canvas-200 overflow-y-auto flex flex-col">
        <div className="relative px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                Holding detail
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight truncate">
                {holding.account.name}
              </h2>
              <p className="text-[11px] text-gray-500 mt-0.5 font-mono">
                {holding.account.code} · {holding.currency || fc}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <LedgerTable ledger={holding.ledger} fc={fc} />
        </div>
      </div>
    </div>
  );
}


function NewHoldingDialog({
  entity, onClose, onCreated,
}: {
  entity: Entity;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(entity.functional_currency || "EUR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client-generates a short, unique-ish code from the holding name.
  // Thomas can rename the code later via the full accounts page.
  function deriveCode(n: string): string {
    const stem = n
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8) || "HOLDING";
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    return `INV-${stem}-${suffix}`;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/beakon/accounts/", {
        code: deriveCode(name),
        name: name.trim(),
        entity: entity.id,
        account_type: "asset",
        account_subtype: "investment",
        normal_balance: "debit",
        currency: currency.trim().toUpperCase(),
        parent: null,
        description: "",
        is_active: true,
      });
      await onCreated();
    } catch (e: any) {
      setError(typeof e?.detail === "string" ? e.detail : JSON.stringify(e?.detail || e || "Failed to create holding"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-[460px] rounded-2xl border border-canvas-200 bg-white shadow-xl">
        <div className="relative px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white rounded-t-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                New holding for {entity.name}
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">
                Add an investment
              </h2>
              <p className="mt-1 text-xs text-gray-500 max-w-sm">
                Creates an investment account under this person's books. Ledger entries (buys, sells,
                valuations) can then be posted against it.
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="px-5 py-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
              Holding name <span className="text-rose-500">*</span>
            </span>
            <input
              className="input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nestlé SA, Apple Inc (AAPL), Swiss Confederation 10Y bond"
              autoFocus
              required
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              Use a descriptive name — ticker, ISIN, or whatever helps identify the position.
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
              Native currency <span className="text-rose-500">*</span>
            </span>
            <input
              className="input mt-1 uppercase font-mono"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="EUR"
              required
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              The currency the position is denominated in. Reported back in {entity.functional_currency}.
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}

          <div className="rounded-lg bg-canvas-50 px-3 py-2 text-[11px] text-gray-500 ring-1 ring-inset ring-canvas-200/70">
            <strong className="text-gray-700">Draft:</strong> this is the placeholder shape for
            holdings. Once Thomas signs off on the instrument-master design (ticker, ISIN, share
            count, market price), this form will capture those fields too.
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={busy || !name.trim() || !currency.trim()} className="btn-primary">
              {busy ? "Adding…" : "Add holding"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function LedgerTable({ ledger, fc }: { ledger: LedgerResponse; fc: string }) {
  return (
    <div className="rounded-xl border border-canvas-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="font-mono text-xs text-gray-500">{ledger.account.code}</span>
          <span className="ml-2 text-sm font-medium text-gray-900">{ledger.account.name}</span>
        </div>
        <span className="text-xs text-gray-500">
          Balance: <span className="font-semibold text-gray-900 tabular-nums">
            {formatAmount(parseFloat(ledger.closing_balance), fc)}
          </span>
        </span>
      </div>
      {ledger.entries.length === 0 ? (
        <p className="text-xs text-gray-400 py-3">No posted lines yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wider border-b border-canvas-100">
                <th className="pb-1.5 font-medium">Date</th>
                <th className="pb-1.5 font-medium">Memo</th>
                <th className="pb-1.5 font-medium text-right">Native</th>
                <th className="pb-1.5 font-medium text-right">Functional ({fc})</th>
                <th className="pb-1.5 font-medium text-right">Running</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-canvas-100">
              {ledger.entries.map((e) => {
                const dr = parseFloat(e.debit);
                const cr = parseFloat(e.credit);
                const fnet = dr - cr;
                const nDr = parseFloat(e.native_debit);
                const nCr = parseFloat(e.native_credit);
                const nnet = nDr - nCr;
                const showFx = e.native_currency !== fc;
                return (
                  <tr key={e.line_id} className="hover:bg-canvas-50">
                    <td className="py-1.5 text-gray-700 whitespace-nowrap">{e.date}</td>
                    <td className="py-1.5 text-gray-700">
                      <Link
                        href={`/dashboard/journal-entries/${e.journal_entry_id}`}
                        className="hover:text-brand-700"
                      >
                        {e.memo}
                      </Link>
                    </td>
                    <td className="py-1.5 font-mono text-right tabular-nums whitespace-nowrap">
                      {formatAmount(nnet, e.native_currency)}
                      {showFx && (
                        <span className="text-[10px] text-gray-400 ml-1">@ {e.exchange_rate}</span>
                      )}
                    </td>
                    <td className={cn(
                      "py-1.5 font-mono text-right tabular-nums whitespace-nowrap",
                      fnet >= 0 ? "text-gray-900" : "text-red-600",
                    )}>
                      {formatAmount(fnet, fc)}
                    </td>
                    <td className="py-1.5 font-mono text-right tabular-nums text-gray-600 whitespace-nowrap">
                      {formatAmount(parseFloat(e.running_balance), fc)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── Edit drawer ───────────────────────────────────────────────────────────

function EditDrawer({
  entity, onClose, onSaved,
}: { entity: Entity; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    code: entity.code,
    name: entity.name,
    legal_name: entity.legal_name || "",
    entity_type: entity.entity_type,
    functional_currency: entity.functional_currency,
    reporting_currency: entity.reporting_currency || "",
    country: entity.country || "",
    fiscal_year_start_month: entity.fiscal_year_start_month,
    tax_id: entity.tax_id || "",
    notes: entity.notes || "",
    is_active: entity.is_active,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityTypeOptions, setEntityTypeOptions] = useState<EntityTypeOption[]>([]);

  const update = (k: string, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get<EntityTypeOption[]>("/beakon/entity-types/")
      .then((data) => setEntityTypeOptions(data))
      .catch(() => setEntityTypeOptions(
        Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      ));
  }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/beakon/entities/${entity.id}/`, {
        code: form.code.trim(),
        name: form.name.trim(),
        legal_name: form.legal_name.trim(),
        entity_type: form.entity_type,
        functional_currency: form.functional_currency.trim().toUpperCase(),
        reporting_currency: form.reporting_currency.trim().toUpperCase() || null,
        country: form.country.trim().toUpperCase().slice(0, 2),
        fiscal_year_start_month: Number(form.fiscal_year_start_month),
        tax_id: form.tax_id.trim(),
        notes: form.notes,
        is_active: form.is_active,
      });
      await onSaved();
    } catch (e: any) {
      setError(typeof e?.detail === "string" ? e.detail : JSON.stringify(e?.detail || e || "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full sm:w-[480px] bg-white border-l border-canvas-200 overflow-y-auto flex flex-col">
        <div className="relative px-5 pt-5 pb-4 border-b border-canvas-100 bg-gradient-to-b from-canvas-50/60 to-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                Edit entity
              </p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900 tracking-tight">
                {entity.code} · {entity.name}
              </h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-canvas-100" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <form onSubmit={submit} className="flex-1 overflow-y-auto p-5 space-y-3">
          <FieldRow label="Code *">
            <input className="input font-mono uppercase" value={form.code}
                   onChange={(e) => update("code", e.target.value.toUpperCase())} required />
          </FieldRow>
          <FieldRow label="Name *">
            <input className="input" value={form.name}
                   onChange={(e) => update("name", e.target.value)} required />
          </FieldRow>
          <FieldRow label="Legal name">
            <input className="input" value={form.legal_name}
                   onChange={(e) => update("legal_name", e.target.value)} />
          </FieldRow>
          <FieldRow label="Entity type *">
            <EntityTypeField
              value={form.entity_type}
              options={entityTypeOptions}
              onChange={(next) => update("entity_type", next)}
              onCatalogChange={async () => {
                const data = await api.get<EntityTypeOption[]>("/beakon/entity-types/");
                setEntityTypeOptions(data);
              }}
            />
          </FieldRow>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Functional currency *">
              <input className="input uppercase font-mono" value={form.functional_currency}
                     list={CURRENCY_DATALIST_ID}
                     onChange={(e) => update("functional_currency", e.target.value.toUpperCase().slice(0, 3))}
                     maxLength={3} />
            </FieldRow>
            <FieldRow label="Reporting currency">
              <input className="input uppercase font-mono" value={form.reporting_currency}
                     list={CURRENCY_DATALIST_ID}
                     onChange={(e) => update("reporting_currency", e.target.value.toUpperCase().slice(0, 3))}
                     maxLength={3} placeholder="(same as functional)" />
            </FieldRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Country">
              <input className="input uppercase font-mono" value={form.country}
                     list={COUNTRY_DATALIST_ID}
                     onChange={(e) => update("country", e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
            </FieldRow>
            <FieldRow label="Fiscal year start">
              <select className="input" value={form.fiscal_year_start_month}
                      onChange={(e) => update("fiscal_year_start_month", Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </FieldRow>
          </div>
          <FieldRow label="Tax ID">
            <input className="input font-mono" value={form.tax_id}
                   onChange={(e) => update("tax_id", e.target.value)} />
          </FieldRow>
          <FieldRow label="Notes">
            <textarea className="input" rows={3} value={form.notes}
                      onChange={(e) => update("notes", e.target.value)} />
          </FieldRow>
          <label className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
            <input type="checkbox" className="mt-0.5 rounded border-canvas-200" checked={form.is_active}
                   onChange={(e) => update("is_active", e.target.checked)} />
            <span>
              <span className="font-medium">Entity is active</span>
              <span className="block text-gray-400 mt-0.5">
                Archived entities are hidden from pickers. History remains intact.
              </span>
            </span>
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}
          <EntityReferenceDatalists />
        </form>
        <div className="sticky bottom-0 border-t border-canvas-100 bg-white/95 backdrop-blur px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" onClick={(e) => submit(e as any)} disabled={saving || !form.code || !form.name}
                  className="btn-primary">
            {saving ? "Saving…" : "Save changes"}
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

  const safeOptions: EntityTypeOption[] = options.length
    ? options
    : Object.entries(ENTITY_TYPE_LABELS).map(([optValue, label]) => ({ value: optValue, label }));

  return (
    <div className="space-y-2">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Built-in">
          {safeOptions.filter((o) => !o.is_custom).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </optgroup>
        {safeOptions.some((o) => o.is_custom) && (
          <optgroup label="Custom">
            {safeOptions.filter((o) => o.is_custom).map((o) => (
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
          <div className="grid grid-cols-2 gap-2">
            <input
              autoFocus
              className="input"
              placeholder="Label"
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

      {safeOptions.some((o) => o.is_custom) && (
        <div className="flex flex-wrap gap-1.5">
          {safeOptions.filter((o) => o.is_custom).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => void removeCustom(o.id)}
              className="inline-flex items-center gap-1 rounded-full border border-canvas-200 bg-white px-2 py-0.5 text-[10px] text-gray-600 hover:border-rose-200 hover:text-rose-700"
            >
              <span>{o.label}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}


// ── Delete / deactivate dialog ────────────────────────────────────────────

interface DeleteBlockers {
  journal_entries: number;
  bank_accounts: number;
  child_entities: number;
}

function DeleteConfirm({
  entity, onClose, onDeleted, onDeactivated,
}: {
  entity: Entity;
  onClose: () => void;
  onDeleted: () => void;
  onDeactivated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<DeleteBlockers | null>(null);

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/beakon/entities/${entity.id}/`);
      onDeleted();
    } catch (e: any) {
      if (e?.status === 409 && e?.error?.blockers) {
        setBlockers(e.error.blockers);
      } else {
        setError(e?.error?.message || JSON.stringify(e) || "Delete failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const doDeactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/beakon/entities/${entity.id}/`, { is_active: false });
      await onDeactivated();
    } catch (e: any) {
      setError(typeof e?.detail === "string" ? e.detail : JSON.stringify(e?.detail || e || "Deactivate failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl border border-canvas-200 w-full max-w-[460px] p-5 mx-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 ring-1 ring-inset ring-red-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">
              Delete {entity.code}?
            </h3>
            {!blockers ? (
              <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                This permanently removes the entity and any accounts / periods attached.
                This action cannot be undone.
              </p>
            ) : (
              <div className="mt-2 text-sm text-gray-700">
                <p className="font-medium">Cannot delete — this entity has ledger history:</p>
                <ul className="mt-2 space-y-0.5 text-xs text-gray-600 ml-4 list-disc">
                  {blockers.journal_entries > 0 && (
                    <li>{blockers.journal_entries} journal {blockers.journal_entries === 1 ? "entry" : "entries"}</li>
                  )}
                  {blockers.bank_accounts > 0 && (
                    <li>{blockers.bank_accounts} linked bank account{blockers.bank_accounts === 1 ? "" : "s"}</li>
                  )}
                  {blockers.child_entities > 0 && (
                    <li>{blockers.child_entities} child entit{blockers.child_entities === 1 ? "y" : "ies"}</li>
                  )}
                </ul>
                <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                  Deactivating instead keeps the audit trail and hides the entity from active lists.
                  Ledger history and any journal entries remain queryable.
                </p>
              </div>
            )}
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
          {!blockers ? (
            <button onClick={doDelete} disabled={busy}
                    className="btn-primary bg-red-600 hover:bg-red-700">
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
          ) : (
            <button onClick={doDeactivate} disabled={busy || !entity.is_active}
                    className="btn-primary">
              {busy ? "Deactivating…" : entity.is_active ? "Deactivate instead" : "Already inactive"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Utilities ─────────────────────────────────────────────────────────────

function formatAmount(n: number, ccy: string): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = ccy === "USD" ? "$" : ccy === "EUR" ? "€" : ccy === "GBP" ? "£" : "";
  return symbol
    ? `${sign}${symbol}${formatted}`
    : `${sign}${formatted} ${ccy}`;
}


function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center px-4 py-2.5 text-sm font-medium border-b-2 -mb-[2px] transition-colors rounded-t-lg",
        active
          ? "border-brand-600 text-brand-800 bg-brand-50/60"
          : "border-transparent text-gray-600 hover:text-gray-900 hover:bg-canvas-50",
      )}
    >
      {children}
    </button>
  );
}
