import { mkdtempSync, rmSync, statSync, unwatchFile, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { displayLogs, followLogs, parseLogLine, readLogEntries } from "../../src/cli/logging.js";

const createTempLogFile = (content: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "poltergeist-log-"));
  const file = path.join(dir, "build.log");
  writeFileSync(file, content, "utf-8");
  return file;
};

const cleanup = (filePath: string) => {
  const dir = path.dirname(filePath);
  rmSync(dir, { recursive: true, force: true });
};

const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

afterEach(() => {
  logSpy.mockClear();
  errorSpy.mockClear();
});

describe("readLogEntries", () => {
  it("parses plain text log lines", async () => {
    const file = createTempLogFile(
      [
        "2024-01-01T00:00:00.000Z INFO : [demo] Build started",
        "2024-01-01T00:00:01.000Z DEBUG: [demo] Compiling",
      ].join("\n"),
    );

    const entries = await readLogEntries(file, "demo");
    cleanup(file);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: "info",
      target: "demo",
      message: "Build started",
    });
  });

  it("parses plain text and JSON via parseLogLine helper", () => {
    const plain = parseLogLine("2024-01-01T00:00:00Z INFO : [demo] Build started", "demo").entry;
    expect(plain).toMatchObject({
      level: "info",
      message: "Build started",
      target: "demo",
    });

    const json = parseLogLine(
      '{"timestamp":"t","level":"error","message":"nope","target":"demo"}',
      "demo",
    ).entry;
    expect(json).toMatchObject({ level: "error", message: "nope", target: "demo" });
  });

  it("supports legacy JSON lines and respects maxLines", async () => {
    const jsonLine = JSON.stringify({
      timestamp: "2024-01-01T00:00:02.000Z",
      level: "error",
      message: "Failed",
      target: "demo",
    });
    const file = createTempLogFile(
      [
        "2024-01-01T00:00:00.000Z INFO : [demo] Build started",
        jsonLine,
        "2024-01-01T00:00:03.000Z INFO : [demo] Retrying",
      ].join("\n"),
    );

    const entries = await readLogEntries(file, "demo", 2);
    cleanup(file);

    expect(entries).toHaveLength(2);
    // The last two lines should be returned when maxLines is 2
    expect(entries[0].message).toBe("Failed");
    expect(entries[1].message).toBe("Retrying");
  });

  it("keeps raw build output that is not a daemon line", async () => {
    const file = createTempLogFile(
      [
        "src/main.go:10: undefined: foo",
        "2024-01-01T00:00:00.000Z INFO : [demo] Build failed",
      ].join("\n"),
    );
    const entries = await readLogEntries(file, "demo");
    cleanup(file);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: "build",
      message: "src/main.go:10: undefined: foo",
      target: "demo",
    });
    expect(entries[1].message).toBe("Build failed");
  });
});

describe("displayLogs", () => {
  it.each([
    '{"reason":"compile failed"}',
    '{"timestamp":123,"level":"error","message":"failed"}',
    '{"timestamp":"now","level":5,"message":"failed"}',
    '{"timestamp":"now","level":"error","message":{}}',
    '{"timestamp":"now","level":"error","message":"failed","target":42}',
    '{"unfinished":',
  ])("displays compiler JSON as raw output: %s", async (line) => {
    const file = createTempLogFile(line);
    try {
      await displayLogs(file, { target: "demo", lines: "10" });
      expect(logSpy.mock.calls.map((call) => call[0]).join("\n")).toContain(line);
    } finally {
      cleanup(file);
    }
  });

  it("prints JSON array when json flag is set", async () => {
    const file = createTempLogFile("2024-01-01T00:00:00Z INFO : [demo] Build started");

    await displayLogs(file, { target: "demo", lines: "10", json: true });
    cleanup(file);

    expect(logSpy).toHaveBeenCalled();
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload[0]).toMatchObject({ target: "demo", message: "Build started" });
  });

  it("warns when no logs are found", async () => {
    const file = createTempLogFile("");
    await displayLogs(file, { target: "demo", lines: "10" });
    cleanup(file);

    const combined = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(combined).toContain("No logs found");
  });
});

const loggedText = (): string => logSpy.mock.calls.map((call) => call.join(" ")).join("\n");

const waitForLoggedText = async (needle: string, timeoutMs: number): Promise<boolean> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (loggedText().includes(needle)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return loggedText().includes(needle);
};

describe("followLogs", () => {
  it("emits the new text when the followed log shrinks", async () => {
    const file = createTempLogFile("a".repeat(100));
    const offset = statSync(file).size;
    expect(offset).toBe(100);

    try {
      void followLogs(file);
      const sawOriginal = await waitForLoggedText("a".repeat(100), 2000);
      expect(sawOriginal).toBe(true);

      writeFileSync(file, "hello-from-new-build");
      const sawRewrite = await waitForLoggedText("hello-from-new-build", 4000);
      expect(sawRewrite).toBe(true);
    } finally {
      unwatchFile(file);
      cleanup(file);
    }
  });

  it("emits the new tail when a longer replacement reuses the same inode", async () => {
    const file = createTempLogFile("a".repeat(100));
    const offset = statSync(file).size;
    const previousIno = statSync(file).ino;
    expect(offset).toBe(100);

    try {
      void followLogs(file);
      expect(await waitForLoggedText("a".repeat(100), 2000)).toBe(true);

      rmSync(file);
      writeFileSync(file, `hello-from-new-build\n${"b".repeat(200)}\ntail-marker`);
      expect(statSync(file).size).toBeGreaterThan(offset);
      expect(await waitForLoggedText("tail-marker", 4000)).toBe(true);
      if (statSync(file).ino !== previousIno) {
        expect(loggedText()).toContain("hello-from-new-build");
      }
    } finally {
      unwatchFile(file);
      cleanup(file);
    }
  });

  it("does not replay earlier lines when the same log only grows", async () => {
    const file = createTempLogFile("keep-me\n");

    try {
      void followLogs(file);
      expect(await waitForLoggedText("keep-me", 2000)).toBe(true);
      const before = logSpy.mock.calls.length;

      writeFileSync(file, "keep-me\nhello-appended\n");
      expect(await waitForLoggedText("hello-appended", 4000)).toBe(true);

      const added = logSpy.mock.calls
        .slice(before)
        .map((call) => call.join(" "))
        .join("\n");
      expect(added).toContain("hello-appended");
      expect(added).not.toContain("keep-me");
    } finally {
      unwatchFile(file);
      cleanup(file);
    }
  });

  it("reports a read error instead of crashing when the log disappears", async () => {
    const file = createTempLogFile("a".repeat(50));
    const crashes: string[] = [];
    const onCrash = (error: Error): void => {
      crashes.push(error.message);
    };
    process.on("uncaughtException", onCrash);

    try {
      void followLogs(file);
      expect(await waitForLoggedText("a".repeat(50), 2000)).toBe(true);
      rmSync(file);

      const started = Date.now();
      let errors = "";
      while (Date.now() - started < 3000) {
        errors = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
        if (errors.includes("ENOENT")) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(errors).toContain("Failed to read log");
      expect(errors).toContain("ENOENT");
      expect(crashes).toEqual([]);
    } finally {
      process.off("uncaughtException", onCrash);
      unwatchFile(file);
      cleanup(file);
    }
  });
});
