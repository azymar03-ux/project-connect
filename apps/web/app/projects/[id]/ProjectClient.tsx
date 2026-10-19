"use client";
import { use, useEffect, useState } from "react";
import Workspace from "../../components/Workspace";
export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params),
    [project, setProject] = useState<any>(null),
    [user, setUser] = useState<any>(null),
    [error, setError] = useState(""),
    [workspace, setWorkspace] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/projects/" + encodeURIComponent(id)).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.message);
        return b;
      }),
      fetch("/api/me").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([p, u]) => {
        if (active) {
          setProject(p);
          setUser(u);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <main className="public-profile-page">
      <a className="workspace-back" href="/">
        ← ProjectConnect
      </a>
      {error ? (
        <section className="empty-state" role="alert">
          <h1>Project unavailable</h1>
          <p>{error}</p>
        </section>
      ) : !project ? (
        <p role="status">Opening project…</p>
      ) : workspace ? (
        <Workspace
          id={id}
          user={user}
          onBack={() => setWorkspace(false)}
          notify={setNotice}
        />
      ) : (
        <article className="panel">
          <img
            src={project.image}
            alt="Original project concept illustration"
            style={{
              width: "100%",
              maxHeight: 300,
              objectFit: "cover",
              borderRadius: 12,
            }}
          />
          <div className="eyebrow">
            {project.category} · {project.status}
          </div>
          <h1>{project.title}</h1>
          <p>{project.description}</p>
          <p>
            Started by{" "}
            <a href={"/people/" + project.owner.id}>{project.owner.name}</a> ·{" "}
            {project.members.length}/{project.teamSize} builders ·{" "}
            {project.remote ? "Remote friendly" : project.city}
          </p>
          <div className="tags">
            {project.tags.map((tag: string) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <h2>Open positions</h2>
          <p>{project.positions.join(" · ")}</p>
          {project.isMember ? (
            <button
              className="primary-button"
              onClick={() => setWorkspace(true)}
            >
              Open project workspace
            </button>
          ) : (
            <a className="primary-button" href={"/?project=" + id}>
              View team and application options
            </a>
          )}
        </article>
      )}
      {notice && <p role="status">{notice}</p>}
    </main>
  );
}
