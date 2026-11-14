import { existsSync, mkdtempSync, readFileSync, rmSync, WriteStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ExecutableBuilder } from "../src/builders/executable-builder.js";
import { createLogger } from "../src/logger.js";
import { StateManager } from "../src/state.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("stops shell descendants before settling a failed capture", async () => {
  const root = mkdtempSync(join(tmpdir(), "polter-log-tree-"));
  roots.push(root);
  const heartbeat = join(root, "heartbeat");
  const pidFile = join(root, "pid");
  writeFileSync(
    join(root, "child.cjs"),
    `
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    process.on('SIGTERM', () => {});
    setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, '.'), 20);
    console.log('trigger-log-failure');
  `,
  );
  writeFileSync(
    join(root, "parent.cjs"),
    `
    require('node:child_process').spawn(process.execPath, ['child.cjs'], { stdio: 'inherit' });
    setInterval(() => {}, 1000);
  `,
  );
  const originalWrite = WriteStream.prototype.write;
  vi.spyOn(WriteStream.prototype, "write").mockImplementation(function (
    this: WriteStream,
    ...args: Parameters<WriteStream["write"]>
  ) {
    if (String(args[0]).includes("trigger-log-failure")) throw new Error("synthetic disk failure");
    return originalWrite.apply(this, args);
  });
  const logger = createLogger("error");
  const state = new StateManager(root, logger);
  const builder = new ExecutableBuilder(
    {
      name: "tree",
      type: "executable",
      enabled: true,
      buildCommand: `"${process.execPath}" parent.cjs`,
      outputPath: "parent.cjs",
      watchPaths: [],
    },
    root,
    logger,
    state,
  );
  let deadline: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      builder.build([], { captureLogs: true, logFile: join(root, "build.log") }),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("build tree did not stop")), 4000);
      }),
    ]);
    expect(result.status).toBe("failure");
    expect(result.error).toContain("synthetic disk failure");
    expect(existsSync(pidFile)).toBe(true);
    const size = existsSync(heartbeat) ? readFileSync(heartbeat).length : 0;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(existsSync(heartbeat) ? readFileSync(heartbeat).length : 0).toBe(size);
  } finally {
    if (deadline) clearTimeout(deadline);
    if (existsSync(pidFile)) {
      try {
        process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
      } catch {}
    }
    builder.stop();
  }
}, 10000);
