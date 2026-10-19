import {
  Controller,
  Get,
  Post,
  Delete,
  Req,
  Res,
  HttpException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import {
  db,
  uid,
  digest,
  validate,
  socialTransaction,
  lockUsers,
  session,
} from "../core/security";
import {
  consumeOAuthState,
  resolveGoogleIdentity,
} from "../core/oauth-accounts";
import { googleIdentity, authorization, oauthRandom } from "../core/oidc";
function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID,
    clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new HttpException(
      "Google sign-in is not configured. Use email sign-in.",
      503,
    );
  const origin = new URL(process.env.PUBLIC_APP_URL || "http://localhost:3000")
    .origin;
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))
    throw new HttpException("OAuth requires an HTTPS application URL.", 503);
  return {
    clientId,
    clientSecret,
    redirect: origin + "/api/auth/google/callback",
    origin,
  };
}
const cookie = "pc_oauth";
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth/google",
  maxAge: 600000,
});
@Controller("api/auth/google")
export class OAuthController {
  @Get("status") status() {
    return {
      configured: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      ),
    };
  }
  @Get("start") async start(@Req() req: Request, @Res() res: Response) {
    const url = await this.begin(req, res);
    res.redirect(url);
  }
  @Post("link") async link(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return { url: await this.begin(req, res, await uid(req)) };
  }
  async begin(req: Request, res: Response, linkUserId?: string) {
    const c = config(),
      state = oauthRandom(),
      binding = oauthRandom(),
      verifier = oauthRandom(),
      nonce = oauthRandom();
    await db.$transaction(async (tx) => {
      await tx.oAuthState.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      const previous = req.cookies?.[cookie];
      if (typeof previous === "string")
        await tx.oAuthState.deleteMany({
          where: { cookieHash: digest(previous) },
        });
      await tx.oAuthState.create({
        data: {
          stateHash: digest(state),
          cookieHash: digest(binding),
          verifier,
          nonce,
          linkUserId,
          linkSessionHash: linkUserId ? digest(req.cookies.pc_session) : null,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
    });
    res.cookie(cookie, binding, cookieOptions());
    return authorization(c.clientId, c.redirect, verifier, state, nonce);
  }
  @Get("callback") async callback(@Req() req: Request, @Res() res: Response) {
    const origin = new URL(
      process.env.PUBLIC_APP_URL || "http://localhost:3000",
    ).origin;
    let result = "GOOGLE_SIGNIN_FAILED";
    try {
      const c = config(),
        q = validate(
          z.object({
            state: z.string().regex(/^[\w-]{43}$/),
            code: z.string().min(1).max(4096).optional(),
            error: z.string().max(100).optional(),
          }),
          req.query,
        ),
        binding = req.cookies?.[cookie];
      if (typeof binding !== "string" || binding.length !== 43)
        throw Error("MISSING_BINDING");
      const state = await consumeOAuthState(q.state, binding);
      if (q.error || !q.code) throw Error("PROVIDER_DENIED");
      if (
        state.linkUserId &&
        ((await uid(req)) !== state.linkUserId ||
          digest(req.cookies.pc_session) !== state.linkSessionHash)
      )
        throw Error("LINK_SESSION_CHANGED");
      const identity = await googleIdentity(
        c,
        q.code,
        state.verifier,
        state.nonce,
      );
      const passwordHash = state.linkUserId
        ? null
        : await hash(randomBytes(40).toString("hex"), 12);
      const resolved = await resolveGoogleIdentity(
        identity,
        state,
        passwordHash,
      );
      res.clearCookie(cookie, cookieOptions());
      await session(res, resolved.userId, {
        kind: "oauth",
        provider: "google",
        subject: identity.sub,
        linkId: resolved.linkId,
      });
      return res.redirect(c.origin + "/?auth=google");
    } catch (e) {
      if (
        e instanceof Error &&
        [
          "GOOGLE_ACCOUNT_ALREADY_LINKED",
          "SIGN_IN_WITH_EMAIL_THEN_LINK_GOOGLE",
        ].includes(e.message)
      )
        result = e.message;
      res.clearCookie(cookie, cookieOptions());
      return res.redirect(origin + "/?authError=" + result);
    }
  }
  @Get("account") async account(@Req() req: Request) {
    const userId = await uid(req);
    const linked = await db.oAuthAccount.findUnique({
      where: { provider_userId: { provider: "google", userId } },
    });
    return { linked: Boolean(linked) };
  }
  @Delete("account") async unlink(@Req() req: Request) {
    const userId = await uid(req);
    return socialTransaction(async (tx) => {
      await lockUsers(tx, userId);
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!u.emailVerifiedAt || !u.passwordSet)
        throw new HttpException(
          "Verify your email and set a password using password recovery before unlinking.",
          409,
        );
      await tx.oAuthAccount.deleteMany({
        where: { provider: "google", userId },
      });
      return { linked: false };
    });
  }
}
