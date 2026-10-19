import { test, expect, request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
try {
  process.loadEnvFile();
} catch {}
const db = new PrismaClient();
test.afterAll(() => db.$disconnect());
test("registration onboarding, project create, save and profile update", async ({
  page,
}) => {
  const email = `browser-core-${Date.now()}@example.com`;
  let id = "";
  try {
    await page.goto("http://localhost:3000");
    await page.locator(".sign-in").click();
    await page.getByRole("button", { name: "Join us", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Your name" })
      .fill("Browser Core Tester");
    await page.getByRole("textbox", { name: "Email address" }).fill(email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("TestPassword2026!");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Edit profile" }),
    ).toBeVisible();
    await page.locator("[name=skills]").fill("Python, React");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(page.locator(".sidebar-profile")).toContainText(
      "Browser Core Tester",
    );
    const me = await page.request.get("http://localhost:3000/api/me");
    id = (await me.json()).id;
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await page.locator("[name=title]").fill("Browser core isolated project");
    await page
      .locator("textarea[name=description]")
      .fill("An isolated browser test project to verify creation and saving.");
    await page.locator("[name=skills]").fill("Python");
    await page.locator("[name=positions]").fill("Developer");
    await page
      .getByRole("button", { name: "Publish project", exact: true })
      .click();
    await expect(page.locator(".project-card")).toHaveCount(1);
    await page.locator(".save-button").click();
    await page
      .locator(".sidebar")
      .getByRole("button", { name: "Saved projects", exact: true })
      .click();
    await expect(page.locator(".project-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Edit your profile" }).click();
    await page.locator("[name=bio]").fill("I build useful things.");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      (await (await page.request.get("http://localhost:3000/api/me")).json())
        .bio,
    ).toBe("I build useful things.");
  } finally {
    if (!id) id = (await db.user.findUnique({ where: { email } }))?.id || "";
    if (id) {
      await db.project.deleteMany({ where: { ownerId: id } });
      await db.emailOutbox.deleteMany({ where: { recipient: email } });
      await db.user.delete({ where: { id } });
    }
  }
});
test("mobile discovery no horizontal overflow and mobile navigation opens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000");
  await expect(page.locator(".project-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "People", exact: true })
    .click();
  await expect(page.locator(".person-card").first()).toBeVisible();
});
