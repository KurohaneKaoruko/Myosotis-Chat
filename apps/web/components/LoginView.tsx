import { useEffect, useState } from "react";
import { t } from "../i18n";
import { login, setupAccount, fetchBootstrap } from "../lib/auth";
import { setDbMode } from "../lib/db";

// ================================================================
// Login / first-run setup gate shown in hub (remote) mode.
// ================================================================
export default function LoginView({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [phase, setPhase] = useState<"loading" | "setup" | "login">("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetchBootstrap()
      .then((b) => setPhase(b.needsSetup ? "setup" : "login"))
      .catch(() => setErr(t("hubUnreachable")));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      if (phase === "setup") {
        await setupAccount(username.trim(), password);
      } else {
        await login(username.trim(), password, totp || undefined);
      }
      setDbMode("remote");
      onLoggedIn();
    } catch (e: any) {
      if (e?.code === "totp-required") {
        setNeedsTotp(true);
        setErr(t("totpRequired"));
      } else if (e?.code === "bad-credentials") setErr(t("badCredentials"));
      else if (e?.code === "weak-password") setErr(t("weakPassword"));
      else setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">🌸</div>
        <h1>Myosotis</h1>
        <p className="login-sub">{phase === "setup" ? t("firstSetupHint") : t("welcomeBack")}</p>
        <form onSubmit={submit}>
          <input
            autoFocus
            placeholder={t("username")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            type="password"
            placeholder={t("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={phase === "setup" ? "new-password" : "current-password"}
          />
          {needsTotp && (
            <input
              autoFocus
              placeholder={t("totpCode")}
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          )}
          {err && <div className="login-err">{err}</div>}
          <button type="submit" disabled={busy || !username || !password}>
            {busy ? "…" : phase === "setup" ? t("createAccount") : t("login")}
          </button>
        </form>
      </div>
    </div>
  );
}
