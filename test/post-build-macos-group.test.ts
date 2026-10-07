import { beforeEach, expect, it, vi } from "vitest";
import { hasMacOSGroupMember } from "../src/post-build/process-group.js";

const processList = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: processList }));
beforeEach(() => vi.resetAllMocks());

it("recognizes an empty group during Darwin process reaping", async () => {
  processList.mockImplementation((_cmd, _args, _opts, callback) =>
    callback(Object.assign(new Error("empty"), { code: 1 }), "", ""),
  );
  expect(await hasMacOSGroupMember(100)).toBe(false);
});

it("does not mistake a live descendant for an empty group", async () => {
  processList.mockImplementation((_cmd, _args, _opts, callback) => callback(null, "Z\nS\n", ""));
  expect(await hasMacOSGroupMember(100)).toBe(true);
});

it("preserves process inspection errors", async () => {
  processList.mockImplementation((_cmd, _args, _opts, callback) =>
    callback(new Error("denied"), "", "permission denied"),
  );
  await expect(hasMacOSGroupMember(100)).rejects.toThrow("denied");
});
