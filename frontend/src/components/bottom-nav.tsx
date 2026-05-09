"use client";

/* Mobile bottom tab bar.
 *
 * Visible only on small screens (<lg). Renders 4 destination tabs
 * (Home, Entities, Journals, Reports) plus a "More" tab that opens the
 * existing full sidebar drawer for everything else. The hamburger in the
 * header still works — this is an additive convenience for the mobile
 * pattern users actually expect.
 *
 * Sits above the iOS home-indicator via `safe-area-inset-bottom`.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Building2, NotebookPen, TrendingUp, Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";


interface Tab {
  name: string;
  href: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  { name: "Home",     href: "/dashboard",                 icon: LayoutDashboard,
    match: (p) => p === "/dashboard" },
  { name: "Entities", href: "/dashboard/entities",        icon: Building2,
    match: (p) => p.startsWith("/dashboard/entities") },
  { name: "Journals", href: "/dashboard/journal-entries", icon: NotebookPen,
    match: (p) => p.startsWith("/dashboard/journal-entries") },
  { name: "Reports",  href: "/dashboard/reports",         icon: TrendingUp,
    match: (p) => p.startsWith("/dashboard/reports") },
];


export default function BottomNav({ onMore }: { onMore: () => void }) {
  const pathname = usePathname() || "";

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 lg:hidden",
        "bg-white/95 backdrop-blur border-t border-canvas-200/80",
        "shadow-[0_-2px_12px_-4px_rgba(15,23,42,0.06)]",
        // Reserve space for the iOS home indicator without crushing the labels.
        "pb-[env(safe-area-inset-bottom)]",
      )}
      aria-label="Bottom navigation"
    >
      <div className="grid grid-cols-5 h-14">
        {TABS.map((t) => {
          const active = t.match(pathname);
          const Icon = t.icon;
          return (
            <Link
              key={t.name}
              href={t.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                "min-w-0 active:bg-canvas-50",
                active ? "text-brand-700" : "text-gray-500",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon
                className={cn(
                  "w-5 h-5 transition-colors",
                  active ? "text-brand-700" : "text-gray-400",
                )}
              />
              <span className="truncate">{t.name}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-gray-500 active:bg-canvas-50"
          aria-label="Open full menu"
        >
          <Menu className="w-5 h-5 text-gray-400" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
