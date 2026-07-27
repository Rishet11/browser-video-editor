/**
 * User-flow verification: drives the real UI in Chromium and checks the
 * end-user interaction flows (select, drag-move, trim, split, undo, edit
 * validation, autosave, persistence, concurrency, export, AI panels).
 *
 * MUTATES persisted state via autosave. Snapshots /api/editor/seed-edl at
 * start and restores it at the end regardless of outcome.
 *
 * Run against a dev server: node scripts/user-flow-check.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const COMPOSITION_ID = "seed-edl";
const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function skip(name, detail = "") {
  results.push({ name, pass: true, skip: true, detail });
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

/** Pointer-drag a clip: "move" drags its body, "edge" drags its right handle. */
async function dragClip(page, box, kind, dx) {
  if (!box) return;
  const x = kind === "move" ? box.x + box.width / 2 : box.x + box.width - 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

// --- snapshot for restore ---
const snapshotRes = await fetch(`${BASE}/api/editor/${COMPOSITION_ID}`);
const snapshot = await snapshotRes.json();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const putRequests = [];
page.on("request", (req) => {
  if (req.method() === "PUT" && req.url().includes(`/api/editor/${COMPOSITION_ID}`)) {
    putRequests.push(req.url());
  }
});

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  // 1. Composition loads, no offline banner.
  const loaded = await page
    .waitForFunction(() => !document.body.innerText.includes("Loading composition"), {
      timeout: 15000,
    })
    .then(() => true)
    .catch(() => false);
  check("composition loads (no 'Loading composition…')", loaded);
  const offlineBanner = await page.locator("text=Could not reach the database").count();
  check("no offline-fallback banner (DB reachable)", offlineBanner === 0);

  // 2. Clicking a stage element selects it.
  const stageEl = page.locator("#stage [data-element-id]").first();
  const stageElId = await stageEl.getAttribute("data-element-id");
  await stageEl.click({ force: true });
  await page.waitForFunction(
    (id) => document.body.innerText.includes(id),
    stageElId,
    { timeout: 3000 },
  ).catch(() => {});
  let propsText = await page.locator("text=No element selected").count();
  let idShown = (await bodyText(page)).includes(stageElId);
  check(
    "clicking a stage element selects it (properties panel shows its ID)",
    propsText === 0 && idShown,
    `id=${stageElId}`,
  );

  // 3. Clicking a timeline clip selects an element (Timeline clips carry no
  // data-* id, so we assert the properties panel populates, not a specific id).
  const firstClip = page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").first();
  await firstClip.click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(150);
  const propsIdAfterTimelineClick = await page.locator("text=No element selected").count();
  check(
    "clicking a timeline clip selects an element (properties panel populated)",
    propsIdAfterTimelineClick === 0,
  );

  // 4. Timeline drag-move.
  const startInputLoc = page.locator("label:has-text('Start') input");
  const durationInputLoc = page.locator("label:has-text('Duration') input");
  const startBefore = Number(await startInputLoc.inputValue());
  await dragClip(page, await firstClip.boundingBox(), "move", 40);
  const startAfter = Number(await startInputLoc.inputValue());
  const moveRejectedShown = (await bodyText(page)).includes("Move rejected");
  check(
    "timeline drag-move increases start, no rejection",
    startAfter > startBefore && !moveRejectedShown,
    `${startBefore} -> ${startAfter}`,
  );

  // 5. Move rejection: drag far past the right edge. Uses a DIFFERENT clip
  // than the one used for move/trim tests below, so that if this reveals a
  // real out-of-bounds bug (element ends up off-screen), it does not corrupt
  // the geometry those later tests depend on.
  const boundaryClip = page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").nth(1);
  await boundaryClip.click({ position: { x: 5, y: 5 } });
  const startInputBeforeReject = await startInputLoc.inputValue();
  await dragClip(page, await boundaryClip.boundingBox(), "move", 5000);
  const rejectMsg = await page.locator("text=Move rejected: out of bounds.").count();
  const startInputAfterReject = await startInputLoc.inputValue();
  check(
    "move far past right edge is rejected, start unchanged",
    rejectMsg > 0 && startInputAfterReject === startInputBeforeReject,
    `start ${startInputBeforeReject} -> ${startInputAfterReject}, rejectMsgSeen=${rejectMsg > 0}`,
  );
  // Undo whatever this drag did (accepted or not) so it can't affect later
  // checks or the final restore.
  await page.keyboard.press(`${MOD_KEY}+z`);
  await page.waitForTimeout(200);

  // 6. Trim: drag right-edge handle left, duration decreases.
  // Reselect firstClip: step 5 selected a different clip.
  await firstClip.click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(150);
  const durationBefore = Number(await durationInputLoc.inputValue());
  await dragClip(page, await firstClip.boundingBox(), "edge", -30);
  const durationAfter = Number(await durationInputLoc.inputValue());
  check(
    "trim right edge decreases duration",
    durationAfter < durationBefore,
    `${durationBefore} -> ${durationAfter}`,
  );

  // 7. Trim rejection: drag right edge far left past minimum.
  await dragClip(page, await firstClip.boundingBox(), "edge", -5000);
  const trimRejectMsg = (await bodyText(page)).includes("Trim rejected");
  check("trim far past minimum is rejected ('Trim rejected')", trimRejectMsg);

  // 8. Split: select clip, scrub playhead into middle, press "s".
  // Uses a clip untouched by the move/trim tests above (those left `firstClip`
  // trimmed down near MIN_DURATION, where a midpoint split would legitimately
  // be rejected for producing a too-short half).
  const splitClip = page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").nth(2);
  await splitClip.click({ position: { x: 5, y: 5 } });
  const clipCountBefore = await page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").count();
  const clipBox5 = await splitClip.boundingBox();
  const trackBox = await page
    .locator("div.relative")
    .filter({ has: page.locator("[class*='bg-blue-700']") })
    .first()
    .boundingBox();
  if (clipBox5 && trackBox) {
    const midX = clipBox5.x + clipBox5.width / 2;
    await page.mouse.click(midX, trackBox.y + 2);
  }
  await page.waitForTimeout(150);
  await page.keyboard.press("s");
  await page.waitForTimeout(300);
  const clipCountAfterSplit = await page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").count();
  check(
    "split increases clip count by 1",
    clipCountAfterSplit === clipCountBefore + 1,
    `${clipCountBefore} -> ${clipCountAfterSplit}`,
  );

  // 9. Split rejection with nothing selected. There is no deselect action in
  // this UI (no window.__store to reach into, either), so a reload is the
  // reliable way to get back to "nothing selected".
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading composition"), {
    timeout: 15000,
  });
  await page.keyboard.press("s");
  await page.waitForTimeout(300);
  const noSelMsg = (await bodyText(page)).includes("No element selected.");
  check("split with nothing selected shows 'No element selected.'", noSelMsg);

  // 10. Undo after split: re-select clip, split again, then undo.
  // Uses the last clip (also untouched by the earlier move/trim tests) so the
  // split is not rejected for producing a too-short half.
  const clip2 = page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").last();
  await clip2.click({ position: { x: 5, y: 5 } });
  const preUndoSplitCount = await page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").count();
  const clip2Box = await clip2.boundingBox();
  const track2Box = await page
    .locator("div.relative")
    .filter({ has: page.locator("[class*='bg-blue-700']") })
    .first()
    .boundingBox();
  if (clip2Box && track2Box) {
    await page.mouse.click(clip2Box.x + clip2Box.width / 2, track2Box.y + 2);
  }
  await page.waitForTimeout(150);
  await page.keyboard.press("s");
  await page.waitForTimeout(300);
  const postSplitCount = await page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").count();
  await page.keyboard.press(`${MOD_KEY}+z`);
  await page.waitForTimeout(300);
  const postUndoCount = await page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").count();
  check(
    "undo after split returns clip count to pre-split value",
    postSplitCount === preUndoSplitCount + 1 && postUndoCount === preUndoSplitCount,
    `pre=${preUndoSplitCount} split=${postSplitCount} postUndo=${postUndoCount}`,
  );

  // 11. Properties validation (closest honest variant): the Start field is a
  // native <input type="number">, so the browser itself blocks non-numeric
  // text like "abc" from ever reaching the DOM value (confirmed: .fill("abc")
  // is refused by Playwright/Chromium, and even a JS-forced "1e309" overflow
  // sanitizes to "" before it reaches React, so the app's "Invalid number"
  // branch is unreachable through real typing). The closest reachable
  // rejection path is a numeric-but-out-of-range value: a negative Start
  // fails `isValidStart` and the app reverts the field with an error.
  const startInputHandle = page.locator("label:has-text('Start') input");
  const startBeforeInvalid = await startInputHandle.inputValue();
  await startInputHandle.fill("-5");
  await startInputHandle.blur();
  await page.waitForTimeout(150);
  const invalidMsg = (await bodyText(page)).includes("Rejected: invalid start");
  const startAfterInvalid = await startInputHandle.inputValue();
  check(
    "properties validation (closest honest variant: negative Start rejected, reverts)",
    invalidMsg && startAfterInvalid === startBeforeInvalid,
  );

  // 12. Properties edit applies: shrink Duration, timeline width shrinks.
  const targetElementId = (await page.locator("div.text-sm.break-all").textContent())?.trim();
  const durationInputHandle = page.locator("label:has-text('Duration') input");
  const durBefore = Number(await durationInputHandle.inputValue());
  const widthBefore = (await clip2.boundingBox())?.width ?? 0;
  const smallerDur = Math.max(0.6, durBefore / 2);
  await durationInputHandle.fill(String(smallerDur));
  await durationInputHandle.blur();
  await page.waitForTimeout(300);
  const widthAfter = (await clip2.boundingBox())?.width ?? 0;
  check(
    "valid Duration edit shrinks rendered clip width",
    widthAfter < widthBefore,
    `${widthBefore.toFixed(1)}px -> ${widthAfter.toFixed(1)}px`,
  );

  // 13. Autosave: "saving…" then "saved" within ~5s, PUT observed.
  const putCountBefore = putRequests.length;
  const sawSaving = await page
    .waitForFunction(() => document.body.innerText.includes("saving…"), { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  const sawSaved = await page
    .waitForFunction(() => document.body.innerText.includes("saved") && !document.body.innerText.includes("save failed"), {
      timeout: 5000,
    })
    .then(() => true)
    .catch(() => false);
  check(
    "autosave shows 'saving…' then settles on 'saved', PUT observed",
    sawSaving && sawSaved && putRequests.length > putCountBefore,
    `saving=${sawSaving} saved=${sawSaved} puts=${putRequests.length - putCountBefore}`,
  );

  // 14. Persistence: reload the page (proves the load pipeline re-fetches from
  // the server), then confirm the edited value is what actually made it to
  // the DB by reading it back through the API for the specific element id
  // (position-based re-selection in the timeline is not reliable across a
  // reload once splits/trims have touched sibling elements' ordering).
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading composition"), {
    timeout: 15000,
  });
  const dbAfterReload = await fetch(`${BASE}/api/editor/${COMPOSITION_ID}`).then((r) => r.json());
  const persistedEl = dbAfterReload.layers
    .flatMap((l) => l.elements)
    .find((e) => e.id === targetElementId);
  const durAfterReload = persistedEl?.duration ?? NaN;
  check(
    "edited duration persists after reload (verified via API for the edited element id)",
    Math.abs(durAfterReload - smallerDur) < 0.05,
    `id=${targetElementId} expected≈${smallerDur.toFixed(2)} got=${durAfterReload}`,
  );

  // 15. Optimistic concurrency (concurrency): second tab edits after first tab saved.
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page2.goto(BASE, { waitUntil: "networkidle" });
  await page2.waitForFunction(() => !document.body.innerText.includes("Loading composition"), {
    timeout: 15000,
  });
  // page (tab 1) makes and saves an edit first.
  const clip1Tab1 = page.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").first();
  await clip1Tab1.click({ position: { x: 5, y: 5 } });
  const durInput1 = page.locator("label:has-text('Duration') input");
  const d1 = Number(await durInput1.inputValue());
  await durInput1.fill(String(Math.max(0.6, d1 - 0.1)));
  await durInput1.blur();
  await page
    .waitForFunction(() => document.body.innerText.includes("saved") && !document.body.innerText.includes("save failed"), {
      timeout: 6000,
    })
    .catch(() => {});
  await page.waitForTimeout(500);
  // page2 (tab 2, stale lastModified) now edits and saves.
  const clip1Tab2 = page2.locator(".border-t.border-neutral-700 [class*='bg-blue-700']").first();
  await clip1Tab2.click({ position: { x: 5, y: 5 } });
  const durInput2 = page2.locator("label:has-text('Duration') input");
  const d2 = Number(await durInput2.inputValue());
  await durInput2.fill(String(Math.max(0.6, d2 - 0.2)));
  await durInput2.blur();
  const sawConflict = await page2
    .waitForFunction(
      () => document.body.innerText.includes("Someone else changed this. Reload to get the latest."),
      { timeout: 6000 },
    )
    .then(() => true)
    .catch(() => false);
  check(
    "optimistic concurrency (concurrency): stale tab shows conflict message",
    sawConflict,
  );
  await page2.close();

  // 16. Space toggles play/pause when focused on page, not inside an input.
  // PlaybackControls always renders both a "Play" and a "Pause" button (their
  // labels never change), so play/pause state has no dedicated toggle-label
  // to read. The observable proxy is the playhead: while playing it advances
  // on its own via the rAF loop; while paused it does not. Read the range
  // input's value before/after a wait to detect that.
  async function playheadValue() {
    return Number(await page.locator('input[type="range"]').inputValue());
  }
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Home").catch(() => {});
  const phBeforeSpace = await playheadValue();
  await page.keyboard.press(" ");
  await page.waitForTimeout(600);
  const phAfterSpaceOnPage = await playheadValue();
  const advancedOnPage = phAfterSpaceOnPage > phBeforeSpace;
  // stop playback
  await page.keyboard.press(" ");
  await page.waitForTimeout(200);

  const startInputForSpace = page.locator("label:has-text('Start') input");
  await startInputForSpace.click();
  const phBeforeSpaceInInput = await playheadValue();
  await page.keyboard.press(" ");
  await page.waitForTimeout(600);
  const phAfterSpaceInInput = await playheadValue();
  const notAdvancedInInput = phAfterSpaceInInput === phBeforeSpaceInInput;
  await startInputForSpace.blur();
  check(
    "space toggles play/pause on page (playhead advances) but not inside a properties input",
    advancedOnPage && notAdvancedInInput,
    `page: ${phBeforeSpace}->${phAfterSpaceOnPage}, input: ${phBeforeSpaceInInput}->${phAfterSpaceInInput}`,
  );

  // 17. Export HTML.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.locator("button", { hasText: "Export HTML" }).click(),
  ]);
  const exportPath = await download.path();
  const exportContent = exportPath ? readFileSync(exportPath, "utf8") : "";
  check(
    "Export HTML downloads a valid file",
    exportContent.toLowerCase().startsWith("<!doctype html") && exportContent.length > 1000,
    `bytes=${exportContent.length}`,
  );

  // 18. AI Suggest timings (soft check).
  const suggestBtn = page.locator("button", { hasText: "Suggest timings" });
  await suggestBtn.click();
  await page
    .waitForFunction(() => !document.body.innerText.includes("thinking…"), { timeout: 20000 })
    .catch(() => {});
  const aiBody = await bodyText(page);
  if (aiBody.includes("AI suggestions are not configured.")) {
    skip("AI 'Suggest timings' — not configured (503 / not configured message)");
  } else {
    const rowCount = await page.locator("button", { hasText: "Apply" }).count();
    check("AI 'Suggest timings' renders suggestion rows", rowCount > 0, `${rowCount} rows`);
    if (rowCount > 0) {
      const patchStatus = page
        .waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/element/"), {
          timeout: 5000,
        })
        .then((r) => r.status())
        .catch(() => "no-response");
      await page.locator("button", { hasText: "Apply" }).first().click();
      const status = await patchStatus;
      await page.waitForTimeout(500);
      const applied = await page.locator("button", { hasText: "Applied" }).count();
      check(
        "Applying a suggestion sets its button label to 'Applied'",
        applied > 0,
        `PATCH status=${status}`,
      );
    }
  }

  // 19. No uncaught console errors.
  check(
    "no uncaught console errors across the run",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(" | "),
  );
  // Let any final in-flight autosave (800ms debounce + round trip) settle
  // before closing the browser, so the restore PUT below is not raced by a
  // still-pending save from the last edit made in this run.
  await page.waitForTimeout(1500).catch(() => {});
} finally {
  await browser.close();

  // Restore the original composition regardless of outcome. Note: the app's
  // autosave aborts the CLIENT-side fetch when superseded, but does not
  // cancel the server-side write already in flight (readJson/replaceComposition
  // keep running after the browser disconnects). A straggling save can in
  // rare cases land after this PUT and drift the DB again, so re-verify once
  // more after a short delay and re-apply the snapshot if that happened.
  async function restoreOnce() {
    const res = await fetch(`${BASE}/api/editor/${COMPOSITION_ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) return false;
    const verifyJson = await fetch(`${BASE}/api/editor/${COMPOSITION_ID}`).then((r) => r.json());
    return JSON.stringify(verifyJson.layers) === JSON.stringify(snapshot.layers);
  }
  let restored = await restoreOnce();
  if (restored) {
    await new Promise((r) => setTimeout(r, 1200));
    restored = await restoreOnce();
  }
  check("snapshot restored after run (PUT /api/editor/seed-edl)", restored);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
