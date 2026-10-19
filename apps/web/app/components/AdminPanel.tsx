"use client";
import { useEffect, useState, useRef } from "react";
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
export default function AdminPanel({
  notify,
}: {
  notify: (s: string) => void;
}) {
  const [o, setO] = useState<any>(null),
    [reports, setReports] = useState<any[]>([]),
    [stores, setStores] = useState<any[]>([]),
    [error, setError] = useState(""),
    [users, setUsers] = useState<any[]>([]),
    [userQuery, setUserQuery] = useState(""),
    [audit, setAudit] = useState<any[]>([]),
    [operations, setOperations] = useState<any>(null);
  const [cursors, setCursors] = useState<Record<string, string | null>>({}),
    [loading, setLoading] = useState<Record<string, boolean>>({});
  const generation = useRef(0),
    activeSearch = useRef("");
  function merge(
    setter: React.Dispatch<React.SetStateAction<any[]>>,
    items: any[],
    append: boolean,
  ) {
    setter((old) =>
      append
        ? Array.from(new Map([...old, ...items].map((r) => [r.id, r])).values())
        : items,
    );
  }
  async function page(
    kind: string,
    append = false,
    query = activeSearch.current,
  ) {
    const setters: Record<
      string,
      React.Dispatch<React.SetStateAction<any[]>>
    > = {
      users: setUsers,
      audit: setAudit,
      reports: setReports,
      stores: setStores,
    };
    const paths: Record<string, string> = {
      users: "admin/users?q=" + encodeURIComponent(query),
      audit: "admin/audit?",
      reports: "admin/reports?paged=true",
      stores: "stores/pending?paged=true",
    };
    const current = generation.current;
    setLoading((old) => ({ ...old, [kind]: true }));
    try {
      const result = await api(
        paths[kind] +
          (append && cursors[kind]
            ? "&cursor=" + encodeURIComponent(cursors[kind]!)
            : ""),
      );
      if (current !== generation.current) return;
      merge(setters[kind], result.items, append);
      setCursors((old) => ({ ...old, [kind]: result.nextCursor }));
    } catch (e: any) {
      if (current === generation.current) notify(e.message);
    } finally {
      if (current === generation.current)
        setLoading((old) => ({ ...old, [kind]: false }));
    }
  }
  function more(kind: string, label: string) {
    return cursors[kind] ? (
      <button
        className="secondary-button"
        disabled={loading[kind]}
        onClick={() => page(kind, true)}
      >
        {loading[kind] ? "Loading…" : label}
      </button>
    ) : null;
  }

  async function act(path: string, data: unknown, message: string) {
    try {
      await api(path, "PATCH", data);
      await load();
      notify(message);
    } catch (e: any) {
      notify(e.message);
    }
  }
  async function load() {
    generation.current++;
    try {
      const [a, b] = await Promise.all([
        api("admin/overview"),
        api("admin/operations"),
      ]);
      setO(a);
      setOperations(b);
      await Promise.all([page("reports"), page("stores"), page("audit")]);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  if (error)
    return (
      <div className="empty-state">
        <h3>Admin access required</h3>
        <p>{error}</p>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">COMMUNITY HEALTH</div>
          <h1>Moderation</h1>
          <p>Review reports and store submissions.</p>
        </div>
      </div>
      {o && (
        <div className="stats-strip">
          {Object.entries(o)
            .slice(0, 3)
            .map(([k, v]) => (
              <div key={k}>
                <div>
                  <strong>
                    {String(v)}
                    <span> {k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                  </strong>
                </div>
              </div>
            ))}
        </div>
      )}
      <section className="panel" style={{ marginBottom: 20 }}>
        <h2>Account moderation</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              generation.current++;
              activeSearch.current = userQuery;
              await page("users", false, userQuery);
            } catch (e: any) {
              notify(e.message);
            }
          }}
        >
          <label className="field">
            Find a profile
            <input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              maxLength={100}
            />
          </label>
          <button className="secondary-button">Search profiles</button>
        </form>
        {users.map((u) => (
          <div className="application-row" key={u.id}>
            <p>
              {u.name} · {u.suspendedAt ? "Suspended" : "Active"}
              {u.isAdmin ? " · Administrator" : ""}
            </p>
            <button
              className="secondary-button"
              disabled={u.isAdmin}
              onClick={async () => {
                const reason = window.prompt(
                  "Enter moderation reason (at least 10 characters)",
                );
                if (!reason) return;
                try {
                  await api("admin/users/" + u.id, "PATCH", {
                    suspended: !u.suspendedAt,
                    reason,
                  });
                  await page("users");
                  await load();
                  notify("Account moderation saved");
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              {u.suspendedAt ? "Restore access" : "Suspend access"}
            </button>
          </div>
        ))}
        {more("users", "Load more profiles")}
      </section>
      <section className="panel" style={{ marginBottom: 20 }}>
        <h2>Operational queue health</h2>
        {operations &&
          Object.entries(operations)
            .filter(([, v]) => typeof v === "number")
            .map(([k, v]) => (
              <p key={k}>
                {k}: {String(v)}
              </p>
            ))}
        {operations?.alerts?.length > 0 && (
          <div role="alert">
            <h3>Operational alerts</h3>
            <ul>
              {operations.alerts.map((a: any) => (
                <li key={a.code}>
                  {a.severity}: {a.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {operations?.http && (
          <details>
            <summary>HTTP metrics (this API process)</summary>
            <p>{operations.http.scope}</p>
            <div style={{ overflowX: "auto" }}>
              <table>
                <caption>
                  Request counts and latency totals since process start
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">Requests</th>
                    <th scope="col">Server errors</th>
                    <th scope="col">Mean ms</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.http.routes.map((r: any) => (
                    <tr key={r.route}>
                      <th scope="row">{r.route}</th>
                      <td>{r.count}</td>
                      <td>{r.serverErrors}</td>
                      <td>{Math.round(r.durationMs / Math.max(1, r.count))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        <h3>Recent admin audit</h3>
        {audit.map((a) => (
          <p key={a.id}>
            {a.action} · {a.targetId} · {new Date(a.createdAt).toLocaleString()}
          </p>
        ))}
        {more("audit", "Load older audit events")}
      </section>
      <div className="progress-layout">
        <section className="panel">
          <h3>Pending reports ({reports.length})</h3>
          {reports.length === 0 ? (
            <p className="muted">No open reports.</p>
          ) : (
            reports.map((r) => (
              <div className="application-row" key={r.id}>
                <div>
                  <strong>
                    {r.targetType} · {r.targetId.slice(0, 10)}
                  </strong>
                  <small>by {r.reporter.name}</small>
                  <p>{r.reason}</p>
                </div>
                <div className="application-actions">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      act(
                        "admin/reports/" + r.id,
                        { status: "Dismissed" },
                        "Report dismissed",
                      )
                    }
                  >
                    Dismiss
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      act(
                        "admin/reports/" + r.id,
                        { status: "Resolved" },
                        "Report resolved",
                      )
                    }
                  >
                    Resolve
                  </button>
                  {r.targetType !== "user" && (
                    <button
                      className="primary-button"
                      onClick={() =>
                        act(
                          "admin/reports/" + r.id,
                          { status: "Resolved", hideTarget: true },
                          "Content hidden and report resolved",
                        )
                      }
                    >
                      Hide content
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          {more("reports", "Load more reports")}
        </section>
        <section className="panel">
          <h3>Store submissions ({stores.length})</h3>
          {stores.length === 0 ? (
            <p className="muted">Nothing awaiting review.</p>
          ) : (
            stores.map((s) => (
              <div className="application-row" key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <small>
                    {s.address}, {s.city} · {s.categories.join(", ")}
                  </small>
                  <p>{s.description}</p>
                </div>
                <div className="application-actions">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      act(
                        `stores/${s.id}/review`,
                        { status: "Rejected" },
                        "Store rejected",
                      )
                    }
                  >
                    Reject
                  </button>
                  <button
                    className="primary-button"
                    onClick={() =>
                      act(
                        `stores/${s.id}/review`,
                        { status: "Approved" },
                        "Store approved",
                      )
                    }
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))
          )}
          {more("stores", "Load more store submissions")}
        </section>
      </div>
    </>
  );
}
