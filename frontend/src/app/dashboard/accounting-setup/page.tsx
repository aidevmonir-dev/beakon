"use client";

/* Accounting Setup — chart template picker.
 *
 * Per the UI philosophy doc (2026-05-10): the Accounting setup begins
 * only after the organizational structure exists. The sequence is:
 *   1. Select chart template
 *   2. Configure accounting basics  ← this page
 *   3. Add suppliers/customers
 *   4. Start operating
 *
 * Per-entity, because in a multi-entity world a Swiss op may run on
 * Swiss SME while a Luxembourg holding runs on SOPARFI. The page lists
 * all entities, shows their current configuration status, and opens
 * an inline form on the entity being configured.
 *
 * The form captures three things from the doc:
 *   • Chart of Accounts template (Swiss SME / Lux SOPARFI / UK Standard
 *     / UAE Standard / Phase 1 Universal)
 *   • Fiscal Year start month
 *   • VAT Enabled?
 *
 * Backend: PATCH /beakon/entities/{id}/. The chart-template field is
 * the entity's *intent*; the actual CoA rows are loaded by existing
 * tooling — import_phase1_coa today, jurisdiction-specific packages as
 * they ship.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, Building2, Calculator, CalendarCheck,
  CheckCircle2, ListTree, Network, Percent, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";


// ── Types & static data ───────────────────────────────────────────


interface Entity {
  id: number;
  code: string;
  name: string;
  entity_type: string;
  country: string;
  functional_currency: string;
  fiscal_year_start_month: number;
  chart_template: string;
  vat_enabled: boolean;
  is_active: boolean;
}


type ChartTemplate =
  | ""
  | "swiss_sme"
  | "lux_soparfi"
  | "uk_standard"
  | "uae_standard"
  | "phase1_universal";


interface ChartTemplateOption {
  slug: ChartTemplate;
  title: string;
  body: string;
  jurisdiction: string;
  available: boolean;
}


const CHART_TEMPLATES: ChartTemplateOption[] = [
  {
    slug: "swiss_sme",
    title: "Swiss SME",
    body: "Standard Swiss SME chart — KMU-Kontenrahmen with VAT and statutory line items aligned to Swiss CO Art. 957 ff.",
    jurisdiction: "🇨🇭 CH",
    available: false,
  },
  {
    slug: "lux_soparfi",
    title: "Luxembourg SOPARFI",
    body: "Holding-and-financing-company chart — PCN-aligned, with intercompany / participation accounts pre-mapped.",
    jurisdiction: "🇱🇺 LU",
    available: false,
  },
  {
    slug: "uk_standard",
    title: "UK Standard",
    body: "UK FRS 102 Section 1A starter — limited-company friendly, VAT on by default.",
    jurisdiction: "🇬🇧 GB",
    available: false,
  },
  {
    slug: "uae_standard",
    title: "UAE Standard",
    body: "UAE chart with VAT and Corporate Tax categories pre-tagged for the new federal CT regime.",
    jurisdiction: "🇦🇪 AE",
    available: false,
  },
  {
    slug: "phase1_universal",
    title: "Phase 1 — Universal CoA",
    body: "The IFRS-aligned universal chart Beakon ships today. Loadable now via the standard CoA importer.",
    jurisdiction: "Universal",
    available: true,
  },
];


const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];


// ── Page ──────────────────────────────────────────────────────────


export default function AccountingSetupPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [openEntityId, setOpenEntityId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        // Individuals don't run accounting — filter them out.
        setEntities(list.filter((e) => e.entity_type !== "individual"));
      })
      .catch(() => setEntities([]))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const onSaved = () => {
    setOpenEntityId(null);
    setReloadKey((k) => k + 1);
  };

  return (
    <div>
      <PageHeader
        title="Accounting Setup"
        description="Pick a chart of accounts, set the fiscal year, and turn on VAT — per entity. Configurable later, but a clean start saves rework."
      />

      {!loading && entities.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-canvas-300 bg-canvas-50/40 p-10 text-center">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <Network className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            Your structure is empty.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 leading-relaxed">
            Accounting setup begins after the organizational structure exists.
            Add at least one entity in <span className="font-mono">Structure</span> first.
          </p>
          <Link
            href="/dashboard/structure"
            className="btn-primary mt-5 inline-flex"
          >
            Build my structure
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        </div>
      )}

      {loading && (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[88px] rounded-2xl border border-canvas-200 bg-canvas-50/60 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && entities.length > 0 && (
        <ul className="mt-6 space-y-3">
          {entities.map((entity) => (
            <li key={entity.id}>
              <EntityRow
                entity={entity}
                isOpen={openEntityId === entity.id}
                onToggle={() =>
                  setOpenEntityId((id) => (id === entity.id ? null : entity.id))
                }
                onSaved={onSaved}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// ── Entity row ────────────────────────────────────────────────────


function EntityRow({
  entity, isOpen, onToggle, onSaved,
}: {
  entity: Entity;
  isOpen: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const tpl = CHART_TEMPLATES.find((t) => t.slug === entity.chart_template);
  const configured = !!entity.chart_template;

  return (
    <div className="rounded-2xl border border-canvas-200/70 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-canvas-50/60 transition-colors rounded-2xl"
      >
        <div
          className={cn(
            "shrink-0 h-10 w-10 rounded-xl flex items-center justify-center",
            configured ? "bg-mint-50 text-mint-700" : "bg-canvas-100 text-gray-500",
          )}
        >
          {configured ? <CheckCircle2 className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-gray-900 truncate">
              {entity.name}
            </span>
            <span className="font-mono text-[11px] text-gray-400">{entity.code}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-gray-500">
            <Stat icon={ListTree} label="Chart" value={tpl?.title ?? "Not chosen yet"} />
            <span className="text-canvas-300">·</span>
            <Stat
              icon={CalendarCheck}
              label="FY"
              value={`Starts ${MONTHS[entity.fiscal_year_start_month - 1]}`}
            />
            <span className="text-canvas-300">·</span>
            <Stat
              icon={Percent}
              label="VAT"
              value={entity.vat_enabled ? "Enabled" : "Off"}
            />
          </div>
        </div>

        <div className="shrink-0 self-center">
          <span className="text-[12px] font-medium text-brand-700 hover:underline">
            {isOpen ? "Close" : configured ? "Reconfigure" : "Configure"}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-canvas-100 p-5">
          <ConfigureForm entity={entity} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}


function Stat({
  icon: Icon, label, value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3 text-gray-400" />
      <span className="text-gray-400">{label}:</span>
      <span className="font-medium text-gray-700">{value}</span>
    </span>
  );
}


// ── Configure form ────────────────────────────────────────────────


function ConfigureForm({
  entity, onSaved,
}: {
  entity: Entity;
  onSaved: () => void;
}) {
  const [template, setTemplate] = useState<ChartTemplate>(
    (entity.chart_template || "") as ChartTemplate,
  );
  const [fiscalMonth, setFiscalMonth] = useState<number>(entity.fiscal_year_start_month || 1);
  const [vatEnabled, setVatEnabled] = useState<boolean>(!!entity.vat_enabled);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const chosenTemplate = useMemo(
    () => CHART_TEMPLATES.find((t) => t.slug === template) || null,
    [template],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!template) {
      setError("Pick a chart template to continue.");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/beakon/entities/${entity.id}/`, {
        chart_template: template,
        fiscal_year_start_month: fiscalMonth,
        vat_enabled: vatEnabled,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.detail || "Failed to save accounting setup.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section>
        <SectionTitle
          icon={ListTree}
          title="1. Chart of Accounts"
          subtitle="Pick the template that fits this entity's jurisdiction. You can override individual accounts after."
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CHART_TEMPLATES.map((t) => {
            const active = template === t.slug;
            return (
              <button
                key={t.slug}
                type="button"
                onClick={() => setTemplate(t.slug)}
                aria-pressed={active}
                className={cn(
                  "text-left rounded-xl border p-4 transition-colors",
                  active
                    ? "border-brand-300 bg-brand-50/40 ring-1 ring-brand-200"
                    : "border-canvas-200 bg-white hover:bg-canvas-50",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[13px] font-semibold text-gray-900">{t.title}</div>
                  <span className="font-mono text-[11px] text-gray-400 whitespace-nowrap">
                    {t.jurisdiction}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
                  {t.body}
                </p>
                <div className="mt-2">
                  {t.available ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2 py-0.5 text-[10px] font-medium text-mint-700 ring-1 ring-mint-100">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Loadable now
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-canvas-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                      <Sparkles className="h-2.5 w-2.5" />
                      Selection saved · template package shipping soon
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle
          icon={CalendarCheck}
          title="2. Fiscal year"
          subtitle="The month in which this entity's fiscal year begins."
        />
        <select
          className="input max-w-xs"
          value={fiscalMonth}
          onChange={(e) => setFiscalMonth(Number(e.target.value))}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
      </section>

      <section>
        <SectionTitle
          icon={Percent}
          title="3. VAT"
          subtitle="Turn on if this entity registers VAT and posts to VAT control accounts."
        />
        <label className="flex items-start gap-3 rounded-xl border border-canvas-200 bg-canvas-50/40 p-4 cursor-pointer max-w-md">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={vatEnabled}
            onChange={(e) => setVatEnabled(e.target.checked)}
          />
          <span>
            <span className="text-[13px] font-medium text-gray-900">
              VAT enabled for {entity.name}
            </span>
            <p className="mt-0.5 text-[11.5px] text-gray-600 leading-relaxed">
              Tax-code pickers will appear on bills, invoices and journal
              entries for this entity.
            </p>
          </span>
        </label>
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-canvas-100 pt-4">
        {chosenTemplate?.available ? (
          <Link
            href="/dashboard/coa-definitions"
            className="text-[12.5px] text-brand-700 hover:underline inline-flex items-center gap-1.5"
          >
            <Calculator className="h-3.5 w-3.5" />
            Load Phase 1 Universal accounts after saving
          </Link>
        ) : <span />}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save accounting setup"}
          {!saving && <ArrowRight className="w-4 h-4 ml-1.5" />}
        </button>
      </div>
    </form>
  );
}


function SectionTitle({
  icon: Icon, title, subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <div className="shrink-0 h-7 w-7 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div>
        <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
        <p className="text-[11.5px] text-gray-500 leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
}
