/**
 * Tests for PI_BTW_SKILLS_ENABLED / PI_BTW_EXTENSIONS_INCLUDE env var logic.
 * Replicates the internal helpers from extensions/btw.ts to validate parsing
 * and pattern matching without needing to export them.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// --- replicated helpers (keep in sync with extensions/btw.ts) ---

type BtwResourceConfig = {
  skillsEnabled: boolean;
  extensionPatterns: string[] | null;
};

function parseBtwResourceConfig(): BtwResourceConfig {
  const raw = process.env["PI_BTW_SKILLS_ENABLED"]?.trim().toLowerCase();
  const skillsEnabled = raw === "true" || raw === "1";

  const extRaw = process.env["PI_BTW_EXTENSIONS_INCLUDE"]?.trim();
  const extensionPatterns =
    extRaw && extRaw.length > 0
      ? extRaw
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : null;

  return { skillsEnabled, extensionPatterns };
}

function extensionName(ext: { path: string; sourceInfo: { source: string } }): string[] {
  const pathParts = ext.path.split(/[\\/]+/).filter(Boolean);
  const base = pathParts.at(-1) ?? ext.path;
  const stem = base.replace(/\.[^.]+$/, "");
  const source = ext.sourceInfo.source;
  const withoutScheme = source.replace(/^(npm:|git:)/, "");
  const unscoped = withoutScheme.replace(/^@[^/]+\//, "");
  const repoName = withoutScheme.split("/").pop() ?? withoutScheme;
  return [...new Set([source, withoutScheme, unscoped, repoName, stem, ...pathParts, ext.path])];
}

function matchesGlob(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  const regexStr = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${regexStr}$`, "i").test(value);
}

function matchesAnyGlob(candidates: string[], patterns: string[]): boolean {
  return candidates.some((name) => patterns.some((pattern) => matchesGlob(name, pattern)));
}

// --- helpers for fake extensions ---

function fakeExt(source: string, path: string) {
  return { path, sourceInfo: { source } };
}

// --- tests ---

describe("parseBtwResourceConfig", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved["PI_BTW_SKILLS_ENABLED"] = process.env["PI_BTW_SKILLS_ENABLED"];
    saved["PI_BTW_EXTENSIONS_INCLUDE"] = process.env["PI_BTW_EXTENSIONS_INCLUDE"];
    delete process.env["PI_BTW_SKILLS_ENABLED"];
    delete process.env["PI_BTW_EXTENSIONS_INCLUDE"];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults to skills disabled and no extension patterns", () => {
    const config = parseBtwResourceConfig();
    expect(config.skillsEnabled).toBe(false);
    expect(config.extensionPatterns).toBeNull();
  });

  it("enables skills with PI_BTW_SKILLS_ENABLED=true", () => {
    process.env["PI_BTW_SKILLS_ENABLED"] = "true";
    expect(parseBtwResourceConfig().skillsEnabled).toBe(true);
  });

  it("enables skills with PI_BTW_SKILLS_ENABLED=1", () => {
    process.env["PI_BTW_SKILLS_ENABLED"] = "1";
    expect(parseBtwResourceConfig().skillsEnabled).toBe(true);
  });

  it("is case-insensitive for PI_BTW_SKILLS_ENABLED", () => {
    process.env["PI_BTW_SKILLS_ENABLED"] = "TRUE";
    expect(parseBtwResourceConfig().skillsEnabled).toBe(true);
  });

  it("parses a single extension name", () => {
    process.env["PI_BTW_EXTENSIONS_INCLUDE"] = "pi-claude-oauth-adapter";
    expect(parseBtwResourceConfig().extensionPatterns).toEqual(["pi-claude-oauth-adapter"]);
  });

  it("parses multiple extension names", () => {
    process.env["PI_BTW_EXTENSIONS_INCLUDE"] = "find-docs,shadcn-ui,pi-btw";
    expect(parseBtwResourceConfig().extensionPatterns).toEqual(["find-docs", "shadcn-ui", "pi-btw"]);
  });

  it("trims whitespace around names", () => {
    process.env["PI_BTW_EXTENSIONS_INCLUDE"] = " find-docs , shadcn-ui ";
    expect(parseBtwResourceConfig().extensionPatterns).toEqual(["find-docs", "shadcn-ui"]);
  });

  it("parses wildcard *", () => {
    process.env["PI_BTW_EXTENSIONS_INCLUDE"] = "*";
    expect(parseBtwResourceConfig().extensionPatterns).toEqual(["*"]);
  });
});

describe("matchesGlob", () => {
  it("* matches anything", () => {
    expect(matchesGlob("pi-claude-oauth-adapter", "*")).toBe(true);
    expect(matchesGlob("", "*")).toBe(true);
  });

  it("exact name matches", () => {
    expect(matchesGlob("pi-claude-oauth-adapter", "pi-claude-oauth-adapter")).toBe(true);
  });

  it("exact name does not match different value", () => {
    expect(matchesGlob("pi-btw", "pi-claude-oauth-adapter")).toBe(false);
  });

  it("prefix wildcard matches", () => {
    expect(matchesGlob("pi-claude-oauth-adapter", "pi-*")).toBe(true);
    expect(matchesGlob("find-docs", "pi-*")).toBe(false);
  });

  it("suffix wildcard matches", () => {
    expect(matchesGlob("pi-claude-oauth-adapter", "*-adapter")).toBe(true);
    expect(matchesGlob("pi-btw", "*-adapter")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesGlob("Pi-Claude-Oauth-Adapter", "pi-claude-oauth-adapter")).toBe(true);
  });
});

describe("extensionName candidates", () => {
  it("returns source variants, stem, path segments, and full path", () => {
    const ext = fakeExt(
      "npm:pi-claude-oauth-adapter",
      "/home/user/.pi/agent/extensions/pi-claude-oauth-adapter.ts",
    );
    const names = extensionName(ext);
    expect(names).toContain("npm:pi-claude-oauth-adapter");
    expect(names).toContain("pi-claude-oauth-adapter");
    expect(names).toContain("/home/user/.pi/agent/extensions/pi-claude-oauth-adapter.ts");
  });

  it("handles nested paths", () => {
    const ext = fakeExt("some-pkg", "/path/to/extensions/my-tool.js");
    const names = extensionName(ext);
    expect(names).toContain("some-pkg");
    expect(names).toContain("my-tool");
    expect(names).toContain("/path/to/extensions/my-tool.js");
  });
});

describe("user env var: PI_BTW_EXTENSIONS_INCLUDE=pi-claude-oauth-adapter", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved["PI_BTW_EXTENSIONS_INCLUDE"] = process.env["PI_BTW_EXTENSIONS_INCLUDE"];
    process.env["PI_BTW_EXTENSIONS_INCLUDE"] = "pi-claude-oauth-adapter";
  });

  afterEach(() => {
    const value = saved["PI_BTW_EXTENSIONS_INCLUDE"];
    if (value === undefined) delete process.env["PI_BTW_EXTENSIONS_INCLUDE"];
    else process.env["PI_BTW_EXTENSIONS_INCLUDE"] = value;
  });

  it("parses into a single pattern", () => {
    const config = parseBtwResourceConfig();
    expect(config.extensionPatterns).toEqual(["pi-claude-oauth-adapter"]);
  });

  it("matches an extension whose source equals the name", () => {
    const config = parseBtwResourceConfig();
    const ext = fakeExt("pi-claude-oauth-adapter", "/some/path/pi-claude-oauth-adapter.ts");
    expect(matchesAnyGlob(extensionName(ext), config.extensionPatterns!)).toBe(true);
  });

  it("matches an extension whose filename stem equals the name", () => {
    const config = parseBtwResourceConfig();
    const ext = fakeExt("@some/scope", "/path/to/pi-claude-oauth-adapter.js");
    expect(matchesAnyGlob(extensionName(ext), config.extensionPatterns!)).toBe(true);
  });

  it("matches an npm package extension before package sourceInfo is applied", () => {
    const config = parseBtwResourceConfig();
    const ext = fakeExt(
      "local",
      "/home/sil/.local/share/fnm/node-versions/v24.14.1/installation/lib/node_modules/pi-claude-oauth-adapter/extensions/index.ts",
    );
    expect(matchesAnyGlob(extensionName(ext), config.extensionPatterns!)).toBe(true);
  });

  it("does not match an unrelated extension", () => {
    const config = parseBtwResourceConfig();
    const ext = fakeExt("pi-btw", "/path/to/btw.ts");
    expect(matchesAnyGlob(extensionName(ext), config.extensionPatterns!)).toBe(false);
  });
});
