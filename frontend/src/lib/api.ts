/* API base URL.
 *
 * Default = "/api/v1" (a relative URL). Next.js's rewrite in next.config.js
 * forwards /api/* → http://localhost:8000/api/* on the dev server, so the
 * browser only ever talks to the same origin that served the page.
 *
 * This is what makes the Cloudflare / ngrok single-tunnel setup work for
 * OTHER devices: their browser calls e.g.
 *   https://<tunnel>.trycloudflare.com/api/v1/auth/login/
 * which Cloudflare forwards to our Next.js dev server, which rewrites it
 * to http://localhost:8000/api/v1/auth/login/ on the machine running the
 * tunnel. No second tunnel needed, no CORS headaches.
 *
 * Override with NEXT_PUBLIC_API_BASE=https://... only if you want to point
 * the frontend at a SEPARATE Django tunnel (skipping the rewrite). Doing
 * so requires CORS_ALLOWED_ORIGINS and CSRF_TRUSTED_ORIGINS to include
 * the frontend origin on the Django side.
 */
export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NEXT_PUBLIC_API_HOST
    ? `${process.env.NEXT_PUBLIC_API_HOST.replace(/\/$/, "")}/api/v1`
    : "/api/v1");

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  includeOrgHeader?: boolean;
}

export interface UserOrganization {
  id: number;
  name: string;
  slug: string;
  role: string;
}

export interface CurrentUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_staff?: boolean;
  is_superuser?: boolean;
  organizations?: UserOrganization[];
}

class ApiClient {
  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("access_token");
  }

  private getOrgId(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("organization_id");
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, includeOrgHeader = true, ...fetchOptions } = options;

    let url = `${API_BASE}${path}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const orgId = this.getOrgId();
    if (includeOrgHeader && orgId) {
      headers["X-Organization-ID"] = orgId;
    }

    const response = await fetch(url, { ...fetchOptions, headers });

    if (response.status === 401) {
      // Try refresh
      const refreshed = await this.refreshToken();
      if (refreshed) {
        headers["Authorization"] = `Bearer ${this.getToken()}`;
        const retryResponse = await fetch(url, { ...fetchOptions, headers });
        if (!retryResponse.ok) throw await this.parseError(retryResponse);
        return retryResponse.json();
      }
      // Redirect to login
      if (typeof window !== "undefined") {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        window.location.href = "/login";
      }
      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      throw await this.parseError(response);
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  private async refreshToken(): Promise<boolean> {
    const refresh = localStorage.getItem("refresh_token");
    if (!refresh) return false;

    try {
      const response = await fetch(`${API_BASE}/auth/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      localStorage.setItem("access_token", data.access);
      if (data.refresh) localStorage.setItem("refresh_token", data.refresh);
      return true;
    } catch {
      return false;
    }
  }

  private async parseError(response: Response) {
    try {
      const data = await response.json();
      return { status: response.status, ...data };
    } catch {
      return { status: response.status, message: response.statusText };
    }
  }

  get<T>(
    path: string,
    params?: Record<string, string>,
    options: Omit<RequestOptions, "method" | "params"> = {},
  ) {
    return this.request<T>(path, { ...options, method: "GET", params });
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }
}

export const api = new ApiClient();

// ── Auth helpers ──────────────────────────────────────────────────────

export async function fetchCurrentUser(): Promise<CurrentUser> {
  return api.get<CurrentUser>("/auth/me/", undefined, { includeOrgHeader: false });
}

export async function syncOrganizationContext(): Promise<UserOrganization | null> {
  const user = await fetchCurrentUser();
  const organizations = user.organizations || [];

  if (typeof window === "undefined") {
    return organizations[0] || null;
  }

  if (organizations.length === 0) {
    localStorage.removeItem("organization_id");
    return null;
  }

  const existingOrgId = localStorage.getItem("organization_id");
  const matchedOrg = existingOrgId
    ? organizations.find((org) => org.id.toString() === existingOrgId)
    : null;

  const activeOrg = matchedOrg || organizations[0];
  localStorage.setItem("organization_id", activeOrg.id.toString());
  return activeOrg;
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await res.json();
  const data = await res.json();
  localStorage.setItem("access_token", data.access);
  localStorage.setItem("refresh_token", data.refresh);
  await syncOrganizationContext();
  return data;
}

export async function register(email: string, password: string, firstName: string, lastName: string) {
  const res = await fetch(`${API_BASE}/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, first_name: firstName, last_name: lastName }),
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

export async function logout() {
  const refresh = localStorage.getItem("refresh_token");
  if (refresh) {
    try {
      await api.post("/auth/logout/", { refresh });
    } catch {
      // Ignore errors — clear local state regardless
    }
  }
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("organization_id");
  window.location.href = "/login";
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("access_token");
}

export function hasOrganizationContext(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("organization_id");
}

export async function requestPasswordReset(email: string) {
  const res = await fetch(`${API_BASE}/auth/password/reset/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

export async function confirmPasswordReset(token: string, newPassword: string) {
  const res = await fetch(`${API_BASE}/auth/password/reset/confirm/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

export async function verifyEmail(token: string) {
  const res = await fetch(`${API_BASE}/auth/verify-email/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

export async function changePassword(oldPassword: string, newPassword: string) {
  return api.post("/auth/password/change/", {
    old_password: oldPassword,
    new_password: newPassword,
  });
}
