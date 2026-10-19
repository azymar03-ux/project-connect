"use client";
import { useMyProjects } from "../../lib/useMyProjects";
import { useEffect, useState, useRef } from "react";
import {
  Search,
  Plus,
  ArrowUpRight,
  Bookmark,
  ThumbsUp,
  BookOpen,
  X,
  Link,
  Loader2,
  FolderPlus,
} from "lucide-react";
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
export default function ResourceHub({
  user,
  projects,
  onSignIn,
  notify,
}: {
  user: any;
  projects: any[];
  onSignIn: () => void;
  notify: (s: string) => void;
}) {
  const owned = useMyProjects(user?.id);
  const [editing, setEditing] = useState<any>(null),
    [metadata, setMetadata] = useState<Record<string, any>>({});
  const [items, setItems] = useState<any[]>([]),
    [search, setSearch] = useState(""),
    [type, setType] = useState("All"),
    [saved, setSaved] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [next, setNext] = useState<string | null>(null),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false),
    [attach, setAttach] = useState<string | null>(null);
  const generation = useRef(0);
  const types = [
    "All",
    "GitHub",
    "Documentation",
    "API",
    "Library",
    "Tutorial",
    "Dataset",
    "Tool",
  ];
  async function load(cursor?: string) {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        search,
        ...(type !== "All" ? { type } : {}),
        ...(saved ? { saved: "true" } : {}),
        ...(cursor ? { cursor } : {}),
      });
      const b = await api("resources?" + q);
      if (current !== generation.current) return;
      setItems((old) => (cursor ? [...old, ...b.items] : b.items));
      setNext(b.nextCursor);
    } catch (e: any) {
      if (current === generation.current) setError(e.message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(() => load(), 200);
    return () => {
      clearTimeout(t);
      generation.current++;
    };
  }, [search, type, saved, user?.id]);
  async function toggle(r: any, kind: "save" | "vote") {
    if (!user) return onSignIn();
    try {
      await api(`resources/${r.id}/${kind}`, "POST", {
        enabled: kind === "save" ? !r.saved : !r.voted,
      });
      await load();
      notify(
        kind === "save"
          ? "Saved collection updated"
          : "Your vote has been updated",
      );
    } catch (e: any) {
      notify(e.message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE TOOLS TO TAKE YOUR IDEA FURTHER</div>
          <h1>
            Less searching. <span>More building.</span>
          </h1>
          <p>A shared library of code, documentation, tutorials, and tools.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            setEditing(null);
            user ? setCreate(true) : onSignIn();
          }}
        >
          <Plus size={17} />
          Share resource
        </button>
      </div>
      <div className="resource-controls">
        <label className="search-box">
          <Search size={18} />
          <input
            aria-label="Search resources"
            placeholder="Search resources and technologies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          className={"filter-button " + (saved ? "enabled" : "")}
          onClick={() => (user ? setSaved(!saved) : onSignIn())}
        >
          <Bookmark size={15} />
          {saved ? "Saved only" : "My collection"}
        </button>
      </div>
      <div className="category-tabs">
        {types.map((t) => (
          <button
            key={t}
            className={t === type ? "active" : ""}
            onClick={() => setType(t)}
          >
            {t}
          </button>
        ))}
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
          Loading resources…
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={34} />
          <h3>No resources here yet.</h3>
          <p>Try another search or share something worth building with.</p>
        </div>
      ) : (
        <div className="resource-grid">
          {items.map((r) => (
            <article className="panel resource-card" key={r.id}>
              <div className="resource-card-top">
                <span className="toolkit-icon blue">
                  <BookOpen size={21} />
                </span>
                <span className="tag">{r.type}</span>
                <button
                  className={"icon-button " + (r.saved ? "saved" : "")}
                  aria-label={"Save " + r.title}
                  onClick={() => toggle(r, "save")}
                >
                  <Bookmark
                    size={18}
                    fill={r.saved ? "currentColor" : "none"}
                  />
                </button>
              </div>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="resource-title"
              >
                {r.title}
                <ArrowUpRight size={17} />
              </a>
              <p>{r.description}</p>
              <div className="tags">
                {r.tags.map((t: string) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              {r.type === "GitHub" && (
                <>
                  <button
                    className="secondary-button"
                    onClick={async () => {
                      if (!user) return onSignIn();
                      try {
                        const m = await api(
                          `resources/${r.id}/github-metadata`,
                          "POST",
                        );
                        setMetadata((prev) => ({ ...prev, [r.id]: m }));
                      } catch (e: any) {
                        notify(e.message);
                      }
                    }}
                  >
                    Load GitHub details
                  </button>
                  {metadata[r.id] && (
                    <p className="integration-note">
                      {metadata[r.id].stars} stars ·{" "}
                      {metadata[r.id].language || "Unknown language"} ·{" "}
                      {metadata[r.id].license || "License not specified"}
                    </p>
                  )}
                </>
              )}
              <small className="resource-domain">
                {new URL(r.url).hostname}
              </small>
              <div className="resource-footer">
                <button
                  className={"secondary-button " + (r.voted ? "enabled" : "")}
                  onClick={() => toggle(r, "vote")}
                  aria-label={"Vote for " + r.title}
                >
                  <ThumbsUp size={13} />
                  {r._count.votes}
                </button>
                <button
                  className="icon-button"
                  aria-label={"Attach " + r.title + " to project"}
                  onClick={() => (user ? setAttach(r.id) : onSignIn())}
                >
                  <FolderPlus size={17} />
                </button>
                <span>Shared by {r.submittedBy.name.split(" ")[0]}</span>
              </div>
              {user && (
                <div className="person-card-actions">
                  {r.submittedById === user.id && (
                    <>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setEditing(r);
                          setCreate(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="secondary-button"
                        onClick={async () => {
                          if (!window.confirm("Delete this resource?")) return;
                          try {
                            await api("resources/" + r.id, "DELETE");
                            await load();
                            notify("Resource deleted");
                          } catch (e: any) {
                            notify(e.message);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                  <button
                    className="icon-button"
                    onClick={async () => {
                      const reason = window.prompt(
                        "Why report this resource? (at least 10 characters)",
                      );
                      if (!reason) return;
                      try {
                        notify(
                          (
                            await api("reports", "POST", {
                              targetType: "resource",
                              targetId: r.id,
                              reason,
                            })
                          ).message,
                        );
                      } catch (e: any) {
                        notify(e.message);
                      }
                    }}
                  >
                    Report
                  </button>
                </div>
              )}
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
          Load more resources
        </button>
      )}
      <p className="integration-note">
        Links open on external websites. GitHub details are fetched from the
        GitHub API on request; external services may rate limit requests.
      </p>
      {create && (
        <div className="modal-backdrop" onClick={() => setCreate(false)}>
          <section
            className="modal wide-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Share resource"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close resource dialog"
              onClick={() => setCreate(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">GOOD TOOLS DESERVE TO BE SHARED</div>
            <h2>
              {editing
                ? "Update your shared resource."
                : "Help another builder get unstuck."}
            </h2>
            <p className="modal-subtitle">
              Share a public resource you find useful. Please respect its
              license.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const f = new FormData(e.currentTarget);
                try {
                  await api(
                    editing ? "resources/" + editing.id : "resources",
                    editing ? "PATCH" : "POST",
                    {
                      title: f.get("title"),
                      description: f.get("description"),
                      url: f.get("url"),
                      type: f.get("type"),
                      tags: String(f.get("tags"))
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                    },
                  );
                  setCreate(false);
                  setEditing(null);
                  await load();
                  notify("Resource shared with the community");
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Title
                <input
                  name="title"
                  defaultValue={editing?.title}
                  minLength={3}
                  maxLength={150}
                  required
                  placeholder="A tool, tutorial, or library worth knowing"
                />
              </label>
              <label className="field">
                HTTPS link
                <input
                  name="url"
                  defaultValue={editing?.url}
                  type="url"
                  required
                  placeholder="https://…"
                />
              </label>
              <label className="field">
                Why is it useful?
                <textarea
                  name="description"
                  defaultValue={editing?.description}
                  minLength={15}
                  maxLength={2000}
                  required
                  rows={3}
                />
              </label>
              <label className="field">
                Type
                <select name="type" defaultValue={editing?.type}>
                  {types.slice(1).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Tags (comma-separated)
                <input
                  name="tags"
                  defaultValue={editing?.tags.join(", ")}
                  placeholder="Python, Robotics"
                />
              </label>
              <button className="primary-button full-width" disabled={busy}>
                <Plus size={16} />
                {editing ? "Save changes" : "Publish resource"}
              </button>
            </form>
          </section>
        </div>
      )}
      {attach && (
        <div className="modal-backdrop" onClick={() => setAttach(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Attach resource to project"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close attach dialog"
              onClick={() => setAttach(null)}
            >
              <X size={20} />
            </button>
            <h2>Add it to your workspace.</h2>
            <p className="modal-subtitle">Choose a project you’re part of.</p>
            {projects
              .filter((p) => p.isMember)
              .map((p) => (
                <button
                  className="workspace-resource-choice"
                  key={p.id}
                  onClick={async () => {
                    try {
                      await api(`resources/${attach}/projects/${p.id}`, "POST");
                      setAttach(null);
                      notify("Resource attached to " + p.title);
                    } catch (e: any) {
                      notify(e.message);
                    }
                  }}
                >
                  <Link size={16} />
                  {p.title}
                  <Plus size={16} />
                </button>
              ))}
            {!projects.some((p) => p.isMember) && (
              <p className="muted">Join or create a project first.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
