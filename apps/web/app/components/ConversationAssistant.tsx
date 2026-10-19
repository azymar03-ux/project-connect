"use client";
import { useEffect, useRef, useState } from "react";
async function api(path: string, method = "GET", data?: unknown) {
  const r = await fetch("/api/assistant/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.message || "Request failed");
  return b;
}
export default function ConversationAssistant({
  user,
  notify,
  projects = [],
}: {
  user: any;
  projects?: any[];
  notify: (s: string) => void;
}) {
  const [status, setStatus] = useState<any>(null),
    [conversations, setConversations] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [prompt, setPrompt] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [partial, setPartial] = useState(""),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [projectId, setProjectId] = useState("");
  const controller = useRef<AbortController | null>(null),
    turnId = useRef<string | null>(null),
    generation = useRef(0);
  async function load(cursor?: string) {
    const current = generation.current;
    try {
      const b = await api(
        "conversations" +
          (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      if (current !== generation.current) return;
      setConversations((old) => (cursor ? [...old, ...b.items] : b.items));
      setNextCursor(b.nextCursor);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    fetch("/api/assistant/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setError("Unable to load provider status"));
    setSelected(null);
    setConversations([]);
    setPartial("");
    setBusy(false);
    if (user) load();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [user?.id]);
  async function open(id: string) {
    const current = ++generation.current;
    controller.current?.abort();
    setBusy(false);
    setPartial("");
    try {
      const c = await api("conversations/" + id);
      if (current !== generation.current) return;
      setSelected(c);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function cancel() {
    controller.current?.abort();
    if (turnId.current)
      try {
        await api("turns/" + turnId.current + "/cancel", "POST");
      } catch (e: any) {
        notify(e.message);
      }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const current = ++generation.current;
    controller.current = new AbortController();
    turnId.current = null;
    setBusy(true);
    setPartial("");
    setError("");
    let conversationId = selected?.id;
    try {
      let c = selected;
      if (!c) {
        c = await api("conversations", "POST", {
          title: prompt.slice(0, 100),
          ...(projectId ? { projectId } : {}),
        });
        setSelected({ ...c, turns: [] });
        await load();
      }
      conversationId = c.id;
      const r = await fetch(
        "/api/assistant/conversations/" + c.id + "/messages",
        {
          method: "POST",
          signal: controller.current.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            requestId: crypto.randomUUID(),
            providerConsent: consent,
          }),
        },
      );
      if (!r.ok) {
        const b = await r.json();
        throw Error(b.message);
      }
      if (!r.body) throw Error("Streaming unavailable");
      const reader = r.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        terminal = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (current !== generation.current) {
            await reader.cancel();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = block
                .split("\n")
                .find((l) => l.startsWith("event:"))
                ?.slice(6)
                .trim(),
              data = block
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5))
                .join("\n");
            if (!data) continue;
            const b = JSON.parse(data);
            if (event === "start") turnId.current = b.turnId;
            if (event === "delta") setPartial((old) => old + b.text);
            if (event === "failure") {
              setError(b.message);
              terminal = true;
            }
            if (event === "done") terminal = true;
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (!terminal)
        throw Error(
          "Connection interrupted before response completed. Refresh the conversation to check its status.",
        );
      if (current === generation.current) {
        setSelected(await api("conversations/" + c.id));
        setPrompt("");
        setPartial("");
        await load();
      }
    } catch (e: any) {
      if (current === generation.current) {
        setPartial("");
        setError(
          e.name === "AbortError"
            ? "Generation cancelled. Usage reservation is retained."
            : e.message,
        );
        if (conversationId)
          try {
            setSelected(await api("conversations/" + conversationId));
          } catch {}
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  if (!user)
    return (
      <section className="panel">
        <h2>Private project conversations</h2>
        <p>Sign in to use and save private assistant conversations.</p>
      </section>
    );
  return (
    <section className="panel conversation-assistant">
      <div className="section-heading">
        <h2>Private assistant conversation</h2>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setSelected(null);
            setPartial("");
            setError("");
          }}
        >
          New conversation
        </button>
      </div>
      <p className="integration-note">
        {status?.providerConfigured
          ? "A live AI provider is configured."
          : "No live provider: clearly labeled template guidance is available."}{" "}
        Only your selected conversation messages are sent. No files or team
        messages are retrieved. Responses may be wrong; links are unverified.
        Daily budgets apply even after deletion/cancellation.
      </p>
      {!selected && (
        <label className="field">
          Associate new conversation with a workspace (private to you)
          <select
            value={projectId}
            disabled={busy}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">No workspace</option>
            {projects
              .filter((p) => p.status !== "Archived")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {status?.providerConfigured && (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I consent to sending this conversation to the configured AI provider.
        </label>
      )}
      <label className="field">
        Saved conversation
        <select
          disabled={busy}
          value={selected?.id || ""}
          onChange={(e) =>
            e.target.value ? open(e.target.value) : setSelected(null)
          }
        >
          <option value="">New conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {nextCursor && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => load(nextCursor)}
        >
          Load earlier conversations
        </button>
      )}
      {selected && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => open(selected.id)}
        >
          Refresh conversation
        </button>
      )}
      {selected && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={async () => {
            if (
              !window.confirm(
                "Delete this conversation? Daily usage counters remain.",
              )
            )
              return;
            try {
              await api("conversations/" + selected.id, "DELETE");
              setSelected(null);
              await load();
              notify("Conversation content deleted");
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          Delete conversation
        </button>
      )}
      <div
        className="conversation-messages"
        role="region"
        aria-label="Assistant conversation"
      >
        {selected?.turns?.map((t: any) => (
          <article key={t.id}>
            <h3>You</h3>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {t.prompt}
            </p>
            <h3>
              {t.source === "llm" ? "AI response" : "Template guidance"} ·{" "}
              {t.status}
            </h3>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {t.content || "No completed response saved."}
            </p>
          </article>
        ))}
        {partial && (
          <p
            role="status"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {partial}
          </p>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={send}>
        <label className="field">
          Ask the assistant
          <textarea
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            minLength={3}
            maxLength={4000}
            required
            placeholder="Plan, compare technologies, or share a minimal debugging example. Never paste passwords or private keys."
          />
        </label>
        <button
          className="primary-button"
          disabled={busy || Boolean(status?.providerConfigured && !consent)}
        >
          {busy ? "Generating…" : "Send to assistant"}
        </button>
        {busy && (
          <button type="button" className="secondary-button" onClick={cancel}>
            Cancel response
          </button>
        )}
      </form>
    </section>
  );
}
