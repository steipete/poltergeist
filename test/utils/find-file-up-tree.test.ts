import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync(candidate: Parameters<typeof actual.existsSync>[0]) {
      if (String(candidate) === "/poltergeist.config.json") {
        return true;
      }
      return actual.existsSync(candidate);
    },
  };
});

import { FileSystemUtils } from "../../src/utils/filesystem.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const probePath = fileURLToPath(new URL("./find-file-up-tree-probe.ts", import.meta.url));
const walkDeadlineMs = 3000;

const driveRootConfig = win32.resolve("C:\\", "poltergeist.config.json");
const projectConfig = win32.resolve("C:\\Users\\me\\proj", "poltergeist.config.json");
const shareConfig = win32.resolve("\\\\server\\share\\", "poltergeist.config.json");
const posixRootConfig = posix.resolve("/", "poltergeist.config.json");

type ProbeInput = {
  fileName: string;
  startDir: string;
  pathApi: "win32" | "posix";
  exists: string[];
};

type ProbeResult = {
  status: "done" | "timeout";
  code: number | null;
  stdout: string;
  stderr: string;
};

describe("findFileUpTree", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds a config in a parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "polter-up-"));
    roots.push(root);
    writeFileSync(join(root, "poltergeist.config.json"), "{}");
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });

    expect(FileSystemUtils.findFileUpTree("poltergeist.config.json", nested)).toBe(
      join(root, "poltergeist.config.json"),
    );
  });

  it("does not use a config at the POSIX root", () => {
    const root = mkdtempSync(join(tmpdir(), "polter-root-"));
    roots.push(root);
    const nested = join(root, "a");
    mkdirSync(nested, { recursive: true });

    expect(FileSystemUtils.findFileUpTree("poltergeist.config.json", nested)).toBeNull();
  });

  // A stuck dirname never returns, so Vitest's own timeout cannot fire.
  it.each([
    {
      name: "unc walk ignores a drive-root config",
      input: {
        fileName: "poltergeist.config.json",
        startDir: "\\\\server\\share\\nested",
        pathApi: "win32",
        exists: [driveRootConfig],
      },
      found: null,
    },
    {
      name: "unc walk still finds a config on the share",
      input: {
        fileName: "poltergeist.config.json",
        startDir: "\\\\server\\share\\nested",
        pathApi: "win32",
        exists: [shareConfig, driveRootConfig],
      },
      found: shareConfig,
    },
    {
      name: "extended drive walk ignores a drive-root config",
      input: {
        fileName: "poltergeist.config.json",
        startDir: "\\\\?\\C:\\Users\\me\\proj",
        pathApi: "win32",
        exists: [driveRootConfig],
      },
      found: null,
    },
    {
      name: "extended unc walk finishes when no config exists",
      input: {
        fileName: "poltergeist.config.json",
        startDir: "\\\\?\\UNC\\server\\share\\nested",
        pathApi: "win32",
        exists: [],
      },
      found: null,
    },
    {
      name: "drive walk finds a project config and skips the drive root",
      input: {
        fileName: "poltergeist.config.json",
        startDir: "C:\\Users\\me\\proj\\src",
        pathApi: "win32",
        exists: [projectConfig, driveRootConfig],
      },
      found: projectConfig,
    },
    {
      name: "posix walk ignores a root config",
      input: {
        fileName: "poltergeist.config.json",
        startDir: "/tmp/proj/nested",
        pathApi: "posix",
        exists: [posixRootConfig],
      },
      found: null,
    },
  ] satisfies Array<{ name: string; input: ProbeInput; found: string | null }>)(
    "$name",
    async ({ input, found }) => {
      const result = await runProbe(input);
      expect(result.status, result.stderr).toBe("done");
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ found });
    },
    20_000,
  );
});

function runProbe(input: ProbeInput): Promise<ProbeResult> {
  const child = spawn(process.execPath, ["--import", "tsx", probePath, JSON.stringify(input)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;

  return new Promise((resolve) => {
    const finish = (result: ProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ status: "timeout", code: null, stdout, stderr });
    }, walkDeadlineMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({ status: "done", code: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      finish({ status: "done", code, stdout, stderr });
    });
  });
}
