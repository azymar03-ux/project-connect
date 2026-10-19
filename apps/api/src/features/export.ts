import { exportDefinitions } from "../core/export-definitions";
import { cursorKeys } from "../core/cursor-keys";
import { Controller, Get, Req, Res, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, uid, validate } from "../core/security";
const sections = Object.keys(
  exportDefinitions,
) as (keyof typeof exportDefinitions)[];
const cursorShape = z
  .object({
    userId: z.string(),
    section: z.string(),
    after: z.string().min(1).max(100),
    startedAt: z.iso.datetime(),
    expires: z.number(),
  })
  .strict();
function sign(
  payload: string,
  secret: string,
  key = cursorKeys("EXPORT_CURSOR_SECRET")[0],
) {
  return createHmac("sha256", key)
    .update(secret + ":" + payload)
    .digest();
}
@Controller("api/account/export")
export class ExportController {
  @Get("sections") async manifest(@Req() req: Request) {
    await uid(req);
    return {
      version: 1,
      sections,
      maxPageSize: 100,
      note: "Download pages separately; no total row cap. Live keyset export, not a cross-page database snapshot. Start again after concurrent edits for a consistent current copy. Attachments/images are metadata only. Passwords, sessions, OAuth tokens, quota identities and private object keys are excluded.",
    };
  }
  @Get("page") async page(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await uid(req),
      q = validate(
        z
          .object({
            section: z.enum(
              sections as [
                keyof typeof exportDefinitions,
                ...(keyof typeof exportDefinitions)[],
              ],
            ),
            limit: z.coerce.number().int().min(1).max(100).default(100),
            cursor: z.string().max(2000).optional(),
            download: z.enum(["true", "false"]).default("false"),
          })
          .strict(),
        req.query,
      );
    const secret = req.cookies.pc_session as string;
    let after: string | undefined,
      startedAt = new Date().toISOString(),
      expires = Date.now() + 3600000;
    if (q.cursor) {
      try {
        const [payload, signature, extra] = q.cursor.split(".");
        const actual = Buffer.from(signature, "base64url");
        if (
          extra ||
          !cursorKeys("EXPORT_CURSOR_SECRET").some((key) => {
            const expected = sign(payload, secret, key);
            return (
              actual.length === expected.length &&
              timingSafeEqual(expected, actual)
            );
          })
        )
          throw Error();
        const c = cursorShape.parse(
          JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        );
        if (
          c.userId !== userId ||
          c.section !== q.section ||
          c.expires < Date.now()
        )
          throw Error();
        after = c.after;
        startedAt = c.startedAt;
        expires = c.expires;
      } catch {
        throw new HttpException(
          "Invalid or expired export cursor. Restart this section.",
          400,
        );
      }
    }
    const d = exportDefinitions[q.section];
    // Only trusted, constant model/column names above; caller controls neither.
    const rows = await (db[d.model] as any).findMany({
      where: {
        AND: [
          d.scope(userId),
          ...(after ? [{ [d.field]: { gt: after } }] : []),
        ],
      },
      orderBy: { [d.field]: "asc" },
      take: q.limit + 1,
      ...("select" in d ? { select: d.select } : {}),
    });
    if ((await uid(req)) !== userId)
      throw new HttpException("Account unavailable.", 403);
    const items = rows.slice(0, q.limit),
      last = items.at(-1);
    let nextCursor: string | null = null;
    if (rows.length > q.limit && last) {
      const payload = Buffer.from(
        JSON.stringify({
          userId,
          section: q.section,
          after: last[d.field],
          startedAt,
          expires,
        }),
      ).toString("base64url");
      nextCursor = payload + "." + sign(payload, secret).toString("base64url");
    }
    const result = {
      version: 1,
      section: q.section,
      startedAt,
      exportedAt: new Date().toISOString(),
      items,
      nextCursor,
      snapshot: false,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)
      throw new HttpException(
        "Export page exceeds 2 MB. Retry with a smaller limit.",
        413,
      );
    res.setHeader("Cache-Control", "private, no-store");
    if (q.download === "true")
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="projectconnect-${q.section}-${Date.now()}.json"`,
      );
    return result;
  }
}
