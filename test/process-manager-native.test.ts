import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessManager } from "../src/utils/process-manager.js";

describe("native managed child termination", () => {
  const children: ChildProcess[] = [];
  const manager = new ProcessManager(() => {}, { shutdownTimeout: 100 });

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }
    await manager.cleanupAllProcesses();
  });

  async function start(handler: string) {
    const managed = await manager.spawnManagedProcess("owned-native", process.execPath, [
      "-e",
      `${handler}; setInterval(() => {}, 1000); console.log('READY')`,
    ]);
    children.push(managed.process);
    await once(managed.process.stdout!, "data");
    return managed.process;
  }

  it.skipIf(process.platform === "win32")(
    "kills a child that ignores SIGTERM before resolving",
    async () => {
      const child = await start("process.on('SIGTERM', () => {})");
      await manager.terminateProcess(child, 100);
      expect(child.signalCode).toBe("SIGKILL");
      expect(child.exitCode).toBeNull();
    },
  );

  it.skipIf(process.platform === "win32")(
    "still terminates an already-signaled live child",
    async () => {
      const child = await start("process.on('SIGTERM', () => {})");
      child.kill("SIGTERM");
      expect(child.killed).toBe(true);
      expect(child.signalCode).toBeNull();
      await manager.terminateProcess(child, 100);
      expect(child.signalCode).toBe("SIGKILL");
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps cooperative exit graceful and accepts an already-exited child",
    async () => {
      const child = await start("process.on('SIGTERM', () => process.exit(0))");
      await manager.terminateProcess(child, 100);
      expect(child.exitCode).toBe(0);
      expect(child.signalCode).toBeNull();
      await manager.terminateProcess(child, 100);
      expect(child.exitCode).toBe(0);
    },
  );
});
