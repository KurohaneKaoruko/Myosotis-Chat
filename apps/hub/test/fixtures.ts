// Shared fixtures for the hub test suite: a signed-in client plus the
// minimal data set (provider → model → agent) every test needs.
// The mock model server on :9911 answers the chat requests.

export const API = process.env.HUB_API ?? "http://127.0.0.1:8791";
export const MOCK_API = process.env.MOCK_API ?? "http://127.0.0.1:9911";

export interface Client {
  cookie: string;
  ok: boolean;
}

export async function login(): Promise<Client> {
  const creds = { username: "nightx", password: "test12345" };
  const doLogin = () =>
    fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
  let res = await doLogin();
  if (res.status === 401) {
    // fresh database → create the account first
    await fetch(`${API}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
    res = await doLogin();
  }
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  return { cookie, ok: res.ok };
}

export async function api(cookie: string, path: string, init?: RequestInit) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

/** provider + model + agent, so chat requests can actually run */
export async function seedBasics(cookie: string) {
  await api(cookie, "/api/data/providers/p1", {
    method: "PUT",
    body: JSON.stringify({
      id: "p1", name: "Mock", protocol: "openai", baseUrl: `${MOCK_API}/v1`,
      apiKey: "sk-test", createdAt: 1,
    }),
  });
  await api(cookie, "/api/data/models/m1", {
    method: "PUT",
    body: JSON.stringify({
      id: "m1", name: "mock-chat", providerId: "p1", label: "Mock",
      roles: ["chat", "vision", "embedding"],
    }),
  });
  await api(cookie, "/api/data/agents/ag1", {
    method: "PUT",
    body: JSON.stringify({
      id: "ag1", name: "小樱", emoji: "🌸", hue: 330, persona: "你是小樱，温柔的朋友",
      greeting: "你好呀，我是小樱！", suggestions: [], memoryEnabled: true,
      models: {}, createdAt: 1, updatedAt: 1,
    }),
  });
  await api(cookie, "/api/data/settings", {
    method: "PUT",
    body: JSON.stringify({ defaults: { chat: "m1", vision: "m1", embedding: "m1" } }),
  });
}

/** all system prompts the mock model received since the last reset */
export async function promptLog(): Promise<string[]> {
  const res = await fetch(`${MOCK_API}/prompt-log`);
  return (await res.json()) as string[];
}

export async function resetLog() {
  await fetch(`${MOCK_API}/reset-log`);
}

/** the newest prompt that contains the marker (the chat turn) */
export async function chatPrompt(marker: string): Promise<string> {
  const log = await promptLog();
  for (let i = log.length - 1; i >= 0; i--) if (log[i].includes(marker)) return log[i];
  return "";
}
