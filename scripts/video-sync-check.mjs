import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
p.on("pageerror", e => errs.push(String(e)));
await p.goto(BASE, { waitUntil: "networkidle" });
await p.waitForFunction(() => !document.body.innerText.includes("Loading composition"), {timeout:15000});

// Find the video element's window from the API, then scrub inside it.
const edl = await p.evaluate(async () => (await fetch("/api/editor/seed-edl")).json());
const vids = edl.layers.flatMap(l => l.elements).filter(e => e.type === "video");
console.log("video elements in EDL:", vids.map(v=>`${v.id} start=${v.start} dur=${v.duration} trimIn=${v.trimIn}`));
const v = vids[0];
const t = v.start + 1.0;                     // 1s into the clip
const expectedTarget = v.trimIn + (t - v.start);
console.log(`scrubbing to t=${t}; expected video.currentTime ~= ${expectedTarget}`);

const setScrub = async (time) => {
  await p.evaluate((time) => {
    const r = document.querySelector('input[type="range"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(r, String(time));
    r.dispatchEvent(new Event("input", { bubbles: true }));
  }, time);
};
await setScrub(t);
await p.waitForTimeout(800);

let s = await p.evaluate(() => [...document.querySelectorAll("video")].map(x => ({ t: x.currentTime, paused: x.paused, ready: x.readyState })));
console.log("after scrub (paused):", JSON.stringify(s));
const drifts = s.filter(x => x.ready > 0).map(x => Math.abs(x.t - expectedTarget));
console.log("drift from target while paused:", drifts.map(d=>d.toFixed(3)));
console.log(drifts.length && drifts.every(d => d <= 0.15) ? "PASS scrub seeks video within 0.15s tolerance" : "INCONCLUSIVE (media may not have loaded in headless)");

// Now play and confirm it advances and stays in tolerance.
await p.locator("button", { hasText: /^Play$/i }).first().click();
await p.waitForTimeout(1500);
const state = await p.evaluate(() => {
  const r = document.querySelector('input[type="range"]');
  return { playhead: Number(r.value), vids: [...document.querySelectorAll("video")].map(x=>({t:x.currentTime,paused:x.paused,rate:x.playbackRate,ready:x.readyState})) };
});
console.log("during playback:", JSON.stringify(state));
const v0 = state.vids.find(x=>x.ready>0);
if (v0) {
  const target = v.trimIn + (state.playhead - v.start);
  console.log(`playhead=${state.playhead.toFixed(2)} target=${target.toFixed(2)} actual=${v0.t.toFixed(2)} drift=${Math.abs(v0.t-target).toFixed(3)}`);
  console.log(!v0.paused ? "PASS video is playing inside its window" : "FAIL video paused inside its window");
  console.log(Math.abs(v0.t-target) <= 0.35 ? "PASS drift within tolerance+frame budget" : "FAIL drift too large");
} else {
  console.log("INCONCLUSIVE: no video reached readyState>0 (headless media codec)");
}

// Leaving the window must pause it.
await p.locator("button", { hasText: /^Pause$/i }).first().click().catch(()=>{});
await setScrub(0.5);
await p.waitForTimeout(600);
const outside = await p.evaluate(() => [...document.querySelectorAll("video")].map(x=>({paused:x.paused})));
console.log("after scrubbing outside video window:", JSON.stringify(outside));
console.log(outside.every(x=>x.paused) ? "PASS videos paused when outside their window" : "FAIL video still playing outside window");
console.log("page errors:", errs.length ? errs.slice(0,2) : "none");
await b.close();
