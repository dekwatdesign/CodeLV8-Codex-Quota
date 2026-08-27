import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

const root = path.resolve("dist-renderer");

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function startStaticServer() {
  const server = createServer((request, response) => {
    const requested = decodeURIComponent((request.url || "/").split("?")[0]);
    const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("quota bars use the full available widget column", async (t) => {
  const server = await startStaticServer();
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const page = await browser.newPage({ viewport: { width: 456, height: 240 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    window.__dragCalls = [];
    window.__startupCalls = [];
    let startWithWindows = false;
    window.routerControl = {
      platform: "win32",
      getOverlaySettings: async () => ({ version: 1, enabled: true, expanded: false, startWithWindows }),
      showOverlay: async () => ({ version: 1, enabled: true, expanded: false, startWithWindows }),
      hideOverlay: async () => ({ version: 1, enabled: false, expanded: false, startWithWindows }),
      setOverlayEnabled: async (enabled) => ({ version: 1, enabled, expanded: false, startWithWindows }),
      setOverlayExpanded: async (expanded) => ({ version: 1, enabled: true, expanded, startWithWindows }),
      setStartWithWindows: async (enabled) => {
        startWithWindows = enabled;
        window.__startupCalls.push(enabled);
        return { version: 1, enabled: true, expanded: true, startWithWindows };
      },
      startOverlayDrag: async () => window.__dragCalls.push({ type: "start" }),
      moveOverlayBy: async (deltaX, deltaY) => window.__dragCalls.push({ type: "move", deltaX, deltaY }),
      endOverlayDrag: async () => window.__dragCalls.push({ type: "end" }),
      getHealth: async () => ({ ok: false, error: "Codex app-server unavailable", activity: { state: "offline", activeCount: 0, active: [] } }),
      getAccountUsage: async () => ({
        primary: { kind: "quota", usedPercent: 54, windowDurationMins: 10_080 },
        secondary: { kind: "quota", usedPercent: 12, windowDurationMins: 300 },
      }),
      getProviderUsage: async () => ({ providers: [] }),
      onOverlaySettings: () => () => {},
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
  await page.locator('[aria-label="Quota limits"]').waitFor();

  const measurements = await page.evaluate(() => {
    const quotas = document.querySelector(".overlay-quotas");
    const bars = [...document.querySelectorAll(".overlay-quota-bar")];
    return {
      title: document.querySelector(".overlay-brand")?.textContent?.trim(),
      quotaWidth: quotas?.getBoundingClientRect().width || 0,
      barWidths: bars.map((bar) => bar.getBoundingClientRect().width),
      labels: [...document.querySelectorAll(".overlay-quota-label")].map((row) => row.textContent?.trim()),
    };
  });

  assert.equal(measurements.title, "Codex Quota");
  assert.equal(await page.locator(".overlay-state").textContent(), "Codex offline");
  await page.locator('[aria-label="Codex Quota activity overlay"]').click();
  assert.equal(await page.locator(".overlay-details").count(), 0);
  assert.equal(await page.locator(".overlay-expand-button").getAttribute("aria-expanded"), "false");

  await page.locator(".overlay-expand-button").click();
  await page.locator(".overlay-details").waitFor();
  assert.equal(await page.locator(".overlay-expand-button").getAttribute("aria-expanded"), "true");
  const startupToggle = page.locator(".overlay-startup-toggle");
  assert.equal(await startupToggle.getAttribute("aria-pressed"), "false");
  await startupToggle.click();
  assert.equal(await startupToggle.getAttribute("aria-pressed"), "true");
  assert.deepEqual(await page.evaluate(() => window.__startupCalls), [true]);
  await page.locator(".overlay-summary").click();
  assert.equal(await page.locator(".overlay-expand-button").getAttribute("aria-expanded"), "true");

  await page.evaluate(() => { window.__dragCalls.length = 0; });
  await page.evaluate(() => {
    const target = document.querySelector(".overlay-metrics");
    if (!target) throw new Error("metrics drag target not found");
    const dispatch = (type, clientX, clientY) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX,
      clientY,
    }));
    dispatch("pointerdown", 300, 150);
    dispatch("pointermove", 320, 160);
    dispatch("pointermove", 340, 170);
    dispatch("pointerup", 340, 170);
  });
  await page.waitForTimeout(20);
  const dragCalls = await page.evaluate(() => window.__dragCalls);
  const dragMoves = dragCalls.filter((call) => call.type === "move");
  assert.equal(dragCalls[0]?.type, "start");
  assert.equal(dragCalls.at(-1)?.type, "end");
  assert.equal(dragMoves.reduce((total, call) => total + call.deltaX, 0), 40);
  assert.equal(dragMoves.reduce((total, call) => total + call.deltaY, 0), 20);

  const fontFamily = await page.locator(".overlay-card").evaluate((element) => getComputedStyle(element).fontFamily);
  assert.match(fontFamily, /LINE Seed Sans TH/);
  assert.equal(await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('12px "LINE Seed Sans TH"');
  }), true);

  assert.ok(measurements.quotaWidth > 300, `quota column too narrow: ${measurements.quotaWidth}`);
  assert.equal(measurements.barWidths.length, 2);
  for (const width of measurements.barWidths) assert.ok(Math.abs(width - measurements.quotaWidth) < 1, `${width} != ${measurements.quotaWidth}`);
  assert.deepEqual(measurements.labels, ["Weekly limit46%", "5-hour limit88%"]);

  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 240 });
    const responsive = await page.evaluate(() => {
      const quotas = document.querySelector(".overlay-quotas");
      const quotaWidth = quotas?.getBoundingClientRect().width || 0;
      const barWidths = [...document.querySelectorAll(".overlay-quota-bar")].map((bar) => bar.getBoundingClientRect().width);
      return { quotaWidth, barWidths, scrollWidth: document.documentElement.scrollWidth };
    });
    assert.ok(responsive.quotaWidth > 0, `quota column missing at ${width}px`);
    assert.ok(responsive.scrollWidth <= width, `horizontal overflow at ${width}px`);
    for (const barWidth of responsive.barWidths) assert.ok(Math.abs(barWidth - responsive.quotaWidth) < 1, `bar mismatch at ${width}px`);
  }
});
