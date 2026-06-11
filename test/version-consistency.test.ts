import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { PACKAGE_INFO } from "../src/cli/version.js";

describe("release version metadata", () => {
  it("matches the published package version", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      name: string;
      version: string;
    };

    expect(PACKAGE_INFO).toEqual({
      name: packageJson.name,
      version: packageJson.version,
    });
  });
});
