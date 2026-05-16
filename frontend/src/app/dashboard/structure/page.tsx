"use client";

/* Structure — module dashboard.
 *
 * Layout follows Thomas's 2026-05-12 Structure mockup:
 *
 *   Header       title + subtitle, Export + Create Entity buttons
 *   Search bar   "Search entities, shareholders or ask getBeakon…"
 *   Stats row    4 KPI cards: Total Entities • Top-Level Structures •
 *                Jurisdictions • Ownership Links
 *   Row 1        Structure Chart (span 2) — visual hierarchical org
 *                chart, branching connectors with ownership percentages;
 *                + Selected Entity (right column) showing the picked
 *                node's full profile and "Open full profile" link.
 *   Row 2        Entities (span 2) — compact table of recent entities;
 *                + Ownership Overview — donut grouped by jurisdiction;
 *                + Structure Tasks — derived to-dos.
 *
 * Data — every value comes from /beakon/entities/. Ownership
 * percentages are not stored on Entity today (parent FK only), so the
 * chart uses an evenly-split default per parent (100% solo, 50/50 for
 * two children, etc.) with a `// TODO` to wire a real
 * Entity.ownership_pct when that field lands.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, Building2, Check, CheckCircle2, Crown,
  Download, FileText, Globe, Info, Link2, MapPin, Network, Plus, Search,
  Sparkles, User, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";


// ── Types ──────────────────────────────────────────────────────────


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


type ListResult<T> = { results: T[]; count?: number } | T[];

function asArray<T>(r: ListResult<T> | null | undefined): T[] {
  if (!r) return [];
  return Array.isArray(r) ? r : (r.results ?? []);
}


// Country code → display label + flag. Flags are Unicode regional-
// indicator pairs so they render natively without an SVG asset bundle.
const COUNTRIES: Record<string, { label: string; flag: string }> = {
  CH: { label: "Switzerland",          flag: "🇨🇭" },
  DE: { label: "Germany",              flag: "🇩🇪" },
  FR: { label: "France",               flag: "🇫🇷" },
  GB: { label: "UK",                   flag: "🇬🇧" },
  LU: { label: "Luxembourg",           flag: "🇱🇺" },
  US: { label: "United States",        flag: "🇺🇸" },
  AE: { label: "UAE",                  flag: "🇦🇪" },
  SG: { label: "Singapore",            flag: "🇸🇬" },
  JP: { label: "Japan",                flag: "🇯🇵" },
  CA: { label: "Canada",               flag: "🇨🇦" },
  AU: { label: "Australia",            flag: "🇦🇺" },
  IT: { label: "Italy",                flag: "🇮🇹" },
  ES: { label: "Spain",                flag: "🇪🇸" },
  NL: { label: "Netherlands",          flag: "🇳🇱" },
};

function countryFor(code: string) {
  return COUNTRIES[code] ?? { label: code, flag: "🌐" };
}


// Friendly label for the entity_type enum.
function entityTypeLabel(slug: string): string {
  const map: Record<string, string> = {
    holding_company:   "Holding Company",
    operating_company: "Operating Company",
    company:           "Company",
    trust:             "Trust",
    foundation:        "Foundation",
    partnership:       "Partnership",
    fund:              "Fund",
    branch:            "Branch",
    spv:               "SPV",
    individual:        "Individual Shareholder",
    family:            "Family",
    other:             "Other",
  };
  return map[slug] ?? slug.replace(/_/g, " ");
}


// ── Page ──────────────────────────────────────────────────────────


export default function StructurePage() {
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    void api.get<ListResult<Entity>>("/beakon/entities/", { is_active: "true" })
      .then((d) => setEntities(asArray(d)))
      .catch(() => setEntities([]));
  }, []);

  // Pick the first non-individual top-level entity by default once the
  // list loads. Falls back to first entity overall.
  useEffect(() => {
    if (entities === null || entities.length === 0) return;
    if (selectedId !== null && entities.some((e) => e.id === selectedId)) return;
    const preferred = entities.find(
      (e) => e.parent === null && e.entity_type !== "individual",
    ) ?? entities[0];
    setSelectedId(preferred.id);
  }, [entities, selectedId]);

  const list = entities ?? [];

  // KPI derived state ────────────────────────────────────────────
  const total = entities === null ? null : list.length;
  const topLevel = entities === null
    ? null
    : list.filter((e) => e.parent === null && e.entity_type !== "individual").length;
  const jurisdictions = entities === null
    ? null
    : new Set(list.map((e) => e.country).filter(Boolean)).size;
  const ownershipLinks = entities === null
    ? null
    : list.filter((e) => e.parent !== null).length;

  // Tree for the chart card ──────────────────────────────────────
  const tree = useMemo(() => buildTree(list), [list]);

  const selected = useMemo(
    () => list.find((e) => e.id === selectedId) ?? null,
    [list, selectedId],
  );
  const selectedSubs = useMemo(
    () => selected ? list.filter((e) => e.parent === selected.id).length : 0,
    [list, selected],
  );
  const selectedParent = useMemo(
    () => selected?.parent ? list.find((e) => e.id === selected.parent) : null,
    [list, selected],
  );

  // Jurisdiction donut ───────────────────────────────────────────
  const jurisdictionSegments = useMemo(
    () => buildJurisdictionSegments(list),
    [list],
  );

  // Compact entities table — show the 5 most recently added.
  const recentEntities = useMemo(() => {
    return list.slice().sort((a, b) => b.id - a.id).slice(0, 5);
  }, [list]);

  return (
    <div className="px-1 py-2 sm:px-2 sm:py-4">
      <div className="mx-auto w-full max-w-7xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 leading-tight">
              Structure
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage entities, ownership and hierarchy across your organization.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-[13px] font-medium text-gray-700 ring-1 ring-canvas-200 hover:ring-brand-200 hover:text-gray-900 transition"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <Link
              href="/dashboard/entities"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Entity
            </Link>
          </div>
        </div>

        {/* ── Search / Ask bar ───────────────────────────────────── */}
        <div className="mt-6 relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search entities, shareholders or ask getBeakon…"
            className="w-full rounded-xl border border-canvas-200 bg-white py-3 pl-10 pr-12 text-[13.5px] text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md bg-violet-50 text-violet-700 ring-1 ring-violet-100">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>

        {/* ── KPI strip ──────────────────────────────────────────── */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Entities" sub="Across all structures"
            value={total === null ? "—" : String(total)}
            icon={Building2} accent="brand" />
          <StatCard label="Top-Level Structures" sub="Parent entities"
            value={topLevel === null ? "—" : String(topLevel)}
            icon={Network} accent="brand" />
          <StatCard label="Jurisdictions" sub="Countries covered"
            value={jurisdictions === null ? "—" : String(jurisdictions)}
            icon={Globe} accent="mint" />
          <StatCard label="Ownership Links" sub="Active relationships"
            value={ownershipLinks === null ? "—" : String(ownershipLinks)}
            icon={Link2} accent="violet" />
        </ul>

        {/* ── Row 1: Structure Chart (span 2) · Selected Entity ───── */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <StructureChartCard
              tree={tree}
              selectedId={selectedId}
              onSelect={setSelectedId}
              loading={entities === null} />
          </div>
          <SelectedEntityCard
            entity={selected}
            parent={selectedParent ?? null}
            subsidiaries={selectedSubs}
            loading={entities === null} />
        </div>

        {/* ── Row 2: Entities · Ownership · Tasks ─────────────────── */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <EntitiesTableCard rows={recentEntities} loading={entities === null}
              onSelect={setSelectedId} />
          </div>
          <OwnershipOverviewCard segments={jurisdictionSegments}
            loading={entities === null} />
          <StructureTasksCard entities={list} loading={entities === null} />
        </div>
      </div>
    </div>
  );
}


// ── Stat card ──────────────────────────────────────────────────────


type Accent = "brand" | "mint" | "amber" | "violet";


function StatCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  accent: Accent;
}) {
  const tone =
    accent === "brand"  ? { well: "bg-brand-50 text-brand-700",   ring: "ring-brand-100" } :
    accent === "mint"   ? { well: "bg-mint-50 text-mint-700",     ring: "ring-mint-100" } :
    accent === "amber"  ? { well: "bg-amber-50 text-amber-700",   ring: "ring-amber-100" } :
                          { well: "bg-violet-50 text-violet-700", ring: "ring-violet-100" };

  return (
    <li className={cn(
      "rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5 ring-1",
      tone.ring,
    )}>
      <div className="flex items-start gap-3">
        <span className={cn(
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
          tone.well,
        )}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-gray-500 truncate">{label}</div>
          <div className="text-[22px] font-semibold text-gray-900 leading-tight tabular-nums mt-0.5">
            {value}
          </div>
          <div className="mt-0.5 text-[11.5px] text-gray-500">{sub}</div>
        </div>
      </div>
    </li>
  );
}


