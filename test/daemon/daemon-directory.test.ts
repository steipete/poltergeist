import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { daemonDirectoryFromMetaUrl } from "../../src/daemon/daemon-manager.js";

describe("daemonDirectoryFromMetaUrl", () => {
  it("decodes a file URL instead of using the raw pathname", () => {
    const metaUrl = "file:///C:/repo/src/my%20daemon/daemon-manager.js";
    const directory = daemonDirectoryFromMetaUrl(metaUrl);

    expect(directory).toBe(dirname(fileURLToPath(metaUrl)));
    expect(directory).not.toContain("%20");
    expect(new URL(metaUrl).pathname).toContain("%20");
  });
});
