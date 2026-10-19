import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { fixtureAccount } from "./fixtures";
import {
  authorization,
  oauthRandom,
  googleIdentity,
} from "../apps/api/src/core/oidc";
import {
  consumeOAuthState,
  resolveGoogleIdentity,
} from "../apps/api/src/core/oauth-accounts";
import { digest } from "../apps/api/src/core/security";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient(),
  base = "http://localhost:3000/api/";
test.afterAll(() => db.$disconnect());
test("Google protocol validates signed issuer/audience/nonce/expiry/verified-email claims and exchanges PKCE only server-side", async () => {
  const { generateKeyPair, SignJWT } = await import("jose"),
    { privateKey, publicKey } = await generateKeyPair("RS256"),
    config = {
      clientId: "local-client",
      clientSecret: "local-fixture-secret",
      redirect: "https://example.com/api/auth/google/callback",
    },
    nonce = oauthRandom(),
    verifier = oauthRandom();
  const url = new URL(
    authorization(
      config.clientId,
      config.redirect,
      verifier,
      oauthRandom(),
      nonce,
    ),
  );
  expect(url.origin).toBe("https://accounts.google.com");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("client_secret")).toBeNull();
  const token = async (
    claims: any = {},
    aud = "local-client",
    issuer = "https://accounts.google.com",
    exp = "5m",
  ) =>
    new SignJWT({
      sub: "fixture-subject",
      email: "fixture@example.com",
      email_verified: true,
      name: "Fixture Identity",
      nonce,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(aud)
      .setExpirationTime(exp)
      .sign(privateKey);
  const fixture = (jwt: string) => ({
    keys: publicKey,
    fetch: (async (_url: any, options: any) => {
      const body = options.body as URLSearchParams;
      expect(body.get("code_verifier")).toBe(verifier);
      expect(body.get("client_secret")).toBe(config.clientSecret);
      expect(options.redirect).toBe("error");
      return new Response(JSON.stringify({ id_token: jwt }));
    }) as typeof fetch,
  });
  expect(
    (
      await googleIdentity(
        config,
        "one-use-code",
        verifier,
        nonce,
        fixture(await token()),
      )
    ).sub,
  ).toBe("fixture-subject");
  for (const jwt of [
    await token({ nonce: "wrong" }),
    await token({ email_verified: false }),
    await token({}, "wrong-client"),
    await token({}, "local-client", "https://evil.example"),
    await token({}, "local-client", "https://accounts.google.com", "-1m"),
  ])
    await expect(
      googleIdentity(config, "code", verifier, nonce, fixture(jwt)),
    ).rejects.toThrow();
  await expect(
    googleIdentity(config, "code", verifier, nonce, {
      keys: publicKey,
      fetch: (async () =>
        new Response("denied", { status: 400 })) as typeof fetch,
    }),
  ).rejects.toThrow("TOKEN_EXCHANGE_FAILED");
});
test("OAuth state is cookie-bound, expiring and atomically single-use; no email-only linking", async () => {
  const a = await fixtureAccount(db, "oauth-link");
  const subject = "fixture-" + oauthRandom(),
    state = oauthRandom(),
    binding = oauthRandom();
  try {
    await db.oAuthState.create({
      data: {
        stateHash: digest(state),
        cookieHash: digest(binding),
        verifier: oauthRandom(),
        nonce: oauthRandom(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await expect(consumeOAuthState(state, "wrong")).rejects.toThrow(
      "INVALID_STATE",
    );
    const claims = await Promise.allSettled([
      consumeOAuthState(state, binding),
      consumeOAuthState(state, binding),
    ]);
    expect(claims.filter((c) => c.status === "fulfilled")).toHaveLength(1);
    await expect(consumeOAuthState(state, binding)).rejects.toThrow(
      "INVALID_STATE",
    );
    await db.oAuthState.create({
      data: {
        stateHash: digest(state),
        cookieHash: digest(binding),
        verifier: oauthRandom(),
        nonce: oauthRandom(),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expect(consumeOAuthState(state, binding)).rejects.toThrow(
      "INVALID_STATE",
    );
    await expect(
      resolveGoogleIdentity(
        { sub: subject, email: a.email },
        { linkUserId: null, linkSessionHash: null },
        await hash("random-provider-secret", 12),
      ),
    ).rejects.toThrow("SIGN_IN_WITH_EMAIL_THEN_LINK_GOOGLE");
    const cookie = (await a.ctx.storageState()).cookies.find(
      (c) => c.name === "pc_session",
    )!;
    expect(
      await resolveGoogleIdentity(
        { sub: subject, email: a.email },
        { linkUserId: a.user.id, linkSessionHash: digest(cookie.value) },
        null,
      ),
    ).toMatchObject({ userId: a.user.id });
    expect(
      await resolveGoogleIdentity(
        { sub: subject, email: a.email },
        { linkUserId: null, linkSessionHash: null },
        null,
      ),
    ).toMatchObject({ userId: a.user.id });
    await a.ctx.delete(
      base +
        "account/sessions/" +
        (await db.session.findFirstOrThrow({ where: { userId: a.user.id } }))
          .id,
    );
    await expect(
      resolveGoogleIdentity(
        { sub: "other-" + subject, email: a.email },
        { linkUserId: a.user.id, linkSessionHash: digest(cookie.value) },
        null,
      ),
    ).rejects.toThrow("LINK_SESSION_CHANGED");
  } finally {
    await db.oAuthState.deleteMany({ where: { stateHash: digest(state) } });
    await db.user.delete({ where: { id: a.user.id } });
    await a.ctx.dispose();
  }
});
test("Google missing-credential status and callback failure are truthful and do not create a session", async () => {
  const ctx = await request.newContext();
  try {
    const status = await (await ctx.get(base + "auth/google/status")).json();
    expect(status.configured).toBe(false);
    expect(
      (await ctx.get(base + "auth/google/start", { maxRedirects: 0 })).status(),
    ).toBe(503);
    const r = await ctx.get(
      base + "auth/google/callback?state=" + oauthRandom() + "&code=bad",
      { maxRedirects: 0 },
    );
    expect(r.status()).toBe(302);
    expect(r.headers().location).toContain("authError=GOOGLE_SIGNIN_FAILED");
    expect(
      (await ctx.storageState()).cookies.some((c) => c.name === "pc_session"),
    ).toBe(false);
  } finally {
    await ctx.dispose();
  }
});
import { boundedJson } from "../apps/api/src/core/http-json";
test("provider bodies are bounded even without content-length headers", async () => {
  expect(await boundedJson(new Response('{"ok":true}'), 32)).toEqual({
    ok: true,
  });
  await expect(boundedJson(new Response("x".repeat(33)), 32)).rejects.toThrow(
    "UPSTREAM_BODY_TOO_LARGE",
  );
  await expect(boundedJson(new Response("invalid"), 32)).rejects.toThrow();
});
