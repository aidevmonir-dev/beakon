"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hasOrganizationContext, isAuthenticated, syncOrganizationContext } from "@/lib/api";
import { loginUrlWithNext } from "@/lib/safe-next";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import AskBeakon from "@/components/ask-beakon";
import BottomNav from "@/components/bottom-nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Guard against React strict-mode + dev Fast Refresh re-running bootstrap
  // in a tight loop (we saw 1 /auth/me/ per second on the server). The ref
  // flips after the first successful run; it survives re-renders.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // Capture the path + query the user actually wanted, so that after
    // login they land back here instead of being dropped on /dashboard.
    const currentPath =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : pathname || "/dashboard";
    const loginHref = loginUrlWithNext(currentPath);

    async function bootstrap() {
      if (!isAuthenticated()) {
        router.push(loginHref);
        return;
      }
      try {
        await syncOrganizationContext();
      } catch {
        router.push(loginHref);
        return;
      }
      if (!hasOrganizationContext()) {
        router.push(`/setup?next=${encodeURIComponent(currentPath)}`);
      }
    }

    void bootstrap();
    // router ref is intentionally excluded — it changes each render in
    // Next 16 and caused a continuous refetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-canvas-100">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      {/* Main reserves only the collapsed rail width (56px); the sidebar
          expands as a hover overlay so reading area doesn't shift.
          On mobile, pb-20 leaves room for the BottomNav (h-14 + safe-area). */}
      <div className="lg:pl-14">
        {/* Trial status moved into the header as a compact pill
            (Thomas §5.10) — no longer competes with page content. */}
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="p-3 sm:p-5 pb-20 lg:pb-5">
          <div className="canvas-panel min-h-[calc(100vh-5rem-2rem)]">
            {children}
          </div>
        </main>
      </div>
      <AskBeakon />
      <BottomNav onMore={() => setMobileNavOpen(true)} />
    </div>
  );
}
