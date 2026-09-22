import { ChildProcess, spawn } from "child_process";
import { PassThrough } from "stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostBuildRunner } from "../src/post-build/post-build-runner.js";
import type { PostBuildCommandConfig } from "../src/types.js";
import { createMockLogger, createMockStateManager } from "./helpers.js";

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: vi.fn() };
});

function childProcess() {
  const child = new ChildProcess();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  return child;
}

function createRunner(hooks: PostBuildCommandConfig[]) {
  const stateManager = {
    ...createMockStateManager(),
    updatePostBuildResult: vi.fn().mockResolvedValue(undefined),
  };
  const logger = createMockLogger();
  return {
    runner: new PostBuildRunner({
      targetName: "app",
      hooks,
      projectRoot: "/project",
      stateManager,
      logger,
    }),
    stateManager,
    logger,
  };
}

describe("PostBuildRunner process errors", () => {
  beforeEach(() => vi.resetAllMocks());

  it("records a failed launch and continues to the next hook", async () => {
    const failed = childProcess();
    const next = childProcess();
    vi.mocked(spawn).mockReturnValueOnce(failed).mockReturnValueOnce(next);
    const { runner, stateManager } = createRunner([
      { name: "missing-cwd", command: "echo ok", cwd: "/does-not-exist" },
      { name: "next", command: "echo next" },
    ]);
    runner.onBuildResult("success");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

    expect(() => failed.emit("error", new Error("spawn /bin/sh ENOENT"))).not.toThrow();
    failed.emit("close", -2, null);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    expect(stateManager.updatePostBuildResult).toHaveBeenCalledWith(
      "app",
      "missing-cwd",
      expect.objectContaining({
        status: "failure",
        formatterError: "spawn /bin/sh ENOENT",
        exitCode: -1,
      }),
    );
    next.emit("close", 0, null);
    await vi.waitFor(() =>
      expect(stateManager.updatePostBuildResult).toHaveBeenLastCalledWith(
        "app",
        "next",
        expect.objectContaining({ status: "success" }),
      ),
    );
  });

  it("keeps the hook output when its formatter cannot start", async () => {
    const command = childProcess();
    const formatter = childProcess();
    vi.mocked(spawn).mockReturnValueOnce(command).mockReturnValueOnce(formatter);
    const { runner, stateManager, logger } = createRunner([
      { name: "check", command: "echo raw output", formatter: "format-output" },
    ]);
    runner.onBuildResult("success");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    command.stdout?.emit("data", Buffer.from("raw output\n"));
    command.emit("close", 0, null);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));

    expect(() => formatter.emit("error", new Error("spawn E2BIG"))).not.toThrow();
    formatter.emit("close", -2, null);
    await vi.waitFor(() =>
      expect(stateManager.updatePostBuildResult).toHaveBeenLastCalledWith(
        "app",
        "check",
        expect.objectContaining({ status: "success", lines: ["raw output"] }),
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("spawn E2BIG"));
  });

  it("accepts formatter output even if the formatter closes its input early", async () => {
    const command = childProcess();
    const formatter = childProcess();
    vi.mocked(spawn).mockReturnValueOnce(command).mockReturnValueOnce(formatter);
    const { runner, stateManager, logger } = createRunner([
      { name: "check", command: "echo output", formatter: "format-output" },
    ]);
    runner.onBuildResult("success");
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    command.stdout?.emit("data", Buffer.from("output\n"));
    command.emit("close", 0, null);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));

    expect(() => formatter.stdin?.emit("error", new Error("write EPIPE"))).not.toThrow();
    formatter.stdout?.emit("data", Buffer.from('{"summary":"formatted","lines":["done"]}'));
    formatter.emit("close", 0, null);
    await vi.waitFor(() =>
      expect(stateManager.updatePostBuildResult).toHaveBeenLastCalledWith(
        "app",
        "check",
        expect.objectContaining({ status: "success", summary: "formatted", lines: ["done"] }),
      ),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("write EPIPE"));
  });
});
