import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createMockLogger } from "./helpers.js";
import { createWatchmanClient } from "../src/utils/watchman-wrapper.js";
import { WatchmanClient } from "../src/watchman.js";

vi.mock("../src/utils/watchman-wrapper.js", () => ({ createWatchmanClient: vi.fn() }));

it("replaces subscription handlers and removes them on unsubscribe", async () => {
  const transport = Object.assign(new EventEmitter(), {
    command: vi.fn((args: string[], callback: (error: null, result: object) => void) => {
      callback(null, args[0] === "watch-project" ? { watch: "/project" } : { clock: "c:1:1" });
    }),
  });
  vi.mocked(createWatchmanClient).mockReturnValue(transport);
  const client = new WatchmanClient(createMockLogger());
  await client.watchProject("/project");
  const oldCallback = vi.fn();
  const currentCallback = vi.fn();
  const expression = { expression: ["match", "src/*.ts", "wholename"], fields: ["name"] };
  await client.subscribe("/project", "source", expression, oldCallback);
  await client.subscribe("/project", "source", expression, currentCallback);
  transport.emit("subscription", {
    subscription: "source",
    files: [{ name: "src/app.ts", exists: true }],
  });
  expect(oldCallback).not.toHaveBeenCalled();
  expect(currentCallback).toHaveBeenCalledTimes(1);
  await client.unsubscribe("source");
  transport.emit("subscription", {
    subscription: "source",
    files: [{ name: "src/app.ts", exists: true }],
  });
  expect(currentCallback).toHaveBeenCalledTimes(1);
});
