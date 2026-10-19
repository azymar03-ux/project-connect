import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("public discovery and hardware screens have no serious/critical automated accessibility findings", async ({
  page,
}) => {
  await page.goto("http://localhost:3000");
  await expect(page.locator(".project-card").first()).toBeVisible();
  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Nearby hardware", exact: true })
    .click();
  await expect(page.locator(".store-card").first()).toBeVisible();
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
});
import { PrismaClient } from "@prisma/client";
import { fixtureAccount } from "./fixtures";
test("workspace task/project dialogs and account controls have no serious/critical accessibility violations at 320px", async ({
  page,
}) => {
  page.setDefaultTimeout(10000);
  const db = new PrismaClient(),
    a = await fixtureAccount(db, "a11y-workspace");
  try {
    const p = await (
      await a.ctx.post("http://localhost:3000/api/projects", {
        data: {
          title: "Accessible workspace project",
          description:
            "Keyboard and accessible editing coverage for the project workspace.",
          category: "Design",
          tags: ["Design"],
          requiredSkills: ["Design"],
          positions: ["Designer"],
          city: "Test",
          remote: true,
          teamSize: 4,
        },
      })
    ).json();
    await page.context().addCookies((await a.ctx.storageState()).cookies);
    await page.goto("http://localhost:3000/projects/" + p.id);
    await page
      .getByRole("button", { name: "Open project workspace", exact: true })
      .click();
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    let results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact || ""),
      ),
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact || ""),
      ),
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 320, height: 720 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto("http://localhost:3000");
    await expect(
      page.getByRole("button", { name: "Edit your profile" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("button", { name: "Settings & profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account security", exact: true }),
    ).toBeVisible();
    results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact || ""),
      ),
    ).toEqual([]);
  } finally {
    await db.project.deleteMany({ where: { ownerId: a.user.id } });
    await db.user.delete({ where: { id: a.user.id } });
    await a.ctx.dispose();
    await db.$disconnect();
  }
});
