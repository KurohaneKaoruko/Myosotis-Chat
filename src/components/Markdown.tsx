import { useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
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

marked.setOptions({ breaks: true, gfm: true, async: false });

export default function Markdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    try {
      const raw = marked.parse(text || "") as string;
      return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
    } catch {
      return DOMPurify.sanitize(text ?? "");
    }
  }, [text]);

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
