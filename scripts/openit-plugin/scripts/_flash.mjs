import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function flash(message) {
  try {
    const dir = resolve(process.cwd(), ".openit");
    await mkdir(dir, { recursive: true });
    const body = JSON.stringify({ message, ts: Date.now() });
    await writeFile(resolve(dir, "flash.json"), body, "utf8");
  } catch {
  }
}
