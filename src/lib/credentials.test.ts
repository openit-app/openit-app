// Tests for the credential-name validator (PIN-7009). This mirrors the
// Rust validator `^[A-Z_][A-Z0-9_]*$`; the two must stay in lockstep so
// the UI never lets through a name the backend will reject (and vice
// versa). Pure function, no Tauri mocking needed.

import { describe, expect, it } from "vitest";
import { CREDENTIAL_NAME_PATTERN, isValidCredentialName } from "./api";

describe("isValidCredentialName", () => {
  it("accepts env-var-style identifiers", () => {
    for (const ok of ["SALESFORCE_TOKEN", "_PRIVATE", "API_KEY_2", "X", "A1_B2"]) {
      expect(isValidCredentialName(ok), ok).toBe(true);
    }
  });

  it("rejects names that would be unsafe or surprising as env vars", () => {
    for (const bad of [
      "", // empty
      "lowercase", // lowercase
      "2LEADING_DIGIT", // leading digit
      "HAS-DASH",
      "HAS SPACE",
      "HAS.DOT",
      "lowerThenUpper",
      "TRAILING ", // trailing space
    ]) {
      expect(isValidCredentialName(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("exposes the same pattern it validates against", () => {
    expect(CREDENTIAL_NAME_PATTERN.test("OK_NAME")).toBe(true);
    expect(CREDENTIAL_NAME_PATTERN.test("bad name")).toBe(false);
  });
});
