// Backup orchestration: local data -> (optional encryption) -> WebDAV file,
// and the reverse for restore. Auto-backup scheduling lives in store.init.

import { exportAll, importAll } from "./db";
import { encryptText, decryptText } from "./crypto";
import { davPut, davGet, davMkdir, davList, type WebDavConfig, type DavEntry } from "./webdav";

const MAGIC = "myosotis-backup";

export function dirOf(cfg: WebDavConfig): string {
  const d = cfg.directory?.trim() || "/Myosotis";
  return d.startsWith("/") ? d : "/" + d;
}

export function backupFilename(date = new Date()): string {
  return `myosotis-backup-${date.toISOString().slice(0, 10)}.json`;
}

export async function webdavBackup(
  cfg: WebDavConfig,
  opts: { encrypt: boolean; backupPassword?: string }
): Promise<string> {
  await davMkdir(cfg, "/");
  const dataText = await (await exportAll()).text();
  let payload: Record<string, unknown>;
  if (opts.encrypt) {
    if (!opts.backupPassword) throw new Error("已开启加密但未设置备份密码");
    const enc = await encryptText(dataText, opts.backupPassword);
    payload = { magic: MAGIC, version: 2, encrypted: true, ...enc };
  } else {
    payload = { magic: MAGIC, version: 2, encrypted: false, data: JSON.parse(dataText) };
  }
  const filename = backupFilename();
  await davPut(cfg, `${dirOf(cfg)}/${filename}`, JSON.stringify(payload));
  return filename;
}

export async function webdavListBackups(cfg: WebDavConfig): Promise<DavEntry[]> {
  const entries = await davList(cfg, dirOf(cfg));
  return entries.sort((a, b) => (b.modifiedAt?.getTime() ?? 0) - (a.modifiedAt?.getTime() ?? 0));
}

export async function webdavRestore(
  cfg: WebDavConfig,
  filename: string,
  backupPassword?: string
): Promise<void> {
  const text = await davGet(cfg, `${dirOf(cfg)}/${filename}`);
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }
  if (payload?.magic !== MAGIC) throw new Error("不是 Myosotis 的备份文件");
  let dataText: string;
  if (payload.encrypted) {
    if (!backupPassword) throw new Error("该备份已加密，需要输入备份密码");
    dataText = await decryptText(payload, backupPassword);
  } else {
    dataText = JSON.stringify(payload.data);
  }
  const file = new File([dataText], filename, { type: "application/json" });
  await importAll(file);
}
