import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { fixtureAccount } from "./fixtures";
import { matchScore } from "../apps/api/src/core/recommendations";
const db = new PrismaClient(),
  base = "http://localhost:3001/api/";
test.afterAll(() => db.$disconnect());
test("explainable interest/activity ranking matches SQL; hides moderated activity and binds time/cursor/profile", async () => {
  const a = await fixtureAccount(db, "rank-eval"),
    b = await fixtureAccount(db, "rank-candidate");
  const marker = "ranking-" + a.user.id;
  let project: any;
  try {
    const profile = {
      skills: ["Python"],
      interests: ["Robotics"],
      city: "Chennai",
    };
    await db.user.update({ where: { id: a.user.id }, data: profile });
    await db.user.update({
      where: { id: b.user.id },
      data: { ...profile, name: marker },
    });
    project = await db.project.create({
      data: {
        title: marker,
        description: "Ranking evaluation",
        tags: ["Robotics"],
        requiredSkills: ["Python"],
        positions: [],
        category: "Robotics",
        city: "Chennai",
        ownerId: b.user.id,
      },
    });
    await db.member.create({
      data: { projectId: project.id, userId: b.user.id, role: "Owner" },
    });
    const activity = await db.activity.create({
      data: {
        authorId: b.user.id,
        projectId: project.id,
        content: "Visible progress",
      },
    });
    const get = async (kind: string) =>
      (
        await (
          await a.ctx.get(base + "discovery/" + kind + "?q=" + marker)
        ).json()
      ).items[0];
    const p = await get("projects"),
      person = await get("people");
    expect(p.match).toBe(100);
    expect(person.match).toBe(100);
    expect(p.match).toBe(
      matchScore(
        profile,
        ["Python"],
        ["Robotics", "Robotics"],
        "Chennai",
        true,
      ),
    );
    expect(p.matchReasons.matchedInterests).toContain("Robotics");
    expect(p.matchReasons.recentPublicActivity).toBe(true);
    expect(
      (await (await a.ctx.get(base + "projects/" + project.id)).json()).match,
    ).toBe(100);
    await db.activity.update({
      where: { id: activity.id },
      data: { hiddenAt: new Date() },
    });
    expect((await get("projects")).match).toBe(95);
    expect((await get("people")).matchReasons.recentPublicActivity).toBe(false);
    // Distinct candidates with weaker fit must not outrank full fit.
    await db.project.create({
      data: {
        title: marker + " other",
        description: "Weaker fit",
        tags: [],
        requiredSkills: ["Rust"],
        positions: [],
        category: "Design",
        city: "Delhi",
        ownerId: b.user.id,
      },
    });
    const page = await (
      await a.ctx.get(base + "discovery/projects?q=" + marker + "&limit=1")
    ).json();
    expect(page.items[0].id).toBe(project.id);
    expect(page.nextCursor).toBeTruthy();
    const next = await (
      await a.ctx.get(
        base +
          "discovery/projects?q=" +
          marker +
          "&limit=1&cursor=" +
          encodeURIComponent(page.nextCursor),
      )
    ).json();
    expect(next.items[0].id).not.toBe(project.id);
    expect(next.ranking.asOf).toBe(page.ranking.asOf);
    expect(
      (
        await a.ctx.get(
          base +
            "discovery/projects?q=" +
            marker +
            "&cursor=" +
            encodeURIComponent(page.nextCursor + "x"),
        )
      ).status(),
    ).toBe(400);
    await db.user.update({
      where: { id: a.user.id },
      data: { interests: ["Design"] },
    });
    expect(
      (
        await a.ctx.get(
          base +
            "discovery/projects?q=" +
            marker +
            "&cursor=" +
            encodeURIComponent(page.nextCursor),
        )
      ).status(),
    ).toBe(400);
    expect(JSON.stringify(p)).not.toMatch(
      /passwordHash|tokenHash|emailVerifiedAt|"email"/,
    );
  } finally {
    await db.project.deleteMany({ where: { ownerId: b.user.id } });
    await db.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
    await a.ctx.dispose();
    await b.ctx.dispose();
  }
});
test("ranking cold start, missing fields and monotonic skill/interest/activity fixtures", () => {
  expect(matchScore(null, [], [], "")).toBeNull();
  const me = { skills: ["PYTHON"], interests: ["robotics"], city: "Chennai" };
  expect(matchScore(me, [], [], "")).toBe(25);
  expect(matchScore(me, ["Python"], [], "")).toBe(80);
  expect(matchScore(me, ["Python"], ["Robotics"], "")).toBe(85);
  expect(matchScore(me, ["Python"], ["Robotics"], "chennai", true)).toBe(100);
  expect(matchScore(me, ["Rust"], ["Design"], "Delhi", true)).toBe(30);
});
