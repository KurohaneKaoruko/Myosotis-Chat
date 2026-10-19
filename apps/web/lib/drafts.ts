// ================================================================
// Per-conversation drafts.
//
// Switching conversations (or closing the app) must never lose what
// you were about to send. Drafts live in localStorage, keyed by
// conversation id, and are restored when you open that chat again.
// ================================================================

const KEY = "myosotis.drafts";

type Drafts = Record<string, string>;

function read(): Drafts {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Drafts;
  } catch {
    return {};
  }
}

function write(drafts: Drafts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    /* storage full / private mode — drafts are best-effort */
  }
}

export function getDraft(convoId: string | null): string {
  if (!convoId) return "";
  return read()[convoId] ?? "";
}

export function setDraft(convoId: string | null, text: string) {
  if (!convoId) return;
  const drafts = read();
  if (text.trim()) drafts[convoId] = text;
  else delete drafts[convoId];
  write(drafts);
}

export function clearDraft(convoId: string | null) {
  if (!convoId) return;
  const drafts = read();
  if (!(convoId in drafts)) return;
  delete drafts[convoId];
  write(drafts);
}

export function allDrafts(): Drafts {
  return read();
}
