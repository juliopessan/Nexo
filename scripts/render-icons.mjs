// Gera icons/*.png a partir de icons/icon.svg e icons/icon-16.svg: node scripts/render-icons.mjs
import { chromium } from "../tests/browser/node_modules/playwright-core/index.mjs";
import fs from "fs";
const dir = new URL("../icons/", import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath() });
const p = await b.newPage();
for (const [size, src] of [[128, "icon.svg"], [48, "icon.svg"], [32, "icon.svg"], [16, "icon-16.svg"]]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${fs.readFileSync(dir + src).toString("base64")}" width="${size}" height="${size}">`);
  await p.screenshot({ path: `${dir}${size}.png`, omitBackground: true });
}
// prévia lado a lado em fundo claro e escuro
await p.setViewportSize({ width: 560, height: 200 });
const img = (s, f) => `<img width="${s}" height="${s}" src="data:image/svg+xml;base64,${fs.readFileSync(dir + f).toString("base64")}">`;
await p.setContent(`<body style="margin:0;display:flex">${["#ffffff", "#1f2937"].map((bg) => `<div style="background:${bg};width:280px;height:200px;display:flex;gap:18px;align-items:center;justify-content:center">${img(128, "icon.svg")}${img(48, "icon.svg")}${img(16, "icon-16.svg")}</div>`).join("")}</body>`);
await p.screenshot({ path: dir + "preview.png" });
await b.close();
