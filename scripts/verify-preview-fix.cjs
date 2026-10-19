const { chromium } = require("playwright");
const sharp = require("sharp");
(async () => {
  const host = `https://3000-${process.env.E2B_SANDBOX_ID}.e2b.app`;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  // HTTPS preview origin routed locally, including same origin fetch/cookies; avoids proxy dependency.
  await context.route(host + "/**", async (route) => {
    const req = route.request();
    const r = await route.fetch({
      url: req.url().replace(host, "http://localhost:3000"),
      headers: { ...req.headers(), host: new URL(host).host },
      maxRedirects: 0,
    });
    await route.fulfill({ response: r });
  });
  const page = await context.newPage();
  await page.goto(host);
  await page.locator(".project-card").first().waitFor();
  const reg = await context.request.post(
    "http://localhost:3001/api/auth/register",
    {
      headers: { Origin: host, "Content-Type": "application/json" },
      data: {
        name: "Preview Tester",
        email: "preview" + Date.now() + "@example.com",
        password: "PreviewPassw0rd!",
      },
    },
  );
  if (reg.status() !== 201) throw Error("register returned " + reg.status());
  const sc = reg.headers()["set-cookie"] || "";
  const m = sc.match(/pc_session=([^;]+)/);
  if (!m)
    throw Error("no session from register (preview-origin cookie dropped)");
  await context.addCookies([{ name: "pc_session", value: m[1], url: host }]);
  await page.goto(host);
  await page.getByRole("button", { name: "Edit your profile" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Edit your profile" }).click();
  const photo = page.locator(".image-upload img");
  await page.locator(".image-upload input").setInputFiles({
    name: "preview-test.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#438b89" },
    })
      .png()
      .toBuffer(),
  });
  await photo.waitFor();
  await page.waitForFunction(
    () => document.querySelector(".image-upload img")?.naturalWidth > 0,
  );
  await page.getByRole("button", { name: "Remove profile photo" }).click();
  await photo.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.locator(".sign-in").waitFor();
  const bad = await context.request.post(
    "http://localhost:3001/api/auth/login",
    {
      headers: { Origin: "https://untrusted.example" },
      data: {
        email: "demo@projectconnect.dev",
        password: "BuildTogether2026!",
      },
    },
  );
  if (bad.status() !== 403) throw Error("Untrusted origin bypass");
  console.log(
    "PASS HTTPS preview-origin register/session reload, image upload/render/removal, logout; untrusted origin denied. Locally routed browser, not external iframe certification.",
  );
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
