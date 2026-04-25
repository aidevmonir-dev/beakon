"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, logout } from "@/lib/api";
import { LogOut, ChevronDown, Bell, Building2, Check, Menu } from "lucide-react";

interface OrgInfo {
  id: number;
  name: string;
  slug: string;
  role: string;
}

interface UserData {
  email: string;
  first_name: string;
  last_name: string;
  organizations: OrgInfo[];
}

interface HeaderProps {
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showOrgMenu, setShowOrgMenu] = useState(false);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);

  useEffect(() => {
    api.get<UserData>("/auth/me/").then(setUser).catch(() => {});
    setCurrentOrgId(localStorage.getItem("organization_id"));
  }, []);

  const currentOrg = user?.organizations?.find(
    (o) => o.id.toString() === currentOrgId
  ) || user?.organizations?.[0];

  const hasMultipleOrgs = (user?.organizations?.length || 0) > 1;

  function switchOrg(org: OrgInfo) {
    localStorage.setItem("organization_id", org.id.toString());
    setCurrentOrgId(org.id.toString());
    setShowOrgMenu(false);
    router.refresh();
    window.location.reload();
  }

  return (
    <header className="h-16 bg-canvas-100 border-b border-canvas-200/60 flex items-center justify-between px-3 sm:px-6 gap-2">
      {/* Left — hamburger (mobile) + org switcher */}
      <div className="flex items-center gap-1 min-w-0">
        <button
          type="button"
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-1 text-gray-600 hover:bg-gray-100 rounded-lg"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="relative min-w-0">
        <button
          onClick={() => hasMultipleOrgs && setShowOrgMenu(!showOrgMenu)}
          className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg transition-colors max-w-full ${
            hasMultipleOrgs ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"
          }`}
        >
          <div className="w-7 h-7 shrink-0 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center">
            <Building2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 text-left">
            <h2 className="text-sm font-semibold text-gray-900 truncate">{currentOrg?.name || "No organization"}</h2>
            {currentOrg && (
              <p className="text-[10px] text-gray-400 leading-none truncate">{currentOrg.role}</p>
            )}
          </div>
          {hasMultipleOrgs && <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" />}
        </button>

        {showOrgMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowOrgMenu(false)} />
            <div className="absolute left-0 mt-1 w-64 bg-white rounded-lg border border-gray-200 shadow-lg z-50 py-1">
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Switch Organization</p>
              </div>
              {user?.organizations?.map((org) => (
                <button
                  key={org.id}
                  onClick={() => switchOrg(org)}
                  className="flex items-center justify-between w-full px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center text-xs font-bold">
                      {org.name[0]}
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-gray-900">{org.name}</p>
                      <p className="text-xs text-gray-400">{org.role}</p>
                    </div>
                  </div>
                  {org.id.toString() === currentOrgId && (
                    <Check className="w-4 h-4 text-brand-600" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
        </div>
      </div>

      {/* Right — notifications + user menu */}
      <div className="flex items-center gap-1 sm:gap-4 shrink-0">
        <button className="relative p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
          <Bell className="w-5 h-5" />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-medium">
              {user?.first_name?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-gray-700">
                {user?.first_name ? `${user.first_name} ${user.last_name}` : user?.email}
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg border border-gray-200 shadow-lg z-50 py-1">
                <div className="px-3 py-2 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900 truncate">{user?.email}</p>
                  <p className="text-xs text-gray-400">{currentOrg?.role}</p>
                </div>
                <button
                  onClick={() => void logout()}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
