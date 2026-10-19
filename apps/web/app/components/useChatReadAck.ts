"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
// Read markers acknowledge server messages rendered in this conversation only.
// Abort is best effort: an already-sent PATCH can still commit on the server.
export function useChatReadAck(
  key: string,
  path: string,
  throughId: string | undefined,
  enabled: boolean,
  onSuccess?: () => void,
) {
  const [visible, setVisible] = useState(true),
    [attempt, setAttempt] = useState(0),
    [error, setError] = useState("");
  const latest = useRef({ key, path, throughId, onSuccess, enabled, visible });
  useLayoutEffect(() => {
    latest.current = { key, path, throughId, onSuccess, enabled, visible };
  });
  const confirmed = useRef<{ key: string; id: string } | undefined>(undefined),
    trigger = useRef<() => void>(() => {});
  const retry = () => setAttempt((n) => n + 1);
  useEffect(() => {
    const visibility = () => setVisible(document.visibilityState === "visible");
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", retry);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", retry);
    };
  }, []);
  useEffect(() => {
    let stopped = false,
      running = false;
    const controller = new AbortController();
    setError("");
    const send = async () => {
      const current = latest.current;
      if (
        stopped ||
        running ||
        !current.enabled ||
        !current.visible ||
        document.visibilityState !== "visible" ||
        current.key !== key ||
        !current.throughId ||
        (confirmed.current?.key === key &&
          confirmed.current.id === current.throughId)
      )
        return;
      running = true;
      const id = current.throughId;
      let succeeded = false;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const r = await fetch("/api/" + current.path, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ throughId: id }),
          signal: controller.signal,
        });
        if (!r.ok)
          throw Error(
            r.status === 401 || r.status === 403
              ? "Read status not saved. Sign in again or check your conversation access."
              : "Read status not saved. Retry when connected to confirm unread status.",
          );
        if (
          !stopped &&
          latest.current.key === key &&
          latest.current.enabled &&
          latest.current.visible &&
          document.visibilityState === "visible"
        ) {
          confirmed.current = { key, id };
          setError("");
          latest.current.onSuccess?.();
          succeeded = true;
        }
      } catch (e: any) {
        if (!stopped && latest.current.key === key)
          setError(
            e.name === "AbortError" || e.name === "TypeError"
              ? "Read status could not be confirmed. Retry when connected."
              : e.message ||
                  "Read status could not be confirmed. Retry when connected.",
          );
      } finally {
        clearTimeout(timeout);
        running = false;
        if (succeeded && latest.current.throughId !== id) void send();
      }
    };
    trigger.current = () => {
      void send();
    };
    void send();
    return () => {
      stopped = true;
      controller.abort();
      trigger.current = () => {};
    };
  }, [key, enabled, visible, attempt]);
  useEffect(() => {
    trigger.current();
  }, [throughId]);
  return { error, retry };
}
