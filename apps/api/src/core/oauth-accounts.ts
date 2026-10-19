import { db, digest, socialTransaction, lockUsers } from "./security";
export async function consumeOAuthState(state: string, binding: string) {
  const rows = await db.$queryRaw<
    {
      verifier: string;
      nonce: string;
      linkUserId: string | null;
      linkSessionHash: string | null;
    }[]
  >`DELETE FROM "OAuthState" WHERE "stateHash"=${digest(state)} AND "cookieHash"=${digest(binding)} AND "expiresAt">now() RETURNING verifier,nonce,"linkUserId","linkSessionHash"`;
  if (!rows[0]) throw Error("INVALID_STATE");
  return rows[0];
}
export async function resolveGoogleIdentity(
  identity: { sub: string; email: string; name?: string },
  state: { linkUserId: string | null; linkSessionHash: string | null },
  passwordHash: string | null,
) {
  return socialTransaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identity.sub},17381))::text`;
    if (state.linkUserId) {
      await lockUsers(tx, state.linkUserId);
      const current = await tx.session.findUnique({
        where: { tokenHash: state.linkSessionHash! },
      });
      if (
        !current ||
        current.userId !== state.linkUserId ||
        current.expiresAt <= new Date()
      )
        throw Error("LINK_SESSION_CHANGED");
    }
    const existing = await tx.oAuthAccount.findUnique({
      where: {
        provider_subject: { provider: "google", subject: identity.sub },
      },
    });
    if (existing) {
      if (state.linkUserId && existing.userId !== state.linkUserId) {
        throw Error("GOOGLE_ACCOUNT_ALREADY_LINKED");
      }
      await lockUsers(tx, existing.userId);
      if (
        !(await tx.oAuthAccount.findUnique({
          where: {
            provider_subject: { provider: "google", subject: identity.sub },
          },
        }))
      )
        throw Error("GOOGLE_ACCOUNT_UNLINKED");
      return { userId: existing.userId, linkId: existing.id };
    }
    if (state.linkUserId) {
      const linked = await tx.oAuthAccount.create({
        data: {
          provider: "google",
          subject: identity.sub,
          userId: state.linkUserId,
        },
      });
      return { userId: state.linkUserId, linkId: linked.id };
    }
    if (
      await tx.user.findUnique({
        where: { email: identity.email.toLowerCase() },
      })
    ) {
      throw Error("SIGN_IN_WITH_EMAIL_THEN_LINK_GOOGLE");
    }
    const name = identity.name || identity.email.split("@")[0];
    const u = await tx.user.create({
      data: {
        email: identity.email.toLowerCase(),
        emailVerifiedAt: new Date(),
        name,
        passwordHash: passwordHash!,
        passwordSet: false,
        initials: name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toUpperCase(),
        skills: [],
        interests: [],
        oauthAccounts: {
          create: { provider: "google", subject: identity.sub },
        },
      },
    });
    const link = await tx.oAuthAccount.findUniqueOrThrow({
      where: { provider_userId: { provider: "google", userId: u.id } },
    });
    return { userId: u.id, linkId: link.id };
  });
}
