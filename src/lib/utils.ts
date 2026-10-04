import type { ModelRole, ModelConfig, Provider, ResolvedModel, Settings } from "../types";
import { getLanguage } from "../i18n";

export function uid(prefix = ""): string {
  const core =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 13).replace(/-/g, "")
      : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return prefix ? `${prefix}_${core}` : core;
}

export function now(): number {
  return Date.now();
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function formatTime(ts: number): string {
  const locale = getLanguage() === "en" ? "en-US" : "zh-CN";
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(today.getTime() - 86400000);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return getLanguage() === "en" ? "Yesterday" : "昨天";
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  }
  return d.toLocaleDateString(locale, { year: "numeric", month: "numeric", day: "numeric" });
}

/** Normalized base url without trailing slash. */
export function trimUrl(u: string): string {
  return (u || "").trim().replace(/\/+$/, "");
}

export function resolveModel(
  role: ModelRole,
  models: ModelConfig[],
  providers: Provider[],
  settings: Settings,
  agentModels?: Partial<Record<"chat" | "vision" | "embedding", string>>
): ResolvedModel | null {
  // 1. agent override (chat can fall back to its own chat model for vision if capable)
  const overrideId = agentModels?.[role as "chat" | "vision" | "embedding"];
  if (overrideId) {
    const m = models.find((x) => x.id === overrideId);
    if (m) {
      const p = providers.find((x) => x.id === m.providerId);
      if (p) return { model: m, provider: p };
    }
  }
  // 2. global default for the role
  const defaultId = settings.defaults[role];
  if (defaultId) {
    const m = models.find((x) => x.id === defaultId);
    if (m) {
      const p = providers.find((x) => x.id === m.providerId);
      if (p) return { model: m, provider: p };
    }
  }
  // 3. any model that has this role
  const capable = models.find((x) => x.roles.includes(role));
  if (capable) {
    const p = providers.find((x) => x.id === capable.providerId);
    if (p) return { model: capable, provider: p };
  }
  return null;
}

/** Human friendly error text from a failed API call. */
export function friendlyError(e: unknown): string {
  if (e == null) return "未知错误";
  const msg = String((e as any)?.message ?? e);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return "网络连接失败：请检查网络、接口地址是否正确，以及该服务是否支持浏览器直连（CORS）";
  }
  if (/\b401\b|invalid.*key|incorrect.*api/i.test(msg)) return "鉴权失败（401）：API Key 无效或已过期";
  if (/\b403\b/i.test(msg)) return "无权限（403）：该 Key 没有访问此模型的权限";
  if (/\b404\b/i.test(msg)) return "接口不存在（404）：请检查 Base URL 和模型名称";
  if (/\b429\b|rate.?limit/i.test(msg)) return "请求太频繁（429）：稍等片刻再试，或检查账号额度";
  if (/insufficient|quota|余额/i.test(msg)) return "账户余额不足，请前往服务商控制台充值";
  return msg.length > 300 ? msg.slice(0, 300) + "…" : msg;
}

/** cosine similarity, assumes same length vectors */
export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** lightweight text similarity for the no-embedding fallback: bigram jaccard */
export function textSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/\s+/g, "");
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    if (t.length === 1) set.add(t);
    return set;
  };
  const A = grams(a),
    B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Strip markdown syntax for previews in the conversation list. */
export function plainPreview(md: string): string {
  return (md || "")
    .replace(/```[\s\S]*?```/g, " [代码] ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " [图片] ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
