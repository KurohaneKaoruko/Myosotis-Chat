import { useEffect, useMemo, useRef, useState } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import Prism from "prismjs";
// language components (order matters: deps first)
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";

const marked = new Marked({ breaks: true, gfm: true, async: false });

// KaTeX chain is lazy: only conversations that actually contain math pay for it.
let katexInstance: Marked | null = null;
let katexLoading: Promise<Marked> | null = null;

function loadKatex(): Promise<Marked> {
  katexLoading ??= (async () => {
    const [{ default: markedKatex }] = await Promise.all([
      import("marked-katex-extension"),
      import("katex/dist/katex.min.css"),
    ]);
    katexInstance = new Marked({ breaks: true, gfm: true, async: false }).use(
      markedKatex({ throwOnError: false })
    );
    return katexInstance;
  })();
  return katexLoading;
}

/** Loose detection: a false positive only triggers the lazy load, never wrong rendering. */
function looksLikeMath(text: string): boolean {
  return /\$\$[^$]+?\$\$|\$[^\s$][^$\n]*?[^\s$]\$/.test(text);
}

function sanitize(raw: string): string {
  try {
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  } catch {
    return DOMPurify.sanitize(raw);
  }
}

function render(text: string, withMath: boolean): string {
  try {
    const parser = withMath && katexInstance ? katexInstance : marked;
    return sanitize(parser.parse(text || "") as string);
  } catch {
    return sanitize(text ?? "");
  }
}

export default function Markdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const needsMath = useMemo(() => looksLikeMath(text), [text]);
  const [mathReady, setMathReady] = useState(!!katexInstance);

  useEffect(() => {
    if (needsMath && !katexInstance) {
      loadKatex().then(() => setMathReady(true));
    }
  }, [needsMath]);

  const html = useMemo(() => render(text, needsMath && mathReady), [text, needsMath, mathReady]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // syntax highlight + language tag + copy button
    root.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      if (!code) return;
      const lang = /language-([\w-]+)/.exec(code.className)?.[1];
      if (lang) pre.setAttribute("data-lang", lang);
      try {
        Prism.highlightElement(code);
      } catch {}
      if (!pre.querySelector(".copy-code")) {
        const btn = document.createElement("button");
        btn.className = "copy-code";
        btn.textContent = "复制";
        btn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(code.textContent ?? "");
            btn.textContent = "已复制";
            setTimeout(() => (btn.textContent = "复制"), 1500);
          } catch {}
        };
        pre.appendChild(btn);
      }
    });
  }, [html]);

  return <div ref={ref} className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
