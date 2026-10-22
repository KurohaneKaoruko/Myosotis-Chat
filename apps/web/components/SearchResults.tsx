import { useEffect, useState } from "react";
import { Icon } from "./ui";
import { t, tf } from "../i18n";
import { useStore } from "../store";
import { apiBase } from "../lib/db";
import { resolveImageUrl } from "../lib/uploads";
import type { ChatMessage } from "@myosotis/core";

// ================================================================
// Global message search (hub mode).
//
// Finds text in the whole history on the server — the client never
// downloads every message just to filter them.
// ================================================================

interface SearchHit {
  message: ChatMessage;
  conversationId: string;
  conversationTitle: string;
}

interface SearchGroup {
  conversationId: string;
  conversationTitle: string;
  hits: ChatMessage[];
}

export default function SearchResults({
  query,
  onClose,
}: {
  query: string;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const openConversation = useStore((s) => s.openConversation);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase()}/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`http ${res.status}`);
        const data = await res.json();
        if (!cancelled) setGroups(data.results ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  return (
    <div className="search-results">
      <div className="search-results-head">
        <span>
          {loading
            ? t("searching")
            : failed
              ? t("searchUnavailable")
              : total
                ? tf("searchFound", { n: total })
                : t("searchNoResult")}
        </span>
        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={onClose} title={t("commonClose")}>
          <Icon name="x" size={13} />
        </button>
      </div>

      {!loading && !failed && groups.length === 0 && <div className="search-empty">{t("searchNoResult")}</div>}

      {groups.map((g) => (
        <div key={g.conversationId} className="search-group">
          <div
            className="search-group-title"
            onClick={() => {
              openConversation(g.conversationId);
              onClose();
            }}
          >
            <Icon name="chat" size={13} />
            <span>{g.conversationTitle || t("newChat")}</span>
            <span className="search-group-count">{g.hits.length}</span>
          </div>
          {g.hits.map((m) => (
            <div
              key={m.id}
              className="search-hit-row"
              onClick={() => {
                openConversation(g.conversationId);
                onClose();
              }}
            >
              <div className="search-hit-text">
                <Highlight text={m.content} term={query} />
              </div>
              <div className="search-hit-meta">
                {m.role === "user" ? t("me") : t("quoteAi")} · {new Date(m.createdAt).toLocaleString()}
                {m.images?.length ? ` · 🖼 ${m.images.length}` : ""}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** text with the search term marked */
function Highlight({ text, term }: { text: string; term: string }) {
  const q = term.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  for (;;) {
    const at = lower.indexOf(q, i);
    if (at < 0) {
      if (i < text.length) out.push(text.slice(i));
      break;
    }
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={key++} className="search-mark">
        {text.slice(at, at + q.length)}
      </mark>
    );
    i = at + q.length;
  }
  return <>{out}</>;
}
