// Browser-only test harness: not served or imported by the application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  useChatDelivery,
  clearChatDelivery,
} from "../apps/web/app/components/useChatDelivery";
import GoogleStoreSearch from "../apps/web/app/components/GoogleStoreSearch";
import { useChatReadAck } from "../apps/web/app/components/useChatReadAck";
function Harness() {
  const [key, setKey] = useState("user:dm:alpha"),
    [text, setText] = useState(""),
    [notice, setNotice] = useState("");
  const delivery = useChatDelivery(
    key,
    async (body) => {
      const w = window as any;
      w.requests ??= [];
      w.requests.push({ key, body });
      if (w.hold)
        await new Promise<void>((resolve) => {
          w.release = resolve;
        });
      if (w.fail) throw Error("Network interrupted");
    },
    () => {
      setText("");
      setNotice("Acknowledged");
    },
    setNotice,
    async () => ({
      status: (window as any).committed ? "committed" : "not_found",
    }),
  );
  const ack = useChatReadAck(
    key,
    "fixture/read",
    (window as any).readId,
    !!(window as any).readId,
  );
  return (
    <>
      <h1>Reliability test harness</h1>
      <button
        onClick={() =>
          setKey(key === "user:dm:alpha" ? "user:dm:beta" : "user:dm:alpha")
        }
      >
        Switch
      </button>
      <button
        onClick={() => {
          clearChatDelivery();
          setKey("loggedout:dm:none");
        }}
      >
        Logout
      </button>
      <p>Conversation {key}</p>
      <input
        aria-label="Draft"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={delivery.busy || (delivery.failed && !delivery.needsText)}
      />
      <button disabled={delivery.busy} onClick={() => delivery.send(text)}>
        Send
      </button>
      <button onClick={delivery.discard}>Discard</button>
      <p role="status">
        {notice} {delivery.failed ? "Unconfirmed" : ""}{" "}
        {delivery.needsText ? "Re-enter original text" : ""}
      </p>
      {ack.error && (
        <p role="alert">
          {ack.error}
          <button onClick={ack.retry}>Retry read status</button>
        </p>
      )}
      <GoogleStoreSearch
        origin={{ lat: 11, lng: 77 }}
        radius={10}
        user={{ id: "user" }}
        onSignIn={() => {}}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
