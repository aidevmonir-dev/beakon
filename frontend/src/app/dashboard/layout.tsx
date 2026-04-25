"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hasOrganizationContext, isAuthenticated, syncOrganizationContext } from "@/lib/api";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import AskBeakon from "@/components/ask-beakon";

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

    async function bootstrap() {
      if (!isAuthenticated()) {
        router.push("/login");
        return;
      }
      try {
        await syncOrganizationContext();
      } catch {
        router.push("/login");
        return;
      }
      if (!hasOrganizationContext()) {
        router.push("/setup");
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
          expands as a hover overlay so reading area doesn't shift. */}
      <div className="lg:pl-14">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="p-3 sm:p-5">
          <div className="canvas-panel min-h-[calc(100vh-5rem-2rem)]">
            {children}
          </div>
        </main>
      </div>
      <AskBeakon />
    </div>
  );
}
