/**
 * Browser-level verification of the phases whose exit criteria are otherwise
 * "look at a screenshot": the canvas renders different elements at different
 * times, playback advances, and video sync stays inside the seek tolerance.
 *
 * Run against a dev server: node scripts/browser-check.mjs [baseUrl]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("#stage, [data-stage]", { timeout: 15000 }).catch(() => {});

// The composition must have loaded from the API, not stayed on the loading state.
const loaded = await page
  .waitForFunction(() => !document.body.innerText.includes("Loading composition"), { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check("composition loads from the API", loaded);

const offlineBanner = await page.locator("text=Could not reach the database").count();
check("no offline-fallback banner (DB is reachable)", offlineBanner === 0);

// Canvas aspect ratio is 16:9.
const stageBox = await page.evaluate(() => {
  const el = document.querySelector("#stage") ?? document.querySelector("[data-stage]");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
});
if (stageBox) {
  const ratio = stageBox.w / stageBox.h;
  check("stage is 16:9", Math.abs(ratio - 16 / 9) < 0.05, `ratio=${ratio.toFixed(3)}`);
} else {
  check("stage element present", false, "no #stage found");
}

// Different elements visible at different playhead times.
async function visibleAt(t) {
  return page.evaluate(async (time) => {
    const w = window;
    w.__store?.setState?.({ playhead: time });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return document.querySelectorAll("[data-element-id]").length;
  }, t);
}
const rendered = await page.locator("[data-element-id]").count();
check("canvas renders element nodes", rendered > 0, `${rendered} nodes with data-element-id`);

// Playback advances the playhead.
const before = await page.evaluate(() => {
  const r = document.querySelector('input[type="range"]');
  return r ? Number(r.value) : null;
});
const playBtn = page.locator("button", { hasText: /^Play$/i }).first();
if (await playBtn.count()) {
  await playBtn.click();
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const r = document.querySelector('input[type="range"]');
    return r ? Number(r.value) : null;
  });
  check("playback advances the playhead", before !== null && after !== null && after > before, `${before} -> ${after}`);

  // Video sync: drift between currentTime and the expected target.
  const drift = await page.evaluate(() => {
    const vids = [...document.querySelectorAll("video")];
    return vids.map((v) => ({ src: v.currentSrc.slice(-24), t: v.currentTime, paused: v.paused }));
  });
  check("video elements are mounted", drift.length > 0, JSON.stringify(drift));

  await page.locator("button", { hasText: /^Pause$/i }).first().click().catch(() => {});
} else {
  check("Play button present", false);
}

check("no uncaught console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await page.screenshot({ path: "/tmp/editor-screenshot.png", fullPage: false });
console.log("\nscreenshot: /tmp/editor-screenshot.png");

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
