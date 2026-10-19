"use client";
import { useEffect, useRef, useState } from "react";
type Pending = { requestId: string; content?: string; created: number };
const pendingMessages = new Map<string, Pending>(),
  inflight = new Map<string, Promise<void>>();
const listeners = new Set<(confirmedKey?: string) => void>();
const prefix = "pc-delivery:";
let epoch = 0;
function broadcast(confirmedKey?: string) {
  for (const fn of listeners) fn(confirmedKey);
}
// Never persist private text or hashes. Keys are user + conversation-type scoped.
function remember(key: string, p: Pending) {
  pendingMessages.set(key, p);
  try {
    sessionStorage.setItem(
      prefix + key,
      JSON.stringify({ requestId: p.requestId, created: p.created }),
    );
  } catch {}
  broadcast();
}
function forget(key: string, confirmed = false) {
  pendingMessages.delete(key);
  try {
    sessionStorage.removeItem(prefix + key);
  } catch {}
  broadcast(confirmed ? key : undefined);
}
function recover(key: string): Pending | null {
  if (!/^[^:]+:(dm|project):[^:]+$/.test(key)) return null;
  let p = pendingMessages.get(key);
  if (!p)
    try {
      const data = JSON.parse(sessionStorage.getItem(prefix + key) || "null");
      if (
        data &&
        typeof data.requestId === "string" &&
        /^[a-f0-9-]{36}$/.test(data.requestId) &&
        Number.isFinite(data.created)
      )
        p = { requestId: data.requestId, created: data.created };
    } catch {}
  if (p && p.created <= Date.now() && Date.now() - p.created < 24 * 3600000) {
    pendingMessages.set(key, p);
    return p;
  }
  pendingMessages.delete(key);
  try {
    sessionStorage.removeItem(prefix + key);
  } catch {}
  return null;
}
export function clearChatDelivery() {
  epoch++;
  pendingMessages.clear();
  inflight.clear();
  try {
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith(prefix)) sessionStorage.removeItem(k);
  } catch {}
  broadcast();
}
export function useChatDelivery(
  key: string,
  post: (body: unknown) => Promise<any>,
  success: () => void | Promise<void>,
  notify: (message: string) => void,
  check?: (requestId: string) => Promise<{ status: string }>,
) {
  const generation = useRef(0),
    mounted = useRef(false),
    checking = useRef(false),
    callbacks = useRef({ success, notify, check });
  callbacks.current = { success, notify, check };
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [needsText, setNeedsText] = useState(false);
  useEffect(() => {
    const g = ++generation.current;
    mounted.current = true;
    checking.current = false;
    // Ambiguous pre-namespace metadata must not be migrated to either audience.
    try {
      for (const k of Object.keys(sessionStorage))
        if (
          k.startsWith(prefix) &&
          !/^[^:]+:(dm|project):[^:]+$/.test(k.slice(prefix.length))
        )
          sessionStorage.removeItem(k);
    } catch {}
    const sync = (confirmedKey?: string) => {
      if (g !== generation.current) return;
      const p = recover(key);
      const running = !!p && inflight.has(p.requestId);
      setBusy(running || checking.current);
      setFailed(!!p && !running);
      setNeedsText(!!p && !p.content && !running);
      if (confirmedKey === key && !p && mounted.current && !checking.current)
        void Promise.resolve()
          .then(() => {
            if (g === generation.current && mounted.current)
              return callbacks.current.success();
          })
          .catch(() =>
            callbacks.current.notify(
              "Message delivered, but refresh failed. Reconnect to see the latest messages.",
            ),
          );
    };
    listeners.add(sync);
    sync();
    const p = recover(key),
      e = epoch;
    if (p && !inflight.has(p.requestId) && callbacks.current.check) {
      checking.current = true;
      sync();
      void callbacks.current
        .check(p.requestId)
        .then((result) => {
          if (e !== epoch || g !== generation.current) return;
          if (
            result.status === "committed" &&
            pendingMessages.get(key)?.requestId === p.requestId
          ) {
            checking.current = false;
            forget(key, true);
          }
        })
        .catch(() => {
          if (e === epoch && g === generation.current)
            callbacks.current.notify(
              "Delivery status could not be checked. No message was resent; reconnect or retry explicitly.",
            );
        })
        .finally(() => {
          if (g === generation.current) {
            checking.current = false;
            sync();
          }
        });
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingMessages.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      mounted.current = false;
      generation.current++;
      listeners.delete(sync);
      window.removeEventListener("beforeunload", warn);
    };
  }, [key]);
  async function send(content?: string) {
    const e = epoch,
      g = generation.current;
    let request = recover(key);
    if (checking.current || (request && inflight.has(request.requestId)))
      return;
    if (!request) {
      if (!content?.trim()) return;
      if (pendingMessages.size >= 50) {
        notify("Resolve or discard pending messages before sending more.");
        return;
      }
      request = {
        requestId: crypto.randomUUID(),
        content: content.trim(),
        created: Date.now(),
      };
    } else if (!request.content) {
      if (!content?.trim()) {
        notify(
          "Re-enter the original text to retry; message text was not saved.",
        );
        return;
      }
      request.content = content.trim();
    }
    remember(key, request);
    const outgoing = request;
    const task = Promise.resolve()
      .then(() =>
        post({ content: outgoing.content, requestId: outgoing.requestId }),
      )
      .then(() => {
        if (e !== epoch) return;
        inflight.delete(outgoing.requestId);
        if (pendingMessages.get(key)?.requestId === outgoing.requestId)
          forget(key, true);
      })
      .catch((error: any) => {
        if (e !== epoch) return;
        if (error.status === 409) {
          outgoing.content = undefined;
          remember(key, outgoing);
        }
        if (g === generation.current && mounted.current)
          notify(
            error.message ||
              "Delivery uncertain. Retry explicitly using the same request ID.",
          );
      })
      .finally(() => {
        if (e === epoch) {
          inflight.delete(outgoing.requestId);
          broadcast();
        }
      });
    inflight.set(outgoing.requestId, task);
    broadcast();
    await task;
  }
  function discard() {
    const p = recover(key);
    if (checking.current || (p && inflight.has(p.requestId))) return;
    forget(key);
  }
  return { busy, failed, needsText, send, discard };
}
