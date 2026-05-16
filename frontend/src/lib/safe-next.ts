// Validate a `?next=` value before redirecting. Only allow same-origin
// paths so a crafted link can't bounce the user to an external site after
// login (open-redirect class of bug).
//
// Accepted: paths starting with a single "/" — e.g. "/dashboard/journal-entries/1397".
// Rejected: anything starting with "//", "/\", "http", "://" or empty.
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v: string;
  try {
    v = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//") || v.startsWith("/\\")) return null;
  if (/^\s*(javascript|data|vbscript):/i.test(v)) return null;
  return v;
}

// Build a "/login?next=…" URL for the current location. Caller passes
// the current path + query (e.g. via `window.location.pathname + window.location.search`)
// or the result of `usePathname()` joined with the searchParams.
export function loginUrlWithNext(currentPath: string): string {
  if (!currentPath || currentPath === "/" || currentPath.startsWith("/login")) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(currentPath)}`;
}
