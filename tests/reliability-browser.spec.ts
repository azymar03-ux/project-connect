import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import AxeBuilder from "@axe-core/playwright";
let script: string;
test.beforeAll(async () => {
  const b = await build({
    entryPoints: ["tests/reliability-harness.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = b.outputFiles[0].text;
});
async function setup(page: any) {
  await page.route("http://localhost:3000/__reliability", (route: any) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>Reliability test</title></head><body><main id="root"></main><script src="/__reliability.js"></script></body></html>',
    }),
  );
  await page.route("http://localhost:3000/__reliability.js", (route: any) =>
    route.fulfill({ contentType: "text/javascript", body: script }),
  );
  await page.route("**/api/places/status", (route: any) =>
    route.fulfill({
      json: {
        configured: true,
        mapConfigured: true,
        browserKey: "browser-fixture-key",
      },
    }),
  );
  await page.goto("http://localhost:3000/__reliability");
}
test("offline retry survives switch and reload without persisting plaintext; logout clears metadata", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).fail = true;
  });
  await page.getByLabel("Draft").fill("private message sentinel");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Unconfirmed");
  const first = await page.evaluate(
    () => (window as any).requests[0].body.requestId,
  );
  expect(
    await page.evaluate(() => JSON.stringify(sessionStorage)),
  ).not.toContain("private message sentinel");
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.getByRole("status")).not.toContainText("Unconfirmed");
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Unconfirmed");
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "Re-enter original text",
  );
  await page.getByLabel("Draft").fill("private message sentinel");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Acknowledged");
  expect(
    await page.evaluate(() => (window as any).requests[0].body.requestId),
  ).toBe(first);
  await page.evaluate(() => {
    (window as any).fail = true;
  });
  await page.getByLabel("Draft").fill("second secret");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Unconfirmed");
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith("pc-delivery:")),
    ),
  ).toEqual([]);
});
test("old delivery completion cannot clear or lock a newer conversation", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).hold = true;
  });
  await page.getByLabel("Draft").fill("alpha message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await page.evaluate(() => {
    (window as any).hold = false;
    (window as any).fail = true;
  });
  await page.getByLabel("Draft").fill("beta message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Unconfirmed");
  await page.evaluate(() => {
    (window as any).fail = false;
    (window as any).release();
  });
  await expect(page.getByRole("status")).toContainText("Unconfirmed");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Acknowledged");
});
test("Maps explicit opt-in, load failure retry, marker disposal and accessible list fallback", async ({
  page,
}) => {
  let loads = 0;
  await page.route(
    "https://maps.googleapis.com/maps/api/js?**",
    async (route) => {
      loads++;
      if (loads === 1) return route.abort();
      const callback = new URL(route.request().url()).searchParams.get(
        "callback",
      );
      await route.fulfill({
        contentType: "text/javascript",
        body: `window.mapStats={maps:0,removed:0,cleared:0};window.google={maps:{Map:class{constructor(){mapStats.maps++}unbindAll(){}},Marker:class{setMap(value){if(value===null)mapStats.removed++}},event:{clearInstanceListeners(){mapStats.cleared++}}}};window[${JSON.stringify(callback)}]();`,
      });
    },
  );
  await page.route("**/api/places/search", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "fixture",
            displayName: { text: "Fixture hardware" },
            formattedAddress: "Fixture address",
            location: { latitude: 11, longitude: 77 },
            googleMapsUri: "https://maps.google.com/",
            attributions: [],
          },
        ],
      },
    }),
  );
  await setup(page);
  expect(loads).toBe(0);
  await page.getByRole("button", { name: "Show Google map" }).click();
  await expect(page.getByRole("alert")).toContainText("failed to load");
  expect(
    await page.evaluate(() =>
      Object.keys(window).filter((k) =>
        k.startsWith("projectConnectMapsReady"),
      ),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "List only" }).click();
  await page.getByRole("button", { name: "Show Google map" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).mapStats?.maps))
    .toBe(1);
  await page
    .getByRole("button", { name: "Search Google Places", exact: true })
    .click();
  await expect(page.getByText("Fixture hardware")).toBeVisible();
  await page.getByRole("button", { name: "List only" }).click();
  expect(await page.evaluate(() => (window as any).mapStats.removed)).toBe(1);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
});

test("reload reconciles server-acknowledged retry without resending private text", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).fail = true;
  });
  await page.getByLabel("Draft").fill("acknowledged but response lost");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Unconfirmed");
  await page.addInitScript(() => {
    (window as any).committed = true;
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Acknowledged");
  expect(await page.evaluate(() => (window as any).requests || [])).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith("pc-delivery:")),
    ),
  ).toEqual([]);
});

test("leaving and returning to an in-flight conversation cannot unlock duplicate sends", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).hold = true;
  });
  await page.getByLabel("Draft").fill("single in-flight message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => (window as any).requests.length)).toBe(1);
  await page.evaluate(() => {
    (window as any).release();
  });
  await expect(page.getByRole("status")).toContainText("Acknowledged");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
});

test("Maps timeout removes callback and a later opt-in uses a fresh loader", async ({
  page,
}) => {
  let loads = 0;
  await page.route(
    "https://maps.googleapis.com/maps/api/js?**",
    async (route) => {
      loads++;
      if (loads === 1)
        return route.fulfill({
          contentType: "text/javascript",
          body: "/* callback deliberately absent */",
        });
      const callback = new URL(route.request().url()).searchParams.get(
        "callback",
      );
      await route.fulfill({
        contentType: "text/javascript",
        body: `window.google={maps:{Map:class{unbindAll(){}},Marker:class{},event:{clearInstanceListeners(){}}}};window[${JSON.stringify(callback)}]();`,
      });
    },
  );
  await setup(page);
  await page.clock.install();
  await page.getByRole("button", { name: "Show Google map" }).click();
  await page.clock.fastForward(15001);
  await expect(page.getByRole("alert")).toContainText("timed out");
  expect(
    await page.evaluate(() =>
      Object.keys(window).filter((k) =>
        k.startsWith("projectConnectMapsReady"),
      ),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "List only" }).click();
  await page.getByRole("button", { name: "Show Google map" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(loads).toBe(2);
});

test("discard is not delivery confirmation and read acknowledgment failures expose safe explicit retry", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).fail = true;
  });
  await page.getByLabel("Draft").fill("not delivered");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Unconfirmed");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByLabel("Draft")).toHaveValue("not delivered");
  await expect(page.getByRole("status")).not.toContainText("Acknowledged");
  let calls = 0;
  await page.route("**/api/fixture/read", (route) => {
    calls++;
    return route.fulfill({ status: calls === 1 ? 503 : 200, json: {} });
  });
  await page.evaluate(() => {
    (window as any).readId = "rendered-id";
  });
  await page.getByLabel("Draft").fill("rerender");
  await expect(page.getByRole("alert")).toContainText("Read status not saved");
  await page.getByRole("button", { name: "Retry read status" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(calls).toBe(2);
});
