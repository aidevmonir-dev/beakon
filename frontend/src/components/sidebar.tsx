"use client";

/* Sidebar — collapsible icon rail (Digits-style).
 *
 * Default state on desktop: a 56px vertical rail showing icons only.
 * On mouse-hover anywhere inside the rail, the sidebar smoothly expands
 * to 256px and reveals labels + section headers, overlaying the content
 * with a soft shadow. Moving the mouse out collapses it again.
 *
 * Within the expanded panel, sections marked `collapsible` show a
 * chevron next to the header and toggle their item list on click.
 * Sections without a label (the top "daily" group) are always open.
 *
 * Sections marked `developerOnly` only render when the current user has
 * `is_staff` set on /auth/me/ — keeps internal tooling out of the way
 * for normal accounting users while staying one click away for staff.
 *
 * Expansion is driven by React state rather than CSS `group-hover`.
 * Tailwind v4's named-group variants were flaky in composition with the
 * other hover states on the inner nav rows, so we use an explicit
 * `onMouseEnter/Leave` + `expanded` prop flowing down.
 *
 * The main content reserves only the rail width (56px) — expansion is
 * a hover overlay, not a layout push — so reading area doesn't shift.
 *
 * On mobile the rail pattern is bypassed: the sidebar slides in full
 * width as a drawer via `mobileOpen`.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchCurrentUser } from "@/lib/api";
import Logo from "@/components/logo";
import { NAV_SECTIONS, type NavItem, type NavSection } from "@/components/sidebar-nav";

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}


export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const [hovered, setHovered] = useState(false);
  const [isDeveloper, setIsDeveloper] = useState(false);

  // Per-section collapsed state. Seeded from each section's
  // `defaultCollapsed`. Keyed by section index since labels can repeat
  // in principle (and `null`-labelled sections are never collapsible).
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    NAV_SECTIONS.forEach((s, i) => {
      if (s.collapsible && s.defaultCollapsed) init[i] = true;
    });
    return init;
  });

  // Detect developer (staff) once on mount. Failure is silent — the
  // Developer section just stays hidden, which is the safe default.
  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((u) => {
        if (!cancelled) setIsDeveloper(Boolean(u?.is_staff || u?.is_superuser));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Auto-open any section whose item is the current route, so a deep
  // link to /dashboard/fx-rates doesn't land the user in a closed
  // "Accounting" group. Runs whenever the route changes.
  useEffect(() => {
    setCollapsed((prev) => {
      const next = { ...prev };
      NAV_SECTIONS.forEach((s, i) => {
        if (!s.collapsible) return;
        const hasActive = s.items.some(
          (it) =>
            pathname === it.href ||
            (it.href !== "/dashboard" && pathname.startsWith(it.href)),
        );
        if (hasActive) next[i] = false;
      });
      return next;
    });
  }, [pathname]);

  // `expanded` drives label + section-header visibility. On desktop it
  // follows hover; on mobile the drawer is always expanded when open.
  const expanded = hovered || mobileOpen;

  const visibleSections = useMemo(
    () => NAV_SECTIONS.filter((s) => !s.developerOnly || isDeveloper),
    [isDeveloper],
  );

  return (
    <>
      {/* Backdrop — mobile only */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={onMobileClose}
          aria-hidden
        />
      )}

      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col",
          "bg-white border-r border-canvas-200/80 overflow-hidden",
          "transition-[width,box-shadow] duration-200 ease-out",
          // Mobile: full drawer (256px) that slides in/out.
          "w-64",
          mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
          // Desktop: always visible, width toggled by React hover state.
          "lg:translate-x-0",
          hovered
            ? "lg:w-64 lg:shadow-[4px_0_24px_-8px_rgba(15,23,42,0.15)]"
            : "lg:w-14 lg:shadow-none",
        )}
      >
        {/* Brand row — tile pinned in the rail well; cursive "get" +
            BEAKON wordmark fades in to the right when expanded so the
            sidebar's mark matches the rest of the app. */}
        <div className="h-16 flex items-center border-b border-canvas-100 shrink-0">
          <div className="w-14 h-full flex items-center justify-center shrink-0">
            <Logo variant="icon" size={28} />
          </div>
          <div
            className={cn(
              "flex items-center pr-4 whitespace-nowrap",
              "transition-opacity duration-150",
              expanded ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={!expanded}
          >
            <Logo variant="wordmark" size={28} />
          </div>
        </div>

        {/* Grouped nav */}
        <nav
          className="flex-1 overflow-y-auto overflow-x-hidden py-3 pb-8"
          aria-label="Main navigation"
        >
          {visibleSections.map((section) => {
            // Use the original index from NAV_SECTIONS so collapsed[]
            // stays stable when developer-only sections appear/hide.
            const idx = NAV_SECTIONS.indexOf(section);
            return (
              <NavSectionBlock
                key={idx}
                section={section}
                isFirst={idx === 0}
                expanded={expanded}
                collapsed={Boolean(collapsed[idx])}
                onToggle={() =>
                  setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }))
                }
                pathname={pathname}
                onNavigate={onMobileClose}
              />
            );
          })}
        </nav>
      </aside>
    </>
  );
}


