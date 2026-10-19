"use client";
import { useEffect, useState } from "react";
import { Send, Users, Globe, Trash2, Loader2, Flag, X } from "lucide-react";
async function api(path: string, method = "GET", data?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.message || "Request failed.");
  return b;
}
export default function SocialFeed({
  user,
  projects,
  notify,
  onProject,
}: {
  user: any;
  projects: any[];
  notify: (s: string) => void;
  onProject: (id: string) => void;
}) {
  const [scope, setScope] = useState("community"),
    [items, setItems] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [target, setTarget] = useState(""),
    [content, setContent] = useState(""),
    [reportId, setReportId] = useState<string | null>(null),
    [reason, setReason] = useState("");
  const mine = projects.filter((p) => p.isMember);
  async function load(cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ scope, ...(cursor ? { cursor } : {}) });
      const b = await api("feed?" + q);
      setItems((old) => (cursor ? [...old, ...b.items] : b.items));
      setNext(b.nextCursor);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [scope, user?.id]);
  useEffect(() => {
    if (!target && mine[0]) setTarget(mine[0].id);
  }, [mine.length]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SMALL WINS. BIG POSSIBILITIES.</div>
          <h1>The builder feed</h1>
          <p>
            Share public milestones and follow the people whose work inspires
            you.
          </p>
        </div>
      </div>
      <div className="feed-layout">
        <section className="panel">
          <h3>Share a project update</h3>
          {mine.length ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api(`workspaces/${target}/updates`, "POST", {
                    content,
                  });
                  setContent("");
                  await load();
                  notify("Public update shared with the community");
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Project
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  {mine.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                What did you build or learn?
                <textarea
                  aria-label="Public project update"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  minLength={5}
                  maxLength={1500}
                  required
                  rows={5}
                />
              </label>
              <p className="integration-note">
                Updates are public to signed-in community members. Do not post
                passwords, private files, or personal data.
              </p>
              <button className="primary-button full-width" disabled={busy}>
                <Send size={15} />
                Publish update
              </button>
            </form>
          ) : (
            <p className="muted">Join or create a project to share updates.</p>
          )}
        </section>
        <section>
          <div className="category-tabs">
            <button
              className={scope === "community" ? "active" : ""}
              onClick={() => setScope("community")}
            >
              <Globe size={14} />
              Community
            </button>
            <button
              className={scope === "following" ? "active" : ""}
              onClick={() => setScope("following")}
            >
              <Users size={14} />
              Following
            </button>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
              <button className="secondary-button" onClick={() => load()}>
                Retry
              </button>
            </div>
          )}
          {loading && items.length === 0 ? (
            <div className="loading-state">
              <Loader2 className="spin" />
              Loading updates…
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <Users size={30} />
              <h3>
                {scope === "following"
                  ? "Your people, their progress."
                  : "The first update starts with you."}
              </h3>
              <p>
                {scope === "following"
                  ? "Follow builders in People to see their project updates here."
                  : "Share a small win from a project you’re working on."}
              </p>
            </div>
          ) : (
            <div className="feed-list">
              {items.map((a) => (
                <article className="panel feed-card" key={a.id}>
                  <header>
                    <span className={"avatar " + a.author.color}>
                      {a.author.initials}
                    </span>
                    <div>
                      <a href={"/people/" + a.author.id}>{a.author.name}</a>
                      <small>{new Date(a.createdAt).toLocaleString()}</small>
                    </div>
                    {a.authorId !== user.id && (
                      <button
                        className="icon-button"
                        aria-label="Report update"
                        onClick={() => {
                          setReportId(a.id);
                          setReason("");
                        }}
                      >
                        <Flag size={15} />
                      </button>
                    )}
                    {a.authorId === user.id && (
                      <button
                        className="icon-button"
                        aria-label="Delete update"
                        onClick={async () => {
                          if (!window.confirm("Delete this public update?"))
                            return;
                          try {
                            await api("feed/" + a.id, "DELETE");
                            load();
                            notify("Update deleted");
                          } catch (e: any) {
                            notify(e.message);
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </header>
                  <p className="feed-content">{a.content}</p>
                  <button
                    className="workspace-resource-choice"
                    onClick={() => onProject(a.projectId)}
                  >
                    {a.project.title}
                    <small>{a.project.category}</small>
                  </button>
                </article>
              ))}
            </div>
          )}
          {next && (
            <button
              className="secondary-button load-more"
              onClick={() => load(next)}
              disabled={loading}
            >
              Load earlier updates
            </button>
          )}
        </section>
      </div>
      {reportId && (
        <div className="modal-backdrop" onClick={() => setReportId(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Report public update"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close report"
              onClick={() => setReportId(null)}
            >
              <X size={20} />
            </button>
            <h2>Report an update</h2>
            <p className="muted">
              Tell the moderation team what should be reviewed.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api("reports", "POST", {
                    targetType: "activity",
                    targetId: reportId,
                    reason,
                  });
                  setReportId(null);
                  notify("Report sent to the moderation team");
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Reason
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={10}
                  maxLength={1000}
                  required
                  rows={4}
                />
              </label>
              <button className="primary-button full-width" disabled={busy}>
                Submit report
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
