import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

// exactly like the lazy instance in Markdown.tsx
const m = new Marked({ breaks: true, gfm: true, async: false }).use(
  markedKatex({ throwOnError: false })
);

const cases = {
  blockStandalone: "$$\\int_0^1 x\\,dx = \\frac{1}{2}$$",
  blockWithZh: "块级公式：$$\\int_0^1 x\\,dx = \\frac{1}{2}$$ 完毕",
  blockCommaNoBackslash: "块级公式：$$\\int_0^1 x,dx = \\frac{1}{2}$$ 完毕",
};

for (const [name, src] of Object.entries(cases)) {
  try {
    const out = m.parse(src);
    console.log(name, ":", out.includes("katex") ? "OK" : "FAIL ->", out.slice(0, 120));
  } catch (e) {
    console.log(name, ": THROW ->", String(e).slice(0, 120));
  }
}
