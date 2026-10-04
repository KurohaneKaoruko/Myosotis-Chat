import { Marked } from "marked";
import markedKatex from "./markedKatexStub.mjs";

const m = new Marked({ breaks: true, gfm: true, async: false }).use(
  markedKatex({ throwOnError: false })
);

const cases = [
  ["no-space formula, zh text", "块级公式：$$\\int_0^1 x\\,dx=\\frac{1}{2}$$ 完毕"],
  ["simple + space inside, zh", "块级公式：$$a + b = c$$ 完毕"],
  ["simple no space, zh", "块级公式：$$a+b=c$$ 完毕"],
  ["space after opening only", "块级公式：$$\\frac{1}{2}$$ 完毕"],
  ["standalone + space", "$$a + b = c$$"],
];

for (const [name, src] of cases) {
  const out = m.parse(src);
  console.log(name.padEnd(30), ":", out.includes("katex") ? "OK" : "FAIL");
}
