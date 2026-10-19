// ================================================================
// Upload store — content-addressed image files on disk.
//
// Images used to travel (and live) as base64 data URLs inside the
// message JSON: ~33% larger than the bytes, and every message read
// had to parse them. Now the client uploads once and the message
// only carries a URL.
//
// Files are content-addressed (sha256) so identical uploads dedupe.
// ================================================================
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

/** hard limit per image (bytes) */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export class UploadStore {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "uploads");
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  get baseDir() {
    return this.dir;
  }

  /**
   * Store a data URL (or raw base64) and return its public URL.
   * Returns null when the payload is not a supported image or too big.
   */
  save(dataUrl: string): { url: string; bytes: number; mime: string } | null {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl.trim());
    if (!m) return null;
    const mime = m[1].toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) return null;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(m[3], m[2] ? "base64" : "utf8");
    } catch {
      return null;
    }
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) return null;

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const name = `${hash}.${ext}`;
    const file = path.join(this.dir, name);
    if (!existsSync(file)) writeFileSync(file, bytes);
    return { url: `/uploads/${name}`, bytes: bytes.length, mime };
  }

  /** read a stored file by its public name (path traversal safe) */
  read(name: string): { data: Buffer; mime: string } | null {
    if (!/^[a-f0-9]{8,64}\.[a-z0-9]{2,5}$/i.test(name)) return null;
    const file = path.join(this.dir, name);
    if (!existsSync(file)) return null;
    const ext = name.split(".").pop()!.toLowerCase();
    const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
    return { data: readFileSync(file), mime };
  }

  size() {
    try {
      return statSync(this.dir).size;
    } catch {
      return 0;
    }
  }
}