function NavSectionBlock({
  section, isFirst, expanded, collapsed, onToggle, pathname, onNavigate,
}: {
  section: NavSection;
  isFirst: boolean;
  expanded: boolean;
  collapsed: boolean;
  onToggle: () => void;
  pathname: string;
  onNavigate?: () => void;
}) {
  const isCollapsible = Boolean(section.collapsible) && Boolean(section.label);
  // When collapsed in the expanded sidebar, hide the items. In the
  // collapsed (icon-only) rail we always show the icons so the user
  // can still click through without expanding the sidebar first.
  const showItems = !expanded || !collapsed;

  return (
    <div className={cn(!isFirst && "mt-4")}>
      {section.label ? (
        isCollapsible ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className={cn(
              "w-full flex items-center justify-between px-5 mb-1",
              "text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400 whitespace-nowrap",
              "hover:text-gray-600 transition-colors",
              "transition-opacity duration-150",
              expanded ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
            )}
          >
            <span>{section.label}</span>
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 transition-transform duration-150",
                collapsed ? "-rotate-90" : "rotate-0",
              )}
            />
          </button>
        ) : (
          <div
            className={cn(
              "px-5 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400 whitespace-nowrap",
              "transition-opacity duration-150",
              expanded ? "opacity-100" : "opacity-0",
            )}
          >
            {section.label}
          </div>
        )
      ) : (
        !isFirst && (
          <div
            className={cn(
              "h-px bg-canvas-100 mx-3 my-2 transition-opacity duration-150",
              expanded ? "opacity-100" : "opacity-0",
            )}
          />
        )
      )}
      {showItems && (
        <ul className="space-y-0.5 px-1.5">
          {section.items.map((item) => (
            <li key={item.href}>
              <NavRow item={item} expanded={expanded} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


function NavRow({
  item, expanded, pathname, onNavigate,
}: {
  item: NavItem;
  expanded: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const isActive =
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href));

  // Fixed 44px icon well keeps icons centered in the collapsed rail;
  // label fades in when `expanded`.
  const rowBase =
    "group relative flex items-center h-9 rounded-lg transition-colors whitespace-nowrap";

  const iconWell = (extraIconClass?: string) => (
    <span className="w-11 h-full flex items-center justify-center shrink-0">
      <Icon className={cn("w-[18px] h-[18px] transition-colors", extraIconClass)} />
    </span>
  );

  const labelClass = cn(
    "flex-1 truncate text-[13px] font-medium",
    "transition-opacity duration-150",
    expanded ? "opacity-100" : "opacity-0",
  );

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={item.description || item.name}
      className={cn(
        rowBase,
        isActive
          ? "bg-brand-50 text-brand-900"
          : "text-gray-600 hover:bg-canvas-50 hover:text-gray-900",
      )}
    >
      {/* Active left accent */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-brand-500"
        />
      )}
      {iconWell(isActive ? "text-brand-700" : "text-gray-400 group-hover:text-gray-600")}
      <span className={labelClass}>{item.name}</span>
    </Link>
  );
}
