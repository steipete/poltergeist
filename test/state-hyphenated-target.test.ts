// Regression tests for reading state files whose target name contains a hyphen.

import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../src/logger.js";
import { Poltergeist } from "../src/poltergeist.js";
import { type PoltergeistState, StateManager } from "../src/state.js";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

const PROJECT_ROOT = "/test/myapp";

function stateFor(target: string): PoltergeistState {
  return {
    version: "1.0",
    projectPath: PROJECT_ROOT,
    projectName: "myapp",
    target,
    targetType: "app-bundle",
    configPath: join(PROJECT_ROOT, "poltergeist.config.json"),
    process: {
      pid: process.pid,
      hostname: "localhost",
      isActive: true,
      startTime: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    },
  } as PoltergeistState;
}

describe.skipIf(process.platform === "win32")("state files with hyphenated targets", () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = join(tmpdir(), `poltergeist-hyphen-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.POLTERGEIST_STATE_DIR = testDir;
  });

  afterEach(() => {
    delete process.env.POLTERGEIST_STATE_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("keys discoverStates by the full target name", async () => {
    const stateManager = new StateManager(PROJECT_ROOT, mockLogger);
    // Names are {projectName}-{pathHash}-{targetName}.state, so splitting on
    // "-" and taking the last segment truncates "app-bundle" to "bundle".
    writeFileSync(
      join(testDir, "myapp-aafbde62-app-bundle.state"),
      JSON.stringify(stateFor("app-bundle")),
    );

    const states = await stateManager.discoverStates();

    expect(Object.keys(states)).toEqual(["app-bundle"]);
    expect(states["app-bundle"]?.target).toBe("app-bundle");
  });

  it("does not collide when two targets share a last hyphen segment", async () => {
    const stateManager = new StateManager(PROJECT_ROOT, mockLogger);
    writeFileSync(
      join(testDir, "myapp-aafbde62-app-bundle.state"),
      JSON.stringify(stateFor("app-bundle")),
    );
    writeFileSync(
      join(testDir, "myapp-aafbde62-test-bundle.state"),
      JSON.stringify(stateFor("test-bundle")),
    );

    const states = await stateManager.discoverStates();

    expect(Object.keys(states).sort()).toEqual(["app-bundle", "test-bundle"]);
  });

  it("returns valid states and skips corrupted state files", async () => {
    writeFileSync(
      join(testDir, "myapp-aafbde62-app-bundle.state"),
      JSON.stringify(stateFor("app-bundle")),
    );
    writeFileSync(join(testDir, "myapp-aafbde62-corrupted.state"), "null");

    const states = await Poltergeist.listAllStates();

    expect(states.map((s) => s.target)).toEqual(["app-bundle"]);
  });
});
