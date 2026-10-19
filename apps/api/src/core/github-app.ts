import { githubTokens } from "./github-token-cache";
import {
  createHash,
  createPrivateKey,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { boundedJson } from "./http-json";
export function verifyGithubSignature(
  body: Buffer,
  signature: string | undefined,
  secret: string,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature) || !secret)
    return false;
  const expected = createHmac("sha256", secret).update(body).digest(),
    actual = Buffer.from(signature.slice(7), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function installationToken(
  installationId: string,
  options: {
    fetch?: typeof fetch;
    appId?: string;
    privateKey?: string;
    repository?: string;
  } = {},
) {
  const appId = options.appId ?? process.env.GITHUB_APP_ID,
    key = options.privateKey ?? process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !key || !/^\d{1,20}$/.test(installationId))
    throw Error("GITHUB_APP_NOT_CONFIGURED");
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify([appId, key, installationId, options.repository || "*"]),
    )
    .digest("hex");
  const mint = async () => {
    const { SignJWT } = await import("jose"),
      now = Math.floor(Date.now() / 1000),
      jwt = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(appId)
        .setIssuedAt(now - 60)
        .setExpirationTime(now + 540)
        .sign(createPrivateKey(key.replace(/\\n/g, "\n")));
    const r = await (options.fetch || fetch)(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "ProjectConnect",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: "Bearer " + jwt,
        },
        body: JSON.stringify({
          ...(options.repository ? { repositories: [options.repository] } : {}),
          permissions: {
            contents: "read",
            metadata: "read",
            pull_requests: "read",
            issues: "read",
          },
        }),
      },
    );
    if (!r.ok) throw Error("GITHUB_INSTALLATION_DENIED");
    const b = await boundedJson(r);
    if (typeof b.token !== "string" || b.token.length > 1000)
      throw Error("INVALID_GITHUB_TOKEN");
    const expires = Date.parse(b.expires_at);
    return {
      token: b.token,
      expires: Number.isFinite(expires) ? expires : Date.now(),
    };
  };
  // Injected fetchers are test adapters and do not share production credentials.
  return options.fetch
    ? (await mint()).token
    : githubTokens.get(cacheKey, installationId, mint);
}

export async function githubRequest(
  path: string,
  token?: string,
  fetcher: typeof fetch = fetch,
) {
  if (
    !/^\/repos\/[\w.-]+\/[\w.-]+(?:\/(?:commits|pulls|issues))?(?:\?per_page=10)?$/.test(
      path,
    )
  )
    throw Error("INVALID_GITHUB_PATH");
  const r = await fetcher("https://api.github.com" + path, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ProjectConnect",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
  });
  if (
    r.status === 429 ||
    (r.status === 403 &&
      (r.headers.get("x-ratelimit-remaining") === "0" ||
        r.headers.has("retry-after")))
  )
    throw Error("GITHUB_RATE_LIMITED");
  if (!r.ok) throw Error("GITHUB_REQUEST_FAILED");
  return boundedJson(r);
}
