import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

const m = new Marked({ breaks: true, gfm: true }).use(markedKatex({ throwOnError: false }));

const t1 = m.parse("中文在前 $$a+b=c$$ 中文在后");
const t2 = m.parse("$$a+b=c$$");
const t3 = m.parse("前 $$a+b$$ 后");
const t4 = m.parse("中文行内单 $a+b$ 后");

console.log("1 zh-text + same-line $$ :", t1.includes("katex") ? "OK" : "FAIL");
console.log("2 standalone-para $$     :", t2.includes("katex") ? "OK" : "FAIL");
console.log("3 en-text + same-line $$ :", t3.includes("katex") ? "OK" : "FAIL");
console.log("4 zh-text + single $     :", t4.includes("katex") ? "OK" : "FAIL");
