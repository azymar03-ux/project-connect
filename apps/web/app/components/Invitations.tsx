"use client";
import { useEffect, useState } from "react";
export default function Invitations({
  notify,
  onAccepted,
}: {
  notify: (s: string) => void;
  onAccepted: () => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  async function load() {
    const r = await fetch("/api/invitations");
    if (r.ok) setItems(await r.json());
  }
  useEffect(() => {
    load();
  }, []);
  return items.length ? (
    <section className="panel" style={{ marginBottom: 24 }}>
      <h3>Project invitations</h3>
      {items.map((i) => (
        <div className="application-row" key={i.id}>
          <div>
            <strong>{i.project.title}</strong>
            <small>{i.project.description.slice(0, 100)}</small>
          </div>
          {["Declined", "Accepted"].map((status) => (
            <button
              key={status}
              className={
                status === "Accepted" ? "primary-button" : "secondary-button"
              }
              onClick={async () => {
                const r = await fetch("/api/invitations/" + i.id, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status }),
                });
                const b = await r.json();
                if (!r.ok) return notify(b.message);
                await load();
                onAccepted();
                notify(
                  status === "Accepted"
                    ? "Welcome to the team!"
                    : "Invitation declined",
                );
              }}
            >
              {status === "Accepted" ? "Accept" : "Decline"}
            </button>
          ))}
        </div>
      ))}
    </section>
  ) : null;
}
