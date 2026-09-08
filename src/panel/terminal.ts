import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Terminal, TuiMainScreen } from "@earendil-works/pi-tui";
import { secureWindowsLogPath } from "./windows-log-acl.js";

export function getPanelLogDirectory(): string {
  return join(homedir(), ".poltergeist-panel");
}

export function createPanelTui(terminal: Terminal, logDirectory: string): TuiMainScreen {
  const tui = new TuiMainScreen(terminal, process.env.PI_HARDWARE_CURSOR === "1", logDirectory);
  tui.setClearOnShrink(process.env.PI_CLEAR_ON_SHRINK === "1");
  return tui;
}

// pi-tui writes these paths itself, so secure them before starting the renderer.
export function preparePanelLogs(directory: string): void {
  if (process.platform === "win32") {
    secureWindowsLogPath(directory, false, true);
  } else {
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const directoryStat = lstatSync(directory);
  const uid = process.getuid?.();
  if (!directoryStat.isDirectory() || (uid !== undefined && directoryStat.uid !== uid)) {
    throw new Error(
      `Panel log directory must be owned by the current user and not a symlink: ${directory}`,
    );
  }
  if (process.platform !== "win32") {
    const fd = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (fstatSync(fd).uid !== uid)
        throw new Error(`Panel log directory owner changed: ${directory}`);
      fchmodSync(fd, 0o700);
    } finally {
      closeSync(fd);
    }
  }

  for (const name of ["pi-tui-crash.log", "pi-tui-debug.log"]) {
    const file = join(directory, name);
    // Exclusive creation distinguishes new files from existing paths on Windows.
    let created = false;
    let fd: number;
    const flags = constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    try {
      fd = openSync(file, flags | constants.O_CREAT | constants.O_EXCL, 0o600);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (lstatSync(file).isSymbolicLink())
        throw new Error(`Panel log must not be a symlink: ${file}`);
      fd = openSync(file, flags);
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (uid !== undefined && stat.uid !== uid)) {
        throw new Error(`Panel log must be a regular file owned by the current user: ${file}`);
      }
      // chmod cannot revoke descriptors another user opened before startup.
      if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
        throw new Error(
          `Panel log is accessible to other users; move it aside before starting: ${file}`,
        );
      }
      if (process.platform === "win32") secureWindowsLogPath(file, created);
      else fchmodSync(fd, 0o600);
    } finally {
      closeSync(fd);
    }
  }
}
