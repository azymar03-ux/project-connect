// Bounded UTF-8 SSE parser, shared by provider adapter tests. Never executes data.
export async function* sseData(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  maxBytes = 524288,
) {
  const reader = body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    bytes = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw Error("CANCELLED");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw Error("CANCELLED");
      if (done) {
        buffer += decoder.decode();
        break;
      }
      bytes += value.length;
      if (bytes > maxBytes) throw Error("STREAM_TOO_LARGE");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 65536 && !buffer.includes("\n\n"))
        throw Error("EVENT_TOO_LARGE");
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        if (boundary > 65536) throw Error("EVENT_TOO_LARGE");
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
      }
    }
    if (buffer.trim()) throw Error("TRUNCATED_STREAM");
  } finally {
    signal?.removeEventListener("abort", abort);
    // Cancellation must not itself hang on a hostile provider stream.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
