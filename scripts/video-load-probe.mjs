import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage();
const failed = [];
p.on("requestfailed", r => failed.push(`${r.url().slice(0,70)} :: ${r.failure()?.errorText}`));
await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForFunction(() => !document.body.innerText.includes("Loading composition"), {timeout:15000});
await p.waitForTimeout(4000);
const info = await p.evaluate(() => [...document.querySelectorAll("video")].map(v => ({
  src: v.getAttribute("src"), currentSrc: v.currentSrc, ready: v.readyState, net: v.networkState,
  err: v.error ? {code: v.error.code, msg: v.error.message} : null, muted: v.muted, preload: v.preload,
})));
console.log(JSON.stringify(info, null, 1));
console.log("failed requests:", failed.length ? failed : "none");
await b.close();
