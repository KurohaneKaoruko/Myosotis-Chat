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

export { zhCN };
