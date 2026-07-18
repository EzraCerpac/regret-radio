import { expect, test } from "@playwright/test";

test("plays, seeks, switches tracks, explains, and restores URL state", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/?track=overtake&speed=1&at=0.00&explain=0");
  await expect(page).toHaveTitle("Regret Radio");
  await expect(page.getByRole("heading", { name: "Overtake" })).toBeVisible();
  await expect(page.locator("#track-select option")).toHaveCount(6);

  const needle = page.locator("#needle");
  const start = await needle.getAttribute("transform");
  await page.getByRole("button", { name: /Listen/ }).click();
  await expect(page.locator("#play-label")).toHaveText("Pause");
  await page.waitForTimeout(450);
  expect(await needle.getAttribute("transform")).not.toBe(start);
  await page.getByRole("button", { name: /Pause/ }).click();
  await expect(page.locator("#play-label")).toHaveText("Listen");

  await page.locator("#scrubber").evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "500";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#position-readout")).toContainText("50%");
  await page.locator("#track-select").selectOption("uncertain-unison");
  await expect(page.getByRole("heading", { name: "Uncertain unison" })).toBeVisible();
  await expect(page.locator("#position-readout")).toContainText("0%");

  await page.getByRole("button", { name: "How this sound works" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/explain=1/);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/track=uncertain-unison/);
  expect(consoleErrors).toEqual([]);
});

test("reports import errors and exports a deterministic WAV download", async ({ page }) => {
  await page.goto("/?track=uncertain-unison&speed=2&at=0.00&explain=0");
  await page.locator("#bundle-file").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"kind":"wrong"}'),
  });
  await expect(page.locator("#status")).toContainText("bundle.kind");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export WAV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^regret-radio-uncertain-unison-d8216a10-2x\.wav$/,
  );
  await expect(page.locator("#status")).toContainText("Exported");

  await page.locator("#bundle-file").setInputFiles("src/data/bundle.json");
  await expect(page.locator("#status")).toContainText("Loaded 6 local tracks");
  await expect(page.locator("#track-select option")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Share" })).toBeDisabled();
});

test("keeps the player readable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overtake" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: /Listen/ })).toHaveCSS(
    "min-height",
    "44px",
  );
});
