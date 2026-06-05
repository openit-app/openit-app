import { describe, it, expect } from "vitest";
import { resolveVaultPath } from "./vaultPath";

describe("resolveVaultPath", () => {
  it("returns undefined for empty / blank / nullish input (Rust default)", () => {
    expect(resolveVaultPath("")).toBeUndefined();
    expect(resolveVaultPath("   ")).toBeUndefined();
    expect(resolveVaultPath(null)).toBeUndefined();
    expect(resolveVaultPath(undefined)).toBeUndefined();
  });

  describe("Unix / macOS paths", () => {
    it("appends OpenIT to a plain parent folder", () => {
      expect(resolveVaultPath("/Users/me/Google Drive")).toBe(
        "/Users/me/Google Drive/OpenIT",
      );
    });

    it("does not double-append when the folder already ends with OpenIT", () => {
      expect(resolveVaultPath("/Users/me/Google Drive/OpenIT")).toBe(
        "/Users/me/Google Drive/OpenIT",
      );
    });

    it("matches OpenIT case-insensitively", () => {
      expect(resolveVaultPath("/Users/me/openit")).toBe("/Users/me/openit");
    });

    it("strips a trailing slash before appending", () => {
      expect(resolveVaultPath("/Users/me/Dropbox/")).toBe(
        "/Users/me/Dropbox/OpenIT",
      );
    });

    it("strips a trailing slash on an existing vault without appending", () => {
      expect(resolveVaultPath("/Users/me/Dropbox/OpenIT/")).toBe(
        "/Users/me/Dropbox/OpenIT",
      );
    });
  });

  describe("Windows paths", () => {
    it("appends OpenIT using a backslash separator", () => {
      expect(resolveVaultPath("C:\\Users\\me\\Google Drive")).toBe(
        "C:\\Users\\me\\Google Drive\\OpenIT",
      );
    });

    it("does not double-append when the folder already ends with OpenIT", () => {
      expect(resolveVaultPath("C:\\Users\\me\\Dropbox\\OpenIT")).toBe(
        "C:\\Users\\me\\Dropbox\\OpenIT",
      );
    });

    it("matches OpenIT case-insensitively on Windows", () => {
      expect(resolveVaultPath("C:\\Users\\me\\OPENIT")).toBe(
        "C:\\Users\\me\\OPENIT",
      );
    });

    it("strips a trailing backslash before appending", () => {
      expect(resolveVaultPath("C:\\Users\\me\\Dropbox\\")).toBe(
        "C:\\Users\\me\\Dropbox\\OpenIT",
      );
    });
  });
});
