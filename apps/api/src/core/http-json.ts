export async function boundedJson(
  response: Response,
  maxBytes = 262144,
): Promise<any> {
  if (Number(response.headers.get("content-length") || 0) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw Error("UPSTREAM_BODY_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("UPSTREAM_BODY_MISSING");
  const chunks: Uint8Array[] = [],
    decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("UPSTREAM_BODY_TOO_LARGE");
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      data.set(c, offset);
      offset += c.length;
    }
    return JSON.parse(decoder.decode(data));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
