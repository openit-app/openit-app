/**
 * Shape validation for the bundled seed data — no cloud required.
 *
 * Catches the class of bug BugBot found on commit 0ccc4228 (sample
 * `firstName` had a "Sample —" prefix that polluted the rendered name).
 * If a future seed edit puts the wrong content in the wrong field, this
 * test fires before integration runs.
 *
 * Ticket / conversation seeds were removed in PIN-6605 — only the
 * remaining personas (people, knowledge, access, assets) and
 * commands/scripts/reports surface as built-ins.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const PLUGIN_ROOT = path.resolve(__dirname, "../../scripts/openit-plugin");
const SEED_ROOT = path.join(PLUGIN_ROOT, "seed");
const SCHEMA_ROOT = path.join(PLUGIN_ROOT, "schemas");

type SchemaField = {
  id: string;
  label?: string;
  type: string;
  required?: boolean;
  values?: string[];
};

function loadSchema(name: string): { fields: SchemaField[] } {
  const raw = fs.readFileSync(path.join(SCHEMA_ROOT, `${name}._schema.json`), "utf-8");
  const parsed = JSON.parse(raw);
  return { fields: parsed.fields as SchemaField[] };
}

function loadSeedFiles(target: string): Array<{ filename: string; data: any }> {
  const dir = path.join(SEED_ROOT, target);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({
      filename: f,
      data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")),
    }));
}

function validateAgainstSchema(row: any, schema: { fields: SchemaField[] }): string[] {
  const errors: string[] = [];
  for (const field of schema.fields) {
    const v = row[field.id];
    const present = v !== undefined && v !== null;
    if (field.required && !present) {
      errors.push(`required field "${field.id}" missing`);
      continue;
    }
    if (!present) continue;
    // Type check (loose — covers the most common shapes).
    switch (field.type) {
      case "string":
      case "text":
      case "datetime":
        if (typeof v !== "string") errors.push(`field "${field.id}" expected string, got ${typeof v}`);
        break;
      case "number":
        if (typeof v !== "number") errors.push(`field "${field.id}" expected number, got ${typeof v}`);
        break;
      case "boolean":
        if (typeof v !== "boolean") errors.push(`field "${field.id}" expected boolean, got ${typeof v}`);
        break;
      case "string[]":
        if (!Array.isArray(v)) errors.push(`field "${field.id}" expected string[], got ${typeof v}`);
        else if (v.some((x) => typeof x !== "string"))
          errors.push(`field "${field.id}" string[] contains non-strings`);
        break;
      case "enum":
        if (typeof v !== "string") {
          errors.push(`field "${field.id}" expected enum string, got ${typeof v}`);
        } else if (Array.isArray(field.values) && !field.values.includes(v)) {
          errors.push(`field "${field.id}" enum value "${v}" not in ${field.values.join("|")}`);
        }
        break;
      // Other types (object, etc.) — skip strict check.
    }
  }
  return errors;
}

describe("Seed data — file counts", () => {
  it("ships exactly 5 sample people", () => {
    expect(loadSeedFiles("people").length).toBe(5);
  });
  it("ships exactly 2 sample KB articles", () => {
    const root = path.join(SEED_ROOT, "knowledge");
    const md = fs.readdirSync(root).filter((f) => f.endsWith(".md"));
    expect(md.length).toBe(2);
  });
  it("does NOT ship sample tickets or conversations (removed in PIN-6605)", () => {
    expect(fs.existsSync(path.join(SEED_ROOT, "tickets"))).toBe(false);
    expect(fs.existsSync(path.join(SEED_ROOT, "conversations"))).toBe(false);
  });
});

describe("Seed data — people validate against people._schema.json", () => {
  const schema = loadSchema("people");
  const seeds = loadSeedFiles("people");
  for (const { filename, data } of seeds) {
    it(`${filename} is schema-valid`, () => {
      const errors = validateAgainstSchema(data, schema);
      expect(errors).toEqual([]);
    });
    // Specific guard for the BugBot-flagged bug: firstName must not be
    // contaminated with the "Sample —" marker (that belongs in `notes`).
    it(`${filename} firstName is a clean given name (no "Sample —" prefix)`, () => {
      expect(typeof data.firstName).toBe("string");
      expect(data.firstName).not.toMatch(/^Sample/);
    });
  }
});

describe("Seed data — KB articles are non-empty markdown", () => {
  const root = path.join(SEED_ROOT, "knowledge");
  const articles = fs.readdirSync(root).filter((f) => f.endsWith(".md"));
  for (const article of articles) {
    it(`${article} is non-empty`, () => {
      const content = fs.readFileSync(path.join(root, article), "utf-8");
      expect(content.length).toBeGreaterThan(20);
    });
  }
});
