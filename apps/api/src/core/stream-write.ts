import type { Response } from "express";
// Backpressure is bounded: a disconnected or slow client cannot indefinitely
// hold a provider stream/reservation. All listeners are removed on settlement.
export async function writeStream(
  res: Response,
  chunk: string,
  signal: AbortSignal,
  timeoutMs = 5000,
) {
  if (signal.aborted || res.destroyed || res.writableEnded)
    throw Error("CANCELLED");
  if (res.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      res.off("drain", drain);
      res.off("close", close);
      res.off("error", close);
      signal.removeEventListener("abort", close);
    };
    const drain = () => {
      cleanup();
      resolve();
    };
    const close = () => {
      cleanup();
      reject(Error("CANCELLED"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("CLIENT_BACKPRESSURE_TIMEOUT"));
    }, timeoutMs);
    res.once("drain", drain);
    res.once("close", close);
    res.once("error", close);
    signal.addEventListener("abort", close, { once: true });
    if (signal.aborted || res.destroyed) close();
  });
}
