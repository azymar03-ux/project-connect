import { cursorKeys } from "./cursor-keys";
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
const shape = z
  .object({
    id: z.string().min(1).max(100),
    date: z.iso.datetime(),
    scope: z.string().max(250),
    expires: z.number(),
  })
  .strict();
function mac(
  payload: string,
  req: Request,
  key = cursorKeys("CHAT_POSITION_SECRET")[0],
) {
  return createHmac("sha256", key)
    .update(String(req.cookies.pc_session) + ":")
    .update("chat-position:" + payload)
    .digest();
}
export function chatPosition(
  row: { id: string; createdAt: Date } | undefined,
  scope: string,
  req: Request,
) {
  if (!row) return null;
  const payload = Buffer.from(
    JSON.stringify({
      id: row.id,
      date: row.createdAt.toISOString(),
      scope,
      expires: Date.now() + 24 * 3600000,
    }),
  ).toString("base64url");
  return "p1." + payload + "." + mac(payload, req).toString("base64url");
}
export function parsePosition(value: string, scope: string, req: Request) {
  try {
    const [version, payload, signature, extra] = value.split(".");
    const actual = Buffer.from(signature, "base64url");
    if (
      version !== "p1" ||
      extra ||
      !cursorKeys("CHAT_POSITION_SECRET").some((key) => {
        const expected = mac(payload, req, key);
        return (
          expected.length === actual.length && timingSafeEqual(expected, actual)
        );
      })
    )
      throw Error();
    const row = shape.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (row.scope !== scope || row.expires < Date.now()) throw Error();
    return { id: row.id, createdAt: new Date(row.date) };
  } catch {
    throw new HttpException(
      {
        message:
          "Message position expired. Reloading recent history is required.",
        code: "CHAT_POSITION_EXPIRED",
      },
      409,
    );
  }
}
export function positionFilter(
  p: { id: string; createdAt: Date },
  forward: boolean,
) {
  return {
    OR: [
      { createdAt: forward ? { gt: p.createdAt } : { lt: p.createdAt } },
      { createdAt: p.createdAt, id: forward ? { gt: p.id } : { lt: p.id } },
    ],
  };
}
