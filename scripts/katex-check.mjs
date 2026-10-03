import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

const marked = new Marked(true).use(markedKatex({ throwOnError: false }));

const inline = marked.parse("能量公式是 $E=mc^2$，很好");
const block = marked.parse("公式如下：\n\n$$\\int_0^1 x\\,dx = \\frac{1}{2}$$\n\n完毕");
const codeBlock = marked.parse("```js\nconst a = $x$;\n```\n正文 $a_1$ 结束");
const price = marked.parse("这个软件只卖 $5，降价到 $3。");
const bad = marked.parse("公式 $\\frac{1{$ 完了");

console.log("INLINE   :", inline.includes("katex") && inline.includes("mc") ? "OK" : "FAIL");
console.log("BLOCK    :", block.includes("katex-display") ? "OK" : "FAIL");
console.log(
  "CODESAFE :",
  codeBlock.includes("<code>const a = $x$;</code>") && codeBlock.includes("katex") ? "OK（代码块未污染，正文公式渲染）" : "FAIL " + codeBlock
);
console.log("PRICE    :", price.includes("katex") ? "FAIL（价格被误判）" : "OK（$5 $3 未触发）");
console.log("BADFALLBK:", bad.includes("frac") || bad.includes("$") ? "OK（原文降级）" : "FAIL");
