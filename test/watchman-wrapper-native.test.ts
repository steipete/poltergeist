import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { createWatchmanClient } from "../src/utils/watchman-wrapper.js";

const available = spawnSync("watchman", ["--version"], { timeout: 5000 }).status === 0;

it.skipIf(!available)(
  "shares initialization across immediate listeners and native commands",
  async () => {
    const client = createWatchmanClient();
    client.on("error", () => {});
    client.on("end", () => {});
    client.on("subscription", () => {});
    const command = (args: string[]) =>
      new Promise<{ version?: string; sockname?: string }>((resolve, reject) => {
        void client.command(args, (error, response) => (error ? reject(error) : resolve(response)));
      });
    try {
      const [version, socket] = await Promise.all([
        command(["version"]),
        command(["get-sockname"]),
      ]);
      expect(version.version).toBeTypeOf("string");
      expect(socket.sockname).toBeTypeOf("string");
    } finally {
      await client.end();
    }
  },
);
