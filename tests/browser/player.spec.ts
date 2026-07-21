import { expect, test } from "@playwright/test";

test("plays, seeks, switches tracks, explains, and restores URL state", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/?track=overtake&speed=1&at=0.00&explain=0");
  await expect(page).toHaveTitle("Regret Radio — Solver Selection You Can Hear");
  await expect(page.getByRole("heading", { name: "Overtake" })).toBeVisible();
  await expect(page.locator("#track-story")).toBeVisible();
  await expect(page.locator("#track-outcome")).toBeVisible();
  await expect(page.locator("#track-select option")).toHaveCount(6);
  await expect(page.locator("#transmission-index-body tr")).toHaveCount(6);
  await expect(page.locator("#transmission-index")).not.toHaveAttribute("open", "");
  await expect(page.locator("#transmission-index")).toContainText(
    "not a representative sample or statistical population",
  );

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

test("opens a curated story from the neutral transmission index", async ({ page }) => {
  await page.goto("/?track=overtake&speed=1&at=0.50&explain=0");
  await page.locator("#transmission-index > summary").click();
  const openStall = page.getByRole("button", { name: "Open Stall in player" });
  await openStall.click();
  await expect(page.getByRole("heading", { name: "Stall" })).toBeFocused();
  await expect(page.locator("#track-select")).toHaveValue("stall");
  await expect(page.locator("#position-readout")).toContainText("0%");
  await expect(page).toHaveURL(/track=stall/);
  await expect(page.locator(".transmission-row.is-current")).toContainText("Stall");
  await expect(page.locator(".transmission-row.is-current .index-open")).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("reports import errors and exports a deterministic WAV download", async ({ page }) => {
  await page.goto("/?track=uncertain-unison&speed=2&at=0.00&explain=0");
  await page.getByText("Advanced import", { exact: true }).click();
  await expect(
    page.getByText("Files stay in this tab, are never uploaded, and disappear on reload."),
  ).toBeVisible();
  await expect(
    page.getByText("A matching digest proves data consistency, not authorship.", {
      exact: false,
    }),
  ).toBeVisible();
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
  await expect(page.locator("#status")).toContainText(
    "Loaded 6 local tracks as unverified local imports",
  );
  await expect(page.locator("#track-select option")).toHaveCount(12);
  await expect(page.locator("#track-select option:checked")).toContainText(
    "Unverified local import",
  );
  await expect(page.locator("#transmission-index-body tr")).toHaveCount(12);
  await expect(page.locator("#transmission-index-body .index-open[data-local='true']")).toHaveCount(
    6,
  );
  await expect(page.locator(".transmission-row.is-current .index-source")).toContainText(
    "Unverified local import",
  );
  await expect(page.getByRole("button", { name: "Share" })).toBeDisabled();
  await expect(page).toHaveURL(/track=uncertain-unison/);

  await page.getByRole("button", { name: "How this sound works" }).click();
  await expect(page.locator("#provenance-heading")).toHaveText("Unverified local import");
  await expect(page.locator("#provenance-status")).toContainText(
    "digest proves data consistency, not authorship",
  );
});

test("rejects files over 10 MiB before reading them", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as unknown as Window & { __fileTextReads: number };
    testWindow.__fileTextReads = 0;
    const originalText = File.prototype.text;
    File.prototype.text = function () {
      testWindow.__fileTextReads += 1;
      return originalText.call(this);
    };
  });
  await page.goto("/");
  await page.locator("#bundle-file").setInputFiles({
    name: "too-large.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32),
  });

  await expect(page.locator("#status")).toHaveText("file: maximum size is 10MB");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as Window & { __fileTextReads: number }).__fileTextReads,
    ),
  ).toBe(0);
});

test("sanitizes generated share state", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await page.goto(
    "/?track=overtake&speed=1&at=0.37&explain=0&utm_source=private&debug=1#decision",
  );
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.locator("#status")).toHaveText("Share link copied.");

  const url = new URL(page.url());
  expect([...url.searchParams.keys()]).toEqual(["track", "speed", "at", "explain"]);
  expect(url.searchParams.get("track")).toBe("overtake");
  expect(url.searchParams.get("speed")).toBe("1");
  expect(url.searchParams.get("at")).toBe("0.37");
  expect(url.searchParams.get("explain")).toBe("0");
  expect(url.hash).toBe("");
});

test("uses one roving score tab stop and announces explicit keyboard selections", async ({
  page,
}) => {
  await page.goto("/");
  const adaptiveMarks = page.locator('.decision-mark[data-lane="adaptive"]');
  await expect(page.locator('.decision-mark[tabindex="0"]')).toHaveCount(1);
  await adaptiveMarks.first().focus();
  await expect(adaptiveMarks.first()).toBeFocused();
  await expect(page.locator("#decision-live")).toBeEmpty();

  await page.keyboard.press("End");
  await expect(adaptiveMarks.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(adaptiveMarks.first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(adaptiveMarks.nth(1)).toBeFocused();
  await expect(page.locator('.decision-mark[tabindex="0"]')).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(page.locator("#decision-live")).toContainText(
    "Adaptive selector, decision 2",
  );
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await expect(page.locator("#decision-live")).toContainText(
    "Adaptive selector, decision 1",
  );

  await page.getByRole("button", { name: "Previous decision" }).click();
  await expect(page.locator("#decision-live")).toContainText("Closed-loop SBS");
});

test("keeps decision controls and full evidence readable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overtake" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByText("Decision transcript", { exact: true }).click();
  const firstTranscriptRow = page.locator("#transcript li").first();
  await expect(firstTranscriptRow.locator("span")).toHaveCount(4);
  await expect(firstTranscriptRow.locator("span").last()).toBeVisible();
  await expect(firstTranscriptRow.locator("span").last()).toContainText("residual");

  const touchControls = page.locator(
    "#mute-adaptive, #solo-adaptive, #mute-baseline, #solo-baseline, #previous-decision, #next-decision",
  );
  await expect(touchControls).toHaveCount(6);
  for (let index = 0; index < (await touchControls.count()); index += 1) {
    const size = await touchControls.nth(index).evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }));
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }

  await page.locator("#transmission-index > summary").click();
  await expect(page.locator(".transmission-index-scroll")).toBeHidden();
  await expect(page.locator("#transmission-index-cards")).toBeVisible();
  await expect(page.locator(".transmission-card")).toHaveCount(6);
  await expect(page.locator(".transmission-card").first().locator("dt")).toHaveText([
    "Case",
    "Convergence",
    "Solver-path work",
    "Switches",
  ]);
  const facts = page.locator(".transmission-card").first().locator(".transmission-card-fact dd");
  await expect(facts).toHaveCount(4);
  for (let index = 0; index < (await facts.count()); index += 1) {
    expect((await facts.nth(index).innerText()).trim()).not.toBe("");
  }
  await expect(page.locator(".transmission-card").first()).toContainText("A");
  await expect(page.locator(".transmission-card").first()).toContainText("SBS");
});
