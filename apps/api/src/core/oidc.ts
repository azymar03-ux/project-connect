import { boundedJson } from "./http-json";
import type { jwtVerify, createRemoteJWKSet } from "jose" with {
  "resolution-mode": "import",
};
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
const google = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
};
let remote: ReturnType<typeof createRemoteJWKSet> | undefined;
export const oauthRandom = () => randomBytes(32).toString("base64url");
export function authorization(
  clientId: string,
  redirect: string,
  verifier: string,
  state: string,
  nonce: string,
) {
  return (
    google.authorize +
    "?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString()
  );
}
export async function googleIdentity(
  config: { clientId: string; clientSecret: string; redirect: string },
  code: string,
  verifier: string,
  nonce: string,
  dependencies: {
    fetch?: typeof fetch;
    keys?: Parameters<typeof jwtVerify>[1];
  } = {},
) {
  const response = await (dependencies.fetch || fetch)(google.token, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirect,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw Error("TOKEN_EXCHANGE_FAILED");
  const body = z
    .object({ id_token: z.string().min(1).max(16000) })
    .parse(await boundedJson(response, 65536));
  const jose = await import("jose");
  remote ??= jose.createRemoteJWKSet(new URL(google.jwks), {
    timeoutDuration: 5000,
    cooldownDuration: 30000,
    cacheMaxAge: 3600000,
  });
  const { payload } = await jose.jwtVerify(
    body.id_token,
    dependencies.keys || remote,
    {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: config.clientId,
      requiredClaims: ["sub", "iat", "exp", "nonce", "email", "email_verified"],
      maxTokenAge: 600,
      clockTolerance: 5,
    },
  );
  if (
    payload.nonce !== nonce ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== config.clientId) ||
    (payload.azp !== undefined && payload.azp !== config.clientId) ||
    payload.email_verified !== true
  )
    throw Error("IDENTITY_CLAIMS_INVALID");
  return z
    .object({
      sub: z.string().min(1).max(255),
      email: z.email().max(254),
      name: z.string().trim().min(1).max(80).optional(),
    })
    .parse(payload);
}
