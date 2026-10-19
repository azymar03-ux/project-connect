import { request, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
try {
  process.loadEnvFile();
} catch {}
// Isolated fixtures provision accounts/sessions directly so the suite does not
// attack the shared IP's real signup limiter. Actual signup/login remain tested separately.
export async function fixtureAccount(db: PrismaClient, label: string) {
  const email = `fixture-${label}-${Date.now()}-${randomBytes(4).toString("hex")}@example.com`;
  const user = await db.user.create({
    data: {
      email,
      name: "Test " + label,
      initials: "TT",
      passwordHash: await hash("TestPassword2026!", 12),
      skills: [],
      interests: [],
    },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const ctx = await request.newContext({
    storageState: {
      cookies: [
        {
          name: "pc_session",
          value: token,
          domain: "localhost",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  });
  return { ctx, email, user };
}
