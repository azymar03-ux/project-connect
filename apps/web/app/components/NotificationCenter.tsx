"use client";
import { useEffect, useState } from "react";
import { Bell, Check, ArrowRight, Loader2 } from "lucide-react";
async function api(path: string, method = "GET") {
  const r = await fetch("/api/" + path, {
      method,
      headers: { "Content-Type": "application/json" },
    }),
    b = await r.json();
  if (!r.ok) throw new Error(b.message);
  return b;
}
export default function NotificationCenter({
  notify,
  onProject,
  onRefresh,
}: {
  notify: (s: string) => void;
  onProject: (id: string) => void;
  onRefresh: () => void;
}) {
  const [items, setItems] = useState<any[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  async function load(next?: string) {
    setLoading(true);
    try {
      const b = await api("notifications" + (next ? "?cursor=" + next : ""));
      setItems((old) => (next ? [...old, ...b.items] : b.items));
      setCursor(b.nextCursor);
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <div className="section-heading">
        <h2>Your updates</h2>
        <button
          className="secondary-button"
          onClick={async () => {
            try {
              await api("notifications/read-all", "PATCH");
              await load();
              onRefresh();
              notify("All notifications marked read");
            } catch (e: any) {
              notify(e.message);
            }
          }}
        >
          <Check size={14} />
          Mark all read
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && !items.length ? (
        <div className="loading-state">
          <Loader2 className="spin" />
        </div>
      ) : !items.length ? (
        <div className="empty-state">
          <Bell size={28} />
          <h3>No notifications yet.</h3>
          <p>Follows, requests, messages and invitations will appear here.</p>
        </div>
      ) : (
        items.map((n) => (
          <div
            className={
              "application-row notification-row " + (!n.readAt ? "unread" : "")
            }
            key={n.id}
          >
            <Bell size={17} />
            <div>
              <strong>{n.title}</strong>
              <small>{new Date(n.createdAt).toLocaleString()}</small>
            </div>
            {n.projectId && (
              <button
                className="icon-button"
                aria-label="Open notification project"
                onClick={() => onProject(n.projectId)}
              >
                <ArrowRight size={16} />
              </button>
            )}
            {!n.readAt && (
              <button
                className="secondary-button"
                aria-label={"Mark read: " + n.title}
                onClick={async () => {
                  try {
                    await api("notifications/" + n.id, "PATCH");
                    await load();
                    onRefresh();
                  } catch (e: any) {
                    notify(e.message);
                  }
                }}
              >
                Mark read
              </button>
            )}
          </div>
        ))
      )}
      {cursor && (
        <button
          className="secondary-button load-more"
          onClick={() => load(cursor)}
          disabled={loading}
        >
          Load older notifications
        </button>
      )}
    </section>
  );
}
