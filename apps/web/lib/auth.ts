// Auth client for the hub + db-mode switching.
export interface BootstrapInfo {
  needsSetup: boolean;
  version: string;
}

/** API base: same-origin by default, or an explicit hub URL for desktop/mobile. */
function apiBase(): string {
  const explicit = (window as any).__MYO_API_BASE__ || localStorage.getItem("myosotis.hubUrl") || "";
  return explicit.replace(/\/+$/, "");
}

async function jf<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase() + url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `http ${res.status}`), { code: body.error });
  return body as T;
}

export async function fetchBootstrap(): Promise<BootstrapInfo> {
  return jf("/api/bootstrap");
}

export async function setupAccount(username: string, password: string) {
  return jf<{ ok: true; username: string }>("/api/auth/setup", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function login(username: string, password: string, totp?: string) {
  return jf<{ ok: true; username: string; totpEnabled: boolean }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, totp }),
  });
}

export async function logout() {
  await jf("/api/auth/logout", { method: "POST" });
}

export async function fetchMe() {
  return jf<{ username: string; totpEnabled: boolean }>("/api/auth/me");
}
