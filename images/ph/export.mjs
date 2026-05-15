#!/usr/bin/env node
// Renders the three Product Hunt HTML slides to PNG at exactly 1270x760.
// Usage:  cd images/ph && node export.mjs
//
// Requires Chrome/Chromium installed. Uses Puppeteer if available,
// otherwise falls back to invoking the system Chrome headless binary.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const slides = [
  ["01-hero.html", "01-hero.png"],
  ["02-self-learning.html", "02-self-learning.png"],
  ["03-open-source.html", "03-open-source.png"],
];

const WIDTH = 1270;
const HEIGHT = 760;

async function withPuppeteer() {
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 },
  });
  for (const [src, out] of slides) {
    const page = await browser.newPage();
    const url = "file://" + path.join(__dirname, src);
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.screenshot({
      path: path.join(__dirname, out),
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      omitBackground: false,
    });
    await page.close();
    console.log("wrote", out);
  }
  await browser.close();
}

function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Arc.app/Contents/MacOS/Arc",
  ];
  return candidates.find((p) => existsSync(p));
}

async function withChromeHeadless() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("Could not locate Chrome. Install puppeteer:  npm i -D puppeteer");
    process.exit(1);
  }
  for (const [src, out] of slides) {
    const url = "file://" + path.join(__dirname, src);
    const outPath = path.join(__dirname, out);
    await new Promise((resolve, reject) => {
      const proc = spawn(chrome, [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        `--window-size=${WIDTH},${HEIGHT}`,
        `--screenshot=${outPath}`,
        url,
      ]);
      proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("chrome exit " + code))));
    });
    console.log("wrote", out);
  }
}

try {
  await withPuppeteer();
} catch (e) {
  console.warn("Puppeteer unavailable, falling back to headless Chrome:", e.message);
  await withChromeHeadless();
}
