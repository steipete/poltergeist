import { beforeEach, expect, it, vi } from "vitest";
import { hasRunningGroupMember } from "../src/post-build/process-group.js";

const io = vi.hoisted(() => ({
  readdir: vi.fn<() => Promise<string[]>>(),
  readFile: vi.fn<(path: string) => Promise<string>>(),
}));
vi.mock("node:fs/promises", () => io);
beforeEach(() => vi.resetAllMocks());

it("does not count zombie-only groups as running", async () => {
  io.readdir.mockResolvedValue(["100", "101", "self"]);
  io.readFile.mockImplementation(async (path) =>
    String(path).includes("/100/")
      ? "100 (shell (test)) Z 1 100 100 0 0"
      : "101 (other) S 1 200 200 0 0",
  );
  expect(await hasRunningGroupMember(100)).toBe(false);
});

it("keeps waiting for a live descendant after its group leader exits", async () => {
  io.readdir.mockResolvedValue(["100", "101"]);
  io.readFile.mockImplementation(async (path) => {
    if (String(path).includes("/100/")) throw Object.assign(new Error("gone"), { code: "ENOENT" });
    return "101 (child) S 1 100 100 0 0";
  });
  expect(await hasRunningGroupMember(100)).toBe(true);
});

it("reports inspection failures instead of claiming the group has stopped", async () => {
  io.readdir.mockResolvedValue(["100"]);
  io.readFile.mockRejectedValue(Object.assign(new Error("denied"), { code: "EIO" }));
  await expect(hasRunningGroupMember(100)).rejects.toThrow("denied");
});

it("ignores inaccessible unrelated processes without losing live group members", async () => {
  io.readdir.mockResolvedValue(["99", "101"]);
  io.readFile.mockImplementation(async (path) => {
    if (path.includes("/99/")) throw Object.assign(new Error("hidden"), { code: "EACCES" });
    return "101 (child) S 1 100 100 0 0";
  });
  expect(await hasRunningGroupMember(100)).toBe(true);
});
