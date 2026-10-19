// ================================================================
// Image uploads.
//
// Local mode keeps data URLs in IndexedDB (fully offline).
// Hub mode uploads the bytes once and keeps only the URL in the
// message — the database stays small and pages load faster.
// ================================================================
import { apiBase } from "./db";

/** data URL → hub URL (identity for local mode) */
export async function uploadImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const base = apiBase();
  if (!base) return dataUrl; // local mode: keep the data URL

  const res = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ data: dataUrl }),
  });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  const body = await res.json();
  if (!body?.url) throw new Error("upload failed");
  // keep the relative path in the message (portable across hosts);
  // it is resolved to an absolute URL at render time
  return body.path ?? body.url;
}

/** resolve a stored image path against the hub origin (remote mode) */
export function resolveImageUrl(src: string): string {
  if (!src.startsWith("/uploads/")) return src;
  const base = apiBase();
  return base ? base + src : src;
}

/** upload every image of a message; returns the message with URLs */
export async function uploadImages(images: string[] | undefined): Promise<string[] | undefined> {
  if (!images?.length) return images;
  const out: string[] = [];
  for (const img of images) {
    try {
      out.push(await uploadImage(img));
    } catch {
      out.push(img); // keep the original so the message still sends
    }
  }
  return out;
}
