// ================================================================
// Hub connection settings: server address + mode switch.
// Used by the desktop/mobile shells to point at a remote hub.
// ================================================================
import { useEffect, useState } from "react";
import { Icon } from "./ui";
import { t } from "../i18n";
import { getDbMode, setDbMode, type DbMode } from "../lib/db";
import { fetchBootstrap, fetchMe } from "../lib/auth";
import { toast } from "sonner";

const HUB_URL_KEY = "myosotis.hubUrl";

export function getHubUrl(): string {
  return localStorage.getItem(HUB_URL_KEY) ?? "";
}

export function setHubUrl(url: string) {
  localStorage.setItem(HUB_URL_KEY, url.replace(/\/+$/, ""));
}

export default function ServerCard() {
  const [mode, setMode] = useState<DbMode>(getDbMode());
  const [url, setUrl] = useState(getHubUrl());
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode(getDbMode());
  }, []);

  const test = async () => {
    setBusy(true);
    setProbe(null);
    try {
      const base = url.replace(/\/+$/, "");
      const res = await fetch(`${base}/api/bootstrap`);
      const body = await res.json();
      if (!res.ok) throw new Error(`http ${res.status}`);
      setProbe({
        ok: true,
        text: body.needsSetup ? t("hubNeedsSetup") : t("hubOk"),
      });
    } catch (e: any) {
      setProbe({ ok: false, text: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setHubUrl(url);
    if (getHubUrl()) {
      // point the app at the remote hub: API base + remote storage mode
      (window as any).__MYO_API_BASE__ = getHubUrl();
    }
    setDbMode("remote");
    setMode("remote");
    toast.success(t("hubSwitched"));
    // reload so every request picks up the new base
    setTimeout(() => location.reload(), 600);
  };

  const backToLocal = () => {
    setDbMode("local");
    setMode("local");
    setHubUrl("");
    setTimeout(() => location.reload(), 400);
  };

  return (
    <div className="card">
      <h3>
        <Icon name="link" size={16} /> {t("secServer")}
        <span className="hint">{t("serverHint")}</span>
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ fontSize: 12.5, color: "var(--text-2)" }}>
          {t("hubServerUrl")}
          <input
            className="input"
            style={{ width: "100%", marginTop: 6 }}
            placeholder="https://myosotis.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" disabled={busy || !url.trim()} onClick={test}>
            {t("serverTest")}
          </button>
          <button className="btn primary" disabled={!url.trim()} onClick={apply}>
            {t("serverConnect")}
          </button>
          {mode === "remote" && (
            <button className="btn ghost" onClick={backToLocal}>
              {t("serverBackLocal")}
            </button>
          )}
          {probe && (
            <span style={{ fontSize: 12, color: probe.ok ? "#16a34a" : "#dc2626" }}>{probe.text}</span>
          )}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          {mode === "remote" ? `· ${t("hubMode")}` : `· ${t("localMode")}`}
        </div>
      </div>
    </div>
  );
}
