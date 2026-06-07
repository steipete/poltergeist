import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import type { PoltergeistConfig } from "../src/types.js";
import { createMatcher } from "../src/utils/glob-matcher.js";
import { WatchmanConfigManager } from "../src/watchman-config.js";

// These tests exercise the REAL createExclusionExpressions conversion together with the
// REAL glob matcher, so that a generated exclusion is verified to actually exclude the
// files it claims to. createExclusionExpressions returns Watchman ["not", ["match",
// pattern, "wholename"]] expressions; we pull the pattern back out and check it against
// realistic relative paths with createMatcher.

const manager = new WatchmanConfigManager(process.cwd(), createLogger());

function exclusionPatterns(projectType: PoltergeistConfig["projectType"]): string[] {
  const config = {
    version: "1.0",
    projectType,
    targets: [],
    // aggressive keeps the full exclusion set so file-extension patterns are present
    performance: { profile: "aggressive" },
  } as unknown as PoltergeistConfig;

  return manager
    .createExclusionExpressions(config)
    .map((expression) => (expression[1] as string[])[1]);
}

function findPattern(patterns: string[], predicate: (p: string) => boolean): string | undefined {
  return patterns.find(predicate);
}

describe("WatchmanConfigManager.createExclusionExpressions", () => {
  it("excludes file-extension globs like *.log everywhere (not as a directory)", () => {
    const patterns = exclusionPatterns("node");

    const logPattern = findPattern(patterns, (p) => p === "**/*.log/**" || p === "**/*.log");
    expect(logPattern).toBeDefined();

    const matches = createMatcher(logPattern as string);

    // A *.log exclusion must actually match real log files at any depth.
    expect(matches("app.log")).toBe(true);
    expect(matches("logs/error.log")).toBe(true);
    expect(matches("a/b/c/x.log")).toBe(true);
  });

  it("excludes other file-extension globs (*.tmp, *.zip, *.swp) as files", () => {
    const patterns = exclusionPatterns("node");

    for (const ext of ["tmp", "zip", "swp"]) {
      const pattern = findPattern(patterns, (p) => p === `**/*.${ext}/**` || p === `**/*.${ext}`);
      expect(pattern, `expected a generated pattern for *.${ext}`).toBeDefined();

      const matches = createMatcher(pattern as string);
      expect(matches(`scratch.${ext}`), `*.${ext} should match scratch.${ext}`).toBe(true);
      expect(matches(`nested/dir/file.${ext}`), `*.${ext} should match nested file`).toBe(true);
    }
  });

  it("keeps bare directory exclusions (node_modules) matching their contents", () => {
    const patterns = exclusionPatterns("node");

    const nodeModules = findPattern(patterns, (p) => p === "**/node_modules/**");
    expect(nodeModules).toBeDefined();

    const matches = createMatcher(nodeModules as string);
    expect(matches("node_modules/foo/index.js")).toBe(true);
    expect(matches("packages/x/node_modules/bar.js")).toBe(true);
  });

  it("keeps bare directory exclusions (target) matching their contents", () => {
    const patterns = exclusionPatterns("rust");

    const target = findPattern(patterns, (p) => p === "**/target/**");
    expect(target).toBeDefined();

    const matches = createMatcher(target as string);
    expect(matches("target/debug/app")).toBe(true);
    expect(matches("crates/x/target/release/lib.rlib")).toBe(true);
  });

  it("keeps Swift bundle globs matching bundle contents", () => {
    const patterns = exclusionPatterns("swift");

    for (const ext of ["app", "framework", "dSYM"]) {
      const pattern = findPattern(patterns, (p) => p === `**/*.${ext}/**`);
      expect(pattern, `expected a directory pattern for *.${ext}`).toBeDefined();

      const matches = createMatcher(pattern as string);
      expect(matches(`Build/Debug/Foo.${ext}/Contents/Info.plist`)).toBe(true);
      expect(matches(`Products/Foo.${ext}/nested/file`)).toBe(true);
    }
  });

  it("keeps Python egg-info globs matching package metadata contents", () => {
    const patterns = exclusionPatterns("python");

    const eggInfo = findPattern(patterns, (p) => p === "**/*.egg-info/**");
    expect(eggInfo).toBeDefined();

    const matches = createMatcher(eggInfo as string);
    expect(matches("pkg.egg-info/PKG-INFO")).toBe(true);
    expect(matches("src/pkg.egg-info/SOURCES.txt")).toBe(true);
  });

  it("leaves directory globs with wildcards (cmake-build-*) as directory matches", () => {
    // cmake-build-* has a wildcard but is a directory pattern, so it must keep converting
    // to the directory glob form **/cmake-build-*/** and not be rewritten by the *.ext
    // file branch. The fix only touches patterns that begin with "*.".
    const directoryGlob = "**/cmake-build-*/**";
    const matches = createMatcher(directoryGlob);

    expect(matches("cmake-build-debug/main.o")).toBe(true);
    expect(matches("cmake-build-release/CMakeCache.txt")).toBe(true);

    // A bare file at the root is not a directory match: the glob needs a segment under it.
    expect(matches("cmake-build-notes.txt")).toBe(false);
  });
});
