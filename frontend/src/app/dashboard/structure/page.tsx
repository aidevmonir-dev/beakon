"use client";

/* Structure — visual tree builder.
 *
 * Per the UI philosophy doc (2026-05-10), Structure Setup is meant to
 * become "one of Beakon's signature UI elements." Two surfaces side by
 * side:
 *
 *   Left  — add-an-entity form. Captures Name, Jurisdiction, Entity
 *           Type, Functional Currency, plus a Relationship picker
 *           (Top-level / Subsidiary of existing / Owned by individual).
 *           Dynamic fields (parent entity selector, individual name)
 *           appear based on the chosen relationship.
 *   Right — the structure tree, rebuilt in real time as entities are
 *           added. Root nodes flow left, children indent under them
 *           with a connector rail.
 *
 * "Owned by individual / shareholder" creates the individual as its own
 * Entity (entity_type=individual), then makes the company a child of
 * that individual. This keeps the model uniform — no parallel
 * shareholder table — and is consistent with the existing Entity
 * hierarchy (Entity.parent → Entity).
 *
 * The flat admin table at /dashboard/entities still exists for power
 * editing.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, Building2, Check, Globe, Network, Plus,
  Sparkles, User,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";


// ── Types & static data ───────────────────────────────────────────


interface Entity {
  id: number;
  code: string;
  name: string;
  legal_name: string;
  entity_type: string;
  parent: number | null;
  parent_code: string | null;
  functional_currency: string;
  country: string;
  is_active: boolean;
}


type Relationship = "root" | "subsidiary" | "individual_owned";


const ENTITY_TYPES = [
  { value: "holding_company",   label: "Holding Company" },
  { value: "operating_company", label: "Operating Company" },
  { value: "company",           label: "Company" },
  { value: "trust",             label: "Trust" },
  { value: "foundation",        label: "Foundation" },
  { value: "partnership",       label: "Partnership" },
  { value: "fund",              label: "Fund" },
  { value: "branch",            label: "Branch" },
  { value: "spv",               label: "SPV" },
  { value: "individual",        label: "Person" },
  { value: "family",            label: "Family" },
  { value: "other",             label: "Other" },
];


const COUNTRIES = [
  { value: "CH", label: "Switzerland" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "GB", label: "United Kingdom" },
  { value: "LU", label: "Luxembourg" },
  { value: "US", label: "United States" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SG", label: "Singapore" },
  { value: "JP", label: "Japan" },
];


const CURRENCIES = ["CHF", "EUR", "USD", "GBP", "JPY", "CAD", "AUD", "AED", "SGD"];


// ── Page ──────────────────────────────────────────────────────────


export default function StructurePage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.get<{ results: Entity[] } | Entity[]>("/beakon/entities/", { is_active: "true" })
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.results ?? []);
        setEntities(list);
      })
      .catch(() => setEntities([]))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const onAdded = () => setReloadKey((k) => k + 1);

  return (
    <div>
      <PageHeader
        title="Structure"
        description="Build your organization as it really is — entities, owners, and the relationships between them. The tree updates as you add people and companies."
      />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <AddEntityCard entities={entities} onAdded={onAdded} />
        <StructureTreeCard entities={entities} loading={loading} />
      </div>
    </div>
  );
}


// ── Add-entity form ───────────────────────────────────────────────


function AddEntityCard({
  entities, onAdded,
}: {
  entities: Entity[];
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("CH");
  const [entityType, setEntityType] = useState("holding_company");
  const [functionalCurrency, setFunctionalCurrency] = useState("CHF");

  const [relationship, setRelationship] = useState<Relationship>("root");
  const [parentId, setParentId] = useState<string>("");
  const [individualName, setIndividualName] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const eligibleParents = useMemo(
    () => entities.filter((e) => e.entity_type !== "individual"),
    [entities],
  );

  const reset = () => {
    setName(""); setEntityType("holding_company");
    setRelationship("root"); setParentId(""); setIndividualName("");
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) { setError("Entity name is required."); return; }
    if (relationship === "subsidiary" && !parentId) {
      setError("Pick the parent entity for a subsidiary.");
      return;
    }
    if (relationship === "individual_owned" && !individualName.trim()) {
      setError("Enter the owner's name (the individual / shareholder).");
      return;
    }

    setSubmitting(true);
    try {
      let resolvedParentId: number | null = null;

      if (relationship === "subsidiary") {
        resolvedParentId = Number(parentId);
      } else if (relationship === "individual_owned") {
        // Create the individual first (or reuse if a same-named person
        // already exists as type=individual under this org).
        const matching = entities.find(
          (e) => e.entity_type === "individual" &&
                 e.name.trim().toLowerCase() === individualName.trim().toLowerCase(),
        );
        if (matching) {
          resolvedParentId = matching.id;
        } else {
          const individual = await api.post<Entity>("/beakon/entities/", {
            code: codeFromName(individualName),
            name: individualName.trim(),
            entity_type: "individual",
            country, functional_currency: functionalCurrency,
            parent: null,
          });
          resolvedParentId = individual.id;
        }
      }

      await api.post<Entity>("/beakon/entities/", {
        code: codeFromName(name),
        name: name.trim(),
        entity_type: entityType,
        country,
        functional_currency: functionalCurrency,
        parent: resolvedParentId,
      });

      onAdded();
      reset();
    } catch (err: any) {
      const detail =
        err?.code?.[0] ||
        err?.name?.[0] ||
        err?.detail ||
        "Failed to add entity. Code may already exist — try another name.";
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-canvas-200/70 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]"
    >
      <div className="mb-4 flex items-center gap-2">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Plus className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-[14px] font-semibold text-gray-900 leading-tight">Add an entity</h2>
          <p className="text-[11.5px] text-gray-500">The tree on the right updates as you go.</p>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-3">
        <Field label="Entity name" required>
          <input
            type="text" className="input"
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Allina Holding SA"
            autoComplete="organization" required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Jurisdiction" required>
            <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Functional currency" required>
            <select
              className="input font-mono"
              value={functionalCurrency}
              onChange={(e) => setFunctionalCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Entity type" required>
          <select className="input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            {ENTITY_TYPES.filter((t) => t.value !== "individual")
              .map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>

        <Field label="Relationship" required>
          <div className="grid grid-cols-1 gap-2">
            <RelationshipOption
              active={relationship === "root"}
              onClick={() => setRelationship("root")}
              icon={Building2}
              title="Top-level holding / root entity"
              body="No parent — this entity sits at the top of the tree."
            />
            <RelationshipOption
              active={relationship === "subsidiary"}
              onClick={() => setRelationship("subsidiary")}
              icon={Network}
              title="Subsidiary of existing entity"
              body="Sits beneath another entity already in your structure."
              disabled={eligibleParents.length === 0}
              disabledHint="Add a holding/operating entity first."
            />
            <RelationshipOption
              active={relationship === "individual_owned"}
              onClick={() => setRelationship("individual_owned")}
              icon={User}
              title="Owned by individual / shareholder"
              body="Held personally by a named person. We'll add the person to the tree."
            />
          </div>
        </Field>

        {relationship === "subsidiary" && (
          <Field label="Parent entity" required>
            <select
              className="input"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">Select a parent…</option>
              {eligibleParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {relationship === "individual_owned" && (
          <Field label="Owner name" required hint="The individual or shareholder who holds this entity.">
            <input
              type="text" className="input"
              value={individualName}
              onChange={(e) => setIndividualName(e.target.value)}
              placeholder="Thomas Allina"
            />
          </Field>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full mt-4"
      >
        {submitting ? "Adding…" : "Add to structure"}
        {!submitting && <ArrowRight className="w-4 h-4 ml-1.5" />}
      </button>
    </form>
  );
}


function RelationshipOption({
  active, onClick, icon: Icon, title, body, disabled, disabledHint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full text-left rounded-xl border p-3 transition-colors",
        active
          ? "border-brand-300 bg-brand-50/40 ring-1 ring-brand-200"
          : "border-canvas-200 bg-white hover:bg-canvas-50",
        disabled && "opacity-50 cursor-not-allowed hover:bg-white",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "shrink-0 h-8 w-8 rounded-lg flex items-center justify-center",
            active ? "bg-brand-100 text-brand-700" : "bg-canvas-100 text-gray-500",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-semibold text-gray-900">{title}</h4>
            {active && <Check className="h-3.5 w-3.5 text-brand-600" />}
          </div>
          <p className="mt-0.5 text-[11.5px] text-gray-600 leading-relaxed">{body}</p>
          {disabled && disabledHint && (
            <p className="mt-1 text-[11px] italic text-gray-400">{disabledHint}</p>
          )}
        </div>
      </div>
    </button>
  );
}


// ── Visual tree ───────────────────────────────────────────────────


function StructureTreeCard({
  entities, loading,
}: {
  entities: Entity[];
  loading: boolean;
}) {
  const tree = useMemo(() => buildTree(entities), [entities]);

  return (
    <div className="rounded-2xl border border-canvas-200/70 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="mb-4 flex items-center gap-2">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-mint-50 text-mint-700">
          <Network className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-[14px] font-semibold text-gray-900 leading-tight">Your structure</h2>
          <p className="text-[11.5px] text-gray-500">
            {entities.length === 0
              ? "Add your first entity to see the tree."
              : `${entities.length} ${entities.length === 1 ? "entity" : "entities"} so far.`}
          </p>
        </div>
      </div>

      {loading ? (
        <TreeSkeleton />
      ) : tree.length === 0 ? (
        <EmptyTreeState />
      ) : (
        <div className="space-y-3">
          {tree.map((node) => (
            <TreeNode key={node.id} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}


interface TreeNodeData {
  id: number;
  code: string;
  name: string;
  entity_type: string;
  functional_currency: string;
  country: string;
  children: TreeNodeData[];
}


function buildTree(entities: Entity[]): TreeNodeData[] {
  const byId = new Map<number, TreeNodeData>();
  entities.forEach((e) => byId.set(e.id, {
    id: e.id, code: e.code, name: e.name, entity_type: e.entity_type,
    functional_currency: e.functional_currency, country: e.country,
    children: [],
  }));
  const roots: TreeNodeData[] = [];
  entities.forEach((e) => {
    const node = byId.get(e.id)!;
    if (e.parent && byId.has(e.parent)) {
      byId.get(e.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // Stable order: alphabetical by name within each level.
  const sortRec = (list: TreeNodeData[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}


function TreeNode({ node, depth }: { node: TreeNodeData; depth: number }) {
  return (
    <div>
      <NodeBadge node={node} isRoot={depth === 0} />
      {node.children.length > 0 && (
        <div className="ml-3 mt-2 border-l-2 border-dashed border-canvas-200 pl-4 space-y-2">
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}


function NodeBadge({ node, isRoot }: { node: TreeNodeData; isRoot: boolean }) {
  const isIndividual = node.entity_type === "individual";

  const Icon = isIndividual ? User : Building2;
  const tone = isIndividual
    ? { ring: "ring-rose-200", bg: "bg-rose-50/40", iconBg: "bg-rose-50 text-rose-700" }
    : isRoot
      ? { ring: "ring-brand-200", bg: "bg-brand-50/40", iconBg: "bg-brand-50 text-brand-700" }
      : { ring: "ring-canvas-200", bg: "bg-white", iconBg: "bg-canvas-100 text-gray-600" };

  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-3 rounded-xl border border-canvas-200 px-3.5 py-2.5 ring-1 transition-colors",
        tone.ring, tone.bg,
      )}
    >
      <div className={cn("shrink-0 h-8 w-8 rounded-lg flex items-center justify-center", tone.iconBg)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900 truncate">
          {node.name}
          {isRoot && !isIndividual && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider text-brand-700">
              <Sparkles className="h-2.5 w-2.5" />
              Root
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {node.country}
          </span>
          <span className="text-canvas-300">·</span>
          <span className="font-mono">{node.functional_currency}</span>
          <span className="text-canvas-300">·</span>
          <span className="capitalize">
            {node.entity_type.replace(/_/g, " ")}
          </span>
          <span className="text-canvas-300">·</span>
          <span className="font-mono text-gray-400">{node.code}</span>
        </div>
      </div>
    </div>
  );
}


function EmptyTreeState() {
  return (
    <div className="rounded-xl border-2 border-dashed border-canvas-300 bg-canvas-50/40 px-4 py-10 text-center">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-gray-400">
        <Network className="h-5 w-5" />
      </div>
      <p className="text-[13px] font-medium text-gray-700">Your structure is empty.</p>
      <p className="mx-auto mt-1 max-w-xs text-[11.5px] text-gray-500 leading-relaxed">
        Start with a top-level holding or the individual who owns it —
        you can always rearrange later.
      </p>
    </div>
  );
}


function TreeSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[58px] rounded-xl border border-canvas-200 bg-canvas-50/60 animate-pulse"
          style={{ marginLeft: i * 16 }}
        />
      ))}
    </div>
  );
}


// ── Helpers ───────────────────────────────────────────────────────


function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-gray-400 leading-relaxed">{hint}</span>}
    </label>
  );
}


/** Generate a 3–10 character uppercase code from a name. We append a
 *  random 3-digit suffix so back-to-back creates with similar names
 *  (e.g. two "Allina Holdings") don't collide on the unique
 *  (organization, code) constraint. The user can rename the code
 *  later from /dashboard/entities. */
function codeFromName(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 6) || "ENT";
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${slug}-${suffix}`;
}
