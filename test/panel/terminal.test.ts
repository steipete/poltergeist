import { execFileSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessTerminal } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelTui, preparePanelLogs } from "../../src/panel/terminal.js";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "panel-logs-test-"));
  roots.push(root);
  return { root, directory: join(root, "logs") };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("panel terminal compatibility", () => {
  it.each([undefined, "0", "false", "1"])("preserves PI_*=%s behavior", (value) => {
    vi.stubEnv("PI_HARDWARE_CURSOR", value);
    vi.stubEnv("PI_CLEAR_ON_SHRINK", value);
    const tui = createPanelTui(new ProcessTerminal(), "/unused");
    expect(tui.getShowHardwareCursor()).toBe(value === "1");
    expect(tui.getClearOnShrink()).toBe(value === "1");
  });

  it("forwards each setting independently", () => {
    vi.stubEnv("PI_HARDWARE_CURSOR", "1");
    vi.stubEnv("PI_CLEAR_ON_SHRINK", "0");
    const tui = createPanelTui(new ProcessTerminal(), "/unused");
    expect(tui.getShowHardwareCursor()).toBe(true);
    expect(tui.getClearOnShrink()).toBe(false);
  });
});

describe("private panel logs", () => {
  it.skipIf(process.platform !== "darwin").each(["directory", "file"])(
    "rejects a Darwin %s ACL even when mode bits are private",
    (kind) => {
      const { directory } = fixture();
      preparePanelLogs(directory);
      const path = kind === "directory" ? directory : join(directory, "pi-tui-crash.log");
      execFileSync("/bin/chmod", [
        "+a",
        "everyone allow read,readattr,readextattr,readsecurity",
        path,
      ]);
      expect(lstatSync(path).mode & 0o777).toBe(kind === "directory" ? 0o700 : 0o600);
      expect(() => preparePanelLogs(directory)).toThrow("extended ACL");
    },
  );
  it.skipIf(process.platform !== "win32")(
    "creates private Windows ACLs and rejects previously permissive paths",
    () => {
      const { directory } = fixture();
      preparePanelLogs(directory);
      const run = (script: string) =>
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(script, "utf16le").toString("base64"),
          ],
          {
            env: { ...process.env, PANEL_TEST_DIRECTORY: directory },
            encoding: "utf8",
          },
        );
      const result = run(`
$ErrorActionPreference = 'Stop'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$paths = @($env:PANEL_TEST_DIRECTORY, (Join-Path $env:PANEL_TEST_DIRECTORY 'pi-tui-crash.log'), (Join-Path $env:PANEL_TEST_DIRECTORY 'pi-tui-debug.log'))
foreach ($path in $paths) {
  $acl = Get-Acl -LiteralPath $path
  if (!$acl.AreAccessRulesProtected -or $acl.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $user) { throw 'Unexpected owner or inheritance' }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 1 -or $rules[0].IdentityReference -ne $user -or $rules[0].AccessControlType -ne 'Allow') { throw 'Unexpected access rules' }
}
'private'
`);
      expect(result.trim()).toBe("private");
      run(`
$ErrorActionPreference = 'Stop'
$paths = @($env:PANEL_TEST_DIRECTORY, (Join-Path $env:PANEL_TEST_DIRECTORY 'pi-tui-crash.log'))
foreach ($path in $paths) {
  $acl = Get-Acl -LiteralPath $path
  $everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, 'Read', 'Allow')))
  Set-Acl -LiteralPath $path -AclObject $acl
}
`);
      expect(() => preparePanelLogs(directory)).toThrow();
    },
  );
  it("creates private files and preserves old crash contents on repeated starts", () => {
    const { directory } = fixture();
    preparePanelLogs(directory);
    const crash = join(directory, "pi-tui-crash.log");
    writeFileSync(crash, "previous diagnostic");
    preparePanelLogs(directory);
    expect(readFileSync(crash, "utf8")).toBe("previous diagnostic");
    if (process.platform !== "win32") {
      expect(lstatSync(directory).mode & 0o777).toBe(0o700);
      expect(lstatSync(crash).mode & 0o777).toBe(0o600);
      expect(lstatSync(join(directory, "pi-tui-debug.log")).mode & 0o777).toBe(0o600);
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects existing permissive logs before they can receive new diagnostics",
    () => {
      const { directory } = fixture();
      preparePanelLogs(directory);
      chmodSync(directory, 0o777);
      const crash = join(directory, "pi-tui-crash.log");
      chmodSync(crash, 0o666);
      expect(() => preparePanelLogs(directory)).toThrow("accessible to other users");
      expect(lstatSync(directory).mode & 0o777).toBe(0o700);
      expect(lstatSync(crash).mode & 0o777).toBe(0o666);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects directory symlinks without changing the destination",
    () => {
      const { root, directory } = fixture();
      const target = join(root, "target");
      mkdirSync(target, { mode: 0o755 });
      symlinkSync(target, directory);
      expect(() => preparePanelLogs(directory)).toThrow();
      expect(lstatSync(target).mode & 0o777).toBe(0o755);
    },
  );

  it.skipIf(process.platform === "win32").each(["symlink", "hardlink"])(
    "rejects an existing %s log without modifying its target",
    (kind) => {
      const { root, directory } = fixture();
      mkdirSync(directory);
      const target = join(root, "target");
      writeFileSync(target, "unrelated data", { mode: 0o644 });
      const file = join(directory, "pi-tui-crash.log");
      if (kind === "symlink") symlinkSync(target, file);
      else linkSync(target, file);
      expect(() => preparePanelLogs(directory)).toThrow();
      expect(readFileSync(target, "utf8")).toBe("unrelated data");
      expect(lstatSync(target).mode & 0o777).toBe(0o644);
    },
  );
});
