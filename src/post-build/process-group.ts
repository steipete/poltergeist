import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

/** Linux signal probes also see zombies, which cannot execute or hold pipes open. */
export async function hasRunningGroupMember(groupId: number): Promise<boolean> {
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = await readFile(`/proc/${entry}/stat`, "utf8");
      const [state, , group] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(group) === groupId && state !== "Z" && state !== "X") return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // hidepid mounts expose other users' PIDs without granting access to their stat files.
      if (code !== "ENOENT" && code !== "ESRCH" && code !== "EACCES" && code !== "EPERM")
        throw error;
    }
  }
  return false;
}

/** Darwin can report EPERM while an empty process group is being reaped. */
export function hasMacOSGroupMember(groupId: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/ps",
      ["-o", "stat=", "-g", String(groupId)],
      { timeout: 500 },
      (error, stdout, stderr) => {
        if (error && !(error.code === 1 && !stdout.trim() && !stderr.trim())) {
          reject(error);
          return;
        }
        resolve(stdout.split(/\s+/).some((state) => state.length > 0 && !state.startsWith("Z")));
      },
    );
  });
}
