// Tests for the credential-name validator (PIN-7009). This mirrors the
// Rust validator `^[A-Z_][A-Z0-9_]*$`; the two must stay in lockstep so
// the UI never lets through a name the backend will reject (and vice
// versa). Pure function, no Tauri mocking needed.

import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_NAME_PATTERN,
  isReservedCredentialName,
  isValidCredentialName,
  RESERVED_CREDENTIAL_NAMES,
} from "./api";

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

  it("rejects reserved env-var names that would hijack the spawned env", () => {
    for (const reserved of [
      "PATH",
      "HOME",
      "PWD",
      "TMPDIR",
      "SHELL",
      "USER",
      "NODE_OPTIONS",
      "PYTHONPATH",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "SYSTEMROOT",
      "WINDIR",
      "COMSPEC",
      "USERPROFILE",
      "PATHEXT",
      "IFS",
    ]) {
      expect(isValidCredentialName(reserved), reserved).toBe(false);
      expect(isReservedCredentialName(reserved), reserved).toBe(true);
    }
  });

  it("still accepts normal names that merely resemble reserved ones", () => {
    for (const ok of ["SALESFORCE_TOKEN", "MY_API_KEY", "GITHUB_PAT", "PATH_TOKEN"]) {
      expect(isValidCredentialName(ok), ok).toBe(true);
      expect(isReservedCredentialName(ok), ok).toBe(false);
    }
  });

  it("treats the reserved check as case-insensitive", () => {
    expect(isReservedCredentialName("path")).toBe(true);
    expect(isReservedCredentialName("Node_Options")).toBe(true);
    expect(RESERVED_CREDENTIAL_NAMES).toContain("PATH");
  });

  it("exposes the same pattern it validates against", () => {
    expect(CREDENTIAL_NAME_PATTERN.test("OK_NAME")).toBe(true);
    expect(CREDENTIAL_NAME_PATTERN.test("bad name")).toBe(false);
  });
});
