// ⟳ real da extensão com uma aba do LinkedIn aberta: o script antigo deve se desligar sem erros
import { chromium } from "playwright-core"; import fs from "fs"; import os from "os"; import path from "path"; import * as fx from "./fixtures.js";
const ext = path.resolve(new URL("../..", import.meta.url).pathname);
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "nexo-r-")), {
  executablePath: process.env.CHROME_PATH || chromium.executablePath(), headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"] });
await ctx.route("https://www.linkedin.com/**", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: fx.feed }));
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("https://www.linkedin.com/feed/");
await page.waitForSelector(".nexo-post-bar", { timeout: 5000 });
await sw.evaluate(() => chrome.runtime.reload()).catch(() => {});
await page.waitForTimeout(1500);
// mexe no DOM para acordar o observer órfão
await page.evaluate(() => { for (let i = 0; i < 5; i++) document.querySelector("main").append(document.createElement("div")); });
await page.waitForTimeout(1200);
const bars = await page.$$eval(".nexo-post-bar", (b) => b.length);
const ok = errors.length === 0 && bars === 0;
console.log(ok ? "ok  " : "FAIL", `⟳ com aba aberta: script antigo se desliga sem erro (erros=${errors.length}, barras=${bars})`);
errors.forEach((e) => console.log("   ", e));
await ctx.close();
process.exit(ok ? 0 : 1);
