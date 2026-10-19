// Explicit test-only preload. Not part of application startup; never use on a deployed server.
if (process.env.PC_TEST_PROVIDERS !== "true" || process.env.NODE_ENV !== "test")
  throw Error("Provider fixtures require explicit test environment");
const { generateKeyPairSync } = require("node:crypto"),
  pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
let jose;
global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target === "https://places.googleapis.com/v1/places:searchText")
    return new Response(
      JSON.stringify({
        places: [
          {
            id: "fixture-http-shop",
            displayName: { text: "Test fixture shop, not live" },
            formattedAddress: "Test fixture address",
            location: { latitude: 11, longitude: 77 },
            attributions: [{ provider: "Test fixture attribution" }],
          },
        ],
      }),
    );
  if (target === "https://oauth2.googleapis.com/token") {
    const params = new URLSearchParams(options.body),
      [nonce, email, sub] = params.get("code").split("|");
    jose ??= await import("jose");
    const id_token = await new jose.SignJWT({
      email,
      email_verified: true,
      name: "Fixture Google User",
      nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience(process.env.GOOGLE_CLIENT_ID)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(pair.privateKey);
    return new Response(JSON.stringify({ id_token }));
  }
  if (target === "https://www.googleapis.com/oauth2/v3/certs") {
    const key = pair.publicKey.export({ format: "jwk" });
    return new Response(
      JSON.stringify({
        keys: [{ ...key, alg: "RS256", kid: "fixture-key", use: "sig" }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (
    /^https:\/\/api.github.com\/repos\/fixture\/repo(?:\/(commits|pulls|issues))?(?:\?per_page=10)?$/.test(
      target,
    )
  ) {
    if (target.endsWith("per_page=10"))
      return new Response(
        JSON.stringify(
          target.includes("/commits")
            ? [
                {
                  sha: "fixture-sha",
                  commit: { message: "Fixture commit" },
                  html_url: "https://github.com/fixture/repo/commit/fixture",
                },
                {
                  sha: "unsafe-link",
                  commit: { message: "Unsafe remote URL" },
                  html_url: "https://evil.example/trap",
                },
              ]
            : [
                {
                  number: 1,
                  title: "Fixture issue or pull",
                  state: "open",
                  html_url: "https://github.com/fixture/repo/issues/1",
                },
              ],
        ),
      );
    return new Response(
      JSON.stringify({
        full_name: "fixture/repo",
        stargazers_count: 12,
        private: false,
        updated_at: "2026-10-09T00:00:00.000Z",
      }),
    );
  }
  if (target === "https://api.openai.com/v1/chat/completions") {
    const body = JSON.parse(options.body),
      prompt = body.messages.at(-1).content;
    if (prompt.includes("provider-failure"))
      return new Response("{}", { status: 503 });
    const controller = options.signal;
    let timer,
      aborted = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Fixture live response, not a real provider. "}}]}\n\n',
          ),
        );
        timer = setTimeout(
          () => {
            if (aborted) return;
            c.enqueue(
              new TextEncoder().encode(
                prompt.includes("truncated-provider")
                  ? "data: unfinished"
                  : 'data: {"usage":{"total_tokens":50}}\n\ndata: [DONE]\n\n',
              ),
            );
            c.close();
          },
          prompt.includes("slow-provider") ? 10000 : 100,
        );
        controller?.addEventListener(
          "abort",
          () => {
            aborted = true;
            clearTimeout(timer);
            c.error(Error("ABORTED"));
          },
          { once: true },
        );
      },
      cancel() {
        aborted = true;
        clearTimeout(timer);
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  throw Error("Fixture blocks unexpected outbound request");
};
