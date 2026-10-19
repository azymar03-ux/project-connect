"use client";
import { useEffect, useState } from "react";
async function api(path: string, method = "GET", data?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.message);
  return b;
}
export default function WorkspaceGithub({
  id,
  owner,
  readOnly,
}: {
  id: string;
  owner: boolean;
  readOnly: boolean;
}) {
  const [link, setLink] = useState<any>(null),
    [activity, setActivity] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const b = await api("workspaces/" + id + "/github");
      setLink(b.linked === false ? null : b);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [id]);
  return (
    <section className="panel">
      <h2>GitHub repository</h2>
      <p className="integration-note">
        Read-only integration. Public repos need no credentials. Private repos
        require a configured GitHub App and owner-approved installation ID. No
        source, write credentials or webhook payloads are stored.
      </p>
      {link && (
        <p>
          <a
            href={"https://github.com/" + link.owner + "/" + link.repo}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.owner}/{link.repo}
          </a>{" "}
          ·{" "}
          {link.privateIntegration ? "Private app installation" : "Public repo"}
          {link.lastDeliveryAt &&
            " · Last webhook " + new Date(link.lastDeliveryAt).toLocaleString()}
        </p>
      )}
      {owner && !readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              await api("workspaces/" + id + "/github", "PUT", {
                url: f.get("url"),
                ...(f.get("installationId")
                  ? { installationId: f.get("installationId") }
                  : {}),
              });
              await load();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Repository URL
            <input
              name="url"
              type="url"
              defaultValue={
                link ? "https://github.com/" + link.owner + "/" + link.repo : ""
              }
              required
              placeholder="https://github.com/owner/repository"
            />
          </label>
          <label className="field">
            Approved installation ID (private repos only)
            <input name="installationId" pattern="[0-9]{1,20}" />
          </label>
          <button className="primary-button" disabled={busy}>
            Link repository
          </button>
        </form>
      )}
      {link && (
        <>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setActivity(await api("workspaces/" + id + "/github/activity"));
                setError("");
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Refresh GitHub activity
          </button>
          {owner && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={async () => {
                try {
                  await api("workspaces/" + id + "/github", "DELETE");
                  setActivity(null);
                  load();
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Unlink repository
            </button>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {activity &&
        ["commits", "pulls", "issues"].map((k) => (
          <div key={k}>
            <h3>{k}</h3>
            {activity[k].length ? (
              activity[k].map((r: any) => (
                <p key={r.id}>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer">
                      {r.title}
                    </a>
                  ) : (
                    r.title
                  )}{" "}
                  {r.state}
                </p>
              ))
            ) : (
              <p>No recent items.</p>
            )}
          </div>
        ))}
    </section>
  );
}
