"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasOrganizationContext, isAuthenticated, syncOrganizationContext } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
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

      router.push(hasOrganizationContext() ? "/dashboard" : "/setup");
    }

    void bootstrap();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
}
