#!/usr/bin/env node
// Regenerates the OpenIT app-icon set from the single HTML master in this
// folder. We render the 1024×1024 master once via headless Chrome, then use
// `sips` (macOS-native) to derive every size Tauri ships.
//
// Run from anywhere:
//   node src-tauri/icons/_generator/generate.mjs
//
// Produces:
//   src-tauri/icons/icon.png                  (1024×1024 master)
//   src-tauri/icons/128x128.png
//   src-tauri/icons/128x128@2x.png            (= 256)
//   src-tauri/icons/32x32.png
//   src-tauri/icons/Square{30,44,71,89,107,142,150,284,310}x{...}Logo.png
//   src-tauri/icons/StoreLogo.png             (= 50)
//   src-tauri/icons/icon.icns                 (if iconutil is available)
//   src-tauri/icons/icon.ico                  (skipped — needs separate tool)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, "..");
const masterHtml = path.join(__dirname, "icon.html");
const masterPng = path.join(iconsDir, "icon.png");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)),
    );
  });
}

function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates.find((p) => existsSync(p));
}

async function renderMaster() {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome not found");
  await run(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    "--window-size=1024,1024",
    `--screenshot=${masterPng}`,
    `file://${masterHtml}`,
  ]);
  console.log("✓ master  →", path.relative(process.cwd(), masterPng));
}

async function derive(size, outName = `${size}x${size}.png`) {
  const out = path.join(iconsDir, outName);
  await run("sips", ["-z", String(size), String(size), masterPng, "--out", out], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log("✓", outName);
}

async function generateIcns() {
  // macOS icns requires a .iconset folder with specific filenames.
  const tmp = mkdtempSync(path.join(tmpdir(), "openit-icns-"));
  const set = path.join(tmp, "icon.iconset");
  await run("mkdir", ["-p", set]);
  const sizes = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [sz, name] of sizes) {
    await run("sips", [
      "-z", String(sz), String(sz), masterPng, "--out", path.join(set, name),
    ], { stdio: ["ignore", "ignore", "inherit"] });
  }
  await run("iconutil", [
    "-c", "icns",
    "-o", path.join(iconsDir, "icon.icns"),
    set,
  ]);
  rmSync(tmp, { recursive: true, force: true });
  console.log("✓ icon.icns");
}

async function main() {
  await renderMaster();
  // Tauri / Windows / generic PNGs
  await derive(32);
  await derive(128);
  await derive(256, "128x128@2x.png");
  await derive(50, "StoreLogo.png");
  // Windows Store square logos
  for (const sz of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
    await derive(sz, `Square${sz}x${sz}Logo.png`);
  }
  // macOS .icns
  try {
    await generateIcns();
  } catch (e) {
    console.warn("skipped .icns (iconutil unavailable):", e.message);
  }
  console.log(
    "\nNote: icon.ico is not regenerated automatically. Use ImageMagick or\n" +
    "an online converter on icon.png if you need to refresh the Windows ICO.\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
