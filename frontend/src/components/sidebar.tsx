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
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchCurrentUser, type CurrentUser, type UserOrganization } from "@/lib/api";
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
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

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

  // Detect developer (staff) + load the current user once on mount.
  // Failure is silent — Developer section stays hidden and the user
  // chip falls back to a generic avatar.
  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((u) => {
        if (cancelled) return;
        setIsDeveloper(Boolean(u?.is_staff || u?.is_superuser));
        setCurrentUser(u ?? null);
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
            (it.href !== "/dashboard" && pathname.startsWith(it.href)) ||
            (it.matches ?? []).some((p) => pathname.startsWith(p)),
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

  // Sections with `pinBottom` flow to the bottom of the rail (above the
  // brand row's flex spacer). Help / Beakon Tour and the Developer group
  // both pin so they don't compete with the module list for first-screen
  // real estate.
  const topSections = visibleSections.filter((s) => !s.pinBottom);
  const bottomSections = visibleSections.filter((s) => s.pinBottom);

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

        {/* Grouped nav — top sections flow naturally, bottom sections
            are pushed to the foot of the rail by `mt-auto`. */}
        <nav
          className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden py-3 pb-4"
          aria-label="Main navigation"
        >
          {topSections.map((section, ti) => {
            const idx = NAV_SECTIONS.indexOf(section);
            return (
              <NavSectionBlock
                key={idx}
                section={section}
                isFirst={ti === 0}
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
          {bottomSections.length > 0 && <div className="mt-auto" aria-hidden />}
          {bottomSections.map((section, bi) => {
            const idx = NAV_SECTIONS.indexOf(section);
            return (
              <NavSectionBlock
                key={idx}
                section={section}
                isFirst={bi === 0}
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

        {/* User-profile chip pinned to the very bottom of the rail.
            Collapsed rail shows just the initials avatar; expanded
            sidebar reveals full name + role · org. Matches Thomas's
            2026-05-11 sidebar mockup. */}
        <UserChip user={currentUser} expanded={expanded} />
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


function UserChip({
  user, expanded,
}: { user: CurrentUser | null; expanded: boolean }) {
  // Pick the org matching localStorage so the chip reflects the
  // current workspace, not the user's first org. Falls back to first.
  const activeOrg: UserOrganization | null = useMemo(() => {
    if (!user?.organizations || user.organizations.length === 0) return null;
    const orgId = typeof window !== "undefined"
      ? localStorage.getItem("organization_id") : null;
    if (orgId) {
      const match = user.organizations.find((o) => String(o.id) === orgId);
      if (match) return match;
    }
    return user.organizations[0];
  }, [user]);

  const fullName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(" ").trim()
      || user.email?.split("@")[0]
      || "Member"
    : "";
  const initials = initialsFor(user);
  const roleLabel = activeOrg?.role ? prettifyRole(activeOrg.role) : "";
  const orgLabel = activeOrg?.name || "";

  return (
    <Link
      href="/dashboard/settings"
      className={cn(
        "flex items-center gap-3 border-t border-canvas-100 px-3 py-3",
        "hover:bg-canvas-50/60 transition-colors",
      )}
      title={fullName ? `${fullName} — ${orgLabel}` : "Account"}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          "bg-brand-100 text-brand-700 text-[11px] font-semibold tracking-wide",
        )}
      >
        {initials}
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 transition-opacity duration-150",
          expanded ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!expanded}
      >
        <div className="text-[12.5px] font-semibold text-gray-900 truncate leading-tight">
          {fullName || "Loading…"}
        </div>
        <div className="text-[10.5px] text-gray-500 truncate leading-tight mt-0.5">
          {roleLabel && orgLabel
            ? `${roleLabel} · ${orgLabel}`
            : (roleLabel || orgLabel || "")}
        </div>
      </div>
      <ChevronUp
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-gray-400 transition-opacity duration-150",
          expanded ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!expanded}
      />
    </Link>
  );
}


function initialsFor(user: CurrentUser | null): string {
  if (!user) return "·";
  const first = (user.first_name || "").trim();
  const last  = (user.last_name || "").trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (last)  return last.slice(0, 2).toUpperCase();
  const local = (user.email || "").split("@")[0];
  return (local.slice(0, 2) || "··").toUpperCase();
}


function prettifyRole(slug: string): string {
  if (!slug) return "";
  return slug
    .split(/[._-\s]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(" ");
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
  const matchesExtra = (item.matches ?? []).some((p) => pathname.startsWith(p));
  const isActive =
    pathname === item.href ||
    (item.href !== "/dashboard" && pathname.startsWith(item.href)) ||
    matchesExtra;

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

  // External items (e.g. /admin/...) open in a new tab via a plain
  // anchor so Next doesn't attempt to client-route a non-app path.
  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        title={item.description || item.name}
        className={cn(
          rowBase,
          "text-slate-700 hover:bg-canvas-50 hover:text-gray-900",
        )}
      >
        {iconWell("text-slate-500 group-hover:text-slate-700")}
        <span className={labelClass}>{item.name}</span>
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={item.description || item.name}
      className={cn(
        rowBase,
        // Thomas §5.2: active state uses Beakon blue more clearly —
        // soft brand background + deeper text. Inactive rows use a
        // stronger slate so the rail stays legible.
        isActive
          ? "bg-brand-50 text-brand-900"
          : "text-slate-700 hover:bg-canvas-50 hover:text-gray-900",
      )}
    >
      {/* Active left accent — stronger Beakon blue per Thomas §5.2. */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-brand-700"
        />
      )}
      {iconWell(
        // Thomas §5.2: inactive icons were too faint (gray-400);
        // bump to slate-500 for legibility. Active icon goes deeper
        // (brand-800) to read as confidently selected.
        isActive ? "text-brand-800" : "text-slate-500 group-hover:text-slate-700",
      )}
      <span className={labelClass}>{item.name}</span>
    </Link>
  );
}
