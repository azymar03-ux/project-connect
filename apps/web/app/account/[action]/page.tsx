"use client";
import { useEffect, useState, useRef, use } from "react";
export default function AccountAction({
  params,
}: {
  params: Promise<{ action: string }>;
}) {
  const { action } = use(params);
  const [token, setToken] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const parsed = useRef(false);
  useEffect(() => {
    if (parsed.current) return;
    parsed.current = true;
    setToken(
      new URLSearchParams(
        window.location.hash.slice(1) || window.location.search,
      ).get("token") || "",
    );
    window.history.replaceState({}, "", window.location.pathname);
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch(
        "/api/account/" +
          (action === "verify"
            ? "verify"
            : action === "reset"
              ? "reset-password"
              : action === "activate"
                ? "activation"
                : "forgot-password"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "verify"
              ? { token, password: f.get("password"), name: f.get("name") }
              : action === "reset"
                ? { token, password: f.get("password") }
                : { email: f.get("email") },
          ),
        },
      );
      const b = await r.json();
      setMessage(b.message);
      if (r.ok) setDone(true);
    } catch {
      setMessage("Connection failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 520, paddingTop: 80 }}>
      <div className="panel">
        <div className="eyebrow">PROJECTCONNECT · ACCOUNT SECURITY</div>
        <h1>
          {action === "verify"
            ? "Verify your email"
            : action === "reset"
              ? "Set a new password"
              : action === "activate"
                ? "Request an activation link"
                : "Reset your password"}
        </h1>
        {!done && (
          <form onSubmit={submit}>
            {action === "reset" || action === "verify" ? (
              <>
                {action === "verify" && (
                  <label className="field">
                    Your profile name
                    <input
                      name="name"
                      minLength={2}
                      maxLength={80}
                      required
                      autoComplete="name"
                    />
                  </label>
                )}
                <label className="field">
                  New password
                  <input
                    name="password"
                    autoComplete="new-password"
                    type="password"
                    minLength={10}
                    maxLength={72}
                    required
                  />
                </label>
              </>
            ) : action !== "verify" ? (
              <label className="field">
                Email address
                <input name="email" type="email" required />
              </label>
            ) : (
              <p className="modal-subtitle">
                Confirm only if you personally registered this account. If you
                did not request it, do not verify this link.
              </p>
            )}
            <button
              className="primary-button full-width"
              disabled={
                busy || ((action === "verify" || action === "reset") && !token)
              }
            >
              {busy
                ? "Working…"
                : action === "verify"
                  ? "Verify email"
                  : action === "reset"
                    ? "Reset password"
                    : action === "activate"
                      ? "Send activation email"
                      : "Send reset email"}
            </button>
          </form>
        )}
        {message && (
          <p role="status" style={{ marginTop: 20 }}>
            {message}
          </p>
        )}
        <a href="/account/activate" className="panel-link">
          Need an activation link?
        </a>
        <a href="/" className="panel-link">
          Back to ProjectConnect
        </a>
      </div>
    </main>
  );
}
