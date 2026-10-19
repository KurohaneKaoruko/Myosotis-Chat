import zhCN, { type Dict } from "./zh-CN";
import en from "./en";

export type Lang = "zh-CN" | "en";

const dicts: Record<Lang, Partial<Dict>> = {
  "zh-CN": zhCN,
  en,
};

let current: Lang = "zh-CN";

export function setLanguage(lang: Lang): void {
  current = lang;
}

export function getLanguage(): Lang {
  return current;
}

/** Translate a key in the current language; falls back to the zh-CN source. */
export function t(key: keyof Dict): string {
  const dict = dicts[current] as Partial<Dict>;
  return dict[key] ?? zhCN[key];
}

/** Translate with {placeholder} interpolation; falls back to the zh-CN source. */
export function tf(key: keyof Dict, params: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** BCP47 locale for Date.prototype.toLocale*String in the current language. */
export function dateLocale(): string {
  return current === "en" ? "en-US" : "zh-CN";
}

export { zhCN };
