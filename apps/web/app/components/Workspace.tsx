"use client";
import { useChatReadAck } from "./useChatReadAck";
import ImageUpload from "./ImageUpload";
import { fetchChatPage } from "./chat-sync";
import { useChatDelivery } from "./useChatDelivery";
import WorkspaceGithub from "./WorkspaceGithub";
import WorkspaceFiles from "./WorkspaceFiles";
import { useDialogAccessibility } from "./useDialogAccessibility";
import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  Plus,
  Check,
  Users,
  MessageSquare,
  Layers,
  Target,
  BookOpen,
  Loader2,
  Send,
  ArrowUpRight,
  Clock,
  Trash2,
  X,
} from "lucide-react";
async function api(path: string, method = "GET", data?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const b = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(b.message || "Request failed."), {
      code: b.code,
      status: r.status,
    });
  return b;
}
export default function Workspace({
  id,
  user,
  onBack,
  notify,
}: {
  id: string;
  user: any;
  onBack: () => void;
  notify: (s: string) => void;
}) {
  const [project, setProject] = useState<any>(null),
    [tab, setTab] = useState("Tasks"),
    [error, setError] = useState(""),
    [taskForm, setTaskForm] = useState(false),
    [messages, setMessages] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [older, setOlder] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [milestone, setMilestone] = useState(""),
    [chatError, setChatError] = useState(""),
    [chatUnread, setChatUnread] = useState(0);
  const [editing, setEditing] = useState<any>(null),
    [projectForm, setProjectForm] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<any>(null),
    [milestoneDue, setMilestoneDue] = useState("");
  const delivery = useChatDelivery(
    `${user?.id}:project:${id}`,
    (body) => api(`workspaces/${id}/messages`, "POST", body),
    async () => {
      setMessage("");
      await chat();
    },
    notify,
    (requestId) =>
      api(
        `workspaces/${id}/messages?requestId=${encodeURIComponent(requestId)}`,
      ),
  );
  useDialogAccessibility();
  const chatGeneration = useRef(0),
    historyLoaded = useRef(false);
  const chatGap = useRef(false);
  const chatBoundary = useRef<string | null>(null),
    chatFetching = useRef<number | null>(null);
  async function load() {
    try {
      setProject(await api("workspaces/" + id));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function chat(cursor?: string) {
    const generation = chatGeneration.current;
    if (chatFetching.current === generation) return;
    chatFetching.current = generation;
    const initial = !chatBoundary.current;
    setChatError("");
    try {
      const b = await fetchChatPage(
        api,
        `workspaces/${id}/messages`,
        cursor,
        chatBoundary.current,
      );
      if (generation !== chatGeneration.current) return;
      if (initial || b.reset)
        chatGap.current = Boolean(
          b.hasOlderUnread || (b.reset && b.nextCursor),
        );
      if (cursor && (!b.nextCursor || b.hasOlderUnread === false))
        chatGap.current = false;
      setChatError(
        chatGap.current
          ? "Load earlier unread messages to close the history gap; unread status is preserved."
          : "",
      );
      if (b.reset) chatBoundary.current = null;
      if ((!cursor || b.reset) && b.items.length)
        chatBoundary.current = b.afterPosition || b.items.at(-1).id;
      setMessages((prev) =>
        Array.from(
          new Map(
            [...(b.reset ? [] : prev), ...b.items].map((m) => [m.id, m]),
          ).values(),
        ).sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
            a.id.localeCompare(b.id),
        ),
      );
      if (cursor) historyLoaded.current = true;
      if (cursor || initial || b.reset)
        setOlder(b.nextPosition || b.nextCursor);
    } catch (e: any) {
      if (generation === chatGeneration.current) setChatError(e.message);
    } finally {
      if (chatFetching.current === generation) chatFetching.current = null;
    }
  }
  useEffect(() => {
    setProject(null);
    setMessages([]);
    chatBoundary.current = null;
    chatGap.current = false;
    setMessage("");
    historyLoaded.current = false;
    chatGeneration.current++;
    load();
  }, [id]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const b = await api("workspaces/unread");
        if (!stopped)
          setChatUnread(
            b.items.find((r: any) => r.projectId === id)?.unread || 0,
          );
      } catch {}
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 8000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, tab]);
  useEffect(() => {
    if (tab !== "Chat") return;
    chatGeneration.current++;
    chat();
    const reconnect = () => {
      if (document.visibilityState === "visible") void chat();
    };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") chat();
    }, 4000);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
      chatGeneration.current++;
    };
  }, [id, tab]);
  const readAck = useChatReadAck(
    `${user?.id}:project:${id}`,
    `workspaces/${id}/messages/read`,
    messages.at(-1)?.id,
    tab === "Chat" && !chatGap.current,
  );

  async function changeTask(t: any, changes: any) {
    try {
      await api(`workspaces/${id}/tasks/${t.id}`, "PATCH", {
        ...changes,
        version: t.version,
      });
      await load();
      notify("Task updated");
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function teamAction(fn: () => Promise<any>, msg: string) {
    try {
      await fn();
      await load();
      notify(msg);
    } catch (e: any) {
      notify(e.message);
    }
  }
  if (error)
    return (
      <div className="empty-state">
        <h3>Couldn’t open the workspace.</h3>
        <p>{error}</p>
        <button className="secondary-button" onClick={() => load()}>
          Retry
        </button>
        <button className="secondary-button" onClick={onBack}>
          Back to projects
        </button>
      </div>
    );
  if (!project)
    return (
      <div className="loading-state">
        <Loader2 className="spin" />
        Opening your workspace…
      </div>
    );
  const archived = project.status === "Archived",
    owner = project.ownerId === user?.id,
    done = project.tasks.filter((t: any) => t.status === "Done").length,
    progress = project.tasks.length
      ? Math.round((100 * done) / project.tasks.length)
      : 0;
  async function reorder(t: any, direction: number) {
    const rows = [...project.tasks],
      index = rows.findIndex((r: any) => r.id === t.id);
    if (index + direction < 0 || index + direction >= rows.length) return;
    [rows[index], rows[index + direction]] = [
      rows[index + direction],
      rows[index],
    ];
    try {
      await api(`workspaces/${id}/tasks/reorder`, "PATCH", {
        items: rows.map((r: any) => ({ id: r.id, version: r.version })),
      });
      await load();
      notify("Task order saved");
    } catch (e: any) {
      notify(e.message);
      await load();
    }
  }
  return (
    <>
      {editingMilestone && (
        <div
          className="modal-backdrop"
          onClick={() => setEditingMilestone(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit milestone"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Edit milestone</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  await api(
                    `workspaces/${id}/milestones/${editingMilestone.id}`,
                    "PATCH",
                    {
                      title: f.get("title"),
                      dueDate: f.get("dueDate")
                        ? new Date(
                            f.get("dueDate") + "T12:00:00Z",
                          ).toISOString()
                        : null,
                    },
                  );
                  setEditingMilestone(null);
                  await load();
                  notify("Milestone updated");
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              <label className="field">
                Milestone title
                <input
                  name="title"
                  defaultValue={editingMilestone.title}
                  required
                  minLength={3}
                  maxLength={150}
                />
              </label>
              <label className="field">
                Due date
                <input
                  name="dueDate"
                  type="date"
                  defaultValue={editingMilestone.dueDate?.slice(0, 10) || ""}
                />
              </label>
              <button className="primary-button">Save milestone</button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditingMilestone(null)}
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
      <button className="workspace-back" onClick={onBack}>
        <ArrowLeft size={15} />
        Back to my projects
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PROJECT WORKSPACE</div>
          <h1>{project.title}</h1>
          <p>
            {project.members.length} builders · {project.status} · {progress}%
            of tasks complete
          </p>
        </div>
        {owner && (
          <>
            <button
              className="secondary-button"
              onClick={() => setProjectForm(true)}
            >
              Edit project
            </button>
            <select
              className="status-select"
              aria-label="Project status"
              value={project.status}
              onChange={async (e) => {
                try {
                  await api(`workspaces/${id}/project`, "PATCH", {
                    status: e.target.value,
                  });
                  await load();
                  notify("Project status updated");
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              {["Idea", "In progress", "Completed", "Archived"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
      </div>
      {archived && (
        <p className="integration-note" role="status">
          Archived workspace: collaboration writes are disabled. The owner can
          restore it using Project status.
        </p>
      )}
      <div className="workspace-tabs">
        {[
          { label: "Tasks", icon: Layers },
          { label: "Files", icon: BookOpen },
          { label: "GitHub", icon: BookOpen },
          { label: "Team", icon: Users },
          { label: "Chat", icon: MessageSquare },
          { label: "Progress", icon: Target },
          { label: "Resources", icon: BookOpen },
        ].map((t) => (
          <button
            key={t.label}
            className={tab === t.label ? "active" : ""}
            onClick={() => setTab(t.label)}
          >
            <t.icon size={16} />
            {t.label}
            {t.label === "Chat" && chatUnread > 0 ? ` (${chatUnread})` : ""}
          </button>
        ))}
      </div>
      {tab === "Tasks" && (
        <>
          <div className="section-heading">
            <h2>
              The small steps that get you there
              <span>{project.tasks.length}</span>
            </h2>
            <button
              className="primary-button"
              disabled={archived}
              onClick={() => {
                setEditing(null);
                setTaskForm(true);
              }}
            >
              <Plus size={15} />
              Add task
            </button>
          </div>
          <div className="kanban">
            {["Todo", "In progress", "Done"].map((status) => (
              <section
                className="kanban-column"
                key={status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (archived) return;
                  const t = project.tasks.find(
                    (t: any) => t.id === e.dataTransfer.getData("text/plain"),
                  );
                  if (t) changeTask(t, { status });
                }}
              >
                <h3>
                  <span
                    className={
                      "task-status-dot " +
                      (status === "Done"
                        ? "complete"
                        : status === "In progress"
                          ? "started"
                          : "")
                    }
                  />
                  {status}
                  <span>
                    {
                      project.tasks.filter((t: any) => t.status === status)
                        .length
                    }
                  </span>
                </h3>
                {project.tasks
                  .filter((t: any) => t.status === status)
                  .map((t: any) => (
                    <article
                      className="task-card"
                      key={t.id}
                      draggable={!archived}
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/plain", t.id)
                      }
                    >
                      <h4>{t.title}</h4>
                      <div className="tags">
                        {(t.labels || []).map((l: string) => (
                          <span key={l}>{l}</span>
                        ))}
                      </div>
                      {t.description && <p>{t.description}</p>}
                      <div className="task-meta">
                        <select
                          disabled={archived}
                          aria-label={"Assign " + t.title}
                          value={t.assigneeId || ""}
                          onChange={(e) =>
                            changeTask(t, {
                              assigneeId: e.target.value || null,
                            })
                          }
                        >
                          <option value="">Unassigned</option>
                          {project.members.map((m: any) => (
                            <option value={m.userId} key={m.userId}>
                              {m.user.name}
                            </option>
                          ))}
                        </select>
                        {t.dueDate && (
                          <span>
                            <Clock size={11} />
                            {new Date(t.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="task-controls">
                        <button
                          className="secondary-button"
                          disabled={archived}
                          aria-label={"Edit " + t.title}
                          onClick={() => {
                            setEditing(t);
                            setTaskForm(true);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="icon-button"
                          disabled={archived || project.tasks[0].id === t.id}
                          aria-label={"Move up " + t.title}
                          onClick={() => reorder(t, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="icon-button"
                          disabled={
                            archived || project.tasks.at(-1).id === t.id
                          }
                          aria-label={"Move down " + t.title}
                          onClick={() => reorder(t, 1)}
                        >
                          ↓
                        </button>
                        <select
                          disabled={archived}
                          aria-label={"Move " + t.title}
                          value={t.status}
                          onChange={(e) =>
                            changeTask(t, { status: e.target.value })
                          }
                        >
                          {["Todo", "In progress", "Done"].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                        {owner && (
                          <button
                            className="icon-button"
                            disabled={archived}
                            aria-label={"Delete " + t.title}
                            onClick={async () => {
                              if (!window.confirm("Delete this task?")) return;
                              try {
                                await api(
                                  `workspaces/${id}/tasks/${t.id}`,
                                  "DELETE",
                                );
                                load();
                              } catch (e: any) {
                                notify(e.message);
                              }
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                {!project.tasks.some((t: any) => t.status === status) && (
                  <p className="kanban-empty">
                    {status === "Todo"
                      ? "Add a task to get things moving."
                      : status === "In progress"
                        ? "Your next step belongs here."
                        : "One step closer to something real."}
                  </p>
                )}
              </section>
            ))}
          </div>
          <p className="integration-note">
            Drag cards between columns or use each card’s status menu with your
            keyboard.
          </p>
        </>
      )}
      {tab === "GitHub" && (
        <WorkspaceGithub id={id} owner={owner} readOnly={archived} />
      )}
      {tab === "Files" && (
        <WorkspaceFiles id={id} notify={notify} readOnly={archived} />
      )}
      {tab === "Team" && (
        <>
          {owner && !archived && (
            <InvitePicker
              projectId={id}
              memberIds={project.members.map((m: any) => m.userId)}
              notify={notify}
            />
          )}
          <div className="people-grid">
            {project.members.map((m: any) => (
              <article className="panel person-card" key={m.userId}>
                <span className={"avatar large " + m.user.color}>
                  {m.user.avatarId ? (
                    <img src={`/api/images/${m.user.avatarId}`} alt="" />
                  ) : (
                    m.user.initials
                  )}
                </span>
                <h3>{m.user.name}</h3>
                <p className="role-text">
                  {m.role} · {m.user.role}
                </p>
                <p className="muted">{m.user.bio}</p>
                <div className="tags">
                  {m.user.skills.map((s: string) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
                {owner && m.userId !== user?.id && (
                  <div className="team-actions">
                    <select
                      aria-label={"Role for " + m.user.name}
                      value={m.role}
                      onChange={(e) =>
                        teamAction(
                          () =>
                            api(`workspaces/${id}/team/${m.userId}`, "PATCH", {
                              role: e.target.value,
                            }),
                          "Role updated",
                        )
                      }
                    >
                      <option>Member</option>
                      <option>Maintainer</option>
                    </select>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        window.confirm(
                          "Transfer ownership to " + m.user.name + "?",
                        ) &&
                        teamAction(
                          () =>
                            api(`workspaces/${id}/team/transfer`, "POST", {
                              userId: m.userId,
                            }),
                          "Ownership transferred",
                        )
                      }
                    >
                      Make owner
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        window.confirm(
                          "Remove " + m.user.name + " from the team?",
                        ) &&
                        teamAction(
                          () =>
                            api(`workspaces/${id}/team/${m.userId}`, "DELETE"),
                          "Member removed",
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
          {!owner && (
            <button
              className="secondary-button"
              style={{ marginTop: 20 }}
              onClick={async () => {
                if (!window.confirm("Leave this project?")) return;
                try {
                  await api(`workspaces/${id}/team/leave`, "POST");
                  notify("You left the project");
                  onBack();
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              Leave project
            </button>
          )}
        </>
      )}
      {tab === "Chat" && (
        <div className="panel workspace-chat">
          {readAck.error && (
            <p className="form-error" role="alert">
              {readAck.error}{" "}
              <button className="secondary-button" onClick={readAck.retry}>
                Retry read status
              </button>
            </p>
          )}
          {chatError && (
            <p role="alert" className="form-error">
              {chatError}{" "}
              <button className="secondary-button" onClick={() => chat()}>
                Reconnect chat
              </button>
            </p>
          )}
          <div className="chat-messages">
            {older && (
              <button className="secondary-button" onClick={() => chat(older)}>
                Load earlier messages
              </button>
            )}
            {messages.length === 0 && (
              <div className="empty-state">
                <MessageSquare size={30} />
                <h3>Your team’s next idea starts here.</h3>
                <p>Share an update, a question, or a small win.</p>
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  "message-bubble " + (m.senderId === user?.id ? "own" : "")
                }
              >
                <strong className="message-sender">{m.sender.name}</strong>
                <p>{m.content}</p>
                <small>{new Date(m.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={async (e) => {
              e.preventDefault();
              await delivery.send(message);
            }}
          >
            <input
              disabled={
                archived ||
                delivery.busy ||
                (delivery.failed && !delivery.needsText)
              }
              aria-label="Project message"
              value={message}
              maxLength={2000}
              placeholder="Share something with your team…"
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              className="primary-button"
              disabled={
                archived ||
                delivery.busy ||
                (delivery.failed && !delivery.needsText)
              }
              aria-label="Send project message"
            >
              <Send size={16} />
            </button>
          </form>
          {delivery.failed && (
            <p role="status">
              Delivery not confirmed.{" "}
              {delivery.needsText &&
                "Re-enter the original text; private message text was not saved after reload."}{" "}
              <button
                className="secondary-button"
                disabled={delivery.busy}
                onClick={() => delivery.send(message)}
              >
                Retry message
              </button>{" "}
              <button
                className="secondary-button"
                disabled={delivery.busy}
                onClick={() => delivery.discard()}
              >
                Discard retry
              </button>
            </p>
          )}
        </div>
      )}
      {tab === "Progress" && (
        <div className="progress-layout">
          <section className="panel">
            <div className="panel-heading">
              <h3>A little further every day.</h3>
              <Target size={20} />
            </div>
            <strong className="progress-value">{progress}%</strong>
            <div className="progress-track">
              <span style={{ width: progress + "%" }} />
            </div>
            <p className="muted">
              {done} of {project.tasks.length} tasks complete
            </p>
            <h3>Milestones</h3>
            {project.milestones.map((m: any) => (
              <div className="milestone-row" key={m.id}>
                <input
                  type="checkbox"
                  aria-label={"Complete milestone: " + m.title}
                  checked={m.completed}
                  disabled={!owner || archived}
                  onChange={async (e) => {
                    try {
                      await api(
                        `workspaces/${id}/milestones/${m.id}`,
                        "PATCH",
                        { completed: e.target.checked },
                      );
                      load();
                    } catch (e: any) {
                      notify(e.message);
                    }
                  }}
                />
                <span>{m.title}</span>
                {m.dueDate && (
                  <small>{new Date(m.dueDate).toLocaleDateString()}</small>
                )}
                {owner && !archived && (
                  <>
                    <button
                      className="secondary-button"
                      aria-label={"Edit milestone: " + m.title}
                      onClick={() => setEditingMilestone(m)}
                    >
                      Edit
                    </button>
                    <button
                      className="secondary-button"
                      aria-label={"Delete milestone: " + m.title}
                      onClick={() => {
                        if (window.confirm("Delete this milestone?"))
                          void teamAction(
                            () =>
                              api(
                                `workspaces/${id}/milestones/${m.id}`,
                                "DELETE",
                              ),
                            "Milestone deleted",
                          );
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            ))}
            {owner && !archived && (
              <form
                className="milestone-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(`workspaces/${id}/milestones`, "POST", {
                      title: milestone,
                      dueDate: milestoneDue
                        ? new Date(milestoneDue + "T12:00:00Z").toISOString()
                        : null,
                    });
                    setMilestone("");
                    setMilestoneDue("");
                    load();
                  } catch (e: any) {
                    notify(e.message);
                  }
                }}
              >
                <input
                  aria-label="New milestone"
                  value={milestone}
                  onChange={(e) => setMilestone(e.target.value)}
                  minLength={3}
                  maxLength={150}
                  required
                  placeholder="The next big milestone…"
                />
                <input
                  type="date"
                  aria-label="Milestone due date"
                  value={milestoneDue}
                  onChange={(e) => setMilestoneDue(e.target.value)}
                />
                <button className="primary-button" aria-label="Add milestone">
                  <Plus size={16} />
                </button>
              </form>
            )}
          </section>
          <section className="panel">
            <h3>Recent activity</h3>
            {project.auditEvents.length === 0 ? (
              <p className="muted">Your team’s progress will appear here.</p>
            ) : (
              project.auditEvents.map((e: any) => (
                <div className="audit-row" key={e.id}>
                  <Check size={13} />
                  <div>
                    <strong>{e.action.replace(".", " ")}</strong>
                    <small>{new Date(e.createdAt).toLocaleString()}</small>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}
      {tab === "Resources" && (
        <div className="resource-grid">
          {project.resources.length === 0 ? (
            <div className="empty-state">
              <BookOpen size={32} />
              <h3>Your project’s knowledge shelf.</h3>
              <p>
                Attach useful links from the Resource Hub to find them here.
              </p>
            </div>
          ) : (
            project.resources.map((link: any) => (
              <article className="panel resource-card" key={link.resourceId}>
                <span className="tag">{link.resource.type}</span>
                <a
                  className="resource-title"
                  href={link.resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.resource.title}
                  <ArrowUpRight size={16} />
                </a>
                <p>{link.resource.description}</p>
                <button
                  className="secondary-button"
                  onClick={async () => {
                    try {
                      await api(
                        `resources/${link.resourceId}/projects/${id}`,
                        "DELETE",
                      );
                      load();
                      notify("Resource detached");
                    } catch (e: any) {
                      notify(e.message);
                    }
                  }}
                >
                  Remove from project
                </button>
              </article>
            ))
          )}
        </div>
      )}
      <div className="workspace-file-note">
        <BookOpen size={16} />
        <p>
          Files are private to your team. Chat refreshes every 4 seconds;
          real-time push delivery is not yet enabled.
        </p>
      </div>
      {projectForm && (
        <div className="modal-backdrop" onClick={() => setProjectForm(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit project"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close project editor"
              onClick={() => setProjectForm(false)}
            >
              <X size={20} />
            </button>
            <h2>Project settings</h2>
            <ImageUpload
              endpoint={`workspaces/${id}/cover`}
              label="Project cover"
              imageUrl={
                project.coverImageId
                  ? `/api/images/${project.coverImageId}`
                  : undefined
              }
              onChanged={load}
              readOnly={archived}
            />
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const f = new FormData(e.currentTarget),
                  split = (k: string) =>
                    String(f.get(k) || "")
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                try {
                  await api(`workspaces/${id}/project`, "PATCH", {
                    title: f.get("title"),
                    description: f.get("description"),
                    category: f.get("category"),
                    city: f.get("city"),
                    teamSize: Number(f.get("teamSize")),
                    remote: f.get("remote") === "on",
                    tags: split("tags"),
                    requiredSkills: split("skills"),
                    positions: split("positions"),
                    ...(f.get("image") ? { image: f.get("image") } : {}),
                  });
                  setProjectForm(false);
                  await load();
                  notify("Project settings saved");
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Project title
                <input
                  name="title"
                  defaultValue={project.title}
                  minLength={5}
                  maxLength={100}
                  required
                />
              </label>
              <label className="field">
                Project description
                <textarea
                  name="description"
                  defaultValue={project.description}
                  minLength={20}
                  maxLength={5000}
                  required
                />
              </label>
              <label className="field">
                Category
                <select name="category" defaultValue={project.category}>
                  {[
                    "Robotics",
                    "IoT",
                    "AI & ML",
                    "Web development",
                    "Design",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Concept illustration
                <select
                  name="image"
                  defaultValue={project.coverImageId ? "" : project.image}
                >
                  <option value="">Keep current image</option>
                  {["drone", "agriculture", "energy"].map((s) => (
                    <option key={s} value={"/images/" + s + ".svg"}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Tags
                <input
                  name="tags"
                  defaultValue={project.tags.join(", ")}
                  required
                />
              </label>
              <label className="field">
                Required skills
                <input
                  name="skills"
                  defaultValue={project.requiredSkills.join(", ")}
                  required
                />
              </label>
              <label className="field">
                Open positions
                <input
                  name="positions"
                  defaultValue={project.positions.join(", ")}
                  required
                />
              </label>
              <label className="field">
                City
                <input name="city" defaultValue={project.city} />
              </label>
              <label className="field">
                Capacity
                <input
                  name="teamSize"
                  type="number"
                  min={Math.max(2, project.members.length)}
                  max={30}
                  defaultValue={project.teamSize}
                  required
                />
              </label>
              <label className="checkbox-field">
                <input
                  name="remote"
                  type="checkbox"
                  defaultChecked={project.remote}
                />
                Remote friendly
              </label>
              <button className="primary-button" disabled={busy}>
                Save project
              </button>
            </form>
            {archived && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={async () => {
                  const title = window.prompt(
                    "Permanently delete this project and all workspace data? Type its exact title to confirm.",
                  );
                  if (title === null) return;
                  setBusy(true);
                  try {
                    await api(`workspaces/${id}/project`, "DELETE", {
                      confirmTitle: title,
                    });
                    notify("Project deleted");
                    onBack();
                  } catch (e: any) {
                    notify(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Permanently delete archived project
              </button>
            )}
          </section>
        </div>
      )}
      {taskForm && (
        <div className="modal-backdrop" onClick={() => setTaskForm(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Edit task" : "Add task"}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close task dialog"
              onClick={() => setTaskForm(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">ONE SMALL STEP</div>
            <h2>
              {editing ? "Refine the next step" : "What needs to happen next?"}
            </h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const f = new FormData(e.currentTarget);
                try {
                  await api(
                    `workspaces/${id}/tasks` +
                      (editing ? "/" + editing.id : ""),
                    editing ? "PATCH" : "POST",
                    {
                      title: f.get("title"),
                      description: f.get("description"),
                      assigneeId: f.get("assigneeId") || null,
                      dueDate: f.get("dueDate")
                        ? new Date(
                            String(f.get("dueDate")) + "T12:00:00Z",
                          ).toISOString()
                        : null,
                      labels: String(f.get("labels") || "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      ...(editing ? { version: editing.version } : {}),
                    },
                  );
                  setTaskForm(false);
                  await load();
                  notify("A new step on your roadmap");
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Task title
                <input
                  name="title"
                  defaultValue={editing?.title || ""}
                  required
                  minLength={3}
                  maxLength={150}
                />
              </label>
              <label className="field">
                Description
                <textarea
                  name="description"
                  defaultValue={editing?.description || ""}
                  maxLength={3000}
                  rows={3}
                />
              </label>
              <label className="field">
                Assignee
                <select
                  name="assigneeId"
                  defaultValue={editing?.assigneeId || ""}
                >
                  <option value="">Unassigned</option>
                  {project.members.map((m: any) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Due date
                <input
                  name="dueDate"
                  type="date"
                  defaultValue={editing?.dueDate?.slice(0, 10) || ""}
                />
              </label>
              <label className="field">
                Labels <small>Comma separated, up to 10</small>
                <input
                  name="labels"
                  defaultValue={editing?.labels?.join(", ") || ""}
                />
              </label>
              <button className="primary-button full-width" disabled={busy}>
                <Plus size={16} />
                {editing ? "Save task" : "Create task"}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function InvitePicker({
  projectId,
  memberIds,
  notify,
}: {
  projectId: string;
  memberIds: string[];
  notify: (s: string) => void;
}) {
  const [people, setPeople] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  async function load(next?: string) {
    const current = ++generation.current;
    setBusy(true);
    try {
      const b = await api(
        "discovery/people?" +
          new URLSearchParams({
            q: query,
            limit: "30",
            ...(next ? { cursor: next } : {}),
          }),
      );
      if (current !== generation.current) return;
      const list = b.items.filter((u: any) => !memberIds.includes(u.id));
      setPeople((old) => (next ? [...old, ...list] : list));
      setCursor(b.nextCursor);
      if (!next) setSelected(list[0]?.id || "");
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(() => load(), 250);
    return () => {
      clearTimeout(t);
      generation.current++;
    };
  }, [projectId, query, memberIds.join(",")]);
  return (
    <div style={{ marginBottom: 20 }}>
      <label className="field">
        Find an invite candidate
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={120}
          placeholder="Name, city or skill"
        />
      </label>
      <div className="milestone-form">
        <select
          className="status-select"
          aria-label="Invite teammate"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {people.length ? (
            people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.role}
              </option>
            ))
          ) : (
            <option value="">No matching candidates</option>
          )}
        </select>
        <button
          className="primary-button"
          disabled={!selected || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`workspaces/${projectId}/invitations`, "POST", {
                userId: selected,
              });
              notify("Invitation sent");
            } catch (e: any) {
              notify(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Send invitation
        </button>
        {cursor && (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => load(cursor)}
          >
            More candidates
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
