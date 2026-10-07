import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  let release!: () => void;
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  const on = vi.fn();
  const command = vi.fn((_args, callback) => callback(null, { version: "fixture" }));
  const end = vi.fn();
  const Client = vi.fn(function () {
    return { on, command, end };
  });
  return { release, loading, on, command, end, Client };
});

vi.mock("fb-watchman", async () => {
  await mock.loading;
  return { default: { Client: mock.Client } };
});

import { createWatchmanClient } from "../src/utils/watchman-wrapper.js";

afterEach(() => mock.release());

it("waits for the same pending client when registering listeners and sending commands", async () => {
  const client = createWatchmanClient();
  const listener = vi.fn();
  client.on("error", listener);
  client.on("subscription", listener);
  const responses: unknown[] = [];
  const requests = ["version", "get-sockname"].map((name) =>
    client.command([name], (error, response) => responses.push(error ?? response)),
  );
  mock.release();
  try {
    await Promise.all(requests);
    expect(mock.Client).toHaveBeenCalledTimes(1);
    expect(mock.on).toHaveBeenCalledWith("error", listener);
    expect(mock.on).toHaveBeenCalledWith("subscription", listener);
    expect(mock.command).toHaveBeenCalledTimes(2);
    expect(responses).toEqual([{ version: "fixture" }, { version: "fixture" }]);
  } finally {
    await client.end();
  }
});
