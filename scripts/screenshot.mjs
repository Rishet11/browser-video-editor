import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
await p.goto("http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForFunction(() => !document.body.innerText.includes("Loading composition"), {timeout:20000});
const setScrub = async (t) => p.evaluate((t) => {
  const r = document.querySelector('input[type="range"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(r,String(t));
  r.dispatchEvent(new Event("input",{bubbles:true}));
}, t);
await setScrub(2); await p.waitForTimeout(1200);
await p.screenshot({ path: "/tmp/shot-t2.png" });
await setScrub(9); await p.waitForTimeout(2000);
await p.screenshot({ path: "/tmp/shot-t9.png" });
console.log("saved /tmp/shot-t2.png and /tmp/shot-t9.png");
await b.close();
