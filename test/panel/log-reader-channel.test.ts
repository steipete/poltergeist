import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { LogTailReader } from "../../src/panel/log-reader.js";
import { FileSystemUtils } from "../../src/utils/filesystem.js";

it("reads a selected channel instead of an existing legacy build log", async () => {
  const root = await mkdtemp(join(tmpdir(), "polter-channel-"));
  vi.stubEnv("POLTERGEIST_STATE_DIR", root);
  try {
    await writeFile(join(root, "app.js.log"), "legacy build output\n");
    await writeFile(FileSystemUtils.getLogFilePath(root, "app", "test"), "test channel output\n");
    const reader = new LogTailReader(root, {
      config: {
        version: "1.0",
        projectType: "node",
        targets: [
          {
            name: "app",
            type: "executable",
            buildCommand: "echo build",
            outputPath: "app.js",
            watchPaths: ["src/**"],
            logChannels: ["test"],
          },
        ],
      },
    });
    expect(await reader.read("app", "build")).toEqual(["legacy build output"]);
    expect(await reader.read("app", "test")).toEqual(["test channel output"]);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { legacy: true, channel: "test", otherChannel: "build" },
  { legacy: false, channel: "test", otherChannel: "build" },
  { legacy: true, channel: "test-unit", otherChannel: "unit" },
  { legacy: false, channel: "test-unit", otherChannel: "unit" },
])(
  "skips another target's colliding $otherChannel log (legacy fallback: $legacy)",
  async ({ legacy, channel, otherChannel }) => {
    const root = await mkdtemp(join(tmpdir(), "polter-channel-collision-"));
    vi.stubEnv("POLTERGEIST_STATE_DIR", root);
    try {
      if (legacy) await writeFile(join(root, "app.js.log"), "app legacy output\n");
      await writeFile(join(root, ".poltergeist.log"), "global fallback\n");
      const otherBuild = FileSystemUtils.getLogFilePath(root, "app-test", otherChannel);
      expect(otherBuild).toBe(FileSystemUtils.getLogFilePath(root, "app", channel));
      await writeFile(otherBuild, "other target build output\n");
      const reader = new LogTailReader(root, {
        config: {
          version: "1.0",
          projectType: "node",
          targets: [
            {
              name: "app",
              type: "executable",
              buildCommand: "echo app",
              outputPath: "app.js",
              watchPaths: ["src/**"],
              logChannels: [channel],
            },
            {
              name: "app-test",
              type: "executable",
              buildCommand: "echo other",
              outputPath: "other.js",
              watchPaths: ["other/**"],
              logChannels: [otherChannel],
            },
          ],
        },
      });
      expect(await reader.read("app", channel)).toEqual([
        legacy ? "app legacy output" : "global fallback",
      ]);
      expect(await reader.read("app-test", otherChannel)).toEqual([
        otherChannel === "build" ? "other target build output" : "global fallback",
      ]);
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
);
