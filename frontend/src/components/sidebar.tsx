"use client";

/* Sidebar — collapsible icon rail (Digits-style).
 *
 * Default state on desktop: a 56px vertical rail showing icons only.
 * On mouse-hover anywhere inside the rail, the sidebar smoothly expands
 * to 256px and reveals labels + section headers, overlaying the content
 * with a soft shadow. Moving the mouse out collapses it again.
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
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import Logo from "@/components/logo";
import { NAV_SECTIONS, type NavItem, type NavSection } from "@/components/sidebar-nav";

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}


export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const [hovered, setHovered] = useState(false);

  // `expanded` drives label + section-header visibility. On desktop it
  // follows hover; on mobile the drawer is always expanded when open.
  const expanded = hovered || mobileOpen;

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
        {/* Brand row */}
        <div className="h-16 flex items-center border-b border-canvas-100 shrink-0">
          <div className="w-14 h-full flex items-center justify-center shrink-0">
            <Logo variant="icon" size={26} />
          </div>
          <span
            className={cn(
              "text-[16px] font-semibold tracking-tight text-brand-900 whitespace-nowrap pr-5",
              "transition-opacity duration-150",
              expanded ? "opacity-100" : "opacity-0",
            )}
          >
            Beakon
          </span>
        </div>

        {/* Grouped nav */}
        <nav
          className="flex-1 overflow-y-auto overflow-x-hidden py-3 pb-8"
          aria-label="Main navigation"
        >
          {NAV_SECTIONS.map((section, si) => (
            <NavSectionBlock
              key={si}
              section={section}
              isFirst={si === 0}
              expanded={expanded}
              pathname={pathname}
              onNavigate={onMobileClose}
            />
          ))}
        </nav>
      </aside>
    </>
  );
}


function NavSectionBlock({
  section, isFirst, expanded, pathname, onNavigate,
}: {
  section: NavSection;
  isFirst: boolean;
  expanded: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className={cn(!isFirst && "mt-4")}>
      {section.label ? (
        <div
          className={cn(
            "px-5 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400 whitespace-nowrap",
            "transition-opacity duration-150",
            expanded ? "opacity-100" : "opacity-0",
          )}
        >
          {section.label}
        </div>
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
      <ul className="space-y-0.5 px-1.5">
        {section.items.map((item) => (
          <li key={item.href}>
            <NavRow item={item} expanded={expanded} pathname={pathname} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
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
    !item.soon &&
    (pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href)));

  // Fixed 44px icon well keeps icons centered in the collapsed rail;
  // label + Soon pill fade in when `expanded`.
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

  const soonPillClass = cn(
    "mr-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400 bg-canvas-100 rounded-full px-1.5 py-[1px] shrink-0",
    "transition-opacity duration-150",
    expanded ? "opacity-100" : "opacity-0",
  );

  // Disabled / placeholder — render as a non-link with a "Soon" pill.
  if (item.soon) {
    return (
      <div
        title={item.description || `${item.name} · coming soon`}
        aria-disabled
        className={cn(rowBase, "text-gray-400 cursor-not-allowed select-none")}
      >
        {iconWell("text-gray-300")}
        <span className={labelClass}>{item.name}</span>
        <span className={soonPillClass}>Soon</span>
      </div>
    );
  }

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
