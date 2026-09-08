import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const skipLongRuns = process.env.CI === "true" || process.env.POLTERGEIST_COVERAGE_MODE === "true";

// Own the foreground process: the background launcher exits before the daemon does,
// and POLTERGEIST_TEST_MODE makes that launcher report success without starting one.
describe.skipIf(skipLongRuns)("Daemon with no enabled targets", () => {
  let testDir: string;
  let daemonProcess: ChildProcessWithoutNullStreams | undefined;
  let daemonOutput: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "poltergeist-no-targets-"));
    daemonOutput = "";
  });

  afterEach(async () => {
    const child = daemonProcess;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    daemonProcess = undefined;
    await rm(testDir, { recursive: true, force: true });
  });

  async function startDaemon() {
    const config = {
      version: "1.0",
      projectType: "node",
      notifications: { enabled: false },
      targets: [
        {
          name: "test",
          type: "executable",
          enabled: false,
          buildCommand: 'echo "hot-reload-proof" > test-output.txt',
          outputPath: "./test-output.txt",
          watchPaths: ["*.js"],
        },
      ],
    };
    const configPath = join(testDir, "poltergeist.config.json");
    await writeFile(configPath, JSON.stringify(config, null, 2));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      POLTERGEIST_STATE_DIR: join(testDir, "state"),
    };
    delete env.VITEST;
    delete env.POLTERGEIST_TEST_MODE;
    daemonProcess = spawn(
      process.execPath,
      [join(process.cwd(), "dist", "cli.js"), "start", "--foreground"],
      {
        cwd: testDir,
        env,
        stdio: "pipe",
      },
    );
    daemonProcess.stdout.on("data", (data: Buffer) => {
      daemonOutput += data.toString();
    });
    daemonProcess.stderr.on("data", (data: Buffer) => {
      daemonOutput += data.toString();
    });
    daemonProcess.on("error", (error: Error) => {
      daemonOutput += error.message;
    });

    await expect
      .poll(() => daemonOutput, { timeout: 10_000 })
      .toContain("is now watching for changes");
    expect(daemonProcess.exitCode).toBeNull();
    expect(daemonProcess.signalCode).toBeNull();
    return { config, configPath };
  }

  it("should keep daemon running with no enabled targets", async () => {
    await startDaemon();
    await expect
      .poll(() => readFile(join(testDir, ".poltergeist.log"), "utf8").catch(() => ""), {
        timeout: 5000,
      })
      .toContain("No enabled targets found. Daemon will continue running.");
    expect(daemonProcess?.exitCode).toBeNull();
    expect(daemonProcess?.signalCode).toBeNull();
  });

  it("should build a target enabled via hot reload", async () => {
    const { config, configPath } = await startDaemon();
    config.targets[0].enabled = true;
    await writeFile(configPath, JSON.stringify(config, null, 2));
    await expect
      .poll(() => daemonOutput, { timeout: 10_000 })
      .toContain("Watching 1 target(s): **/*.js");
    await writeFile(join(testDir, "trigger.js"), "// trigger the newly enabled target\n");

    await expect
      .poll(() => readFile(join(testDir, "test-output.txt"), "utf8").catch(() => ""), {
        timeout: 10_000,
      })
      .toContain("hot-reload-proof")
      .catch((error: unknown) => {
        throw new Error(`${String(error)}\nDaemon output:\n${daemonOutput}`);
      });
    expect(daemonProcess?.exitCode).toBeNull();
    expect(daemonProcess?.signalCode).toBeNull();
  });
});
