"use client";
import AccountBundle from "./AccountBundle";
import AccountExport from "./AccountExport";
import { useEffect, useState } from "react";
async function api(path: string, method = "GET", data?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.message);
  return b;
}
export default function AccountSecurity({
  notify,
  onSignedOut,
}: {
  notify: (s: string) => void;
  onSignedOut: () => void;
}) {
  const [blocks, setBlocks] = useState<any[]>([]),
    [google, setGoogle] = useState({ configured: false, linked: false });
  const [info, setInfo] = useState<any>(null),
    [sessions, setSessions] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setInfo(await api("account"));
      const [status, linked] = await Promise.all([
        api("auth/google/status"),
        api("auth/google/account"),
      ]);
      setGoogle({ ...status, ...linked });
      setBlocks(await api("blocks"));
      setSessions(await api("account/sessions"));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR ACCOUNT, YOUR CONTROL</div>
          <h1>Account security</h1>
          <p>Manage email verification, passwords, and active sessions.</p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="progress-layout">
        <section className="panel">
          <h3>Email verification</h3>
          <p className="muted">{info?.email}</p>
          <p style={{ margin: "16px 0" }}>
            {info?.emailVerifiedAt
              ? "Email verified"
              : "Email not yet verified"}
          </p>
          {!info?.emailVerifiedAt && (
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  notify((await api("account/verification", "POST")).message);
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              Send verification email
            </button>
          )}
          <p className="integration-note">
            Delivery needs a configured SMTP provider. Development messages are
            held in a private database outbox, not shown publicly.
          </p>
          <h3>Google sign-in</h3>
          <p className="muted">
            {google.linked
              ? "Google account linked"
              : google.configured
                ? "Link Google only while signed in to this account."
                : "Owner has not configured Google OAuth."}
          </p>
          {google.configured && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  if (google.linked) {
                    await api("auth/google/account", "DELETE");
                    await load();
                    notify("Google unlinked");
                  } else {
                    const b = await api("auth/google/link", "POST");
                    window.location.assign(b.url);
                  }
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {google.linked ? "Unlink Google" : "Link Google"}
            </button>
          )}
          {info?.passwordSet === false && (
            <p className="integration-note">
              Use <a href="/account/forgot">password recovery</a> to set an
              email sign-in password before unlinking Google.
            </p>
          )}
          <h3>Notification preferences</h3>
          {info &&
            (
              ["notifySocial", "notifyMessages", "notifyWorkspace"] as const
            ).map((key, i) => (
              <label className="checkbox-field" key={key}>
                <input
                  type="checkbox"
                  checked={info[key]}
                  onChange={async (e) => {
                    const v = {
                      notifySocial: info.notifySocial,
                      notifyMessages: info.notifyMessages,
                      notifyWorkspace: info.notifyWorkspace,
                      [key]: e.target.checked,
                    };
                    try {
                      const saved = await api(
                        "account/preferences",
                        "PATCH",
                        v,
                      );
                      setInfo({ ...info, ...saved });
                      notify("Notification preferences saved");
                    } catch (e: any) {
                      notify(e.message);
                    }
                  }}
                />
                {
                  [
                    "Follows and connections",
                    "Direct-message alerts",
                    "Projects and team activity",
                  ][i]
                }
              </label>
            ))}
          <p className="integration-note">
            Turning off alerts does not delete messages or affect collaboration
            access.
          </p>
          <h3>Your account data</h3>
          <a className="secondary-button" href="/api/account/export">
            Download bounded account summary
          </a>
          <AccountBundle />
          <AccountExport />
          <button
            className="secondary-button"
            style={{ marginLeft: 8 }}
            onClick={async () => {
              if (
                !window.confirm(
                  "Permanently delete your account? Transfer any project ownership first.",
                )
              )
                return;
              const password = window.prompt(
                "Enter your password to confirm account deletion.",
              );
              if (!password) return;
              try {
                notify((await api("account", "DELETE", { password })).message);
                onSignedOut();
              } catch (e: any) {
                notify(e.message);
              }
            }}
          >
            Delete account
          </button>
          <h3>Change password</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                notify(
                  (
                    await api("account/password", "POST", {
                      currentPassword: f.get("currentPassword"),
                      password: f.get("password"),
                    })
                  ).message,
                );
                onSignedOut();
              } catch (e: any) {
                notify(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Current password
              <input name="currentPassword" type="password" required />
            </label>
            <label className="field">
              New password
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={72}
                required
              />
            </label>
            <button className="primary-button" disabled={busy}>
              Change password & sign out all sessions
            </button>
          </form>
        </section>
        <section className="panel">
          <h3>Blocked profiles</h3>
          {blocks.length === 0 ? (
            <p className="muted">No blocked profiles.</p>
          ) : (
            blocks.map((b) => (
              <div className="application-row" key={b.blockedId}>
                <div>
                  <strong>{b.blocked.name}</strong>
                </div>
                <button
                  className="secondary-button"
                  onClick={async () => {
                    try {
                      await api("blocks/" + b.blockedId, "DELETE");
                      load();
                      notify(
                        "Profile unblocked. Connections are not restored automatically.",
                      );
                    } catch (e: any) {
                      notify(e.message);
                    }
                  }}
                >
                  Unblock
                </button>
              </div>
            ))
          )}
          <h3>Active sessions</h3>
          {sessions.map((s) => (
            <div className="application-row" key={s.id}>
              <div>
                <strong>{s.current ? "This session" : "Other session"}</strong>
                <small>Created {new Date(s.createdAt).toLocaleString()}</small>
                <small>Expires {new Date(s.expiresAt).toLocaleString()}</small>
              </div>
              <button
                className="secondary-button"
                onClick={async () => {
                  try {
                    await api("account/sessions/" + s.id, "DELETE");
                    if (s.current) onSignedOut();
                    else load();
                  } catch (e: any) {
                    notify(e.message);
                  }
                }}
              >
                Revoke
              </button>
            </div>
          ))}
          <button
            className="secondary-button"
            style={{ marginTop: 20 }}
            onClick={async () => {
              try {
                await api("auth/logout-all", "POST");
                onSignedOut();
                notify("All sessions signed out");
              } catch (e: any) {
                notify(e.message);
              }
            }}
          >
            Sign out everywhere
          </button>
        </section>
      </div>
    </>
  );
}