// ── Card wrapper ───────────────────────────────────────────────────


function Card({
  title, action, info, children, footer, className,
}: {
  title: string;
  action?: React.ReactNode;
  info?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(
      "flex flex-col rounded-2xl border border-canvas-200/70 bg-white p-4 sm:p-5",
      className,
    )}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[14.5px] font-semibold text-gray-900">
          {title}
          {info && <Info className="h-3.5 w-3.5 text-gray-400" />}
        </h2>
        {action}
      </div>
      <div className="mt-4 flex-1">{children}</div>
      {footer && (
        <div className="mt-4 pt-3 border-t border-canvas-100">{footer}</div>
      )}
    </section>
  );
}


function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="h-7 rounded-md bg-canvas-100/80 animate-pulse" />
      ))}
    </ul>
  );
}


// ── Structure Chart ───────────────────────────────────────────────


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
  const sortRec = (list: TreeNodeData[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}


function StructureChartCard({
  tree, selectedId, onSelect, loading,
}: {
  tree: TreeNodeData[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
}) {
  return (
    <Card title="Structure Chart" info>
      {loading ? (
        <div className="h-72 rounded-lg bg-canvas-100/60 animate-pulse" />
      ) : tree.length === 0 ? (
        <EmptyChart />
      ) : (
        <OrgChart
          tree={tree}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}
    </Card>
  );
}


/** Org-chart renderer.
 *
 *  Lays out the tree with computed coordinates (Reingold–Tilford-ish:
 *  each parent centers above its children block), then draws orthogonal
 *  connector paths via a single SVG overlay. Nodes are absolutely
 *  positioned <button>s over the SVG so clicks still hit React.
 *
 *  Why this and not pure flexbox + dividers: CSS connectors break when
 *  child columns differ in width, and gap'd flex rails don't visually
 *  span the gap between siblings. SVG over computed coords gives clean,
 *  always-correct T-junction lines like a real org chart.
 */
const NODE_W = 184;
const NODE_H = 60;
const H_GAP = 28;
const V_GAP = 64;


interface LaidOutNode {
  id: number;
  data: TreeNodeData;
  x: number;          // top-left of the node
  y: number;
  cx: number;         // center-x of the node
  depth: number;
  parentId: number | null;
  /** Ownership % from this node's parent (null for roots). */
  pct: number | null;
}


function layoutTree(roots: TreeNodeData[]): {
  nodes: LaidOutNode[];
  width: number;
  height: number;
} {
  // Subtree width (in pixels) — minimum is NODE_W, otherwise the sum
  // of children's widths + gaps between them.
  function subtreeWidth(node: TreeNodeData): number {
    if (node.children.length === 0) return NODE_W;
    let total = 0;
    node.children.forEach((c) => { total += subtreeWidth(c); });
    total += H_GAP * (node.children.length - 1);
    return Math.max(NODE_W, total);
  }

  const out: LaidOutNode[] = [];
  let maxDepth = 0;

  function place(
    node: TreeNodeData,
    xStart: number,
    depth: number,
    parentId: number | null,
    pct: number | null,
  ): void {
    const sw = subtreeWidth(node);
    const cx = xStart + sw / 2;
    const y = depth * (NODE_H + V_GAP);
    out.push({
      id: node.id,
      data: node,
      x: cx - NODE_W / 2,
      y,
      cx,
      depth,
      parentId,
      pct,
    });
    if (depth > maxDepth) maxDepth = depth;

    const n = node.children.length;
    if (n === 0) return;
    const childPct = Math.round(100 / n);

    let childX = xStart;
    // If subtree is wider than children block, centre the children
    // under the parent.
    const childrenBlockWidth = node.children.reduce(
      (acc, c, i) => acc + subtreeWidth(c) + (i > 0 ? H_GAP : 0),
      0,
    );
    if (childrenBlockWidth < sw) {
      childX += (sw - childrenBlockWidth) / 2;
    }
    node.children.forEach((c) => {
      place(c, childX, depth + 1, node.id, childPct);
      childX += subtreeWidth(c) + H_GAP;
    });
  }

  let cursorX = 0;
  roots.forEach((r) => {
    place(r, cursorX, 0, null, null);
    cursorX += subtreeWidth(r) + H_GAP;
  });

  const totalWidth = Math.max(NODE_W, cursorX - H_GAP);
  const totalHeight = (maxDepth + 1) * NODE_H + maxDepth * V_GAP;
  return { nodes: out, width: totalWidth, height: totalHeight };
}


function OrgChart({
  tree, selectedId, onSelect,
}: {
  tree: TreeNodeData[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const { nodes, width, height } = useMemo(() => layoutTree(tree), [tree]);
  const byId = useMemo(() => {
    const m = new Map<number, LaidOutNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  // Build connector paths + percentage label coords.
  const connectors = nodes
    .filter((n) => n.parentId !== null)
    .map((n) => {
      const parent = byId.get(n.parentId!)!;
      const yParentBottom = parent.y + NODE_H;
      const yChildTop = n.y;
      const midY = (yParentBottom + yChildTop) / 2;
      // Orthogonal path: down → across → down. Rounded corners by
      // adding a tiny arc would over-complicate it; sharp 90° joins
      // are what every org chart uses anyway.
      const d = `M ${parent.cx} ${yParentBottom} V ${midY} H ${n.cx} V ${yChildTop}`;
      return {
        key: `${parent.id}-${n.id}`,
        d,
        labelX: n.cx,
        labelY: midY,
        pct: n.pct,
      };
    });

  // Pad the viewBox a touch so node hover-lift + ring don't get
  // clipped at the very top/bottom of the SVG.
  const PAD_X = 8;
  const PAD_Y = 8;

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="relative mx-auto"
        style={{
          width: width + PAD_X * 2,
          height: height + PAD_Y * 2,
        }}
      >
        {/* Connector overlay */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={width + PAD_X * 2}
          height={height + PAD_Y * 2}
          aria-hidden
        >
          <g transform={`translate(${PAD_X} ${PAD_Y})`}>
            {connectors.map((c) => (
              <g key={c.key}>
                <path d={c.d} stroke="#cbd5e1" strokeWidth="1.5" fill="none" />
                {c.pct !== null && (
                  <>
                    <rect
                      x={c.labelX - 18}
                      y={c.labelY - 9}
                      width={36}
                      height={18}
                      rx={4}
                      ry={4}
                      fill="#ffffff"
                    />
                    <text
                      x={c.labelX}
                      y={c.labelY + 4}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="500"
                      fill="#64748b"
                    >
                      {c.pct}%
                    </text>
                  </>
                )}
              </g>
            ))}
          </g>
        </svg>

        {/* Nodes */}
        {nodes.map((n) => (
          <div
            key={n.id}
            className="absolute"
            style={{
              left: n.x + PAD_X,
              top: n.y + PAD_Y,
              width: NODE_W,
              height: NODE_H,
            }}
          >
            <NodeCard
              node={n.data}
              selected={n.id === selectedId}
              onClick={() => onSelect(n.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}


function NodeCard({
  node, selected, onClick,
}: {
  node: TreeNodeData;
  selected: boolean;
  onClick: () => void;
}) {
  const isIndividual = node.entity_type === "individual";
  const isRoot = !isIndividual; // visual: non-individuals get the standard box
  const Icon = isIndividual ? User : Building2;

  // Three node states:
  //   selected             → solid brand fill (highlighted node)
  //   non-selected entity  → mint outline (matches mockup: subsidiaries)
  //   individual           → indigo outline
  const tone = selected
    ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200 text-brand-900"
    : isIndividual
      ? "border-canvas-200 bg-white text-gray-900 hover:border-indigo-200"
      : "border-mint-200 bg-mint-50/40 text-gray-900 hover:border-mint-300";

  const iconBg = selected
    ? "bg-brand-100 text-brand-700"
    : isIndividual
      ? "bg-indigo-50 text-indigo-700"
      : "bg-mint-50 text-mint-700";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex w-44 items-center gap-2.5 rounded-xl border px-3 py-2.5 transition",
        "hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-12px_rgba(15,23,42,0.18)]",
        tone,
      )}
      aria-pressed={selected}
    >
      <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconBg)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 text-left">
        <div className="text-[12.5px] font-semibold leading-tight truncate">{node.name}</div>
        <div className="text-[10.5px] text-gray-500 truncate">
          {isIndividual ? "Individual Shareholder"
            : isRoot && node.children?.length ? "Top Holding"
            : "Subsidiary"}
        </div>
      </div>
    </button>
  );
}


function EmptyChart() {
  return (
    <div className="rounded-xl border-2 border-dashed border-canvas-300 bg-canvas-50/40 px-4 py-12 text-center">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-gray-400 ring-1 ring-canvas-200">
        <Network className="h-5 w-5" />
      </div>
      <p className="text-[13px] font-medium text-gray-700">Your structure chart is empty.</p>
      <p className="mx-auto mt-1 max-w-xs text-[11.5px] text-gray-500 leading-relaxed">
        Add your first entity from the Entities table to see the chart populate.
      </p>
    </div>
  );
}


// ── Selected Entity card ──────────────────────────────────────────


function SelectedEntityCard({
  entity, parent, subsidiaries, loading,
}: {
  entity: Entity | null;
  parent: Entity | null;
  subsidiaries: number;
  loading: boolean;
}) {
  return (
    <Card title="Selected Entity">
      {loading ? (
        <CardSkeleton rows={6} />
      ) : !entity ? (
        <div className="flex h-32 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500 px-4 text-center">
          Pick an entity from the chart to see its profile here.
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              {entity.entity_type === "individual"
                ? <User className="h-5 w-5" />
                : <Building2 className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-gray-900 truncate">
                {entity.name}
              </div>
              <div className="text-[11.5px] text-gray-500 mt-0.5 truncate">
                {entity.entity_type === "individual"
                  ? "Individual Shareholder"
                  : parent === null ? "Top Holding" : "Subsidiary"}
              </div>
            </div>
          </div>

          <dl className="mt-5 divide-y divide-canvas-100">
            <SRow label="Entity Type" value={entityTypeLabel(entity.entity_type)} />
            <SRow label="Jurisdiction" value={
              <span className="inline-flex items-center gap-1.5">
                {countryFor(entity.country).label}
                <span aria-hidden>{countryFor(entity.country).flag}</span>
              </span>
            } />
            <SRow label="Functional Currency"
              value={<span className="font-mono text-brand-700">{entity.functional_currency}</span>} />
            <SRow label="Parent / Owner" value={
              parent
                ? <span className="text-brand-700">{parent.name}</span>
                : <span className="text-gray-400">—</span>
            } />
            <SRow label="Subsidiaries" value={String(subsidiaries)} />
            <SRow label="Status" value={
              entity.is_active
                ? <span className="inline-flex items-center rounded-full bg-mint-50 px-2 py-0.5 text-[10.5px] font-medium text-mint-700 ring-1 ring-mint-100">Active</span>
                : <span className="inline-flex items-center rounded-full bg-canvas-100 px-2 py-0.5 text-[10.5px] font-medium text-gray-600 ring-1 ring-canvas-200">Inactive</span>
            } />
          </dl>

          <Link
            href="/dashboard/entities"
            className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800"
          >
            Open full profile
            <ArrowRight className="h-3 w-3" />
          </Link>
        </>
      )}
    </Card>
  );
}


function SRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[11.5px] text-gray-500">{label}</dt>
      <dd className="text-[12.5px] text-gray-900 font-medium text-right truncate max-w-[60%]">{value}</dd>
    </div>
  );
}


// ── Entities table (compact) ──────────────────────────────────────


function EntitiesTableCard({
  rows, loading, onSelect,
}: {
  rows: Entity[]; loading: boolean; onSelect: (id: number) => void;
}) {
  return (
    <Card
      title="Entities"
      footer={
        <Link href="/dashboard/entities"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all entities
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500 px-4 text-center">
          No entities yet. Create one to get started.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] font-medium text-gray-500">
                <th className="font-medium pb-2 pl-2 pr-3">Entity Name</th>
                <th className="font-medium pb-2 pr-3">Entity Type</th>
                <th className="font-medium pb-2 pr-3">Jurisdiction</th>
                <th className="font-medium pb-2 pr-3">Currency</th>
                <th className="font-medium pb-2 pr-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-canvas-100">
              {rows.map((e) => {
                const isIndividual = e.entity_type === "individual";
                const Icon = isIndividual ? User : Building2;
                const country = countryFor(e.country);
                return (
                  <tr
                    key={e.id}
                    onClick={() => onSelect(e.id)}
                    className="cursor-pointer hover:bg-canvas-50/40 transition-colors"
                  >
                    <td className="py-2.5 pl-2 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn(
                          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                          isIndividual
                            ? "bg-rose-50 text-rose-700"
                            : "bg-brand-50 text-brand-700",
                        )}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="font-medium text-gray-900 truncate">{e.name}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-600">{entityTypeLabel(e.entity_type)}</td>
                    <td className="py-2.5 pr-3 text-gray-600">
                      <span className="inline-flex items-center gap-1.5">
                        {country.label}
                        <span aria-hidden>{country.flag}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700 font-mono">{e.functional_currency}</td>
                    <td className="py-2.5 pr-2">
                      {e.is_active
                        ? <span className="inline-flex items-center rounded-full bg-mint-50 px-2 py-0.5 text-[10.5px] font-medium text-mint-700 ring-1 ring-mint-100">Active</span>
                        : <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 ring-1 ring-amber-100">Pending Review</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


// ── Ownership Overview (donut by jurisdiction) ────────────────────


interface JurisdictionSegment { label: string; value: number; pct: number; color: string; }


const JURISDICTION_COLOURS = ["#2563eb", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#0ea5e9"];


function buildJurisdictionSegments(entities: Entity[]): JurisdictionSegment[] {
  if (!entities.length) return [];
  const groups = new Map<string, number>();
  for (const e of entities) {
    const key = e.country || "—";
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const total = entities.length;
  return Array.from(groups.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([code, count], i) => ({
      label: countryFor(code).label,
      value: count,
      pct: total > 0 ? (count / total) * 100 : 0,
      color: JURISDICTION_COLOURS[i % JURISDICTION_COLOURS.length],
    }));
}


function OwnershipOverviewCard({
  segments, loading,
}: { segments: JurisdictionSegment[]; loading: boolean }) {
  return (
    <Card
      title="Ownership Overview"
      footer={
        <Link href="/dashboard/entities"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View by jurisdiction
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={5} />
      ) : segments.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500 px-4 text-center">
          No entities to break down.
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <Donut segments={segments}
            total="100%" subtitle="Total Ownership" />
          <ul className="flex-1 space-y-2">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: s.color }} aria-hidden />
                  <span className="text-gray-700 truncate">{s.label}</span>
                </span>
                <span className="text-gray-900 font-semibold tabular-nums">
                  {s.pct.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}


function Donut({
  segments, total, subtitle,
}: {
  segments: { pct: number; color: string; label: string }[];
  total: string; subtitle: string;
}) {
  const size = 130; const stroke = 18; const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = segments.reduce((a, s) => a + s.pct, 0) || 1;

  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        {segments.map((s) => {
          const len = (s.pct / sum) * c;
          const dasharray = `${len} ${c - len}`;
          const dashoffset = -offset;
          offset += len;
          return (
            <circle
              key={s.label}
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={dasharray} strokeDashoffset={dashoffset}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-[14px] font-semibold text-gray-900 leading-tight tabular-nums">{total}</div>
        <div className="text-[10px] text-gray-500 mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}


// ── Structure Tasks (derived from real signals) ──────────────────


interface SubTask {
  key: string;
  title: string;
  body: string;
  done: boolean;
  href: string;
}


function deriveTasks(entities: Entity[]): SubTask[] {
  if (!entities.length) return [];
  const hasIndividual = entities.some((e) => e.entity_type === "individual");
  const inactive = entities.filter((e) => !e.is_active);

  return [
    {
      key: "shareholders",
      title: "Complete shareholder details",
      body: hasIndividual
        ? "All major shareholders recorded"
        : "No individual shareholders captured yet",
      done: hasIndividual,
      href: "/dashboard/entities",
    },
    {
      key: "directors",
      title: "Add director information",
      body: "Director records not tracked yet — upload from constitutional docs",
      done: false,
      href: "/dashboard/entities",
    },
    {
      key: "documents",
      title: "Upload constitutional documents",
      body: "Articles, shareholder agreements, board minutes",
      done: false,
      href: "/dashboard/documents",
    },
    {
      key: "review",
      title: inactive.length === 1 ? "Review pending entity" : "Review pending entities",
      body: inactive.length
        ? `${inactive[0].name}${inactive.length > 1 ? ` and ${inactive.length - 1} more` : ""} require review`
        : "No entities awaiting review",
      done: inactive.length === 0,
      href: "/dashboard/entities",
    },
  ];
}


function StructureTasksCard({
  entities, loading,
}: { entities: Entity[]; loading: boolean }) {
  const tasks = useMemo(() => deriveTasks(entities), [entities]);
  return (
    <Card
      title="Structure Tasks"
      footer={
        <Link href="/dashboard/entities"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:text-brand-800">
          View all tasks
          <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <CardSkeleton rows={4} />
      ) : tasks.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg bg-canvas-50/60 text-[12px] text-gray-500 px-4 text-center">
          No open tasks.
        </div>
      ) : (
        <ul className="space-y-3">
          {tasks.map((t) => (
            <li key={t.key}>
              <Link href={t.href}
                className="group flex items-start gap-3 -mx-1 p-1 rounded-md hover:bg-canvas-50/60 transition"
              >
                <span className={cn(
                  "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1",
                  t.done
                    ? "bg-mint-500 text-white ring-mint-500"
                    : "bg-white ring-canvas-300",
                )}>
                  {t.done && <CheckCircle2 className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn(
                    "text-[12.5px] font-medium leading-tight",
                    t.done ? "text-gray-500 line-through decoration-mint-300/70" : "text-gray-900",
                  )}>
                    {t.title}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{t.body}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}


// ── Reserved icon imports (kept for future cards) ────────────────


// Keep the AlertCircle, FileText, Sparkles, Crown, Check, Users, MapPin
// imports in scope — they're either used in this file or kept available
// for the next iteration so future PRs don't churn the import list.
const _reserved = { AlertCircle, FileText, Sparkles, Crown, Check, Users, MapPin };
void _reserved;
