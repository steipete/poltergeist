import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { SimpleLogger } from "../src/logger.js";
import { Poltergeist } from "../src/poltergeist.js";
import { ConfigurationManager } from "../src/utils/config-manager.js";
import { createDefaultDependencies } from "../src/factories.js";

const available = spawnSync("watchman", ["--version"], { timeout: 5000 }).status === 0;

it.skipIf(!available).each(["poltergeist.config.json", "custom[dev].json", "configs/custom.json"])(
  "applies a real configuration edit delivered by Watchman for %s",
  async (filename) => {
    const dir = mkdtempSync(join(tmpdir(), "poltergeist-config-reload-"));
    const prior = process.env.POLTERGEIST_STATE_DIR;
    process.env.POLTERGEIST_STATE_DIR = join(dir, "states");
    const configPath = join(dir, filename);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ version: "1.0", projectType: "node", targets: [] }));
    const logger = new SimpleLogger(undefined, "error");
    const deps = createDefaultDependencies(dir, logger);
    // This test covers config delivery/reload, not the separate wrapper initialization race.
    await sleep(100);
    const app = new Poltergeist(
      await ConfigurationManager.loadConfigFromPath(configPath),
      dir,
      logger,
      deps,
      configPath,
    );
    try {
      await app.start(undefined, { waitForInitialBuilds: false });
      await sleep(100);
      writeFileSync(
        configPath,
        JSON.stringify({
          version: "1.0",
          projectType: "node",
          targets: [
            {
              name: "added-by-reload",
              type: "executable",
              enabled: false,
              buildCommand: "echo unused",
              outputPath: "unused",
              watchPaths: [],
            },
          ],
        }),
      );
      const deadline = Date.now() + 5000;
      while (!("added-by-reload" in (await app.getStatus())) && Date.now() < deadline)
        await sleep(20);
      expect(await app.getStatus()).toHaveProperty("added-by-reload");
    } finally {
      await app.stop();
      if (prior === undefined) delete process.env.POLTERGEIST_STATE_DIR;
      else process.env.POLTERGEIST_STATE_DIR = prior;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  10000,
);
